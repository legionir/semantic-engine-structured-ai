# ممیزی batch 51-1 — ۱۷ فایل بعدی

## دامنه و روش

دقیقاً ۱۷ مسیر بعدیِ وضعیت «درانتظار» در `AUDIT_FILE_STATUS.md` انتخاب شد (از `src/dependencies/heuristic/index.ts` تا `src/export/schemaValidation.ts`). هر فایل از ابتدا تا انتها خوانده شد؛ برای تست‌ها نیز suite/test caseها و wiring آن‌ها بررسی شد. امنیت عمداً خارج از scope است. در این گزارش فقط مواردی که از متن کد و قرارداد اجرایی مستقیماً قابل اثبات‌اند **FINDING** شده‌اند؛ موارد محتمل با **POTENTIAL/UNVERIFIED** جدا شده‌اند.

> اجرای تست ممکن نشد: `npm test -- --runInBand ...` به timeout رسید. تلاش مستقیم با `npx jest` نیز در ابتدای راه متوقف شد، چون `ts-jest` در `node_modules` نصب نیست و Jest خطای `Preset ts-jest not found` داد. بنابراین assertions از روی source/test خوانده شده‌اند، نه از اجرای موفق.

## Findings قطعی

### F-51-1 — `JsonExporter.export` گزینهٔ validation را نادیده می‌گیرد و parent directory را نمی‌سازد

- **فایل/خطوط:** `semantic-engine/src/export/JsonExporter.ts:141-160`.
- **نقش و call path:** API اصلی تولید خروجی: `export(scanResult, allSymbols, options, ...)` → `buildProjectIndex(...)` → `JSON.stringify` → `fs.promises.writeFile`. مسیر `writeProjectIndex` در خطوط 122-135 validation و `mkdir` دارد، اما call path اصلی `export` از آن عبور نمی‌کند.
- **Evidence verbatim:** خطوط 141-150 امضای `export` و `options` با فیلد `validate` را نشان می‌دهد؛ خطوط 152-160 دقیقاً فقط `buildProjectIndex`، `JSON.stringify` و `fs.promises.writeFile(options.outputPath, json, 'utf8')` را اجرا می‌کنند؛ هیچ `if (options.validate)` یا `mkdir` در این مسیر نیست. در مقابل، خطوط 122-135 شامل `if (options.validate)` و `await fs.promises.mkdir(path.dirname(options.outputPath), { recursive: true });` هستند.
- **اثر قطعی:** `ExportOptions.validate` در مسیر عمومی و مستند exporter اثری ندارد؛ index نامعتبر می‌تواند نوشته شود. همچنین اگر parent خروجی وجود نداشته باشد، `export` با `ENOENT` شکست می‌خورد، در حالی‌که API دیگر parent را می‌سازد.
- **وابستگی‌ها/چندپروژه:** وابسته به schema validator از `./schemaValidation` و filesystem است؛ با هر workspace و هر پروژه تکرار می‌شود، نه مختص fixture یا single-project.
- **تست مرتبط:** `JsonExporter.phase24.test.ts:145-182` validation را روی `validate()` و `writeProjectIndex` می‌سنجد، نه روی `export`؛ `JsonExporter.schema.test.ts:45-76` هم `export` را بدون `validate: true` اجرا می‌کند و سپس validator خارجی را دستی صدا می‌زند، پس این regression را نمی‌گیرد.
- **محدودیت:** تست runtime به دلیل نبود `ts-jest` اجرا نشد.

### F-51-2 — مهاجرت database قدیمیِ بدون `meta` واقعاً انجام نمی‌شود

- **فایل/خطوط:** `semantic-engine/src/export/SQLiteExporter.ts:114-122,124-137`.
- **نقش و call path:** `SQLiteExporter.export` خطوط 60-80 → `ensureSchema` خطوط 114-122 → `readSchemaVersion` خطوط 124-137 → `createTables`. برای DB قدیمی قبل از فاز ۲۴، `SELECT ... FROM meta` خطا می‌دهد و `readSchemaVersion` مقدار `null` می‌دهد.
- **Evidence verbatim:** `ensureSchema` فقط وقتی drop می‌کند که `existing !== null && existing !== SQLITE_SCHEMA_VERSION` (خطوط 117-120). `readSchemaVersion` در catch صراحتاً `return null` دارد (خطوط 132-137) و comment می‌گوید «جدول `meta` وجود ندارد ... از پیش از فاز ۲۴». سپس بدون drop، `await this.createTables(db)` اجرا می‌شود (خطوط 121-122). `CREATE TABLE IF NOT EXISTS` در خطوط 150 و 178 و بقیه، جدول موجود را alter نمی‌کند؛ insert جدید به ستون‌های فازهای بعدی در خطوط 315-320 و 354-362 وابسته است.
- **اثر قطعی:** روی DB موجودِ بدون `meta` که جدول‌های قدیمی دارد، جدول‌ها حفظ می‌شوند و ستون‌های جدید ایجاد نمی‌شوند؛ export بعدی می‌تواند با «no such column»/عدم تطابق تعداد ستون‌ها fail شود، یا DB با schema جدید همگام نشود. این برخلاف comment خطوط 108-112 است که بازسازی را وعده می‌دهد.
- **وابستگی‌ها/چندپروژه:** به SQLite schema و `SqliteDriver` وابسته است؛ هر DB cache قدیمی، از جمله هر پروژهٔ مستقل یا workspace چندپروژه‌ای که reuse شود، تحت اثر است.
- **تست مرتبط:** `SQLiteExporter.phase24.test.ts:164-197` فقط meta و DB با version ناسازگار را پوشش می‌دهد؛ مورد «no meta ولی جدول‌های قدیمی موجود» تست نشده است.
- **محدودیت:** تست اجرا نشد؛ تحلیل از مسیر قطعی کد و قرارداد SQLite است.

### F-51-3 — ادعای engines `>=20` با fallback ناقص SQLite ناسازگار است

- **فایل‌های مرتبط در همین batch:** `semantic-engine/src/export/SQLiteExporter.ts:32-34,59-83` و `semantic-engine/src/export/sqlite/SqliteDriver.ts` خارج از ۱۷ فایل اما dependency مستقیم آن.
- **نقش/call path:** `SQLiteExporter.export` → `openSqlite(options.outputPath)` → `hasNativeSqlite()`؛ اگر native Node SQLite موجود نباشد، `openSqlite3(filePath)` فراخوانی می‌شود.
- **Evidence verbatim:** `package.json:engines` می‌گوید `"node": ">=20"` و dependencies/optionalDependencies آن هیچ `sqlite3`ای ندارد. در driver، خطوط 171-173 دقیقاً می‌گویند `if (hasNativeSqlite()) return openNodeSqlite(filePath); return openSqlite3(filePath);` و خطوط 123-126 `require('sqlite3')` را انجام می‌دهند. خود driver خطوط 14-17 می‌گوید native از Node `>=22.5` است.
- **اثر قطعی:** در Node 20 (که package رسماً پشتیبانی می‌کند)، native `node:sqlite` موجود نیست و چون `sqlite3` در package metadata نیست، SQLite export با `MODULE_NOT_FOUND` شکست می‌خورد. این یک ناسازگاری build/runtime قابل بازتولید از metadata و call path است.
- **تست مرتبط:** `SQLiteExporter.phase24.test.ts:82-92` عملاً وجود native SQLite و انتخاب همان driver را می‌سنجد؛ این تست fallback Node 20 بدون sqlite3 را پوشش نمی‌دهد. `SQLiteExporter.test.ts:95-186` نیز به driver موجود وابسته است.
- **محدودیت:** runtime suite اجرا نشد؛ نسخهٔ Node محیط فعلی/نصب native برای اجرای assertion قابل اتکا نبود.

## فهرست فایل‌های ممیزی‌شده بدون finding قطعی

در موارد زیر نقش، call path، وابستگی‌ها، scope چندپروژه‌ای، تست/شواهد و محدودیت‌ها بررسی شد؛ defect قطعی دیگری از متن کامل فایل احراز نشد. نبود finding به معنی تضمین کامل correctness نیست؛ مواردی که test یا integration لازم دارند POTENTIAL/UNVERIFIED هستند.

### 1) `src/dependencies/heuristic/index.ts`

- **نقش:** barrel تک‌خطی برای `HeuristicDependencyExtractor`؛ evidence خط 1: `export { HeuristicDependencyExtractor } from './HeuristicDependencyExtractor';`.
- **Call path/deps:** مصرف‌کنندهٔ package از barrel dependencies به implementation heuristic می‌رسد؛ implementation در این فایل نیست. فقط dependency داخلی همان module است.
- **Scope/tests/limits:** export در سطح package و بنابراین برای هر پروژه یکسان؛ تست مستقیمی در این path نیست. ممیزی implementation خارج از batch بود، پس correctness extractor اینجا **UNVERIFIED** است.

### 2) `src/dependencies/index.ts`

- **نقش:** public barrel برای interface/result، manager، TS extractor، path resolver و re-export resolver؛ evidence خطوط 1-5.
- **Call path/deps:** import از `dependencies` به پنج export داخلی می‌رود؛ side effect یا transform ندارد.
- **Scope/tests/limits:** multi-project مستقل از state این فایل است؛ تست‌های مرتبط `ReExportResolver.test.ts` و phase18 path/dependency tests هستند. فقط wiring barrel در این فایل قطعی است؛ وجود exportها بدون build/runtime **UNVERIFIED** ماند.

### 3) `src/dependencies/typescript/ReExportResolver.test.ts`

- **نقش:** unit test برای resolve کردن re-export و link کردن local export symbol IDs.
- **Evidence:** خطوط 12-20 fixture روی disk می‌سازند و cleanup می‌کنند؛ خطوط 57-89 انتظار `resolvedFileId`/`resolvedSymbolId` و namespace null را دارد؛ خطوط 91-112 local `symbolId` را assert می‌کند.
- **Call path/deps:** test → `TSPathResolver` → `ReExportResolver.resolve` یا `linkLocalExportSymbolIds`; types از project-index و confidence utility.
- **Scope/limits:** fixture single root `tmp-reexport-resolver-test` و paths نسبی است؛ package aliases, project references, cycles و چند tsconfig پروژه تست نشده‌اند (**UNVERIFIED**). اجرای واقعی ممکن نشد (نبود ts-jest).

### 4) `src/dependencies/typescript/TSDependencyExtractor.phase18.test.ts`

- **نقش:** phase-18 acceptance/unit suite برای TypeScript API extractor.
- **Evidence:** helper خطوط 19-27 `extractDependencies('f1', file, source, language)` را صدا می‌زند؛ suiteها خطوط 29-43 provenance، 45-97 export splitting، 99-161 CommonJS، 163-197 builtin، 199-236 type-only، 238-263 anonymous default را پوشش می‌دهند.
- **Call path/deps:** test → `TSDependencyExtractor`؛ از project-index entry types استفاده می‌کند.
- **Scope/limits:** source strings در memory و `f1` مصنوعی‌اند؛ package resolution، tsconfig paths، project references، malformed syntax، monorepo cross-project imports و filesystem integration پوشش داده نشده (**UNVERIFIED**). تست اجرا نشد.

### 5) `src/dependencies/typescript/TSPathResolver.phase18.test.ts`

- **نقش:** acceptance suite برای extends chain و module file shapes/caching.
- **Evidence:** خطوط 26-32 temp root lifecycle؛ خطوط 34-103 extends/override/chain/baseUrl/cycle/missing config؛ خطوط 106-153 پسوندها/index/declaration/preference/missing؛ خطوط 156-214 disk probe cache.
- **Call path/deps:** test → `new TSPathResolver(root).resolve` و `stats`; fs/os/path برای fixture.
- **Scope/limits:** یک root و config plain JSON ساخته می‌شود؛ package `extends`، npm resolution، `tsconfig` JSONC، symlink، project references و چند project root تست نشده (**UNVERIFIED**). اجرای suite ممکن نشد.

### 6) `src/export/BlueprintExporter.ts`

- **نقش:** ساخت/نوشتن blueprint با `BlueprintGenerator` و atomic rename؛ evidence خطوط 56-70 (`export`)، 79-85 (`buildWithRefs`)، 89-95 (`write`)، 97-100 (`buildBlueprint`).
- **Call path/deps:** API → `withSourceReader` خطوط 102-109 → `BlueprintGenerator.generate`; export/write → `writeAtomic` خطوط 45-53. reader فقط JS/TS و حداکثر `512 * 1024` bytes (خطوط 28-40) از `projectIndex.rootPath` می‌خواند.
- **Finding قطعی:** ندارد. **POTENTIAL/UNVERIFIED:** `writeAtomic` parent directory را ایجاد نمی‌کند (خطوط 45-49)، بنابراین caller باید parent را از قبل بسازد؛ تست این batch برای BlueprintExporter نیست. این رفتار فقط به عنوان potential ثبت شد چون قرارداد caller صراحتاً در این فایل نیست.
- **Scope:** reader بر root یک index عمل می‌کند؛ برای multi-project باید هر index root صحیح بدهد. symlink/path semantics و source reader failure فقط با `undefined` سنجیده می‌شوند.

### 7) `src/export/JsonExporter.e2e.test.ts`

- **نقش:** E2E تولید JSON و اجرای validator خارجی.
- **Evidence:** خطوط 49-81 یک scan/symbol مصنوعی، `exporter.export`، خواندن output و `validate-schema.js project-index` را اجرا می‌کند؛ assertions خطوط 73-76 schema و files/symbols را بررسی می‌کند.
- **Call path/deps:** test → `JsonExporter.export` → filesystem → external validator script؛ fixtureها در `tmp-e2e`.
- **Scope/limits:** E2E تنها یک فایل/یک symbol دارد؛ graph/dependency/invalid input/parent missing/`validate:true` پوشش ندارد. به build artifacts و installed dependencies وابسته است؛ اجرا timeout/ts-jest missing داشت.

### 8) `src/export/JsonExporter.phase24.test.ts`

- **نقش:** acceptance suite خروجی outline/rootPath/schema، حذف fileContents، و output-folder handling.
- **Evidence:** suites خطوط 69-118 outline؛ 121-143 root/rootPath؛ 145-182 validation؛ 190-272 memory/content lifecycle؛ 274-327 output ignore/outside workspace.
- **Call path/deps:** testها به `JsonExporter.buildProjectIndex/finalizeProjectIndex/writeProjectIndex/export`، scanner/pipeline و fs وصل‌اند.
- **Scope/limits:** هر موضوع با fixtureهای کوچک و temp dirs است؛ full concurrent/multi-project output, malformed graph, export `validate` (F-51-1) پوشش ندارد. تست اجرایی ناموفق/timeout بود.

### 9) `src/export/JsonExporter.phase4.test.ts`

- **نقش:** end-to-end dependency + graph acceptance.
- **Evidence:** خطوط 83-116 assertions برای valid index، imports/exports، local file IDs، dependency graph و package kind.
- **Call path/deps:** test → pipeline fixture/project index → `JsonExporter` و dependency/graph builders؛ دقیقاً wiring phase 4 را exercise می‌کند.
- **Scope/limits:** fixture path و TS/JS محدود؛ cross-package workspace, circular graphs, missing targets و diagnostics aggregate محدود/بدون assertion مستقیم هستند. suite اجرا نشد.

### 10) `src/export/JsonExporter.schema.test.ts`

- **نقش:** schema validation integration با script validator.
- **Evidence:** خطوط 45-80 basic index و 82-128 Phase C `gitMetrics/configUsages` را export کرده و `validate-schema.js` را با `execSync` اجرا می‌کند.
- **Call path/deps:** test → `JsonExporter.export` → JSON file → child process validator؛ temp dirs خطوط 59-61 و 108-110.
- **Scope/limits:** نکتهٔ قطعی مرتبط با F-51-1: هر دو call به `export` بدون `validate: true` هستند، پس write-time validation را ثابت نمی‌کنند. cleanup بعد از assertion است و در failure ممکن است temp بماند (**POTENTIAL**). تست اجرا نشد.

### 11) `src/export/JsonExporter.test.ts`

- **نقش:** unit coverage برای dedupe/metrics/call refs/root/determinism/test IDs/git/config.
- **Evidence:** test names/خطوط 48-380؛ ورودی‌های scan/symbol مصنوعی در helperهای ابتدای فایل و assertions برای duplicate، complexity، graph refs، root، deterministic output و enrichment.
- **Call path/deps:** test → public `buildProjectIndex/finalizeProjectIndex`; types و `makeConfidence`، fs/path برای temp output در بخش‌های مربوط.
- **Scope/limits:** implementation private methods فقط غیرمستقیم دیده می‌شوند؛ export write validation/parent handling پوشش ندارد، LLM path، malformed symbols, huge monorepo و concurrent calls نیز **UNVERIFIED**. اجرا نشد.

### 12) `src/export/JsonExporter.ts`

- **نقش:** ترکیب scan/symbol/dependencies/graphs/enrichment و تولید ProjectIndex؛ خطوط 141-259 build path، 271-341 finalization، 442-463 metadata، 664-739 metrics.
- **Call path/deps:** scanner + symbol list + dependency/graph results → dedupe/sort → attach symbols/deps → reverse graph → TestMapper → AI metadata/metrics → JSON. به schema validator، graph indexes، AI metadata/LLM و TestMapper وابسته است.
- **Scope:** `workspaceRoot` و `rootPath` در خطوط 231-234 به هر index تعلق دارد؛ state mutable فقط local/cached downstream objects است. برای multi-project، caller باید inputs/file IDs را جدا نگه دارد؛ این فایل project isolation را enforce نمی‌کند (**UNVERIFIED**).
- **محدودیت/پتانسیل:** LLM failure propagation، duplicate `fileId` inputs، missing graph endpoints و export direct path نیازمند integration است. finding قطعی اصلی F-51-1 است.

### 13) `src/export/SQLiteExporter.phase24.test.ts`

- **نقش:** acceptance tests برای dead-row pruning، meta/schema version و FK cascade.
- **Evidence:** خطوط 82-92 driver availability؛ 94-162 deleted file/symbol/edge؛ 164-197 meta/version rebuild؛ 199-231 FK insert/cascade.
- **Call path/deps:** test → `SQLiteExporter.export` → `openSqlite(':memory:' یا temp)` → SQL queries via driver.
- **Scope/limits:** version-mismatch path tested ولی no-meta-old-tables (F-51-2) نیست؛ native-only availability path (F-51-3) نیز fallback Node20 را نمی‌سنجد. اجرا نشد.

### 14) `src/export/SQLiteExporter.test.ts`

- **نقش:** baseline schema/files/symbol/vector export و orphan symbol reference behavior.
- **Evidence:** tests خطوط 95-116 tables/files/symbols، 134-156 vector chunks، 158-186 missing symbol reconciliation را assert می‌کنند.
- **Call path/deps:** test → `SQLiteExporter.export` و driver query helpers؛ fixture index کامل در ابتدای فایل.
- **Scope/limits:** پروژه کوچک/in-memory و یک export؛ concurrent writers، stale rows across process restart، old unversioned schema و Node20 fallback **UNVERIFIED**. تست اجرا نشد.

### 15) `src/export/SQLiteExporter.ts`

- **نقش:** materialize کردن ProjectIndex در SQLite؛ schema، transaction، prepared statements، prune dead rows، meta و vector reconciliation.
- **Call path/deps:** خطوط 60-83 open/optimize/schema/transaction/inserts/prune/meta/close؛ SQL driver در `./sqlite/SqliteDriver` و ProjectIndex types.
- **Scope:** همهٔ جدول‌ها متعلق به exporter هستند (TABLES خطوط 44-53)؛ DB هر project باید output مستقل داشته باشد، چون `deleteDeadRows` کل DB را به input فعلی reconcile می‌کند. multi-project sharing یک DB عملاً دادهٔ پروژهٔ قبلی را حذف می‌کند (**POTENTIAL/contract-dependent**).
- **Finding قطعی:** F-51-2 و F-51-3 در بالا.
- **محدودیت:** foreign-key رفتار، SQLite version و driver selection به محیط runtime وابسته است؛ suite اجرا نشد.

### 16) `src/export/fileRoleExport.phase46.test.ts`

- **نقش:** acceptance test برای role/entryPoint و language support metadata.
- **Evidence:** suite اول خطوط 53-99 role و entryPoint را assert می‌کند؛ suite دوم خطوط 101-109 support declaration را بررسی می‌کند؛ helper خطوط 1-26 فایل‌های مصنوعی می‌سازد.
- **Call path/deps:** test → `JsonExporter.buildProjectIndex/finalizeProjectIndex` → `classifyFileRole`, `isEntryPointPath`, `describeLanguageSupport`.
- **Scope/limits:** only representative paths/languages؛ role edge cases، unknown extensions، project-specific configs و cross-project aggregation تست نشده (**UNVERIFIED**). اجرا نشد.

### 17) `src/export/schemaValidation.ts`

- **نقش:** lazy AJV compilation و تبدیل schema errors به JSON-pointer strings.
- **Evidence:** schema names/files خطوط 17-22؛ cache خطوط 28-29؛ `contractsDir` خطوط 36-38؛ lazy `require('ajv/dist/2020')` و `ajv-formats` خطوط 49-57؛ public `validateAgainstSchema` خطوط 68-87.
- **Call path/deps:** JsonExporter.validate → `validateAgainstSchema` → compile/cache → contracts file read/JSON parse → AJV validate.
- **Scope/limits:** module-level `compiled` cache در یک process بین calls مشترک است، اما key فقط schema name است؛ با contractsDir ثابت process مشکلی ندارد، multi-project data به validator داده می‌شود. تغییر schema روی disk در همان process reload نمی‌شود (**POTENTIAL/UNVERIFIED**, چون hot replacement قرارداد requirement اعلام نشده). malformed/missing contract و AJV dependency absence error propagation تست نشده.

## تغییر status

فقط همین ۱۷ مسیر زیر باید از `درانتظار` به `کامل` تغییر کنند: heuristic index، dependencies index، سه تست TypeScript dependency، BlueprintExporter، شش فایل/test JsonExporter، سه فایل/test SQLiteExporter، fileRoleExport test، schemaValidation. فایل‌های خارج از این فهرست دست‌نخورده باقی گذاشته شدند.
