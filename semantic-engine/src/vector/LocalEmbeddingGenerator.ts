/**
 * LocalEmbeddingGenerator — تولید embedding با مدل محلی @xenova/transformers.
 *
 * مدل پیش‌فرض: Xenova/all-MiniLM-L6-v2
 * - اندازه: ~۲۲MB
 * - ابعاد: ۳۸۴
 * - رایگان، offline، بدون API key
 *
 * نکته: اولین فراخوانی download مدل را انجام می‌دهد و ممکن است کند باشد.
 *
 * ── SE-EXT-05 ─────────────────────────────────────────────────────
 *
 * `@xenova/transformers` این‌جا **ایستا** import می‌شد. آن بسته
 * `sharp` را می‌کشد، که یک ماژول native با باینری دانلودی است. چون
 * barrel عمومی این کلاس را صادر می‌کند، نتیجه این بود که
 * `require('@aicoder/semantic-engine')` در هر محیطی که `sharp` build
 * نشده باشد کاملاً می‌ترکید:
 *
 * ```
 * Something went wrong installing the "sharp" module
 * Cannot find module '../build/Release/sharp-linux-x64.node'
 * ```
 *
 * یعنی یک وابستگی *اختیاری* (بردار)، کل API را گروگان گرفته بود.
 * همان الگوی SE-BUILD-09 که فاز ۰۵ برای `sqlite3` حل کرد: بارگذاری
 * تنبل، درست در لحظه‌ای که واقعاً لازم است.
 */

import { IEmbeddingGenerator, EmbeddingResult, EmbeddingGeneratorOptions } from './EmbeddingGenerator';

type FeatureExtractionPipeline = (
  input: string | string[],
  options?: Record<string, unknown>
) => Promise<{ data: Float32Array }>;

type TransformersModule = {
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>
  ) => Promise<FeatureExtractionPipeline>;
};

/**
 * بارگذاری تنبل، با پیام قابل‌فهم به‌جای استک‌تریس `sharp`.
 */
function loadTransformers(): TransformersModule {
  try {

    return require('@xenova/transformers') as TransformersModule;
  } catch (error) {
    throw new Error(
      'The transformer-based local embedding generator is not bundled in production. ' +
        'Use HashingEmbeddingGenerator or a remote IEmbeddingGenerator instead. ' +
        `Optional legacy loader cause: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_BATCH_SIZE = 8;
/**
 * all-MiniLM-L6-v2 پنجرهٔ ۲۵۶ توکنی دارد؛ با تقریبِ چهار کاراکتر به
 * ازای هر توکن، حدود ۱۰۲۴ کاراکتر. بریدن در این نقطه صادقانه‌تر از
 * سپردنش به tokenizer است.
 */
const DEFAULT_MAX_INPUT_LENGTH = 1024;

export class LocalEmbeddingGenerator implements IEmbeddingGenerator {
  private extractor: FeatureExtractionPipeline | null = null;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly normalize: boolean;
  private readonly cacheDir?: string;
  private readonly maxInputLength: number;

  constructor(options: EmbeddingGeneratorOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.normalize = options.normalize ?? true;
    this.cacheDir = options.cacheDir;
    this.maxInputLength = Math.max(1, options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH);
  }

  get modelName(): string {
    return this.model;
  }

  async isReady(): Promise<boolean> {
    try {
      await this.getExtractor();
      return true;
    } catch {
      return false;
    }
  }

  async generate(text: string): Promise<EmbeddingResult> {
    const [result] = await this.runBatch([text]);
    return result!;
  }

  /**
   * SE-VEC-08 — batchِ واقعی، و ترتیبی.
   *
   * نسخهٔ قبلی این بود:
   *
   * ```ts
   * const batchResults = await Promise.all(batch.map(text => this.generate(text)));
   * ```
   *
   * دو ایراد. اول اینکه چند فراخوانی **همزمان** روی یک session از
   * `@xenova/transformers` می‌زد؛ آن pipelineها برای فراخوانی همزمان
   * روی یک session امن نیستند. دوم اینکه اصلاً batch نبود: مدل هر
   * متن را جدا می‌دید، پس هیچ‌کدام از صرفه‌جویی‌های batching (یک بار
   * راه‌اندازی گراف، یک ماتریسِ بزرگ‌تر) به دست نمی‌آمد.
   *
   * حالا هر batch **یک** فراخوانی است با آرایهٔ متن‌ها، و batchها
   * پشت‌سرهم اجرا می‌شوند.
   */
  async generateBatch(texts: readonly string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const results: EmbeddingResult[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      results.push(...(await this.runBatch(batch)));
    }
    return results;
  }

  private async runBatch(texts: readonly string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const extractor = await this.getExtractor();
    const truncated = texts.map(text => this.truncate(text));

    const output = await (extractor as unknown as (
      input: string[],
      options: Record<string, unknown>
    ) => Promise<{ data: Float32Array }>)(truncated, {
      pooling: 'mean',
      normalize: this.normalize,
    });

    const flat = Array.from(output.data as Float32Array);

    /*
    | خروجی batch یک آرایهٔ صاف است: n بردار پشت هم. تقسیم بر تعداد
    | متن‌ها بُعد را می‌دهد. اگر مدل بردارِ کمتری برگرداند (که نباید،
    | ولی سکوت در برابرش یعنی بردارهای درهم‌رفته) با خطا می‌ایستیم.
    */
    if (flat.length % truncated.length !== 0) {
      throw new Error(
        `embedding batch returned ${flat.length} values for ${truncated.length} inputs, ` +
          'which is not divisible; refusing to guess the vector boundaries'
      );
    }

    const dimensions = flat.length / truncated.length;

    return truncated.map((_, i) => ({
      embedding: flat.slice(i * dimensions, (i + 1) * dimensions),
      model: this.model,
      dimensions,
    }));
  }

  private truncate(text: string): string {
    return text.length <= this.maxInputLength ? text : text.slice(0, this.maxInputLength);
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      const options: Record<string, unknown> = {
        quantized: true, // مدل کوانتایز‌شده برای سرعت و حافظه کمتر
      };
      if (this.cacheDir) {
        options.cache_dir = this.cacheDir;
      }
      this.extractor = await loadTransformers().pipeline('feature-extraction', this.model, options);
    }
    return this.extractor;
  }

  async dispose(): Promise<void> {
    this.extractor = null;
  }
}
