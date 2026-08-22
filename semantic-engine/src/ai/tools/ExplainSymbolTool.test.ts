/**
 * GAP-03 — یک تماس به‌جای چهار تماس.
 *
 * معیار پذیرش فاز صریح است: «یک تماس، همان اطلاعاتی را بدهد که امروز
 * چهار تماس لازم دارد». پس آزمون اصلی هم همان است — چهار ابزار
 * موجود روی یک ایندکس اجرا می‌شوند و خروجی‌شان با خروجی یک تماس
 * `explain_symbol` مقایسه می‌شود.
 */

import { ProjectIndex } from '../../core/types/project-index.types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { ExplainSymbolTool, SymbolExplanation } from './ExplainSymbolTool';
import { FindSymbolTool } from './FindSymbolTool';
import { FindTestsTool } from './FindTestsTool';
import { ImpactAnalysisTool } from './ImpactAnalysisTool';
import { provenanceFor } from '../../graphs/EdgeProvenance';
import { makeConfidence } from '../../core/types/common.types';

function file(over: Record<string, unknown>) {
  return {
    language: 'typescript',
    size: 100,
    lines: 20,
    hash: 'h',
    binary: false,
    symbolIds: [],
    imports: [],
    exports: [],
    diagnostics: [],
    outline: [],
    ...over,
  };
}

function symbol(over: Record<string, unknown>) {
  return {
    parentId: null,
    kind: 'method',
    visibility: 'public',
    endLine: 50,
    documentation: null,
    deprecated: false,
    exported: true,
    source: 'lsp',
    confidence: makeConfidence(95),
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
    ...over,
  };
}

/*
| ایندکس آزمون، بر اساس همان نمونه‌ای که GRAPH-INTELLIGENCE-GAPS
| برای `explain_symbol` نوشته است:
|
|   AuthService.login  ←  AuthController.login   (فراخوان، حدسِ نام)
|          │
|          ├──▶ UserService.find                 (قطعی)
|          └──▶ TokenService.create              (قطعی)
|   تست: auth.service.spec.ts
*/
function index(): ProjectIndex {
  const call = (caller: string, callee: string, confidence: number) => ({
    id: `${caller}->${callee}`,
    caller,
    callee,
    callerKind: 'symbol' as const,
    kind: 'direct' as const,
    line: 44,
    provenance: {
      ...provenanceFor(confidence >= 70 ? 'resolved' : 'name-match', 'lsp', {
        file: 'src/auth/auth.service.ts',
        line: 44,
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
      file({
        id: 'f-auth',
        path: 'src/auth/auth.service.ts',
        symbolIds: ['s-login'],
        testIds: ['f-spec'],
        gitMetrics: { commitCount: 23, hotspotScore: 71, lastModified: null, authors: [] },
        aiMetadata: { aiScore: { importance: 78, hotness: 65, readPriority: 70 } },
        diagnostics: [
          { severity: 'warning', line: 45, message: 'unused variable', source: 'ts', code: '6133' },
          { severity: 'error', line: 900, message: 'somewhere else entirely', source: 'ts', code: '1' },
        ],
      }),
      file({ id: 'f-user', path: 'src/user/user.service.ts', symbolIds: ['s-find'] }),
      file({ id: 'f-token', path: 'src/token/token.service.ts', symbolIds: ['s-create'] }),
      file({ id: 'f-ctrl', path: 'src/auth/auth.controller.ts', symbolIds: ['s-ctrl'] }),
      file({ id: 'f-spec', path: 'src/auth/auth.service.spec.ts', testFile: true }),
    ],
    symbols: [
      symbol({
        id: 's-login',
        fileId: 'f-auth',
        name: 'login',
        fullyQualifiedName: 'AuthService.login',
        signature: 'login(id: string): Promise<User>',
        line: 42,
        endLine: 50,
        complexity: 7,
        referenceCount: 3,
      }),
      symbol({ id: 's-find', fileId: 'f-user', name: 'find', fullyQualifiedName: 'UserService.find', signature: 'find()', line: 5 }),
      symbol({ id: 's-create', fileId: 'f-token', name: 'create', fullyQualifiedName: 'TokenService.create', signature: 'create()', line: 8 }),
      symbol({ id: 's-ctrl', fileId: 'f-ctrl', name: 'login', fullyQualifiedName: 'AuthController.login', signature: 'login()', line: 12 }),
    ],
    languages: {},
    graphs: {
      dependencyGraph: [],
      callGraph: [
        call('s-login', 's-find', 98),
        call('s-login', 's-create', 98),
        call('s-ctrl', 's-login', 40),
      ],
      typeGraph: [],
      reverseDependencyGraph: [],
    },
    diagnostics: [],
    metrics: {} as never,
  } as unknown as ProjectIndex;
}

const reader = () => new ProjectIndexReader(index());
const explanationOf = async (input: Record<string, unknown>) => {
  const result = await new ExplainSymbolTool(reader()).execute(input);
  return { result, explanation: result.items[0]?.metadata as unknown as SymbolExplanation };
};

describe('GAP-03 — یک تماس، همهٔ داده', () => {
  it('همان چیزی که سند نمونه‌اش را نوشته بود', async () => {
    const { explanation } = await explanationOf({ id: 's-login' });

    expect(explanation.symbol).toBe('AuthService.login');
    expect(explanation.file).toBe('src/auth/auth.service.ts');
    expect(explanation.line).toBe(42);
    expect(explanation.signature).toBe('login(id: string): Promise<User>');
    expect(explanation.complexity).toBe(7);
    expect(explanation.calls.map(entry => entry.name).sort()).toEqual([
      'TokenService.create',
      'UserService.find',
    ]);
    expect(explanation.calledBy.map(entry => entry.name)).toEqual(['AuthController.login']);
    expect(explanation.tests.map(entry => entry.path)).toEqual(['src/auth/auth.service.spec.ts']);
    expect(explanation.git).toEqual({ commitCount: 23, hotspotScore: 71 });
    expect(explanation.aiScore).toEqual({ importance: 78, hotness: 65, readPriority: 70 });
  });

  it('پذیرش: هرچه چهار ابزار جدا می‌دهند، اینجا در یک تماس هست', async () => {
    /*
    | معیار پذیرش فاز، به‌صورت اجرایی: چهار ابزار موجود صدا زده
    | می‌شوند و هر چیزی که می‌گویند باید در خروجی یک تماس باشد.
    */
    const source = reader();
    const [findSymbol, impact, tests] = await Promise.all([
      new FindSymbolTool(source).execute({ name: 'login', limit: 10 }),
      new ImpactAnalysisTool(source).execute({ id: 's-login', level: 'symbol', minConfidence: 0 }),
      new FindTestsTool(source).execute({ symbolId: 's-login', path: 'src/auth/auth.service.ts' }),
    ]);

    const { explanation } = await explanationOf({ id: 's-login' });

    // ۱. find_symbol: خط و امضا
    const fromFind = findSymbol.items.find(item => item.id === 's-login')!;
    expect(explanation.line).toBe(fromFind.line);

    // ۲. impact_analysis: چه کسی صدایش می‌زند
    expect(explanation.calledBy.map(entry => entry.id)).toEqual(
      impact.items.map(item => item.id)
    );

    // ۳. find_tests: تست‌ها
    expect(explanation.tests.map(entry => entry.path)).toEqual(tests.items.map(item => item.path));

    // و دلیل هر تست هم می‌آید، نه فقط مسیرش.
    expect(explanation.tests[0].reason.length).toBeGreaterThan(3);

    // ۴. و چیزی که هیچ‌کدام از آن سه نمی‌دهند: منشأ هر بخش.
    expect(explanation.confidence.calledBy).toBe('name-match');
  });
});

describe('GAP-03 — منشأ هر بخش', () => {
  it('فراخوانی‌های قطعی `resolved` علامت می‌خورند', async () => {
    const { explanation } = await explanationOf({ id: 's-login' });
    expect(explanation.confidence.calls).toBe('resolved');
    expect(explanation.confidence.weakCalls).toBe(0);
  });

  it('فراخوانِ حدسی `name-match` علامت می‌خورد و شمرده می‌شود', async () => {
    const { explanation } = await explanationOf({ id: 's-login' });
    expect(explanation.confidence.calledBy).toBe('name-match');
    expect(explanation.confidence.weakCalledBy).toBe(1);
    expect(explanation.calledBy[0].basis).toBe('name-match');
    expect(explanation.calledBy[0].confidence).toBe(40);
  });

  it('بخشی که چیزی ندارد `none` است، نه `resolved`', async () => {
    const { explanation } = await explanationOf({ id: 's-find' });
    expect(explanation.confidence.calls).toBe('none');
  });

  it('منبع خودِ symbol هم گزارش می‌شود', async () => {
    const { explanation } = await explanationOf({ id: 's-login' });
    expect(explanation.confidence.source).toBe('lsp');
    expect(explanation.confidence.symbol).toBe(95);
  });

  it('پیش‌فرض همه‌چیز را نشان می‌دهد — با برچسب، نه با حذف', async () => {
    /*
    | برخلاف `impact_analysis` که پیش‌فرضش فیلتر کردن است، اینجا
    | هدف «توضیح» است: پنهان کردن یک فراخوان حدسی یعنی مدل فکر
    | می‌کند هیچ فراخوانی نیست.
    */
    const { explanation } = await explanationOf({ id: 's-login' });
    expect(explanation.calledBy).toHaveLength(1);

    const filtered = await explanationOf({ id: 's-login', minConfidence: 70 });
    expect(filtered.explanation.calledBy).toHaveLength(0);
  });
});

describe('GAP-03 — diagnostics همین symbol', () => {
  it('فقط آن‌هایی که داخل بدنه‌اند', async () => {
    const { explanation } = await explanationOf({ id: 's-login' });
    expect(explanation.diagnostics).toEqual([
      { severity: 'warning', line: 45, message: 'unused variable' },
    ]);
  });
});

describe('GAP-03 — پیدا کردن symbol', () => {
  it('با نام یکتا کار می‌کند', async () => {
    const { explanation } = await explanationOf({ name: 'find' });
    expect(explanation.id).toBe('s-find');
  });

  it('نام مبهم خطا نیست — نامزدها برمی‌گردند', async () => {
    /*
    | دو symbol به نام `login` هست. خطا دادن یعنی یک رفت‌وبرگشت
    | اضافه برای چیزی که خودمان می‌دانیم.
    */
    const result = await new ExplainSymbolTool(reader()).execute({ name: 'login' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/2 symbols/);
    expect(result.items.map(item => item.id).sort()).toEqual(['s-ctrl', 's-login']);
  });

  it('`path` ابهام را رفع می‌کند', async () => {
    const { explanation } = await explanationOf({
      name: 'login',
      path: 'src/auth/auth.service.ts',
    });
    expect(explanation.id).toBe('s-login');
  });

  it('نام ناموجود، خطای روشن', async () => {
    const result = await new ExplainSymbolTool(reader()).execute({ name: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('nope');
  });

  it('بدون id و بدون name، خطای روشن', async () => {
    const result = await new ExplainSymbolTool(reader()).execute({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/id or name/);
  });
});

describe('GAP-03 — چیزی ساخته نمی‌شود', () => {
  it('فیلدی که داده ندارد، غایب است — نه صفر', async () => {
    const { explanation } = await explanationOf({ id: 's-find' });
    expect(explanation.git).toBeUndefined();
    expect(explanation.aiScore).toBeUndefined();
    expect(explanation.complexity).toBeNull();
    expect(explanation.referenceCount).toBeNull();
  });

  it('مقصدی که symbol نیست، همان‌طور که هست گزارش می‌شود', async () => {
    const withExternal = index();
    (withExternal.graphs.callGraph as unknown[]).push({
      id: 'x',
      caller: 's-find',
      callee: 'console.log',
      callerKind: 'symbol',
      kind: 'external',
      line: 6,
      provenance: provenanceFor('unresolved', 'typescript-api', { file: 'x.ts', line: 6 }),
    });

    const tool = new ExplainSymbolTool(new ProjectIndexReader(withExternal));
    const result = await tool.execute({ id: 's-find' });
    const explanation = result.items[0].metadata as unknown as SymbolExplanation;

    expect(explanation.calls.map(entry => entry.name)).toEqual(['console.log']);
    expect(explanation.calls[0].basis).toBe('unresolved');
  });
});

describe('GAP-03 — ثبت در رجیستری', () => {
  it('ابزار نام و شرح دارد', () => {
    const tool = new ExplainSymbolTool(reader());
    expect(tool.name).toBe('explain_symbol');
    expect(tool.description.length).toBeGreaterThan(30);
    expect(tool.inputSchema).toBeDefined();
  });
});
