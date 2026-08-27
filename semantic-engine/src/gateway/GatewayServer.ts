/**
 * Semantic Gateway — فاز ۹.
 *
 * One public port, many single-project workers. The Gateway analyses nothing;
 * it registers projects, supervises workers and routes:
 *
 * ```text
 * /api/v1/gateway/...            administration (registry, lifecycle, metrics)
 * /api/v1/projects               the shape public/open.js already speaks
 * /api/v1/projects/:id/...       proxied to that project's worker, unrewritten
 * ```
 *
 * Two compatibility promises are kept on purpose:
 *
 *   - `GET|POST /api/v1/projects` answers exactly like the platform server did,
 *     so `public/open.js` works against the Gateway without a change;
 *   - proxied paths are **not** rewritten, so `visualizer.js` URLs such as
 *     `/api/v1/projects/<id>/visualization/architecture` reach the worker as
 *     they are.
 */

import * as http from 'http';
import * as path from 'path';
import { GatewayAuth } from './GatewayAuth';
import { proxyRequest } from './GatewayProxy';
import { ProjectRegistry } from '../core/config/ProjectRegistry';
import { CapacityError, LockHeldError, WorkerSupervisor, WorkerSummary } from './WorkerSupervisor';
import { createWorkerConfig, validateWorkerConfig } from './WorkerConfigSchema';
import { ProjectWorkerConfig } from './types';
import { ApiKeyRecord, PermissionScope } from '../security/rbac/types';
import { generateToken } from '../cli/HttpGuard';
import { isPathSafeProjectId } from '../core/config/ProjectIdentity';

export const DEFAULT_GATEWAY_PORT = 4000;

export interface GatewayServerOptions {
  readonly dataRoot: string;
  readonly port?: number;
  readonly host?: string;
  /** توکن bootstrap با دسترسی کامل؛ در نبودش ساخته می‌شود. */
  readonly token?: string;
  readonly registry?: ProjectRegistry;
  readonly supervisor?: WorkerSupervisor;
  readonly now?: () => Date;
}

export interface GatewayStartInfo {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  readonly token: string;
}

interface SseClient {
  readonly res: http.ServerResponse;
}

export class GatewayServer {
  readonly auth: GatewayAuth;
  private readonly bootstrapToken: string;
  readonly registry: ProjectRegistry;
  readonly supervisor: WorkerSupervisor;
  private server?: http.Server;
  private readonly sseClients = new Set<SseClient>();
  private activeRequests = 0;
  private requestsTotal = 0;
  private proxyErrorsTotal = 0;
  private readonly startedAt: number;

  constructor(private readonly options: GatewayServerOptions) {
    this.bootstrapToken = options.token ?? generateToken();
    this.auth = new GatewayAuth(this.bootstrapToken);
    this.registry = options.registry ?? new ProjectRegistry({ dataRoot: options.dataRoot });
    this.supervisor =
      options.supervisor ??
      new WorkerSupervisor({
        dataRoot: options.dataRoot,
        onEvent: event => this.broadcast({ type: 'worker', ...event }),
      });
    this.startedAt = Date.now();
  }

  async start(): Promise<GatewayStartInfo> {
    this.supervisor.startHealthLoop();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handle(req, res).catch(error => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
          }
          res.end(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
          );
        });
      });

      this.server.once('error', reject);
      const port = this.options.port ?? DEFAULT_GATEWAY_PORT;
      const host = this.options.host ?? '127.0.0.1';
      this.server.listen(port, host, () => {
        const address = this.server?.address();
        const boundPort = typeof address === 'object' && address ? address.port : port;
        resolve({
          port: boundPort,
          host,
          url: `http://${host}:${boundPort}`,
          token: this.bootstrapToken,
        });
      });
    });
  }

  async stop(): Promise<void> {
    for (const client of [...this.sseClients]) client.res.end();
    this.sseClients.clear();
    await this.supervisor.stopAll();
    if (this.server) {
      await new Promise<void>(resolve => this.server?.close(() => resolve()));
      this.server = undefined;
    }
  }

  private broadcast(event: Record<string, unknown>): void {
    const now = this.options.now ?? (() => new Date());
    const payload = `event: gateway\ndata: ${JSON.stringify({ ...event, at: now().toISOString() })}\n\n`;
    for (const client of [...this.sseClients]) {
      if (!client.res.writableEnded) client.res.write(payload);
    }
  }

  private send(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', chunk => {
        size += (chunk as Buffer).length;
        if (size > 5 * 1024 * 1024) {
          reject(new Error('request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk as Buffer);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.trim() === '') {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text) as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  /** نگاشت روش/مسیر به permission، با همان واژگان platform. */
  private requiredPermission(method: string, pathname: string): PermissionScope {
    if (/^\/api\/v1\/gateway\/projects(\/|$)/.test(pathname)) {
      if (method === 'GET') return 'project:read';
      if (/\/reindex$/.test(pathname)) return 'semantic:index';
      return 'project:admin';
    }
    if (/\/index$|\/reindex$/.test(pathname)) return 'semantic:index';
    return method === 'GET' ? 'project:read' : 'project:write';
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://gateway.local');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    this.requestsTotal += 1;

    /* سلامت خودِ Gateway هیچ دادهٔ پروژه‌ای ندارد، پس باز است. */
    if (pathname === '/health' || pathname === '/api/v1/gateway/health') {
      this.send(res, 200, this.healthPayload());
      return;
    }
    if (pathname === '/ready' || pathname === '/api/v1/gateway/ready') {
      const payload = this.healthPayload();
      this.send(res, payload.ok ? 200 : 503, payload);
      return;
    }
    if (pathname === '/metrics' || pathname === '/api/v1/gateway/metrics') {
      this.send(res, 200, this.metricsPayload());
      return;
    }

    const auth = this.auth.verify(req, url.searchParams.get('token') ?? undefined);
    if (!auth.authenticated || !auth.record) {
      this.send(res, 401, { error: 'Unauthorized: a valid gateway token is required' });
      return;
    }
    const record = auth.record;

    if (pathname === '/api/v1/gateway/events' && method === 'GET') {
      this.openSse(req, res);
      return;
    }

    /*
    | ── MCP (فاز ۱۰) ────────────────────────────────────────────────────
    |
    | `POST /mcp/:projectId` به `/mcp` روی worker همان پروژه می‌رود. session
    | از لحظهٔ ایجاد به همان پروژه bound است، چون هر پروژه socket خودش را
    | دارد و مسیر هرگز بازنویسی نمی‌شود.
    */
    const mcp = /^\/mcp\/([^/]+)$/.exec(pathname);
    if (mcp) {
      if (!this.auth.hasPermission(record, 'semantic:query')) {
        this.send(res, 403, { error: 'token lacks permission semantic:query' });
        return;
      }
      await this.proxyToProject(req, res, mcp[1]!, record, { targetPath: '/mcp' });
      return;
    }

    const permission = this.requiredPermission(method, pathname);
    if (!this.auth.hasPermission(record, permission)) {
      this.send(res, 403, { error: `token lacks permission ${permission}` });
      return;
    }

    /* ── مدیریت پروژه‌ها ─────────────────────────────────────────────── */
    if (pathname === '/api/v1/gateway/projects' || pathname === '/api/v1/projects') {
      if (method === 'GET') {
        this.send(res, 200, this.projectListPayload(record));
        return;
      }
      if (method === 'POST') {
        await this.registerProject(req, res);
        return;
      }
      this.send(res, 405, { error: `method ${method} not allowed` });
      return;
    }

    const gatewayProject = /^\/api\/v1\/gateway\/projects\/([^/]+)(?:\/(start|stop|restart|reindex))?$/.exec(
      pathname
    );
    if (gatewayProject) {
      await this.gatewayProjectRoute(req, res, gatewayProject[1]!, gatewayProject[2], record);
      return;
    }

    /* ── proxy پروژه‌محور ─────────────────────────────────────────────── */
    /*
    | هر `/api/v1/projects/<id>/…` — با هر method — به worker همان پروژه
    | می‌رود و مسیر بازنویسی نمی‌شود، پس URLهای `visualizer.js` دست‌نخورده
    | کار می‌کنند.
    */
    const proxied = /^\/api\/v1\/projects\/([^/]+)(\/.*)?$/.exec(pathname);
    if (proxied) {
      await this.proxyToProject(req, res, proxied[1]!, record);
      return;
    }

    this.send(res, 404, { error: `route not found: ${method} ${pathname}` });
  }

  private openSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: gateway\ndata: ${JSON.stringify({ type: 'hello' })}\n\n`);

    const client: SseClient = { res };
    this.sseClients.add(client);
    req.on('close', () => this.sseClients.delete(client));
  }

  private healthPayload(): Record<string, unknown> {
    const workers = this.supervisor.list();
    const ready = workers.filter(worker => worker.state === 'ready').length;
    const degraded = workers.filter(worker => worker.degraded).length;

    return {
      ok: degraded === 0,
      gateway: 'semantic-gateway',
      projects: this.registry.list().length,
      workers: workers.length,
      workersReady: ready,
      workersDegraded: degraded,
      activeRequests: this.activeRequests,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  private metricsPayload(): Record<string, unknown> {
    const workers = this.supervisor.list();
    return {
      gateway_projects_total: this.registry.list().length,
      gateway_workers_ready: workers.filter(w => w.state === 'ready').length,
      gateway_workers_unhealthy: workers.filter(w => w.degraded || w.state === 'crashed').length,
      gateway_requests_total: this.requestsTotal,
      gateway_active_requests: this.activeRequests,
      gateway_proxy_errors_total: this.proxyErrorsTotal,
      gateway_worker_restarts_total: workers.reduce((sum, w) => sum + w.restartCount, 0),
      gateway_index_jobs_active: 0,
    };
  }

  private summarize(recordId: string): WorkerSummary | undefined {
    return this.supervisor.list().find(worker => worker.projectId === recordId);
  }

  private projectEntry(id: string): Record<string, unknown> {
    const registered = this.registry.get(id);
    const worker = this.summarize(id);
    const running = worker?.state === 'ready';

    return {
      id,
      name: registered?.name ?? id,
      rootPath: registered?.rootPath ?? '',
      status: running ? 'ready' : worker ? 'indexing' : 'missing',
      workerState: worker?.state ?? 'stopped',
      restartCount: worker?.restartCount ?? 0,
      degraded: worker?.degraded ?? false,
      stats: {
        filesCount: 0,
        symbolsCount: 0,
        dependenciesCount: 0,
      },
    };
  }

  private projectListPayload(record: ApiKeyRecord) {
    const projects = this.registry
      .list()
      .filter(entry => this.auth.canAccessProject(record, entry.id))
      .map(entry => this.projectEntry(entry.id));

    return { total: projects.length, projects };
  }

  private async registerProject(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await this.readBody(req);
    } catch (error) {
      this.send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const rootPath = String(body['path'] ?? body['rootPath'] ?? '');
    if (rootPath.trim() === '') {
      this.send(res, 400, { error: 'path is required' });
      return;
    }

    const name = String(body['name'] ?? path.basename(rootPath));
    const requestedId = body['id'] !== undefined ? String(body['id']) : undefined;

    let registered;
    try {
      registered = this.registry.register({
        rootPath,
        name,
        ...(requestedId && isPathSafeProjectId(requestedId) ? { id: requestedId } : {}),
      });
    } catch (error) {
      this.send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const autoStart = body['autoStart'] === true;
    if (autoStart) {
      try {
        await this.startWorkerFor(registered.id, registered.rootPath, registered.name);
      } catch (error) {
        this.send(res, this.errorStatus(error), {
          error: error instanceof Error ? error.message : String(error),
          project: this.projectEntry(registered.id),
        });
        return;
      }
    }

    this.broadcast({ type: 'project-registered', projectId: registered.id });
    this.send(res, 201, this.projectEntry(registered.id));
  }

  /** ساخت config معتبر یک پروژه؛ عمومی است چون `gateway` CLI هم لازم دارد. */
  configForProject(projectId: string, rootPath: string, name: string): ProjectWorkerConfig {
    return this.configFor(projectId, rootPath, name);
  }

  private configFor(projectId: string, rootPath: string, name: string): ProjectWorkerConfig {
    const config = createWorkerConfig({
      projectId,
      name,
      rootPath,
      watch: true,
      watchOptions: { skipInitialIndex: false },
    } as never);
    const validation = validateWorkerConfig(config as never, { checkFileSystem: true });
    if (!validation.ok) {
      throw new Error(validation.errors.join('; '));
    }
    return validation.config;
  }

  private async startWorkerFor(projectId: string, rootPath: string, name: string) {
    return this.supervisor.start(this.configFor(projectId, rootPath, name));
  }

  private errorStatus(error: unknown): number {
    if (error instanceof CapacityError) return 503;
    if (error instanceof LockHeldError) return 409;
    return 500;
  }

  private async gatewayProjectRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    projectId: string,
    action: string | undefined,
    record: NonNullable<ReturnType<GatewayAuth['verify']>['record']>
  ): Promise<void> {
    const registered = this.registry.get(projectId);
    if (!registered) {
      this.send(res, 404, { error: `unknown project: ${projectId}` });
      return;
    }
    if (!this.auth.canAccessProject(record, projectId)) {
      this.send(res, 403, { error: `token cannot access project ${projectId}` });
      return;
    }

    const method = req.method ?? 'GET';

    if (!action) {
      if (method === 'GET') {
        this.send(res, 200, this.projectEntry(projectId));
        return;
      }
      if (method === 'DELETE') {
        await this.supervisor.stop(projectId);
        this.registry.remove(projectId);
        this.broadcast({ type: 'project-removed', projectId });
        this.send(res, 200, { ok: true, removed: projectId });
        return;
      }
      if (method === 'PATCH') {
        let body: Record<string, unknown>;
        try {
          body = await this.readBody(req);
        } catch (error) {
          this.send(res, 400, { error: error instanceof Error ? error.message : String(error) });
          return;
        }
        const renamed = typeof body['name'] === 'string' ? (body['name'] as string) : undefined;
        const updated = renamed ? this.registry.rename(projectId, renamed) : registered;
        this.send(res, 200, this.projectEntry(updated.id));
        return;
      }
      this.send(res, 405, { error: `method ${method} not allowed` });
      return;
    }

    try {
      switch (action) {
        case 'start': {
          await this.startWorkerFor(projectId, registered.rootPath, registered.name);
          this.send(res, 200, this.projectEntry(projectId));
          return;
        }
        case 'stop': {
          const stopped = await this.supervisor.stop(projectId);
          this.send(res, 200, { ok: stopped, ...this.projectEntry(projectId) });
          return;
        }
        case 'restart': {
          await this.supervisor.restart(projectId);
          this.send(res, 200, this.projectEntry(projectId));
          return;
        }
        case 'reindex': {
          const result = await this.supervisor.reindex(projectId);
          this.send(res, result.status, result.json);
          return;
        }
        default:
          this.send(res, 404, { error: `unknown action: ${action}` });
      }
    } catch (error) {
      this.send(res, this.errorStatus(error), {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async proxyToProject(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    projectId: string,
    record: NonNullable<ReturnType<GatewayAuth['verify']>['record']>,
    options: { targetPath?: string } = {}
  ): Promise<void> {
    if (!this.registry.get(projectId)) {
      this.send(res, 404, { error: `unknown project: ${projectId}` });
      return;
    }
    if (!this.auth.canAccessProject(record, projectId)) {
      this.send(res, 403, { error: `token cannot access project ${projectId}` });
      return;
    }

    const worker = this.supervisor.get(projectId);
    if (!worker || worker.pid === null || worker.exitCode !== null) {
      this.send(res, 502, { error: `worker ${projectId} is not running` });
      return;
    }

    /*
    | توکن داخلی worker از خودِ supervisor پرسیده می‌شود؛ هرگز از کلاینت
    | گرفته نمی‌شود و هرگز در لاگ نمی‌آید.
    */
    const target = {
      socketPath: worker.socketPath,
      token: this.supervisor.workerToken(projectId) ?? '',
    };

    this.activeRequests += 1;
    try {
      await proxyRequest(target, req, res, {
        projectId,
        ...(options.targetPath !== undefined ? { targetPath: options.targetPath } : {}),
        onUpstream: () => undefined,
        onError: () => {
          this.proxyErrorsTotal += 1;
        },
      });
    } finally {
      this.activeRequests -= 1;
    }
  }
}
