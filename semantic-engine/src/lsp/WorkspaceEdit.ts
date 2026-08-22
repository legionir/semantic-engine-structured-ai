/**
 * اعمال `WorkspaceEdit` — نوشتن روی فایل‌های کاربر.
 *
 * این خطرناک‌ترین کد کل زیرسیستم LSP است: هرچیز دیگری *می‌خواند*، این
 * یکی **می‌نویسد**. پس سه قاعده بر همه‌چیز مقدم است:
 *
 * ۱. **هیچ نوشتنی بیرون از ریشهٔ workspace.** یک سرور مخرب — یا فقط
 *    یک سرور با پیکربندی عجیب — می‌تواند در `WorkspaceEdit` مسیری
 *    مثل `file:///etc/passwd` یا `../../.ssh/config` بگذارد. همان
 *    خانوادهٔ SE-SEC-01 است که فاز ۰۴ برای `GitClient` بست.
 * ۲. **همه یا هیچ.** اول کل نقشه ساخته می‌شود و اعتبارسنجی، بعد
 *    نوشتن. یک rename نیمه‌اعمال‌شده، کدبیس را در حالتی می‌گذارد که
 *    نه قبل است نه بعد — و کاربر نمی‌داند کدام فایل‌ها عوض شده‌اند.
 * ۳. **ویرایش‌ها از آخر به اول.** هر ویرایش با موقعیتِ *متن اصلی*
 *    بیان شده است. اگر از اول شروع کنیم، اولین درج، همهٔ موقعیت‌های
 *    بعدی را می‌لغزاند.
 *
 * ── چرا خودمان و نه `workspace/applyEdit` ──────────────────────────
 *
 * آن پیام برای وقتی است که سرور بخواهد ویرایشگر را وادار به تغییر
 * کند؛ ما ویرایشگر نیستیم و از فاز ۳۲ صریحاً `{applied:false}`
 * جواب می‌دهیم. اینجا جهت برعکس است: *ما* خواسته‌ایم، پس *ما* اعمال
 * می‌کنیم.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RangeLike } from '../symbols/types';
import { pathOf } from './LspClient';

export interface TextEditLike {
  readonly range: RangeLike;
  readonly newText: string;
}

export interface TextDocumentEditLike {
  readonly textDocument: { readonly uri: string; readonly version?: number | null };
  readonly edits: readonly TextEditLike[];
}

export interface WorkspaceEditLike {
  readonly changes?: Record<string, readonly TextEditLike[]>;
  readonly documentChanges?: readonly (TextDocumentEditLike | { readonly kind: string })[];
}

export interface PlannedFileEdit {
  /** مسیر مطلق روی دیسک. */
  readonly path: string;
  /** همان مسیر، نسبت به ریشه — چیزی که به مدل نشان داده می‌شود. */
  readonly relativePath: string;
  readonly editCount: number;
  readonly before: string;
  readonly after: string;
}

export interface WorkspaceEditPlan {
  readonly files: readonly PlannedFileEdit[];
  readonly totalEdits: number;
}

export interface PlanOptions {
  readonly rootPath: string;
  /** برای تست و برای متنی که هنوز روی دیسک نیست. */
  readonly readFile?: (filePath: string) => string;
}

export class WorkspaceEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceEditError';
  }
}

/**
 * نقشه‌ای از آنچه قرار است نوشته شود — بدون نوشتن.
 *
 * همین تابع، هم مسیر `dry_run` است و هم مرحلهٔ اول مسیر واقعی. یعنی
 * چیزی که در `dry_run` دیده می‌شود، دقیقاً همان چیزی است که اعمال
 * می‌شود؛ نه یک تخمینِ جداگانه که می‌تواند واگرا شود.
 */
export function planWorkspaceEdit(
  edit: WorkspaceEditLike | null | undefined,
  options: PlanOptions
): WorkspaceEditPlan {
  const read = options.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf8'));
  const root = path.resolve(options.rootPath);
  const byUri = collectEdits(edit);

  const files: PlannedFileEdit[] = [];
  let totalEdits = 0;

  for (const [uri, edits] of byUri) {
    const filePath = resolveInsideRoot(uri, root);
    const before = read(filePath);
    const after = applyTextEdits(before, edits);
    files.push({
      path: filePath,
      relativePath: path.relative(root, filePath) || path.basename(filePath),
      editCount: edits.length,
      before,
      after,
    });
    totalEdits += edits.length;
  }

  // ترتیب قطعی: خروجی نباید به ترتیب کلیدهای یک شیء JSON وابسته باشد.
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, totalEdits };
}

/** نوشتن نقشه روی دیسک. فقط فایل‌هایی که واقعاً عوض شده‌اند. */
export async function applyEditPlan(plan: WorkspaceEditPlan): Promise<readonly string[]> {
  const written: string[] = [];
  for (const file of plan.files) {
    if (file.before === file.after) continue;
    await fs.promises.writeFile(file.path, file.after, 'utf8');
    written.push(file.relativePath);
  }
  return written;
}

/**
 * اعمال ویرایش‌های یک فایل.
 *
 * ویرایش‌ها به آفست تبدیل می‌شوند و بعد **از آخر به اول** اعمال — و
 * پیش از آن، هم‌پوشانی رد می‌شود. طبق پروتکل، ویرایش‌های یک سند
 * نباید هم‌پوشانی داشته باشند؛ اگر داشته باشند نتیجه به ترتیب اعمال
 * بستگی پیدا می‌کند، یعنی خروجی غیرقطعی روی کد کاربر.
 */
export function applyTextEdits(text: string, edits: readonly TextEditLike[]): string {
  if (edits.length === 0) return text;

  const starts = lineStarts(text);
  const resolved = edits.map(edit => ({
    start: offsetOf(edit.range.start, starts, text.length),
    end: offsetOf(edit.range.end, starts, text.length),
    newText: edit.newText,
  }));

  for (const item of resolved) {
    if (item.end < item.start) {
      throw new WorkspaceEditError(
        `edit range ends before it starts (${item.start}…${item.end})`
      );
    }
  }

  const ordered = [...resolved].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].start < ordered[index - 1].end) {
      throw new WorkspaceEditError(
        `overlapping edits at offsets ${ordered[index - 1].start}…${ordered[index - 1].end} ` +
          `and ${ordered[index].start}…${ordered[index].end}`
      );
    }
  }

  let out = text;
  for (let index = ordered.length - 1; index >= 0; index--) {
    const item = ordered[index];
    out = out.slice(0, item.start) + item.newText + out.slice(item.end);
  }
  return out;
}

// ── درون ──────────────────────────────────────────────────────────────

function collectEdits(
  edit: WorkspaceEditLike | null | undefined
): Map<string, readonly TextEditLike[]> {
  const byUri = new Map<string, TextEditLike[]>();
  if (!edit) return byUri;

  const add = (uri: string, edits: readonly TextEditLike[]): void => {
    const existing = byUri.get(uri);
    if (existing) existing.push(...edits);
    else byUri.set(uri, [...edits]);
  };

  for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);

  for (const change of edit.documentChanges ?? []) {
    /*
    | `documentChanges` می‌تواند ساخت/حذف/تغییرنامِ فایل هم باشد.
    | پیاده نکردنشان یک تصمیم است: rename و organizeImports هیچ‌کدام
    | لازمشان ندارند، و نادیده گرفتن بی‌صدای یک «فایل را پاک کن»
    | بدترین حالت ممکن است.
    */
    if ('kind' in change) {
      throw new WorkspaceEditError(
        `workspace edit asks for a "${change.kind}" file operation, which is not supported`
      );
    }
    add(change.textDocument.uri, change.edits);
  }

  return byUri;
}

/**
 * URI → مسیر، با اطمینان از اینکه داخل ریشه است.
 *
 * `path.relative` تنها سنجهٔ قابل اتکاست: مقایسهٔ رشته‌ای با پیشوند،
 * `root-sibling/` را هم داخل `root` می‌بیند.
 */
export function resolveInsideRoot(uri: string, rootPath: string): string {
  if (!uri.startsWith('file:')) {
    throw new WorkspaceEditError(`refusing a non-file URI: ${uri}`);
  }

  let filePath: string;
  try {
    filePath = path.resolve(pathOf(uri));
  } catch (error) {
    throw new WorkspaceEditError(`could not read the URI ${uri}: ${(error as Error).message}`);
  }

  const root = path.resolve(rootPath);
  const relative = path.relative(root, filePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkspaceEditError(
      `refusing to edit ${filePath}: it is outside the workspace root ${root}`
    );
  }
  return filePath;
}

/** آفست شروع هر خط. `\r\n` و `\r` تنها هم خط‌شکن‌اند. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\n') {
      starts.push(index + 1);
    } else if (char === '\r') {
      if (text[index + 1] === '\n') index++;
      starts.push(index + 1);
    }
  }
  return starts;
}

/**
 * موقعیت LSP → آفست رشته.
 *
 * `character` در واحد UTF-16 است (سرور `positionEncoding: "utf-16"`
 * اعلام کرد) و رشتهٔ جاوااسکریپت هم همان است، پس جمع مستقیم درست
 * است — برای ایموجی هم، که در هر دو دو واحد است.
 *
 * موقعیت بیرون از متن به مرز نزدیک بریده می‌شود: سرورها برای «انتهای
 * فایل» گاهی خطی می‌دهند که وجود ندارد.
 */
function offsetOf(
  position: { line: number; character: number },
  starts: readonly number[],
  length: number
): number {
  if (position.line < 0) return 0;
  if (position.line >= starts.length) return length;
  return Math.min(starts[position.line] + Math.max(0, position.character), length);
}
