/**
 * `semantic-engine` — نقطهٔ ورود CLI — MIG-50.
 *
 * چاپ کردن فقط این‌جا اتفاق می‌افتد. دستورها یک `CommandResult`
 * برمی‌گردانند و این تابع تصمیم می‌گیرد چه چیزی کجا برود — وگرنه
 * `--json` در هر دستور نصفه‌کاره پیاده می‌شود و stderr و stdout قاطی
 * می‌شوند.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EXIT, ParsedArgs, boolOption, parseArgs } from './args';
import { CommandResult } from './commands/types';
import { runIndex } from './commands/index-command';
import { runQuery } from './commands/query-command';
import { runDoctor } from './commands/doctor-command';
import { runServe, runUi, runStart } from './commands/serve-command';
import { runWatch } from './commands/watch-command';
import { createLoggerFromEnv } from '../host/Logger';

const COMMANDS: Record<
  string,
  (args: ParsedArgs, context: { cwd: string; logger: ReturnType<typeof createLoggerFromEnv> }) => Promise<CommandResult>
> = {
  index: runIndex,
  query: runQuery,
  doctor: runDoctor,
  serve: runServe,
  watch: runWatch,
  ui: runUi,
  start: runStart,
};

const HELP = `semantic-engine — standalone code intelligence platform and visualizer

usage:
  semantic-engine <command> [options]

commands:
  index                 scan a project and write project-index.json
  ui                    launch standalone web visualizer and platform server
  start                 index if needed, launch UI/MCP, and keep artifacts updated
  serve                 expose index over MCP or standalone HTTP server
  watch                 index, then keep it up to date until Ctrl+C
  query [tool] [params] run an AI tool against an existing index
  doctor                check this environment

ui & serve options:
  --web / --ui          launch full Web Visualizer UI and REST/LoD APIs (default for 'ui')
  --http                MCP protocol over HTTP
  --stdio               MCP protocol over stdin/stdout (default for 'serve')
  --port <n>            HTTP port                  (default: 4000 for ui, 3000 for http)
  --ui-port <n>          UI port for 'start'         (default: 4000)
  --mcp-port <n>         MCP port for 'start'        (default: 3000)
  --no-watch             start UI/MCP without the file watcher
  --host <addr>         bind address               (default: 127.0.0.1)
  --token <secret>      required bearer token      (generated if omitted)
  --allow-remote        permit a non-loopback bind (needs a strong token)

index options:
  --root <dir>          project to scan            (default: cwd)
  --out <dir>           output directory           (default: <root>/.semantic-engine)
  --no-blueprint        skip blueprint.json
  --vectors             build vector chunks for semantic search (off by default)
  --no-git              skip git metrics
  --no-tree-sitter      heuristic extractors only

watch options:
  --root <dir>          project to watch           (default: cwd)
  --out <dir>           output directory           (default: <root>/.semantic-engine)
  --debounce <ms>       batch window               (default: 500)
  --vectors             build/update vector chunks and embeddings
  --no-blueprint        skip blueprint.json updates
  --blueprint-mode <m>  always (default) or threshold
  --skip-initial-index  internal: watch an existing index without rebuilding it

query options:
  --index <file>        path to project-index.json (default: <root>/.semantic-engine/…)
  --<name> <value>      passed through to the tool
  (no tool name)        list the available tools

global options:
  --json                machine-readable output on stdout
  --help                this text
  --version             package version

exit codes:
  0  success
  1  the command ran and failed
  2  the command line was wrong
  3  doctor found a broken requirement
`;

function packageVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const wantsJson = boolOption(args.options, 'json', false);

  if (boolOption(args.options, 'help', false) || args.command === 'help') {
    process.stdout.write(HELP);
    return EXIT.ok;
  }

  if (boolOption(args.options, 'version', false) || args.command === 'version') {
    process.stdout.write(`${packageVersion()}\n`);
    return EXIT.ok;
  }

  if (!args.command) {
    process.stderr.write(HELP.replace(/^semantic-engine — .*\n\n/, 'usage:\n').trimStart());
    return EXIT.usage;
  }

  const handler = COMMANDS[args.command];
  if (!handler) {
    process.stderr.write(
      `unknown command: ${args.command}\n` +
        `available: ${Object.keys(COMMANDS).join(', ')}\n` +
        `try "semantic-engine --help"\n`
    );
    return EXIT.usage;
  }

  /*
  | SE-EXT-06: `Logger` سطح `info` و `debug` را روی **stdout**
  | می‌نویسد و فقط `warn`/`error` را روی stderr. برای یک کتابخانه
  | انتخاب معقولی است؛ برای یک CLI فاجعه است — اولین خطِ خروجیِ
  | `--json` یک لاگ می‌شود و `JSON.parse` می‌ترکد.
  |
  | حالت `stdio` که از فاز ۰۷ برای سرور MCP وجود دارد دقیقاً همین را
  | حل می‌کند: همه‌چیز به stderr. برای CLI همیشه روشن است، نه فقط با
  | `--json` — چون کاربر به‌هرحال ممکن است stdout را pipe کند، و
  | قرارداد یونیکس هم همین است: داده روی stdout، پیشرفت روی stderr.
  */
  const logger = createLoggerFromEnv(process.env, { stdio: true });

  let result: CommandResult;
  try {
    result = await handler(args, { cwd: process.cwd(), logger });
  } catch (error) {
    /*
    | استک‌تریس روی صفحهٔ کاربر، یک باگ رابط است. پیام می‌رود روی
    | stderr و جزئیات به لاگر — که اگر کسی بخواهد با
    | SEMANTIC_ENGINE_LOG_LEVEL=debug ببیندش.
    */
    const failure = error instanceof Error ? error : new Error(String(error));
    logger.debug('command threw', { stack: failure.stack });
    process.stderr.write(`${failure.message}\n`);
    return EXIT.failure;
  }

  if (result.error) process.stderr.write(`${result.error}\n`);

  if (wantsJson) {
    if (result.json !== undefined) process.stdout.write(`${JSON.stringify(result.json)}\n`);
  } else if (result.text) {
    process.stdout.write(`${result.text}\n`);
  }

  return result.code;
}

export { EXIT };
