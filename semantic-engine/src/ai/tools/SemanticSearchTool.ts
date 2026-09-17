/**
 * SemanticSearchTool — جستجوی معنایی در symbol ها و فایل‌ها.
 *
 * Hybrid scoring:
 * - keyword match (name, signature, documentation, path)
 * - vector similarity (اگر embedding موجود باشد)
 * - reference count / graph centrality
 * - exported bonus
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import type { SymbolEntry } from '../../core/types/project-index.types';
import { VectorStore, VectorStoreOptions } from '../../vector/VectorStore';
import { VectorStoreCache } from '../../vector/VectorStoreCache';
import type { IEmbeddingGenerator } from '../../vector/EmbeddingGenerator';
import { ContextRanker, RankCandidate, SignalName } from '../ranking/ContextRanker';
import { queryTerms, identifierSegments, matchesSegments } from './queryTerms';
import { SymbolTermIndex } from './SymbolTermIndex';

/**
 * SE-VEC-12 — پیش‌فرضِ پایین و عمدی.
 *
 * لایهٔ برداری «نامزد» تولید می‌کند، نه «جواب». حذف کردن نامزد بر
 * اساس یک آستانهٔ مطلق، کارِ رتبه‌بند را پیش از رتبه‌بندی انجام
 * می‌دهد — و با عددی که هیچ‌کس تنظیمش نکرده.
 */
const DEFAULT_MIN_SCORE = 0.05;

export interface SemanticSearchInput extends AiToolInput {
  readonly query: string;
  readonly filters?: {
    readonly language?: string | string[];
    readonly kind?: string | string[];
    readonly path?: string;
    readonly exportedOnly?: boolean;
  };
  readonly limit?: number;
  /** Candidate source(s) to search. Defaults to hybrid. */
  readonly mode?: 'keyword' | 'vector' | 'hybrid';
  /** Minimum final ranked score (not the vector-store threshold). */
  readonly minScore?: number;
  /** @deprecated Prefer mode. */
  readonly useEmbeddings?: boolean;
}

interface ScoredEntity {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly path?: string;
  readonly line?: number;
  readonly source: string;
  readonly excerpt?: string;
  /**
   * امتیاز **خام** — برای کلیدواژه بی‌کران، برای بردار در بازهٔ ۰..۱.
   *
   * تا فاز ۴۲ همین عدد مستقیم با ضریب ۰٫۵ جمع می‌شد و SE-VEC-03
   * دقیقاً همین بود. حالا خام می‌ماند و نرمال‌سازی را `ContextRanker`
   * انجام می‌دهد، که مقیاس هر سیگنال را نسبت به دستهٔ نامزدها
   * می‌سنجد.
   */
  readonly score: number;
}

export class SemanticSearchTool implements AiTool<SemanticSearchInput> {
  readonly name = 'semantic_search';
  readonly description = 'Search symbols and files by natural language query. Uses keyword matching, vector embeddings, and reference count.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language query' },
      filters: {
        type: 'object',
        properties: {
          language: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          kind: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          path: { type: 'string' },
          exportedOnly: { type: 'boolean' },
        },
      },
      limit: { type: 'integer', default: 20 },
      mode: { type: 'string', enum: ['keyword', 'vector', 'hybrid'], default: 'hybrid' },
      minScore: { type: 'number', description: 'Minimum final ranked score' },
      useEmbeddings: { type: 'boolean', default: true },
    },
    required: ['query'],
  };

  private readonly vectorStore: VectorStore | null;
  private embeddingGenerator: IEmbeddingGenerator | undefined;
  private readonly ranker = new ContextRanker();
  /**
   * SE-VEC-04 — ایندکس معکوس، ساخته‌شده به‌صورت تنبل و مشترک بین
   * پرس‌وجوها. اندازه‌گیری پیش از این: ۱۱۰ms برای هر پرس‌وجو روی
   * ۸٬۴۱۴ نماد، چون هر بار کلِ ایندکس پیمایش و قطعه‌بندی می‌شد.
   */
  private readonly termIndex: SymbolTermIndex;

  constructor(
    private readonly reader: ProjectIndexReader,
    embeddingGenerator?: IEmbeddingGenerator,
    private readonly vectorStoreOptions?: VectorStoreOptions
  ) {
    /*
    | SE-VEC-07 — ایندکس برداری از کشِ مشترک می‌آید.
    |
    | قبلاً هر `SemanticSearchTool` یکی از صفر می‌ساخت، و این کلاس
    | بیش از یک بار ساخته می‌شود: یک‌بار در `AiToolRegistry` و
    | یک‌بار داخل `ContextDiscoverer`. با backendِ usearch یعنی دو
    | بار برپا کردن کاملِ گرافِ HNSW روی همان بردارها.
    |
    | `filter` روی آرایه یک آرایهٔ **تازه** می‌سازد، پس کلیدِ کش هم
    | تازه می‌شد و کش هرگز نمی‌گرفت. برای همین وقتی همهٔ chunkها
    | بردار دارند — حالت متعارف — همان آرایهٔ اصلی به کش داده می‌شود.
    */
    const chunks = reader.projectIndex.vectorChunks ?? [];
    const allHaveEmbeddings = chunks.every(c => c.embedding && c.embedding.length > 0);
    const chunksWithEmbeddings = allHaveEmbeddings
      ? chunks
      : chunks.filter(c => c.embedding && c.embedding.length > 0);
    this.vectorStore = VectorStoreCache.shared.forChunks(
      chunksWithEmbeddings,
      vectorStoreOptions
    );
    this.embeddingGenerator = embeddingGenerator;
    this.termIndex = new SymbolTermIndex(reader);
  }

  /**
   * SE-VEC-02 — مسیر برداری در پیکربندی پیش‌فرض مرده بود.
   *
   * دو نقصِ روی هم:
   *
   * ۱. این تابعِ «سازندهٔ تنبل» فقط *داخل* `getEmbeddingCandidates`
   *    صدا زده می‌شد، و آن‌جا فقط وقتی می‌رسیدیم که
   *    `this.embeddingGenerator` از قبل مقدار داشته باشد. یک بن‌بست
   *    کامل: تنها راهِ ساختنِ generator، داشتنِ generator بود.
   * ۲. تنها گزینه‌اش `LocalEmbeddingGenerator` بود که به‌خاطر
   *    زنجیرهٔ `@xenova/transformers → sharp` بارگذاری نمی‌شود
   *    (SE-VEC-10). اجرای واقعی در همین مخزن:
   *    `Cannot find module '../build/Release/sharp-linux-x64.node'`.
   *
   * حالا در `execute` صدا زده می‌شود و اگر مسیر ترنسفورمری در
   * دسترس نبود، به generatorِ بدونِ وابستگی برمی‌گردد.
   *
   * **انتخاب مدل از روی خودِ chunkها**: بردارهای دو مدل مختلف
   * هم‌سنجه نیستند و اگر ابعادشان هم فرق کند، شباهت کسینوسی عددِ
   * بی‌معنا می‌دهد. پس اگر chunkها گفته‌اند با کدام مدل ساخته شده‌اند،
   * همان انتخاب می‌شود؛ وگرنه بردار اصلاً استفاده نمی‌شود.
   */
  private async ensureEmbeddingGenerator(): Promise<IEmbeddingGenerator | undefined> {
    if (this.embeddingGenerator) return this.embeddingGenerator;
    if (!this.vectorStore) return undefined;

    const chunkModel = this.dominantChunkModel();

    if (chunkModel && chunkModel.startsWith('hashing-bag-of-segments-')) {
      const dimensions = Number.parseInt(chunkModel.split('-').pop() ?? '', 10);
      const { HashingEmbeddingGenerator } = await import('../../vector/HashingEmbeddingGenerator');
      this.embeddingGenerator = new HashingEmbeddingGenerator(
        Number.isFinite(dimensions) ? { dimensions } : {}
      );
      return this.embeddingGenerator;
    }

    try {
      const { LocalEmbeddingGenerator } = await import('../../vector/LocalEmbeddingGenerator');
      const local = new LocalEmbeddingGenerator();
      if (!(await local.isReady())) throw new Error('local embedding model unavailable');
      this.embeddingGenerator = local;
      return this.embeddingGenerator;
    } catch {
      /*
      | نه مدلِ اعلام‌شده‌ای روی chunkها هست و نه مسیر ترنسفورمری کار
      | می‌کند. عمداً به generatorِ پیش‌فرض *برنمی‌گردیم*: بردارهای
      | موجود با مدل دیگری ساخته شده‌اند و پرس‌وجو کردنشان با یک
      | فضای برداریِ دیگر، عددِ بی‌معنا می‌دهد که شبیه عددِ بامعنا
      | است.
      */
      return undefined;
    }
  }

  /** مدلی که بیشترِ chunkها با آن ساخته شده‌اند، اگر اعلام شده باشد. */
  private dominantChunkModel(): string | undefined {
    const counts = new Map<string, number>();
    for (const chunk of this.reader.projectIndex.vectorChunks ?? []) {
      if (!chunk.embedding || chunk.embedding.length === 0) continue;
      const model = chunk.embeddingModel;
      if (!model) continue;
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }

    let winner: string | undefined;
    let best = 0;
    for (const [model, count] of counts) {
      if (count > best) {
        best = count;
        winner = model;
      }
    }
    return winner;
  }

  async execute(input: SemanticSearchInput): Promise<AiToolOutput> {
    try {
      const terms = queryTerms(input.query);
      const limit = input.limit ?? 20;
      const filters = input.filters ?? {};
      // mode is authoritative; preserve the legacy boolean for old callers.
      const mode = input.mode ?? (input.useEmbeddings === false ? 'keyword' : 'hybrid');

      const kinds = filters.kind ? (Array.isArray(filters.kind) ? filters.kind : [filters.kind]) : [];
      const languages = filters.language ? (Array.isArray(filters.language) ? filters.language : [filters.language]) : [];

      // Step 1: keyword-based candidates
      const keywordCandidates = mode === 'vector'
        ? []
        : this.getKeywordCandidates(terms, kinds, languages, filters);

      // Step 2: embedding-based candidates
      let embeddingCandidates: ScoredEntity[] = [];
      let embeddingGenerator: IEmbeddingGenerator | undefined;
      if (mode !== 'keyword' && this.vectorStore) {
        // SE-VEC-02 — تلاش برای ساختنِ generator *پیش* از استفاده،
        // نه داخلِ شاخه‌ای که فقط با داشتنش به آن می‌رسیم.
        embeddingGenerator = await this.ensureEmbeddingGenerator();
        if (embeddingGenerator) {
          embeddingCandidates = await this.getEmbeddingCandidates(input.query, filters);
        }
      }

      // Step 3: merge and score
      /*
      | SE-VEC-03 — تا فاز ۴۲ اینجا این بود:
      |
      |   merged.set(c.id, { ...c, score: c.score * 0.5 });        // کلیدواژه
      |   merged.set(c.id, { ...existing, score: existing.score + c.score * 0.5 }); // بردار
      |
      | یعنی دو مقیاسِ ناهم‌جنس با ضریب یکسان جمع می‌شدند: کلیدواژه
      | بی‌کران، شباهت کسینوسی کران‌دار به یک. نتیجه‌اش این بود که یک
      | برخوردِ نام (۳ واحد) از یک شباهت کاملِ برداری (۱ واحد) سه برابر
      | سنگین‌تر بود.
      |
      | حالا هر سیگنال خام می‌ماند و `ContextRanker` نرمال‌سازی
      | دسته‌ای می‌کند — و همان‌جا سیگنال‌هایی که موتور می‌ساخت و دور
      | می‌ریخت (aiScore، gitMetrics، complexity، testIds) هم وارد
      | امتیاز می‌شوند (GAP-06).
      */
      const entities = new Map<string, ScoredEntity>();
      const rawKeyword = new Map<string, number>();
      const rawVector = new Map<string, number>();

      for (const c of keywordCandidates) {
        entities.set(c.id, c);
        rawKeyword.set(c.id, c.score);
      }
      for (const c of embeddingCandidates) {
        if (!entities.has(c.id)) entities.set(c.id, c);
        rawVector.set(c.id, c.score);
      }

      const churnRanks: number[] = [];
      for (const f of this.reader.getAllFiles()) {
        const rank = f.gitMetrics?.churnRank;
        if (typeof rank === 'number') churnRanks.push(rank);
      }

      const candidates: RankCandidate<ScoredEntity>[] = Array.from(entities.values()).map(
        entity => {
          const symbol = this.reader.getSymbolById(entity.id);
          const file = symbol
            ? this.reader.getFileById(symbol.fileId)
            : this.reader.getFileById(entity.id);
          const aiScore = file?.aiMetadata?.aiScore;
          const git = file?.gitMetrics;

          return {
            id: entity.id,
            payload: entity,
            signals: {
              keyword: rawKeyword.get(entity.id) ?? null,
              vector: rawVector.get(entity.id) ?? null,
              referenceCount: symbol ? symbol.referenceCount ?? null : null,
              importance: aiScore?.importance ?? null,
              hotness: aiScore?.hotness ?? null,
              readPriority: aiScore?.readPriority ?? null,
              hotspotScore: git?.hotspotScore ?? null,
              churnRank: git?.churnRank ?? null,
              complexity: symbol?.complexity ?? null,
              testCount: symbol?.testIds?.length ?? null,
              exported: symbol?.exported ?? null,
            },
          };
        }
      );

      const ranked = this.ranker
        .rank<ScoredEntity>(candidates, {
          ...(churnRanks.length > 0 ? { churnRankOutOf: Math.max(...churnRanks) } : {}),
        })
        .filter(r => input.minScore == null || r.score >= input.minScore)
        .slice(0, limit);

      const items = ranked.map(r => {
        const entity = r.payload as ScoredEntity;
        return {
          id: entity.id,
          name: entity.name,
          kind: entity.kind,
          path: entity.path,
          line: entity.line,
          relevanceScore: Math.round(r.score * 1000) / 1000,
          source: entity.source,
          excerpt: entity.excerpt,
          metadata: {
            signals: r.contributions.map(c => c.signal) as SignalName[],
            rawKeyword: rawKeyword.get(entity.id) ?? null,
            rawVector: rawVector.get(entity.id) ?? null,
          },
        };
      });

      return {
        success: true,
        items,
        metadata: {
          keywordCandidates: keywordCandidates.length,
          embeddingCandidates: embeddingCandidates.length,
          /*
          | SE-VEC-02 — قبلاً این فقط می‌گفت «chunk داریم و کاربر
          | مخالفت نکرده»، نه «واقعاً از بردار استفاده شد». کاربر
          | `true` می‌دید در حالی که جست‌وجو صرفاً کلیدواژه‌ای بود.
          */
          usedEmbeddings: embeddingGenerator !== undefined && embeddingCandidates.length > 0,
          embeddingModel: embeddingGenerator?.modelName ?? null,
          ...(mode !== 'keyword' && this.vectorStore && !embeddingGenerator
            ? { embeddingNote: 'no usable embedding generator for the model these chunks were built with' }
            : {}),
          ...(mode !== 'keyword' && !this.vectorStore
            ? { embeddingNote: 'index has no vector chunks with embeddings' }
            : {}),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
      };
    }
  }

  private getKeywordCandidates(
    terms: string[],
    kinds: string[],
    languages: string[],
    filters: SemanticSearchInput['filters']
  ): ScoredEntity[] {
    /*
    | SE-VEC-04 — به‌جای پیمایشِ همهٔ نمادها، فقط آنهایی که ایندکس
    | معکوس نامزد می‌داند. `SymbolTermIndex` تضمین می‌کند مجموعه‌اش
    | دقیقاً همان چیزی است که پیمایشِ کامل می‌داد؛ آزمونِ برابری‌اش
    | این را روی هفت پرس‌وجو می‌سنجد.
    */
    const candidateIds = this.termIndex.candidatesFor(terms);

    /*
    | نامزدها مستقیم از روی شناسه برداشته می‌شوند، نه با فیلترِ
    | `getAllSymbols()`. آن فیلتر خودش یک پیمایشِ کاملِ دیگر است و
    | نصفِ صرفه‌جوییِ ایندکس معکوس را پس می‌دهد.
    */
    let symbols: SymbolEntry[] = [];
    for (const id of candidateIds) {
      const symbol = this.reader.getSymbolById(id);
      if (symbol) symbols.push(symbol);
    }
    // ترتیب پایدار: `Set` ترتیبِ درج دارد که به ترتیبِ ساختِ ایندکس
    // گره خورده؛ مرتب‌سازی صریح، نتیجه را از آن مستقل می‌کند.
    symbols.sort((a, b) => a.id.localeCompare(b.id));

    if (kinds.length > 0) symbols = symbols.filter(s => kinds.includes(s.kind));
    if (filters?.exportedOnly) symbols = symbols.filter(s => s.exported);

    if (languages.length > 0 || filters?.path) {
      symbols = symbols.filter(s => {
        const file = this.reader.getFileById(s.fileId);
        if (!file) return false;
        if (languages.length > 0 && file.language && !languages.includes(file.language)) return false;
        if (filters?.path && !file.path.toLowerCase().includes(filters.path.toLowerCase())) return false;
        return true;
      });
    }

    return symbols.map(symbol => {
      const file = this.reader.getFileById(symbol.fileId);

      /*
      | SE-VEC-11 — تطبیق روی **قطعه‌های** شناسه است، نه زیررشتهٔ خام.
      |
      | قبلاً `symbol.name.toLowerCase().includes(term)` بود، که یعنی
      | «at» داخل «aiMetadata» می‌خورد و «the» داخل «otherEvents».
      | روی ایندکس واقعی، پرس‌وجوی «at» هشتاد و دو درصد ایندکس را
      | نامزد می‌کرد.
      */
      // قطعه‌ها یک‌بار هنگام ساختِ ایندکس معکوس حساب شده‌اند.
      const cached = this.termIndex.segmentsOf(symbol.id);
      const nameSegments = cached
        ? cached.name
        : identifierSegments(symbol.name);
      const contextSegments = cached
        ? cached.context
        : [
            ...(symbol.fullyQualifiedName ? identifierSegments(symbol.fullyQualifiedName) : []),
            ...(symbol.signature ? identifierSegments(symbol.signature) : []),
            ...(symbol.documentation ? identifierSegments(symbol.documentation) : []),
            ...(file?.path ? identifierSegments(file.path) : []),
            ...(file?.aiMetadata?.summary ? identifierSegments(file.aiMetadata.summary) : []),
          ];

      let keywordScore = 0;
      for (const term of terms) {
        if (matchesSegments(term, nameSegments)) keywordScore += 3;
        else if (matchesSegments(term, contextSegments)) keywordScore += 1;
      }

      /*
      | فقط سیگنالِ خامِ کلیدواژه. مرکزیت و «exported» از اینجا حذف
      | شدند چون داخل یک عددِ واحد قاطی می‌شدند و بعد قابل تفکیک
      | نبودند؛ حالا هر کدام سیگنالِ مستقلِ خودشان را در
      | `ContextRanker` دارند و در `metadata.signals` قابل دیدن‌اند.
      */
      return {
        id: symbol.id,
        name: symbol.name,
        kind: symbol.kind,
        path: file?.path,
        line: symbol.line,
        source: symbol.source,
        excerpt: symbol.signature ?? symbol.documentation ?? file?.aiMetadata?.summary,
        score: keywordScore,
      };
    }).filter(c => c.score > 0);
  }

  private async getEmbeddingCandidates(
    query: string,
    filters: SemanticSearchInput['filters']
  ): Promise<ScoredEntity[]> {
    if (!this.vectorStore) return [];

    const generator = await this.ensureEmbeddingGenerator();
    if (!generator) return [];

    const queryEmbedding = await generator.generate(query);
    const kinds = filters?.kind ? (Array.isArray(filters.kind) ? filters.kind : [filters.kind]) : [];

    const results = await this.vectorStore.search(queryEmbedding.embedding, {
      topK: this.vectorStoreOptions?.topK ?? 50,
      /*
      | SE-VEC-12 — این عدد قبلاً `0.3` و هاردکد بود. آستانهٔ شباهت
      | به مدل وابسته است و یک ثابتِ دلبخواه، برای هر مدلی جز آنکه
      | در ذهن نویسنده بوده یعنی حذفِ کامل نتایج.
      */
      minScore: this.vectorStoreOptions?.minScore ?? DEFAULT_MIN_SCORE,
      filter: chunk => {
        if (kinds.length > 0 && chunk.symbolId) {
          const sym = this.reader.getSymbolById(chunk.symbolId);
          if (sym && !kinds.includes(sym.kind)) return false;
        }
        /*
        | SE-VEC-06 — فیلتر مسیر باید روی مسیرِ **فایلِ** chunk
        | باشد. قبلاً با `chunk.content` مقایسه می‌شد، پس فایلی که
        | فقط آن مسیر را import کرده بود قبول می‌شد و chunkهای واقعیِ
        | همان پوشه که مسیرشان در متن نیامده بود رد می‌شدند.
        */
        if (filters?.path) {
          const owner = this.reader.getFileById(chunk.fileId);
          const ownerPath = owner?.path.toLowerCase() ?? '';
          if (!ownerPath.includes(filters.path.toLowerCase())) return false;
        }
        return true;
      },
    });

    const candidates = new Map<string, ScoredEntity>();

    for (const result of results) {
      const chunk = result.chunk;
      if (chunk.symbolId) {
        const sym = this.reader.getSymbolById(chunk.symbolId);
        const file = sym ? this.reader.getFileById(sym.fileId) : undefined;
        if (!sym) continue;
        if (filters?.exportedOnly && !sym.exported) continue;

        const existing = candidates.get(sym.id);
        if (!existing || existing.score < result.score) {
          candidates.set(sym.id, {
            id: sym.id,
            name: sym.name,
            kind: sym.kind,
            path: file?.path,
            line: sym.line,
            source: sym.source,
            excerpt: sym.signature ?? sym.documentation ?? undefined,
            score: result.score,
          });
        }
      } else {
        const file = this.reader.getFileById(chunk.fileId);
        if (!file) continue;

        const existing = candidates.get(file.id);
        if (!existing || existing.score < result.score) {
          candidates.set(file.id, {
            id: file.id,
            name: file.path,
            kind: 'file',
            path: file.path,
            source: 'index',
            excerpt: file.aiMetadata?.summary,
            score: result.score,
          });
        }
      }
    }

    return Array.from(candidates.values());
  }

}
