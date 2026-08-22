/**
 * ExplainSymbolTool — همه‌چیزِ یک symbol، در یک تماس — GAP-03.
 *
 * سند شکاف‌ها این را «ارزان‌ترین برد کل سند» نامیده و دلیلش را هم
 * گفته: **تمام داده از قبل موجود است، فقط پراکنده.** امروز مدل برای
 * فهمیدن یک symbol باید چهار ابزار جدا صدا بزند و خودش وصله کند:
 *
 * ```
 * find_symbol      → امضا، خط، kind
 * get_dependencies → چه چیزی را صدا می‌زند
 * impact_analysis  → چه کسی آن را صدا می‌زند
 * find_tests       → کدام تست‌ها پوششش می‌دهند
 * ```
 *
 * چهار رفت‌وبرگشت، چهار قالب متفاوت، و هیچ‌کدام نمی‌گویند این
 * اطلاعات چقدر قابل اتکاست.
 *
 * ── تصمیم: `confidence` بخشِ اصلیِ خروجی است، نه یک ضمیمه ──────────
 *
 * نمونهٔ خروجی در سند، فیلدی به نام `confidence` دارد که برای هر
 * بخش می‌گوید داده از کجا آمده (`resolved` در برابر `name-match`).
 * این تنها چیزی است که خروجی را از «چهار تماس، دستی وصله‌شده» متمایز
 * می‌کند: مدل می‌تواند ببیند `calledBy` از یک حدسِ نام آمده و به آن
 * تکیه نکند.
 *
 * ── چه چیزی *ساخته* نمی‌شود ────────────────────────────────────────
 *
 * هیچ فیلدی که داده‌اش نیست، با عدد پیش‌فرض پر نمی‌شود. `complexity`
 * که محاسبه نشده `null` است، نه صفر؛ `git` که نیست، غایب است نه
 * `{commitCount: 0}`. صفرِ ساختگی از نبودِ فیلد بدتر است چون شبیه
 * دادهٔ واقعی است.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { GraphQueryEngine, GraphEdge } from '../../graphs/GraphQueryEngine';
import { FindTestsTool } from './FindTestsTool';
import { SymbolEntry } from '../../core/types/project-index.types';
import { HIGH_CONFIDENCE_THRESHOLD } from '../../graphs/EdgeProvenance';

export interface ExplainSymbolInput extends AiToolInput {
  /** شناسهٔ symbol. */
  readonly id?: string;
  /** یا نامش — اگر یکتا نبود، همهٔ نامزدها گزارش می‌شوند. */
  readonly name?: string;
  /** برای رفع ابهام نام. */
  readonly path?: string;
  /** چند فراخوان و فراخوانده در خروجی. پیش‌فرض ۲۰. */
  readonly limit?: number;
  /** پیش‌فرض ۰ — اینجا **همه‌چیز** نشان داده می‌شود، با برچسب. */
  readonly minConfidence?: number;
}

/** یک طرف رابطه، با منشأش. */
interface RelatedSymbol {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
  readonly line?: number;
  readonly basis: string;
  readonly confidence: number;
}

export interface SymbolExplanation {
  readonly id: string;
  readonly symbol: string;
  readonly kind: string;
  readonly file?: string;
  readonly line: number;
  readonly endLine: number;
  readonly signature: string;
  readonly visibility: string;
  readonly exported: boolean;
  readonly deprecated: boolean;
  readonly documentation: string | null;
  readonly complexity: number | null;
  readonly referenceCount: number | null;
  readonly parameters: readonly unknown[];
  readonly returnType: string | null;
  readonly calls: readonly RelatedSymbol[];
  readonly calledBy: readonly RelatedSymbol[];
  /**
   * تست‌ها، با **دلیل** پیدا شدنشان.
   *
   * `find_tests` دلیلش را از قبل حساب می‌کرد و در فیلد `source`
   * می‌گذاشت؛ نسخهٔ اول این ابزار فقط مسیرها را برمی‌داشت. روی
   * ایندکس واقعی، `runDoctor` دو فایل تستِ کاملاً بی‌ربط می‌گرفت و
   * هیچ راهی نبود که مدل بفهمد آن‌ها یک حدسِ نامِ فایل‌اند
   * (SE-AI-15).
   */
  readonly tests: readonly { readonly path: string; readonly reason: string }[];
  readonly git?: { readonly commitCount: number; readonly hotspotScore: number };
  readonly aiScore?: { readonly importance: number; readonly hotness: number; readonly readPriority: number };
  readonly diagnostics: readonly { readonly severity: string; readonly line: number; readonly message: string }[];
  /** منشأ هر بخش — همان چیزی که خروجیِ وصله‌شدهٔ دستی ندارد. */
  readonly confidence: {
    readonly symbol: number;
    readonly source: string;
    readonly calls: string;
    readonly calledBy: string;
    readonly weakCalls: number;
    readonly weakCalledBy: number;
  };
}

export class ExplainSymbolTool implements AiTool<ExplainSymbolInput> {
  readonly name = 'explain_symbol';
  readonly description =
    'Everything known about one symbol in a single call: signature, complexity, calls, callers, tests, git, scores, diagnostics, and how trustworthy each part is.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Symbol id' },
      name: { type: 'string', description: 'Symbol name (alternative to id)' },
      path: { type: 'string', description: 'File path, to disambiguate a name' },
      limit: { type: 'integer', default: 20 },
      minConfidence: { type: 'integer', default: 0 },
    },
    required: [],
  };

  private engine: GraphQueryEngine | undefined;
  /*
  | تست‌ها از خودِ `find_tests` می‌آیند و نه از یک پیمایش موازی.
  | آن ابزار بیش از نگاشت `testIds` می‌داند (تطبیق نام فایل،
  | پوشهٔ همسایه)، و دو پیاده‌سازی یعنی دو جواب متفاوت برای یک
  | سؤال — که دقیقاً همان چیزی است که این فاز می‌خواهد از بین
  | ببرد.
  */
  private readonly tests: FindTestsTool;

  constructor(private readonly reader: ProjectIndexReader) {
    this.tests = new FindTestsTool(reader);
  }

  async execute(input: ExplainSymbolInput): Promise<AiToolOutput> {
    try {
      const found = this.resolveSymbol(input);
      if ('error' in found) return { success: false, error: found.error, items: found.items };

      const explanation = await this.explain(found.symbol, input);
      return {
        success: true,
        items: [
          {
            id: explanation.id,
            name: explanation.symbol,
            kind: explanation.kind,
            path: explanation.file,
            line: explanation.line,
            source: 'explain-symbol',
            metadata: explanation as unknown as Record<string, unknown>,
          },
        ],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
      };
    }
  }

  /**
   * پیدا کردن symbol از id یا نام.
   *
   * نام مبهم، خطا **نیست**: فهرست نامزدها برمی‌گردد تا مدل بتواند
   * دوباره با `path` بپرسد. خطا دادن اینجا یعنی یک رفت‌وبرگشت
   * اضافه برای چیزی که خودمان می‌دانیم.
   */
  private resolveSymbol(
    input: ExplainSymbolInput
  ): { symbol: SymbolEntry } | { error: string; items: AiToolOutput['items'] } {
    if (input.id) {
      const symbol = this.reader.getSymbolById(input.id);
      if (!symbol) return { error: `No symbol with id ${input.id}`, items: [] };
      return { symbol };
    }

    if (!input.name) return { error: 'Either id or name is required', items: [] };

    let candidates = this.reader.getSymbolsByName(input.name);
    if (input.path) {
      const file = this.reader.getFileByPath(input.path);
      candidates = file ? candidates.filter(symbol => symbol.fileId === file.id) : [];
    }

    if (candidates.length === 0) {
      return { error: `No symbol named ${input.name}`, items: [] };
    }
    if (candidates.length > 1) {
      return {
        error: `${candidates.length} symbols are named ${input.name}; pass id or path`,
        items: candidates.map(symbol => ({
          id: symbol.id,
          name: symbol.fullyQualifiedName || symbol.name,
          kind: symbol.kind,
          path: this.reader.getFileById(symbol.fileId)?.path,
          line: symbol.line,
          source: 'explain-symbol:candidate',
        })),
      };
    }

    return { symbol: candidates[0] };
  }

  private async explain(
    symbol: SymbolEntry,
    input: ExplainSymbolInput
  ): Promise<SymbolExplanation> {
    const limit = input.limit ?? 20;
    const minConfidence = input.minConfidence ?? 0;
    const engine = (this.engine ??= new GraphQueryEngine(this.reader.projectIndex));
    const file = this.reader.getFileById(symbol.fileId);

    const calls = engine
      .callees(symbol.id, { minConfidence })
      .slice(0, limit)
      .map(edge => this.related(edge.to, edge));
    const calledBy = engine
      .callers(symbol.id, { minConfidence })
      .slice(0, limit)
      .map(edge => this.related(edge.from, edge));

    /*
    | diagnosticهای همین symbol: آن‌هایی که خطشان داخل بدنه است.
    | فاز ۳۴ آن‌ها را روی `FileEntry` گذاشت؛ اینجا فقط برش
    | می‌خورند.
    */
    const diagnostics = (file?.diagnostics ?? [])
      .filter(entry => entry.line >= symbol.line && entry.line <= symbol.endLine)
      .map(entry => ({ severity: entry.severity, line: entry.line, message: entry.message }));

    return {
      id: symbol.id,
      symbol: symbol.fullyQualifiedName || symbol.name,
      kind: symbol.kind,
      file: file?.path,
      line: symbol.line,
      endLine: symbol.endLine,
      signature: symbol.signature ?? symbol.name,
      visibility: symbol.visibility ?? 'public',
      exported: symbol.exported ?? false,
      deprecated: symbol.deprecated ?? false,
      documentation: symbol.documentation ?? null,
      complexity: symbol.complexity ?? null,
      referenceCount: symbol.referenceCount ?? null,
      parameters: symbol.parameters ?? [],
      returnType: symbol.returnType ?? null,
      calls,
      calledBy,
      tests: await this.testsFor(symbol),
      /*
      | فیلدهای اختیاری فقط وقتی می‌آیند که داده‌شان هست. صفرِ
      | ساختگی از نبودِ فیلد بدتر است — شبیه دادهٔ واقعی است.
      */
      ...(file?.gitMetrics
        ? {
            git: {
              commitCount: file.gitMetrics.commitCount,
              hotspotScore: file.gitMetrics.hotspotScore,
            },
          }
        : {}),
      ...(file?.aiMetadata?.aiScore
        ? {
            aiScore: {
              importance: file.aiMetadata.aiScore.importance,
              hotness: file.aiMetadata.aiScore.hotness,
              readPriority: file.aiMetadata.aiScore.readPriority,
            },
          }
        : {}),
      diagnostics,
      confidence: {
        symbol: symbol.confidence,
        source: symbol.source,
        calls: summarize(calls),
        calledBy: summarize(calledBy),
        weakCalls: calls.filter(entry => entry.confidence < HIGH_CONFIDENCE_THRESHOLD).length,
        weakCalledBy: calledBy.filter(entry => entry.confidence < HIGH_CONFIDENCE_THRESHOLD).length,
      },
    };
  }

  private async testsFor(
    symbol: SymbolEntry
  ): Promise<{ path: string; reason: string }[]> {
    const file = this.reader.getFileById(symbol.fileId);
    const result = await this.tests.execute({
      symbolId: symbol.id,
      path: file?.path,
      fileId: symbol.fileId,
    });
    if (!result.success) return [];
    return result.items
      .filter((item): item is typeof item & { path: string } => typeof item.path === 'string')
      .map(item => ({ path: item.path, reason: item.source }));
  }

  private related(nodeId: string, edge: GraphEdge): RelatedSymbol {
    const symbol = this.reader.getSymbolById(nodeId);
    const file = symbol
      ? this.reader.getFileById(symbol.fileId)
      : this.reader.getFileById(nodeId);

    return {
      id: nodeId,
      /*
      | مقصدی که symbol نیست، یا یک فایل است (فراخوانی سطح ماژول،
      | فاز ۳۷) یا فقط یک نام خارجی مثل `console.log`. هر دو حالت
      | همان‌طور که هستند گزارش می‌شوند.
      */
      name: symbol?.fullyQualifiedName || symbol?.name || file?.path || nodeId,
      path: file?.path,
      line: symbol?.line,
      basis: edge.basis,
      confidence: edge.confidence,
    };
  }
}

/**
 * یک کلمه دربارهٔ اینکه این بخش چقدر قابل اتکاست.
 *
 * `resolved` وقتی همه‌چیز از کامپایلر آمده، `mixed` وقتی بعضی
 * حدس‌اند، `name-match` وقتی همه حدس‌اند، و `none` وقتی چیزی نیست.
 */
function summarize(entries: readonly RelatedSymbol[]): string {
  if (entries.length === 0) return 'none';
  const weak = entries.filter(entry => entry.confidence < HIGH_CONFIDENCE_THRESHOLD).length;
  if (weak === 0) return 'resolved';
  if (weak === entries.length) return 'name-match';
  return 'mixed';
}
