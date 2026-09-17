# گزارش ممیزی ادامه‌ای ۳

## دامنه و روش

نخستین ۲۰ مسیر دارای وضعیت `درانتظار` در `AUDIT_FILE_STATUS.md` بررسی شدند. هر فایل کامل و خط‌به‌خط خوانده شد؛ امنیت خارج از دامنه بود. نقش، مسیر فراخوانی، وابستگی، خطا/رفتار قابل مشاهده، دامنه چندپروژه‌ای، تست و محدودیت برای هر فایل ثبت شده است. «قطعی» فقط برای مواردی آمده که از کد و مسیر فراخوانی evidence مستقیم دارند؛ موارد دیگر `POTENTIAL/UNVERIFIED` هستند.

## فایل‌های بررسی‌شده و تحلیل

1. `semantic-engine/src/ai/tools/ImpactAnalysisTool.test.ts` — تست واحد/قراردادی `ImpactAnalysisTool`: فاصله کوتاه‌ترین، مرتب‌سازی امتیاز، limit، level، confidence، چرخه و شناسه ناشناخته را می‌سنجد. وابستگی مستقیم به `ProjectIndexReader`، `ImpactAnalysisTool`، provenance و مدل index است؛ مسیر فراخوانی تست → `execute`. دامنه multi-project در fixture واحد آزموده نشده است. محدودیت: فقط سناریوهای fixture و سقف عمق ۳ را پوشش می‌دهد؛ تست اجرا نشد چون `node_modules` و `ts-jest` موجود نبودند.
2. `semantic-engine/src/ai/tools/ImpactAnalysisTool.ts` — ابزار اثرگذاری که seed فایل/سمبل/ماژول/پکیج را resolve می‌کند، `GraphQueryEngine` را یک‌بار می‌سازد، ancestors/subgraph را در جهت `in` می‌خواند و نتیجه را score/sort/slice می‌کند. مسیر: registry/مصرف‌کننده AI → `execute` → `resolveSeeds` → `GraphQueryEngine` → `describe`. وابسته به reader، graph engine و resolveIndexEntity؛ blueprint اختیاری برای module. multi-project از index و reader جاری می‌آید و ایزولاسیون در این فایل اثبات نشده است. محدودیت قطعی کد: عمق فقط سقف‌گذاری می‌شود (`const depth = Math.min(input.depth ?? 2, 3)` در خطوط 92–93) و اعتبارسنجی صریح برای منفی/غیرعددی ندارد؛ اثر عملی ورودی نامعتبر `POTENTIAL/UNVERIFIED` است چون رفتار engine باید جدا بررسی شود.
3. `semantic-engine/src/ai/tools/QueryIndexTool.ts` — ابزار اجرای query خواندنی روی SQLite با policy مسیر/SQL، بازکردن `openSqlite`، map ردیف‌ها به `AiToolOutput` و close در finally. مسیر: MCP/registry → `execute` → `validateDatabasePath`/`applyQueryPolicy` → `openSqlite` → `all` → `close`. وابستگی به queryPolicy و SQLiteDriver؛ root artifact از options می‌آید و برای هر project باید جدا ساخته شود. `loadSqlite` در خطوط 165–172 تعریف شده اما در این فایل استفاده نمی‌شود؛ اثر عملی/فقدان آن `POTENTIAL/UNVERIFIED` است چون درایور واقعی مسیر مستقل دارد. تست مرتبط در فایل بعدیِ آزموده‌نشده به دلیل blocker است.
4. `semantic-engine/src/ai/tools/SemanticSearchTool.test.ts` — تست جامع جست‌وجوی واژه‌ای/embedding، نرمال‌سازی score، سیگنال‌ها، stopword، path filter، minScore، زبان‌های غیرلاتین و پایداری. مسیر تست → `SemanticSearchTool.execute`; وابسته به reader، embedding mock و index fixture. multi-project و تغییر index در طول عمر ابزار پوشش ندارد. اجرا نشد: `node_modules`/`ts-jest` موجود نبود.
5. `semantic-engine/src/ai/tools/SimulateMutationTool.ts` — ابزار شبیه‌سازی rename/delete/move قبل از mutation دیسک؛ target را resolve، graph مشترک را با call edges می‌سازد و `MutationSimulator.simulate` را به خروجی broken references تبدیل می‌کند. مسیر: AI registry → `execute` → `resolveSymbolId` → `buildIndexGraph` → `MutationSimulator`. وابستگی به reader، graph builder، simulator و resolver؛ graph همان project index جاری را مصرف می‌کند. **یافته قطعی:** schema در خطوط 10–22 `move_symbol` را مجاز اعلام می‌کند، اما simulator وابسته فقط برای `delete_symbol` و `rename_symbol` شاخه دارد (evidence verbatim در dependency: `if (action.type === 'delete_symbol')` و `} else if (action.type === 'rename_symbol')`). tool بدون validate/catch در خطوط 61–69 خروجی success می‌دهد؛ بنابراین `move_symbol` عملاً بدون تحلیل، `isSafe: true` برمی‌گرداند. دامنه چندپروژه‌ای به graph جاری محدود است. محدودیت: newPath در ورودی tool اصلاً expose نمی‌شود.
6. `semantic-engine/src/ai/tools/SymbolTermIndex.test.ts` — تست برابری index معکوس با brute-force، prefix، path/docs، اجتماع termها، non-Latin و lazy build. مسیر تست → `SymbolTermIndex.candidatesFor/segmentsOf`; وابسته به reader/queryTerms. multi-project فقط از نظر ایندکس مستقل در fixture دیده می‌شود. اجرا نشد به‌علت نبود dependency.
7. `semantic-engine/src/ai/tools/SymbolTermIndex.ts` — lazy reverse index از term/prefix به symbol IDs، همراه cache قطعه‌ها؛ ورودی‌های لاتین با postings و non-Latin با پیمایش کلیدهای exact پاسخ می‌گیرند. مسیر: `SemanticSearchTool` (مصرف‌کننده بالادستی) → `candidatesFor` → `build` → `identifierSegments`. وابسته به reader و queryTerms. برای هر reader/index عمر جدا دارد؛ reuse بین projectها در این کلاس تضمین نشده. محدودیت: non-Latin همچنان روی کل exact keys پیمایش می‌کند؛ بهینه‌سازی کامل نیست، اما correctness ادعاشده است. یافته قطعی جدیدی از متن استخراج نشد.
8. `semantic-engine/src/ai/tools/ToolResultCache.test.ts` — تست LRU، stable key بازگشتی، آرایه، projectHash، TTL و clear. مسیر تست → `ToolResultCache.get/set`; وابستگی فقط types/cache. multi-project با projectHash مدل شده ولی collision/هم‌زمانی پروژه‌ها آزموده نشده. اجرا نشد به‌علت نبود `node_modules`/`ts-jest`.
9. `semantic-engine/src/ai/tools/ToolResultCache.ts` — cache نتایج ابزار با stable stringify، LRU map، projectHash و TTL. مسیر registry/tool wrapper → `get` پیش از اجرا یا `set` پس از اجرا. وابستگی به AiTool types و state درون حافظه؛ project scope با hash ورودی کنترل می‌شود. محدودیت: در نبود hash یکتای project در caller، جداسازی پروژه‌ها تضمین این فایل نیست؛ `POTENTIAL/UNVERIFIED` چون caller بررسی این batch نیست. یافته قطعی دیگری ندارد.
10. `semantic-engine/src/ai/tools/queryIndexArtifactRoot.test.ts` — تست resolve مسیر نسبی نسبت به artifact root، رد escape و رد اجرای بدون root. مسیر تست → `QueryIndexTool.execute` → policy. وابسته به fs/os/temp و QueryIndexTool. multi-project صریحاً artifact root جدا را مدل می‌کند. اجرا نشد به‌علت نبود dependency.
11. `semantic-engine/src/ai/tools/queryPolicy.test.ts` — تست policy برای SELECT/CTE، mutation، join/table allowlist، function، literals/comments، row cap و database path. مسیر تست → `applyQueryPolicy`/`validateDatabasePath`. وابستگی path و policy؛ multi-project ندارد. **یک نقص آزمون قطعی از اتصال تست به پیاده‌سازی:** تست `accepts a common table expression` انتظار پذیرش `WITH recent AS (SELECT id FROM files) SELECT * FROM symbols` را دارد، اما parser در `queryPolicy.ts:120–125` هر token بعد از `FROM|JOIN` را جمع می‌کند و alias `recent` را نیز table می‌گیرد؛ سپس allowlist در خطوط 203–205 آن را رد می‌کند. تست اجرا نشد برای تأیید runtime، اما مسیر منطقی و evidence کد قطعی است.
12. `semantic-engine/src/ai/tools/queryPolicy.ts` — policy خالص برای strip literal/comment، تشخیص statement، table allowlist، cap و path. مسیر `QueryIndexTool.execute` → `applyQueryPolicy`/`validateDatabasePath`. وابستگی فقط path؛ per-project root از caller. **یافته قطعی:** CTE alias با regex `const pattern = /\\b(?:from|join)\\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;` در خطوط 120–124 به‌عنوان table ثبت می‌شود، و allowlist در خطوط 203–205 آن را رد می‌کند؛ بنابراین CTE معتبر مورد ادعای تست خطای `Table 'recent' is not allowed` می‌گیرد. محدودیت: parser regex-based است؛ queryهای SQL پیچیده دیگر `POTENTIAL/UNVERIFIED` هستند.
13. `semantic-engine/src/ai/tools/queryTerms.ts` — tokenizer Unicode، stopword/min length انگلیسی، identifier segmentation و matching prefix/contains. مسیر SemanticSearchTool/SymbolTermIndex → queryTerms/identifierSegments/matchesSegments. وابستگی خارجی ندارد. multi-project ندارد و pure است. محدودیت طراحی صریح: non-Latin contains می‌گیرد و prefix نه؛ مناسب بودن آن برای زبان‌های دیگر `POTENTIAL/UNVERIFIED`. یافته قطعی جدیدی ندارد.
14. `semantic-engine/src/ai/tools/resolveIndexEntity.ts` — resolver برای stable file/symbol ID، path، `path::Symbol` و نام یکتا. مسیر graph tools (`ImpactAnalysisTool` و `SimulateMutationTool`) → resolver → ProjectIndexReader. وابستگی فقط reader. multi-project به index reader جاری محدود است؛ نام تکراری عمداً null می‌شود. یافته قطعی جدیدی ندارد.
15. `semantic-engine/src/ai/tools/v2AiTools.test.ts` — integration-style tests برای mutation، module-level caller، architecture cycles و git hotspots. مسیر تست → سه AI tool → reader/graph/services. fixtureها تک‌پروژه‌ای‌اند. اجرا نشد به‌علت blocker dependency.
16. `semantic-engine/src/blueprint/ApiMapExtractor.test.ts` — acceptance/unit tests Express/Fastify/Nest route extraction، handler، line/framework و false positives/comments/non-JS. مسیر تست → `ApiMapExtractor.extract`. وابستگی فقط extractor. multi-project ندارد. محدودیت‌های تست شامل routeهای چندخطی یا handlerهای چند middleware نیست؛ `POTENTIAL/UNVERIFIED`.
17. `semantic-engine/src/blueprint/ApiMapExtractor.ts` — استخراج قطعی route از JS/TS با regex، method calls، Fastify object و Nest decorators. مسیر `BlueprintGenerator.buildApiMap` → `extract`; sourceOf تزریق‌شده را مصرف می‌کند. وابستگی pure و types محلی؛ هر فایل project جدا پردازش می‌شود. محدودیت قطعی اعلام‌شده: فقط literal path، `app.use` prefix را propagate نمی‌کند، فقط JS/TS. محدودیت فنی محتمل: regex خطوط 81–82 و 112–113 به ساختار چندخطی حساس است؛ `POTENTIAL/UNVERIFIED` چون در قرارداد محدودیت صریح نیامده و تست runtime اجرا نشد. یافته قطعی دیگری ندارد.
18. `semantic-engine/src/blueprint/BlueprintGenerator.phase46.test.ts` — regression tests module ID collision/root coverage/cycles/layers/file refs/apiMap. مسیر تست → `BlueprintGenerator.generate/moduleRefs`. وابسته به project-index types و generator. multi-project ندارد. اجرا نشد به‌علت نبود dependency.
19. `semantic-engine/src/blueprint/BlueprintGenerator.test.ts` — end-to-end phase-6 test: scanner، dependency extraction/resolution، graph builders، JSON/Blueprint exporters و schema validation روی fixture. مسیر beforeAll → WorkspaceScanner/DependencyExtractor/graphs/exporters → validator؛ assertions روی blueprint. دامنه چندپروژه‌ای ندارد و به test-fixture/Node CLI وابسته است. اجرا نشد به‌علت نبود dependency.
20. `semantic-engine/src/blueprint/BlueprintGenerator.ts` — تولید blueprint مشتق‌شده: module map، apiMap، folder/dependency graph، entity/workflow، symbol index و constraints/Tarjan cycles. مسیر exporter/service → `generate` → builders. وابسته به ApiMapExtractor، EntityMapExtractor/WorkflowExtractor، hash و core types؛ state moduleRefs برای آخرین generate است. multi-project در هر invocation از یک ProjectIndex است و registry isolation این فایل اثبات نشده. محدودیت‌های قطعی: بدون `sourceOf` در خطوط 194–196 apiMap عمداً خالی است؛ فایل binary در خطوط 208–212 کنار گذاشته می‌شود؛ route source فقط وقتی truthy باشد خوانده می‌شود. شناسه module برای مسیرهای دارای `_`/`-` hash suffix می‌گیرد (خطوط 351–366) و طراحی collision را کاهش می‌دهد؛ نقص قطعی مشاهده نشد.

## یافته‌های قطعی جمع‌بندی‌شده

### F-1 — `move_symbol` در `SimulateMutationTool` شبیه‌سازی نمی‌شود
- **شدت/اثر:** correctness؛ ابزار ممکن است mutation پشتیبانی‌شده در schema را safe اعلام کند.
- **Evidence:** `SimulateMutationTool.ts:10–22` شامل `'move_symbol'` است؛ `:61–66` action را به simulator می‌دهد؛ simulator فقط شاخه‌های `delete_symbol` و `rename_symbol` دارد و برای move هیچ broken reference تولید نمی‌کند.
- **مسیر:** tool → `MutationSimulator.simulate`.
- **وضعیت تست:** تست موجود move ندارد؛ اجرا به blocker برخورد کرد.

### F-2 — CTE معتبر در `queryPolicy` به‌خاطر alias رد می‌شود
- **شدت/اثر:** correctness/API contract؛ تست policy خودش انتظار پذیرش CTE دارد.
- **Evidence verbatim:** `const pattern = /\\b(?:from|join)\\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;` (`queryPolicy.ts:120`) و `tables.push(match[1]!)` (`:124`)؛ سپس `if (!ALLOWED_TABLES.has(table))` (`:204`). برای `WITH recent AS (SELECT ... FROM files) SELECT ... FROM recent` مقدار `recent` استخراج و رد می‌شود.
- **مسیر:** QueryIndexTool → `applyQueryPolicy`.
- **وضعیت تست:** runtime اجرا نشد؛ نتیجه از مسیر کد قطعی است.

## تست و blocker

تلاش شد تست‌های مرتبط با هر دو خوشه (ابزارهای AI و Blueprint) با `npx jest --runInBand` اجرا شوند. خروجی قطعی:

```text
node_modules=no
ts-jest=no
BLOCKER: node_modules or ts-jest unavailable; tests not run
```

بنابراین هیچ تستی در این batch به‌عنوان passed/failed گزارش نمی‌شود؛ فقط تحلیل ایستا و evidence کد/تست ثبت شده است.

## فهرست دقیق تغییر وضعیت

فقط همین ۲۰ مسیر به `کامل` تغییر داده شدند:

- `semantic-engine/src/ai/tools/ImpactAnalysisTool.test.ts`
- `semantic-engine/src/ai/tools/ImpactAnalysisTool.ts`
- `semantic-engine/src/ai/tools/QueryIndexTool.ts`
- `semantic-engine/src/ai/tools/SemanticSearchTool.test.ts`
- `semantic-engine/src/ai/tools/SimulateMutationTool.ts`
- `semantic-engine/src/ai/tools/SymbolTermIndex.test.ts`
- `semantic-engine/src/ai/tools/SymbolTermIndex.ts`
- `semantic-engine/src/ai/tools/ToolResultCache.test.ts`
- `semantic-engine/src/ai/tools/ToolResultCache.ts`
- `semantic-engine/src/ai/tools/queryIndexArtifactRoot.test.ts`
- `semantic-engine/src/ai/tools/queryPolicy.test.ts`
- `semantic-engine/src/ai/tools/queryPolicy.ts`
- `semantic-engine/src/ai/tools/queryTerms.ts`
- `semantic-engine/src/ai/tools/resolveIndexEntity.ts`
- `semantic-engine/src/ai/tools/v2AiTools.test.ts`
- `semantic-engine/src/blueprint/ApiMapExtractor.test.ts`
- `semantic-engine/src/blueprint/ApiMapExtractor.ts`
- `semantic-engine/src/blueprint/BlueprintGenerator.phase46.test.ts`
- `semantic-engine/src/blueprint/BlueprintGenerator.test.ts`
- `semantic-engine/src/blueprint/BlueprintGenerator.ts`
