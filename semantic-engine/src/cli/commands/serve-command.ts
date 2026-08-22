/**
 * `semantic-engine serve` — MIG-54، SE-SEC-03.
 *
 * `--stdio` پیش‌فرض است چون کلاینت MCP همان را می‌خواهد و هیچ سطح
 * حمله‌ای باز نمی‌کند. `--http` وجود دارد چون گاهی لازم است، ولی با
 * چهار مهاری که نسخهٔ قبلی هیچ‌کدام را نداشت.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { ProjectIndex } from '../../core/types/project-index.types';
import { EXIT, ParsedArgs, boolOption, stringOption } from '../args';
import { CommandContext, CommandResult } from './types';
import { DEFAULT_OUTPUT_DIR } from './index-command';
import { INDEX_FILE_NAME } from '../../pipeline/OutputWriter';
import {
  HttpGuard,
  DEFAULT_HOST,
  DEFAULT_MAX_BODY_BYTES,
  generateToken,
  isLoopbackHost,
} from '../HttpGuard';

export function resolveIndexPath(args: ParsedArgs, cwd: string): string {
  return path.resolve(
    stringOption(args.options, 'index') ??
      path.join(stringOption(args.options, 'root') ?? cwd, DEFAULT_OUTPUT_DIR, INDEX_FILE_NAME)
  );
}

export function loadIndex(indexPath: string): ProjectIndex | { error: string } {
  if (!fs.existsSync(indexPath)) {
    return {
      error:
        `index not found: ${indexPath}\n` +
        `run "semantic-engine index" first, or pass --index <path>`,
    };
  }
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as ProjectIndex;
  } catch (error) {
    return {
      error: `index is not readable JSON: ${indexPath}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export async function runServe(args: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const wantsWeb = boolOption(args.options, 'web', false) || boolOption(args.options, 'ui', false);
  const wantsPlatform = boolOption(args.options, 'platform', false) || boolOption(args.options, 'api', false) || wantsWeb;
  const wantsHttp = boolOption(args.options, 'http', false);

  if (wantsHttp || wantsPlatform) {
    const invalid = validateHttpOptions(args);
    if (invalid) return invalid;
  }

  const indexPath = resolveIndexPath(args, context.cwd);
  const loaded = loadIndex(indexPath);
  if ('error' in loaded) return { code: EXIT.failure, error: loaded.error };

  const workspaceRoot = loaded.rootPath ?? path.dirname(path.dirname(indexPath));

  if (wantsPlatform) return runPlatform(loaded, workspaceRoot, args, context);
  if (wantsHttp) return runHttp(loaded, workspaceRoot, args, context);
  return runStdio(loaded, workspaceRoot);
}

export async function runUi(args: ParsedArgs, context: CommandContext): Promise<CommandResult> {
  const invalid = validateHttpOptions(args);
  if (invalid) return invalid;

  /*
  | SE-UI-01: نسخهٔ قبلی این‌جا `loadIndex` را اجباری می‌کرد و اگر
  | `project-index.json` نبود با «run semantic-engine index first»
  | خارج می‌شد — یعنی UI هیچ‌وقت بالا نمی‌آمد تا کاربر بتواند از
  | داخلش پروژه باز کند و ایندکس بگیرد. حالا UI همیشه بالا می‌آید:
  | اگر ایندکس بود بارگذاری می‌شود، وگرنه با یک حالت خالی شروع
  | می‌کند و کاربر از خود UI پروژه را باز/ایندکس می‌کند.
  */
  const indexPath = resolveIndexPath(args, context.cwd);
  const loaded = loadIndex(indexPath);
  const hasIndex = !('error' in loaded);

  const rootRoot = path.resolve(stringOption(args.options, 'root') ?? context.cwd);
  const workspaceRoot = hasIndex
    ? (loaded as ProjectIndex).rootPath ?? path.dirname(path.dirname(indexPath))
    : rootRoot;

  return runPlatform(hasIndex ? (loaded as ProjectIndex) : null, workspaceRoot, args, context);
}

/** بررسی‌های ارزانِ خط فرمان — هیچ‌کدام به دیسک دست نمی‌زنند. */
function validateHttpOptions(args: ParsedArgs): CommandResult | null {
  const rawPort = stringOption(args.options, 'port');
  if (rawPort !== undefined) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      return { code: EXIT.usage, error: `--port must be a number between 0 and 65535` };
    }
  }

  const host = stringOption(args.options, 'host') ?? DEFAULT_HOST;
  if (!isLoopbackHost(host) && !boolOption(args.options, 'allowRemote', false)) {
    return {
      code: EXIT.usage,
      error:
        `refusing to bind ${host}: that exposes the whole index to the network.\n` +
        `pass --allow-remote if you really mean it, and set a strong --token.`,
    };
  }

  return null;
}

async function runPlatform(
  projectIndex: ProjectIndex | null,
  workspaceRoot: string,
  args: ParsedArgs,
  context: CommandContext
): Promise<CommandResult> {
  const port = Number(stringOption(args.options, 'port') ?? 4000);
  const host = stringOption(args.options, 'host') ?? DEFAULT_HOST;
  const provided = stringOption(args.options, 'token') ?? process.env['SEMANTIC_ENGINE_TOKEN'];
  if (boolOption(args.options, 'allowRemote', false) && !provided) {
    return {
      code: EXIT.usage,
      error: 'remote platform mode requires --token or SEMANTIC_ENGINE_TOKEN',
    };
  }
  const token = provided ?? generateToken();


  const { HttpServer } = require('../../server/HttpServer') as typeof import('../../server/HttpServer');
  const server = new HttpServer({
    port,
    host,
    token,
    allowRemote: boolOption(args.options, 'allowRemote', false),
    projectsRoot: workspaceRoot,
  });

  const started = await server.start();

  /*
  | همیشه پروژهٔ ریشه را ثبت می‌کنیم تا از UI قابل باز/ایندکس‌شدن
  | باشد. `registerProject` خودش تشخیص می‌دهد که ایندکس هست یا نه و
  | status را روی `ready` یا `missing` می‌گذارد؛ پس چه ایندکس داشته
  | باشیم چه نه، پروژه در لیست UI ظاهر می‌شود.
  */
  const projName = path.basename(workspaceRoot);
  const projId = projName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  server.projects.registerProject(workspaceRoot, projId, projName);
  server.projects.registerProject(workspaceRoot, `prj-${projId}`, projName);
  const current = server.projects.registerProject(workspaceRoot, 'current', projName);
  const resumedJobs = await server.jobs.resumeInterruptedJobs();

  context.logger.info('platform http server listening', {
    url: started.url,
    tokenSource: provided ? 'provided' : 'generated',
    indexPresent: Boolean(projectIndex) || current.status === 'ready',
    resumedJobs,
  });

  const shutdown = waitForShutdown(async () => {
    await server.stop();
  });

  const indexHint =
    current.status === 'ready'
      ? `   • Loaded index:       ${current.stats.filesCount} files, ${current.stats.symbolsCount} symbols\n`
      : `   • No index yet:       open a project and run indexing from the UI\n`;

  process.stderr.write(
    `\n🚀 Semantic Engine Standalone Web & Platform Server\n` +
      `   • Web Visualizer UI:  ${started.url}/\n` +
      `   • Open / Configure:   ${started.url}/open.html\n` +
      `   • REST & LoD APIs:    ${started.url}/api/v1/...\n` +
      `   • V2 Enterprise APIs: ${started.url}/api/v2/...\n` +
      `   • Health & Metrics:   ${started.url}/health, ${started.url}/metrics\n` +
      indexHint +
      `   • Active Token:       ${token}\n` +
      (provided ? '' : '     (pass --token or SEMANTIC_ENGINE_TOKEN to configure static token)\n\n')
  );

  await shutdown;
  return { code: EXIT.ok };
}

async function runStdio(projectIndex: ProjectIndex, workspaceRoot: string): Promise<CommandResult> {
  /*
  | بارگذاری تنبل — همان دلیل SQLite و transformers: کسی که فقط
  | `index` می‌زند نباید SDK مربوط به MCP را بار کند.
  */

  const { SemanticEngineMcpServer } = require('../../ai/mcp/SemanticEngineMcpServer') as {
    SemanticEngineMcpServer: new (options: {
      projectIndex: ProjectIndex;
      workspaceRoot: string;
    }) => { start(): Promise<void> };
  };

  await new SemanticEngineMcpServer({ projectIndex, workspaceRoot }).start();
  /*
  | `start()` تا وقتی stdin باز است برنمی‌گردد. رسیدن به این‌جا یعنی
  | کلاینت قطع کرده — یک خاموشی عادی.
  */
  return { code: EXIT.ok };
}

async function runHttp(
  projectIndex: ProjectIndex,
  workspaceRoot: string,
  args: ParsedArgs,
  context: CommandContext
): Promise<CommandResult> {
  /*
  | SE-SEC-03: نسخهٔ قبلی `listen(port)` بدون host می‌زد، یعنی روی
  | `0.0.0.0`. اندازه‌گیری‌شده در همین sandbox: در دسترس روی
  | `eth0:169.254.0.21`. حالا پیش‌فرض loopback است و `validateHttpOptions`
  | خروج از آن را یک تصمیم صریح کرده.
  */
  const port = Number(stringOption(args.options, 'port') ?? 3000);
  const host = stringOption(args.options, 'host') ?? DEFAULT_HOST;

  /*
  | توکن اجباری است. اگر داده نشود ساخته و چاپ می‌شود — «فراموش
  | کردم توکن بدهم» نباید به «سرور بی‌محافظ» ترجمه شود.
  */
  const provided = stringOption(args.options, 'token') ?? process.env['SEMANTIC_ENGINE_TOKEN'];
  if (boolOption(args.options, 'allowRemote', false) && !provided) {
    return {
      code: EXIT.usage,
      error: 'remote MCP HTTP mode requires --token or SEMANTIC_ENGINE_TOKEN',
    };
  }
  const token = provided ?? generateToken();

  const maxBodyBytes = Number(
    stringOption(args.options, 'maxBody') ?? DEFAULT_MAX_BODY_BYTES
  );
  const guard = new HttpGuard({ token, maxBodyBytes, path: '/mcp' });


  const { SemanticEngineMcpServer } = require('../../ai/mcp/SemanticEngineMcpServer') as {
    SemanticEngineMcpServer: new (options: {
      projectIndex: ProjectIndex;
      workspaceRoot: string;
    }) => { connectTransport(transport: unknown): Promise<void> };
  };
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );

  const server = http.createServer((request, response) => {
    void guard.handle(request, response, async body => {
      /*
      | SE-SEC-03: نسخهٔ قبلی یک `transport` مشترک بین همهٔ
      | درخواست‌ها نگه می‌داشت و «stateless» می‌نامیدش. دو درخواست
      | هم‌زمان روی همان شیء مسابقه می‌دادند. یک transport به ازای
      | هر درخواست، همان چیزی است که «stateless» یعنی.
      */
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const mcp = new SemanticEngineMcpServer({ projectIndex, workspaceRoot });
      await mcp.connectTransport(transport);

      try {
        await transport.handleRequest(request, response, JSON.parse(body));
      } finally {
        await transport.close?.();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actual = server.address();
  const boundPort = typeof actual === 'object' && actual ? actual.port : port;

  /*
  | آدرس و توکن روی stderr می‌روند، نه stdout: در حالت `--json` هم
  | باید بشود این‌ها را دید بدون اینکه خروجی داده خراب شود.
  */
  context.logger.info('mcp http server listening', {
    url: `http://${host}:${boundPort}/mcp`,
    tokenSource: provided ? 'provided' : 'generated',
  });
  /*
  | همان ترتیبی که فاز ۴۹ در `watch` اصلاح کرد: handler پیش از
  | اعلام آمادگی. سروری که آدرسش را چاپ کرده ولی هنوز Ctrl+C را
  | نمی‌فهمد، به کاربر دروغ گفته است.
  */
  const shutdown = waitForShutdown(
    () => new Promise<void>(resolve => server.close(() => resolve()))
  );

  process.stderr.write(
    `MCP server on http://${host}:${boundPort}/mcp\n` +
      `token: ${token}\n` +
      (provided ? '' : '(generated — pass --token or SEMANTIC_ENGINE_TOKEN to pin it)\n')
  );

  await shutdown;
  return { code: EXIT.ok };
}

/**
 * ماندن تا SIGINT/SIGTERM، بعد خاموشی تمیز.
 *
 * بدون این، `Ctrl+C` پروسه را وسط کار می‌کشد و سوکت‌های باز و — در
 * حالت watch — یک batch نیمه‌نوشته جا می‌ماند.
 */
export function waitForShutdown(cleanup: () => Promise<void>): Promise<void> {
  return new Promise<void>(resolve => {
    let closing = false;

    const stop = (signal: string): void => {
      if (closing) return;
      closing = true;
      process.stderr.write(`\nreceived ${signal}, shutting down…\n`);
      void cleanup().then(
        () => resolve(),
        () => resolve()
      );
    };

    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}
