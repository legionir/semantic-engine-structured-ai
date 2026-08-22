/**
 * `semantic-engine doctor` — MIG-55.
 *
 * بررسی: نسخهٔ Node، در دسترس بودن `git`، وجود فایل‌های wasm،
 * بارگذاری ماژول‌های native، دسترسی نوشتن.
 *
 * ── تصمیم: «اختیاری» یک حالت درجهٔ اول است ────────────────────────
 *
 * `sqlite3` و `usearch` باینری‌شان را در نصب دانلود می‌کنند و در
 * محیط بدون شبکه یا با گواهی TLS شرکتی نصب نمی‌شوند (SE-BUILD-10).
 * اگر نبودشان `doctor` را قرمز کند، این دستور دقیقاً در محیطی که
 * بیشترین کاربرد را دارد همیشه شکست می‌خورد و کسی جدی‌اش نمی‌گیرد.
 *
 * پس گزارش می‌شوند، ولی روی کد خروج اثر ندارند.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { EXIT, ParsedArgs } from '../args';
import { CommandContext, CommandResult } from './types';
import { resolveGrammarDir } from '../../pipeline/ExtractorFactory';
import { LspServerRegistry } from '../../lsp/registry';
import { LspClient } from '../../lsp/LspClient';

/** کمینهٔ Node که پکیج ادعا می‌کند پشتیبانی می‌کند. */
const MIN_NODE_MAJOR = 20;

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** نبودنش خرابی نیست — فقط قابلیتی کمتر. */
  readonly optional?: boolean;
}

function checkNode(): DoctorCheck {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    name: 'node',
    ok: Number.isFinite(major) && major >= MIN_NODE_MAJOR,
    detail:
      major >= MIN_NODE_MAJOR
        ? `v${process.versions.node}`
        : `v${process.versions.node} — needs >= ${MIN_NODE_MAJOR}`,
  };
}

function checkGit(): DoctorCheck {
  const result = spawnSync('git', ['--version'], { encoding: 'utf8' });
  const ok = result.status === 0;
  return {
    name: 'git',
    ok,
    detail: ok
      ? (result.stdout || '').trim()
      : 'not on PATH — git metrics and drift detection will be skipped',
    optional: true,
  };
}

function checkGrammars(cwd: string): DoctorCheck {
  const dir = resolveGrammarDir(cwd, null);
  let found: string[] = [];
  try {
    found = fs.readdirSync(dir).filter(name => name.endsWith('.wasm'));
  } catch {
    /* شمردن صفر، خودش جواب است */
  }

  return {
    name: 'tree-sitter-grammars',
    ok: found.length > 0,
    detail:
      found.length > 0
        ? `${found.length} grammar(s) in ${dir}`
        : `no .wasm grammars in ${dir} — TypeScript and JavaScript fall back to heuristics`,
    optional: true,
  };
}

function checkOptionalModule(name: string): DoctorCheck {
  try {
    require(name);
    return { name, ok: true, detail: 'loads', optional: true };
  } catch (error) {
    /*
    | اولین خطِ *غیرخالی*: پیام `sharp` با یک خط خالی شروع می‌شود و
    | `split('\n')[0]` یک رشتهٔ تهی می‌داد — گزارشی که چیزی نمی‌گفت.
    */
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.split('\n').map(line => line.trim()).find(Boolean) ?? 'failed to load';
    return {
      name,
      ok: false,
      detail: `unavailable — ${message}`,
      optional: true,
    };
  }
}

function checkWriteAccess(target: string): DoctorCheck {
  const probe = path.join(target, `.semantic-engine-doctor-${process.pid}`);
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    return { name: 'write-access', ok: true, detail: target };
  } catch (error) {
    return {
      name: 'write-access',
      ok: false,
      detail: `cannot write in ${target} — ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function checkTempAccess(): DoctorCheck {
  const dir = os.tmpdir();
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return { name: 'temp-dir', ok: true, detail: dir };
  } catch {
    return { name: 'temp-dir', ok: false, detail: `not writable: ${dir}` };
  }
}

/**
 * زبان‌سرورها — LSP-11.
 *
 * سه چیز گزارش می‌شود و هیچ‌کدام روی کد خروج اثر ندارد: کدام سرور
 * نصب است، کدام نیست (با دستور نصبش)، و کدام نصب است ولی به این
 * پروژه نمی‌خورد.
 *
 * «نبود سرور» خرابی نیست — موتور با tree-sitter کار می‌کند. اگر
 * `doctor` را قرمز کند، در محیطی که هیچ سروری نصب نیست همیشه شکست
 * می‌خورد و کسی جدی‌اش نمی‌گیرد؛ همان استدلالی که برای `sqlite3`
 * در بالای این فایل نوشته شده.
 */
function checkLanguageServers(cwd: string): DoctorCheck[] {
  const registry = new LspServerRegistry();
  const detections = registry.detectAll(cwd);
  const usable = detections.filter(detection => detection.resolved && detection.suitable);

  const summary: DoctorCheck = {
    name: 'language-servers',
    ok: usable.length > 0,
    detail:
      usable.length > 0
        ? `${usable.length} of ${detections.length} available: ${usable.map(d => d.id).join(', ')}`
        : `none of ${detections.length} known servers is available — symbol extraction uses tree-sitter`,
    optional: true,
  };

  /*
  | فقط سرورهایی که *نیستند* و زبانشان پرکاربرد است، یک خط راهنما
  | می‌گیرند. نُه خط «نصب نیست» برای کسی که فقط TypeScript
  | می‌نویسد، نویز است — پس فهرست کوتاه می‌ماند و بقیه در خروجی
  | JSON هستند.
  */
  const lines = detections
    .filter(detection => !detection.resolved || !detection.suitable)
    .slice(0, 3)
    .map(detection => ({
      name: `  lsp:${detection.id}`,
      ok: false,
      detail: detection.reason,
      optional: true,
    }));

  return [summary, ...lines];
}

/**
 * تست سلامت: سروری که پیدا شده، واقعاً دست می‌دهد؟
 *
 * «باینری هست» با «کار می‌کند» یکی نیست — یک `tsc` نسخهٔ ۵ روی
 * PATH هر دو را برآورده نمی‌کند (SE-LSP-07). این تست فقط روی
 * سرورهای *پیداشده* اجرا می‌شود و سررسید کوتاهی دارد، وگرنه
 * `doctor` روی ماشینی با سرور کند، خودش کند می‌شود.
 */
async function checkServerHandshake(cwd: string): Promise<DoctorCheck[]> {
  const registry = new LspServerRegistry();
  const usable = registry
    .detectAll(cwd)
    .filter(detection => detection.resolved && detection.suitable)
    .slice(0, 2);

  const checks: DoctorCheck[] = [];
  for (const detection of usable) {
    const resolved = detection.resolved!;
    const client = new LspClient({
      id: detection.id,
      command: resolved.command,
      args: resolved.args,
      rootPath: cwd,
      initializeTimeoutMs: 10_000,
      shutdownTimeoutMs: 3_000,
    });
    const startedAt = Date.now();
    try {
      const result = await client.start();
      checks.push({
        name: `  lsp:${detection.id}`,
        ok: true,
        detail: `handshake in ${Date.now() - startedAt}ms — ${
          result.serverInfo?.name ?? 'unnamed'
        } ${result.serverInfo?.version ?? ''}`.trim(),
        optional: true,
      });
    } catch (error) {
      checks.push({
        name: `  lsp:${detection.id}`,
        ok: false,
        detail: `found at ${resolved.command} but the handshake failed — ${
          error instanceof Error ? error.message : String(error)
        }`,
        optional: true,
      });
    } finally {
      await client.stop();
    }
  }
  return checks;
}

export async function runDoctor(
  _args: ParsedArgs,
  context: CommandContext
): Promise<CommandResult> {
  const checks: DoctorCheck[] = [
    checkNode(),
    checkGit(),
    checkGrammars(context.cwd),
    checkOptionalModule('chokidar'),
    checkOptionalModule('sqlite3'),
    checkOptionalModule('usearch'),
    checkWriteAccess(context.cwd),
    checkTempAccess(),
    ...checkLanguageServers(context.cwd),
    ...(await checkServerHandshake(context.cwd)),
  ];

  const blocking = checks.filter(check => !check.ok && !check.optional);
  const ok = blocking.length === 0;

  const lines = checks.map(check => {
    const mark = check.ok ? 'ok  ' : check.optional ? 'warn' : 'FAIL';
    return `${mark}  ${check.name.padEnd(22)} ${check.detail}`;
  });

  const degraded = checks.filter(check => !check.ok && check.optional);
  if (degraded.length > 0) {
    lines.push(
      '',
      `${degraded.length} optional component(s) unavailable; the engine still runs without them.`
    );
  }

  return {
    code: ok ? EXIT.ok : EXIT.unhealthy,
    json: { ok, checks },
    text: lines.join('\n'),
  };
}
