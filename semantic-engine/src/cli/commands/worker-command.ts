/**
 * `semantic-engine worker` — فاز ۷.
 *
 * One process, one project. This is the unit the Gateway supervises (فاز ۸),
 * and it is also useful on its own: a worker started by hand serves the same
 * REST surface plus the `/internal/*` endpoints, with no Gateway involved.
 *
 * What it owns:
 *
 *   - the artifact paths, through `projectPathsFromArgs` (never re-derived);
 *   - the platform HTTP server, on a Unix socket or a loopback port;
 *   - an optional `watch` child, so the index stays fresh;
 *   - the internal lifecycle surface: health, ready, metrics, status,
 *     reindex, reload, shutdown.
 *
 * Readiness is honest: until an index is loaded, `/internal/ready` answers 503,
 * which is what lets the Gateway wait for a worker instead of guessing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EXIT, ParsedArgs, boolOption, stringOption } from '../args';
import { CommandContext, CommandResult } from './types';
import { runIndex } from './index-command';
import { artifactLocationFromArgs, projectPathsFromArgs } from '../projectPathsFromArgs';
import { DEFAULT_HOST, generateToken } from '../HttpGuard';
import { spawnService, stopChild, StartedChild } from './serve-command';
import type { HttpServer } from '../../server/HttpServer';
import type { RouteDefinition } from '../../server/types';

interface WorkerStatus {
  readonly ok: boolean;
  readonly projectId: string;
  readonly pid: number;
  readonly state: 'starting' | 'ready' | 'degraded';
  readonly indexState: 'fresh' | 'missing' | 'stale';
  readonly watcher: 'running' | 'stopped';
  readonly files: number;
  readonly symbols: number;
  readonly dependencies: number;
  readonly vectorChunks: number;
  readonly sqlite: boolean;
  readonly blueprint: boolean;
  readonly memoryMb: number;
  readonly queueSize: number;
  readonly lastIndexedAt?: string;
}

export async function runWorker(
  args: ParsedArgs,
  context: CommandContext
): Promise<CommandResult> {
  const root = stringOption(args.options, 'root') ?? context.cwd;
  const paths = projectPathsFromArgs(args, root);

  if (!fs.existsSync(paths.workspaceRoot) || !fs.statSync(paths.workspaceRoot).isDirectory()) {
    return {
      code: EXIT.failure,
      error: `--root does not exist or is not a directory: ${paths.workspaceRoot}`,
    };
  }

  const socketPath = stringOption(args.options, 'socket');
  const rawPort = stringOption(args.options, 'port');
  const port = rawPort === undefined ? 0 : Number(rawPort);
  if (rawPort !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    return { code: EXIT.usage, error: '--port must be a number between 0 and 65535' };
  }

  const host = stringOption(args.options, 'host') ?? DEFAULT_HOST;
  const gatewayManaged = boolOption(args.options, 'gatewayManaged', false);
  const token =
    stringOption(args.options, 'token') ??
    process.env['SEMANTIC_ENGINE_TOKEN'] ??
    generateToken();

  /* Index on start unless told not to: a worker with no index is not ready,
     and the Gateway would just wait for a 503 forever. */
  if (!fs.existsSync(paths.indexPath) && !boolOption(args.options, 'skipInitialIndex', false)) {
    const indexed = await runIndex(args, context);
    if (indexed.code !== EXIT.ok) return indexed;
  }

  const { HttpServer: PlatformServer } = require('../../server/HttpServer') as typeof import('../../server/HttpServer');
  const server: HttpServer = new PlatformServer({
    port,
    host,
    token,
    projectsRoot: paths.workspaceRoot,
    dataRoot: paths.dataRoot,
    artifactLocation: artifactLocationFromArgs(args, process.env),
    ...(socketPath !== undefined ? { socketPath } : {}),
    ...(gatewayManaged ? { gatewayManaged: true } : {}),
  });

  const project = server.projects.registerProject(
    paths.workspaceRoot,
    paths.projectId,
    path.basename(paths.workspaceRoot)
  );

  const startedAt = Date.now();
  let watcher: StartedChild | null = null;
  let reindexing = false;

  const status = (): WorkerStatus => {
    const current = server.projects.getProject(paths.projectId);
    const stats = current?.stats;
    const indexState: WorkerStatus['indexState'] = !current || current.status === 'missing'
      ? 'missing'
      : current.status === 'stale'
        ? 'stale'
        : 'fresh';

    return {
      ok: indexState === 'fresh',
      projectId: paths.projectId,
      pid: process.pid,
      state: indexState === 'fresh' ? 'ready' : indexState === 'stale' ? 'degraded' : 'starting',
      indexState,
      watcher: watcher && watcher.child.exitCode === null ? 'running' : 'stopped',
      files: stats?.filesCount ?? 0,
      symbols: stats?.symbolsCount ?? 0,
      dependencies: stats?.dependenciesCount ?? 0,
      vectorChunks: current?.index?.vectorChunks?.length ?? 0,
      sqlite: Boolean(current?.sqlitePath && fs.existsSync(current.sqlitePath)),
      blueprint: Boolean(current?.blueprint),
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      queueSize: reindexing ? 1 : 0,
      ...(stats?.lastIndexedAt !== undefined ? { lastIndexedAt: stats.lastIndexedAt } : {}),
    };
  };

  let requestShutdown: (result: CommandResult) => void = () => undefined;

  const internalRoutes: RouteDefinition[] = [
    {
      method: 'GET',
      pattern: '/internal/health',
      permission: 'project:read',
      handler: async () => {
        const snapshot = status();
        return { status: snapshot.ok ? 200 : 503, json: snapshot };
      },
    },
    {
      method: 'GET',
      pattern: '/internal/status',
      permission: 'project:read',
      handler: async () => {
        const snapshot = status();
        return { status: snapshot.ok ? 200 : 503, json: snapshot };
      },
    },
    {
      method: 'GET',
      pattern: '/internal/ready',
      permission: 'project:read',
      handler: async () => {
        const snapshot = status();
        /* تا وقتی ایندکس load نشده، «آماده» یعنی دروغ. */
        return {
          status: snapshot.indexState === 'fresh' ? 200 : 503,
          json: { ready: snapshot.indexState === 'fresh', ...snapshot },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/internal/metrics',
      permission: 'project:read',
      handler: async () => {
        const snapshot = status();
        return {
          status: 200,
          json: {
            worker_uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
            worker_memory_bytes: process.memoryUsage().rss,
            worker_active_requests: 0,
            worker_queue_size: snapshot.queueSize,
            worker_files_total: snapshot.files,
            worker_symbols_total: snapshot.symbols,
            worker_dependencies_total: snapshot.dependencies,
            worker_vector_chunks_total: snapshot.vectorChunks,
            worker_restart_count: 0,
            worker_index_state: snapshot.indexState,
          },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/internal/reindex',
      permission: 'semantic:index',
      handler: async () => {
        if (reindexing) {
          return { status: 409, json: { ok: false, error: 'an index run is already in progress' } };
        }
        reindexing = true;
        void runIndex(args, context)
          .then(() => server.projects.reloadProject(paths.projectId))
          .catch(() => undefined)
          .finally(() => {
            reindexing = false;
          });
        return { status: 202, json: { ok: true, started: true, projectId: paths.projectId } };
      },
    },
    {
      method: 'POST',
      pattern: '/internal/reload',
      permission: 'semantic:index',
      handler: async () => {
        const reloaded = server.projects.reloadProject(paths.projectId);
        return {
          status: reloaded ? 200 : 404,
          json: { ok: Boolean(reloaded), projectId: paths.projectId, state: status().state },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/internal/shutdown',
      permission: 'project:write',
      handler: async () => {
        /* پاسخ اول، خاموشی بعد: کلاینت باید بداند دستور رسیده است. */
        setImmediate(() =>
          requestShutdown({
            code: EXIT.ok,
            json: { ok: true, shutdown: true, projectId: paths.projectId },
            text: 'worker stopped',
          })
        );
        return { status: 200, json: { ok: true, shuttingDown: true } };
      },
    },
  ];

  for (const route of internalRoutes) server.addRoute(route);

  const info = await server.start();
  context.logger.info('worker listening', {
    url: info.url,
    projectId: project.id,
    artifactRoot: paths.artifactRoot,
    indexState: status().indexState,
  });

  /* Watcher اختیاری است؛ `--no-watch` دقیقاً همان معنای `serve` را دارد. */
  if (boolOption(args.options, 'watch', true)) {
    try {
      watcher = spawnService(
        [
          'watch',
          '--root',
          paths.workspaceRoot,
          '--project-id',
          paths.projectId,
          '--data-dir',
          paths.dataRoot,
          '--out',
          paths.artifactRoot,
          '--skip-initial-index',
        ],
        /press Ctrl\+C/,
        paths.workspaceRoot
      );
      await watcher.ready;
    } catch {
      /* نبود watcher نباید worker را از سرویس دادن بیندازد. */
      watcher = null;
    }
  }

  const onSignal = (signal: NodeJS.Signals): void => {
    requestShutdown({
      code: EXIT.ok,
      json: { ok: true, shutdown: true, signal, projectId: paths.projectId },
      text: `worker stopped (${signal})`,
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const result = await new Promise<CommandResult>(resolve => {
    requestShutdown = resolve;
  });

  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);

  if (watcher) await stopChild(watcher.child);
  await server.stop();
  if (socketPath) {
    try {
      fs.rmSync(socketPath, { force: true });
    } catch {
      /* فایل socket ممکن است از قبل برداشته شده باشد. */
    }
  }

  context.logger.info('worker stopped', { projectId: paths.projectId, url: info.url });
  return result;
}
