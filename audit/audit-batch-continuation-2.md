# ممیزی ادامه‌ای — batch continuation 2

## دامنه و روش

نخستین ۲۰ مسیر با وضعیت `درانتظار` از `AUDIT_FILE_STATUS.md` انتخاب و فایل‌های repository در `work/repo` کامل، خط‌به‌خط و با شماره‌خط بررسی شدند. call path محلی، وابستگی‌ها، مسیر خطا، multi-project scope، تست‌های مرتبط و محدودیت‌ها بررسی شد؛ امنیت خارج از scope بود. فقط شواهد قطعی زیر finding قطعی شده‌اند؛ موارد دیگر POTENTIAL/UNVERIFIED هستند.

## فایل‌های بررسی‌شده

1. `semantic-engine/src/ai/ranking/ContextRanker.test.ts`
2. `semantic-engine/src/ai/ranking/ContextRanker.ts`
3. `semantic-engine/src/ai/ranking/TokenBudget.test.ts`
4. `semantic-engine/src/ai/ranking/TokenBudget.ts`
5. `semantic-engine/src/ai/schemas/ai-tools.schema.json`
6. `semantic-engine/src/ai/secretRedaction.test.ts`
7. `semantic-engine/src/ai/semanticSearchAcceptance.phase44.test.ts`
8. `semantic-engine/src/ai/tools/AssembleContextTool.test.ts`
9. `semantic-engine/src/ai/tools/DetectArchitectureViolationsTool.ts`
10. `semantic-engine/src/ai/tools/DiscoverContextTool.ts`
11. `semantic-engine/src/ai/tools/ExplainSymbolTool.class.test.ts`
12. `semantic-engine/src/ai/tools/ExplainSymbolTool.test.ts`
13. `semantic-engine/src/ai/tools/ExplainSymbolTool.ts`
14. `semantic-engine/src/ai/tools/FindSymbolTool.ts`
15. `semantic-engine/src/ai/tools/FindTestsTool.ts`
16. `semantic-engine/src/ai/tools/GetConfigUsageTool.ts`
17. `semantic-engine/src/ai/tools/GetDependenciesTool.ts`
18. `semantic-engine/src/ai/tools/GetFileSummaryTool.ts`
19. `semantic-engine/src/ai/tools/GetGitHotspotsTool.ts`
20. `semantic-engine/src/ai/tools/GetRecentChangesTool.ts`

## Findings قطعی

### F-21 — `checkCyclesOnly` در DetectArchitectureViolationsTool نادیده گرفته می‌شود

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Scope:** قرارداد ابزار / correctness؛ برای هر پروژه‌ای که از این ابزار استفاده کند

Input schema گزینه‌ای با نام `checkCyclesOnly` را اعلام می‌کند:

```ts
checkCyclesOnly: {
  type: 'boolean',
  description: 'Whether to restrict analysis to circular dependency detection only',
},
```

Evidence: `semantic-engine/src/ai/tools/DetectArchitectureViolationsTool.ts:16-20`.

اما مسیر اجرا input را دور می‌اندازد و همیشه کل تحلیل را اجرا می‌کند:

```ts
async execute(_input: AiToolInput): Promise<AiToolOutput> {
  ...
  const report = engine.analyzeArchitectureDebt(graph);
```

Evidence: `semantic-engine/src/ai/tools/DetectArchitectureViolationsTool.ts:25-34`. خروجی نیز بدون شرط، هم `report.circularDependencies` و هم `report.layerViolations` را map می‌کند (`:36-63`). بنابراین فراخوانی با `{checkCyclesOnly: true}` layer violations را حذف نمی‌کند؛ گزینهٔ مستندشده اثر عملی ندارد. این نقص در call path ابزار → `buildIndexGraph(reader)` → `ArchitectureRuleEngine.analyzeArchitectureDebt(graph)` رخ می‌دهد و project-local یا multi-project بودن را تغییر نمی‌دهد.

### F-22 — GetDependenciesTool عمق بیش از سقف را clamp می‌کند، برخلاف قرارداد اعلام‌شده

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Scope:** correctness / contract؛ گراف هر پروژه

Schema صراحتاً می‌گوید درخواست بزرگ‌تر از ۳ باید رد شود:

```ts
depth: { type: 'integer', default: 1, minimum: 1, maximum: 3, description: 'How many hops to traverse. Capped at 3; asking for more is rejected rather than silently reduced.' },
```

Evidence: `semantic-engine/src/ai/tools/GetDependenciesTool.ts:30`.

اما implementation مقدار را بی‌صدا کاهش می‌دهد:

```ts
const depth = Math.min(input.depth ?? 1, MAX_DEPTH);
```

Evidence: `semantic-engine/src/ai/tools/GetDependenciesTool.ts:48`؛ `MAX_DEPTH = 3` در `:19`. سپس traversal با همین مقدار ادامه می‌یابد (`:70-75`, `:109`). هیچ validation یا error برای `depth > 3` وجود ندارد و پاسخ success با نتایج عمق ۳ برمی‌گردد. پس caller که عمق ۴ یا ۱۰ می‌خواهد نمی‌تواند بفهمد درخواستش اجرا نشده و خروجی ناقص است. این finding مستقل از جهت forward/backward، level و kind است و روی هر index/project صدق می‌کند.

### F-23 — دو schema ورودی معتبر implementation را به‌اشتباه رد می‌کنند

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Scope:** schema validation / AI tool contract؛ multi-project scope ندارد و برای هر project index رخ می‌دهد

`FindTestsTool` در implementation فایل را با `fileId` یا symbol را با `symbolId` می‌پذیرد:

```ts
const file = input.fileId
  ? this.reader.getFileById(input.fileId)
  : input.path
    ? this.reader.getFileByPath(input.path)
    : undefined;
const symbol = input.symbolId ? this.reader.getSymbolById(input.symbolId) : undefined;
```

Evidence: `semantic-engine/src/ai/tools/FindTestsTool.ts:33-40`. با این حال schema فقط path را required اعلام می‌کند:

```ts
required: ['path'],
```

Evidence: `semantic-engine/src/ai/tools/FindTestsTool.ts:26`. بنابراین درخواست معتبر `{fileId: '...'}` یا `{symbolId: '...'}` پیش از رسیدن به execute توسط validator رد می‌شود.

همین mismatch در `GetConfigUsageTool` نیز وجود دارد. implementation همهٔ فیلترها را optional می‌داند (`key`, `path`, `kind`, `limit`) و بدون key هم تمام config usages را enumerate می‌کند (`semantic-engine/src/ai/tools/GetConfigUsageTool.ts:34-43`, `:55-79`)، ولی schema می‌گوید:

```ts
required: ['key'],
```

Evidence: `semantic-engine/src/ai/tools/GetConfigUsageTool.ts:19-30`. پس use case مستندشدهٔ «یافتن استفاده‌های config/env در پروژه» بدون فیلتر key، که implementation آن را پشتیبانی می‌کند، در validation رد می‌شود. این دو مورد یک finding قراردادی واحد با دو manifestation قطعی هستند.

## POTENTIAL / UNVERIFIED (finding قطعی نیست)

- `ContextRanker.ts:203-205` وزن‌های caller را بدون validation می‌پذیرد؛ رفتار وزن منفی/NaN در قرارداد مشخص نشده و تست موجود فقط وزن صفر/مثبت را پوشش می‌دهد. POTENTIAL.
- `TokenBudget.ts:193-205` کلید `sectionIndex::item.id` را برای dedup استفاده می‌کند؛ اگر id آیتم‌ها داخل یک section تکراری باشد، رفتار گزارش kept/dropped می‌تواند ناسازگار شود. uniqueness contract در این فایل اثبات نشده. UNVERIFIED.
- `GetGitHotspotsTool.ts:29` با `(input.limit as number) || 10` مقدار صفر را به ۱۰ تبدیل می‌کند؛ قرارداد limit حداقل را اعلام نمی‌کند. POTENTIAL.
- `GetRecentChangesTool.ts:47-55` تاریخ `since` نامعتبر را silently ignore می‌کند؛ قرارداد دربارهٔ invalid ISO error مشخص نکرده است. POTENTIAL.
- `ai-tools.schema.json` فقط schemaهای declarative موجود را تعریف می‌کند و در خودِ این فایل required بودن top-level `tools` را enforce نمی‌کند (`:6-12`)، اما call path مصرف validator در فایل‌های این batch اثبات نشد؛ UNVERIFIED.
- تست‌های redaction و پذیرش semantic-search ادعاهای خودشان را پوشش می‌دهند؛ security findings عمداً خارج از scope ممیزی هستند.

## تست و blocker

تست‌های هدفمند قابل اجرا نبودند. `package.json` script تست را `jest` و devDependency را `ts-jest` اعلام می‌کند (`package.json:scripts.test`, `package.json:devDependencies`)، اما `repo/node_modules/.bin/jest` وجود نداشت؛ بنابراین `ts-jest` نیز در dependency نصب‌شده موجود نبود. اجرای هدفمند با این blocker انجام نشد و این مورد صریحاً به‌عنوان عدم اجرای تست ثبت می‌شود.

## وضعیت

فقط همین ۲۰ مسیر در `AUDIT_FILE_STATUS.md` از `درانتظار` به `کامل` تغییر داده شدند. هیچ مسیر دیگری تغییر نکرد.
