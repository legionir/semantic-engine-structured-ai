/**
 * SE-AI-03 — تحلیل تأثیر، روی موتور پیمایش مشترک.
 *
 * سه ادعای نسخهٔ قبلی که آزمون نداشتند و هر سه غلط بودند:
 * «نزدیک‌ترین‌ها را می‌دهد»، «`level: symbol` فیلتر می‌کند»، و
 * «نتیجه پایدار است».
 */

import { ProjectIndex } from '../../core/types/project-index.types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { ImpactAnalysisTool } from './ImpactAnalysisTool';
import { provenanceFor } from '../../graphs/EdgeProvenance';
import { makeConfidence } from '../../core/types/common.types';

/*
| گراف آزمون — همان شکلی که باگ DFS را آشکار می‌کند:
|
|   near.ts ─────────import────────▶ core.ts
|   far.ts ─▶ mid.ts ─▶ near.ts                (پس near هم عمق ۱ است و هم عمق ۳)
|   guess.ts ─import(name-match, 40)─▶ core.ts
*/
function file(id: string, path: string) {
  return {
    id,
    path,
    language: 'typescript',
    size: 10,
    lines: 5,
    hash: 'h',
    binary: false,
    symbolIds: [],
    imports: [],
    exports: [],
    diagnostics: [],
    outline: [],
  };
}

function symbolIn(id: string, fileId: string, name: string) {
  return {
    id,
    fileId,
    parentId: null,
    kind: 'function',
    name,
    fullyQualifiedName: name,
    signature: name,
    visibility: 'public',
    line: 1,
    endLine: 2,
    documentation: null,
    deprecated: false,
    exported: true,
    source: 'tree-sitter',
    confidence: makeConfidence(90),
    async: false,
    generator: false,
    abstract: false,
    static: false,
    readonly: false,
    parameters: [],
    returnType: null,
    generics: [],
    extends: [],
    implements: [],
    complexity: null,
    referenceCount: null,
    calls: [],
    calledBy: [],
  };
}

function index(): ProjectIndex {
  const dep = (from: string, to: string, confidence = 85) => ({
    from,
    to,
    kind: 'import' as const,
    provenance: {
      ...provenanceFor(confidence >= 70 ? 'import-resolved' : 'name-match', 'typescript-api', {
        file: from,
        line: 1,
      }),
      confidence,
    },
  });

  return {
    schemaVersion: '2.0.0',
    generatedAt: new Date().toISOString(),
    root: 'test',
    rootPath: '/test',
    files: [
      file('core', 'src/core.ts'),
      file('near', 'src/near.ts'),
      file('mid', 'src/mid.ts'),
      file('far', 'src/far.ts'),
      file('guess', 'src/guess.ts'),
    ],
    symbols: [symbolIn('sym-core', 'core', 'coreFn'), symbolIn('sym-near', 'near', 'nearFn')],
    languages: {},
    graphs: {
      dependencyGraph: [
        // `guess` عمداً اول است — ترتیب پیمایش نباید ترتیب نتیجه شود.
        dep('guess', 'core', 40),
        dep('near', 'core'),
        dep('mid', 'near'),
        dep('far', 'mid'),
      ],
      callGraph: [
        {
          id: 'c1',
          caller: 'sym-near',
          callee: 'sym-core',
          callerKind: 'symbol' as const,
          kind: 'direct' as const,
          line: 1,
          provenance: provenanceFor('ast', 'typescript-api', { file: 'src/near.ts', line: 1 }),
        },
        {
          /*
          | فراخوانی در سطح ماژول: `caller` یک **فایل** است
          | (فاز ۳۷، SE-GRAPH-02). یعنی `sym-core` هم جد symbolای
          | دارد و هم جد فایلی — بدون این، فیلتر `level` چیزی
          | برای فیلتر کردن ندارد و آزمونش هیچ‌چیز ثابت نمی‌کند.
          */
          id: 'c2',
          caller: 'mid',
          callee: 'sym-core',
          callerKind: 'file' as const,
          kind: 'direct' as const,
          line: 3,
          provenance: provenanceFor('ast', 'typescript-api', { file: 'src/mid.ts', line: 3 }),
        },
      ],
      typeGraph: [],
      reverseDependencyGraph: [],
    },
    diagnostics: [],
    metrics: {} as never,
  } as unknown as ProjectIndex;
}

const tool = () => new ImpactAnalysisTool(new ProjectIndexReader(index()));

describe('SE-AI-03 — نزدیک‌ترین‌ها، نه اولین‌ها', () => {
  it('عمق هر گره، کوتاه‌ترین فاصله است', async () => {
    const result = await tool().execute({ id: 'core', depth: 3 });
    expect(result.success).toBe(true);

    const near = result.items.find(item => item.id === 'near')!;
    const far = result.items.find(item => item.id === 'far')!;

    expect((near.metadata as { depth: number }).depth).toBe(1);
    expect((far.metadata as { depth: number }).depth).toBe(3);
    expect(near.relevanceScore ?? 0).toBeGreaterThan(far.relevanceScore ?? 0);
  });

  it('نتیجه بر اساس امتیاز مرتب است، نه ترتیب پیمایش', async () => {
    const result = await tool().execute({ id: 'core', depth: 3 });
    const scores = result.items.map(item => item.relevanceScore ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('دو اجرا، یک نتیجه — برش دیگر وسط پیمایش نیست', async () => {
    const first = await tool().execute({ id: 'core', depth: 3, limit: 2 });
    const second = await tool().execute({ id: 'core', depth: 3, limit: 2 });
    expect(first.items.map(item => item.id)).toEqual(second.items.map(item => item.id));
  });

  it('`limit` بعد از مرتب‌سازی اعمال می‌شود، نه وسط پیمایش', async () => {
    /*
    | نکتهٔ ظریفی که اثباتِ برگرداندن آشکارش کرد: با limit=1 و
    | یک ترتیب پیمایشی که تصادفاً همان ترتیب امتیاز است، جای
    | `slice` و `sort` فرقی نمی‌کند و آزمون هیچ‌چیز ثابت نمی‌کند.
    |
    | اینجا `guess` (اعتماد ۴۰) **پیش از** `near` در گراف است، پس
    | ترتیب پیمایش با ترتیب امتیاز یکی نیست: بریدن قبل از
    | مرتب‌سازی، حدس را برمی‌گرداند و همسایهٔ قطعی را دور می‌ریزد.
    */
    const result = await tool().execute({
      id: 'core',
      depth: 1,
      limit: 1,
      minConfidence: 0,
    });
    expect(result.items.map(item => item.id)).toEqual(['near']);
  });
});

describe('SE-AI-03 — `level` واقعاً فیلتر می‌کند', () => {
  it('`file` فقط فایل می‌دهد', async () => {
    const result = await tool().execute({ id: 'sym-core', depth: 2, level: 'file' });
    expect(result.items.every(item => item.kind === 'file')).toBe(true);
  });

  it('`symbol` فقط symbol می‌دهد — پیش از این هر چیزی می‌داد', async () => {
    /*
    | `sym-core` دو جد دارد: `sym-near` (symbol) و `mid` (فایل، از
    | یک فراخوانی سطح ماژول). فیلتر باید دومی را کنار بگذارد.
    */
    const any = await tool().execute({ id: 'sym-core', depth: 1, level: 'any' });
    expect(any.items.map(item => item.id).sort()).toEqual(['mid', 'sym-near']);

    const result = await tool().execute({ id: 'sym-core', depth: 1, level: 'symbol' });
    expect(result.items.map(item => item.id)).toEqual(['sym-near']);
  });

  it('`any` هر دو را می‌دهد', async () => {
    const result = await tool().execute({ id: 'core', depth: 1, level: 'any' });
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe('SE-AI-03 — اعتماد', () => {
  it('یال حدسی پیش‌فرض کنار می‌رود', async () => {
    const result = await tool().execute({ id: 'core', depth: 1 });
    expect(result.items.map(item => item.id)).not.toContain('guess');
  });

  it('با آستانهٔ صفر، حدس هم می‌آید ولی امتیازش کمتر است', async () => {
    const result = await tool().execute({ id: 'core', depth: 1, minConfidence: 0 });
    const guess = result.items.find(item => item.id === 'guess')!;
    const near = result.items.find(item => item.id === 'near')!;

    expect(guess).toBeDefined();
    expect(guess.relevanceScore ?? 0).toBeLessThan(near.relevanceScore ?? 0);
    expect((guess.metadata as { via: string }).via).toContain('name-match');
  });
});

describe('SE-AI-03 — گزارش صادقانه', () => {
  it('چند گره دیده شد و آیا بریده شد', async () => {
    const result = await tool().execute({ id: 'core', depth: 3 });
    const meta = result.metadata as { visited: number; truncated: boolean };
    expect(meta.visited).toBeGreaterThan(0);
    expect(meta.truncated).toBe(false);
  });

  it('گرهٔ ناشناخته، نتیجهٔ خالی — نه خطا', async () => {
    const result = await tool().execute({ id: 'does-not-exist' });
    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('عمق بیشتر از سه، به سه محدود می‌شود', async () => {
    const result = await tool().execute({ id: 'core', depth: 99 });
    const depths = result.items.map(item => (item.metadata as { depth: number }).depth);
    expect(Math.max(...depths)).toBeLessThanOrEqual(3);
  });
});
