# گزارش ممیزی batch continuation-7

## دامنه و روش

دقیقاً ۲۰ فایل اولی که در `AUDIT_FILE_STATUS.md` وضعیت `درانتظار` داشتند بررسی خط‌به‌خط شدند؛ مسیر مبنا `/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/repo/semantic-engine` است. امنیت عمداً خارج از scope است. موارد قطعی فقط با evidence verbatim و line/path گزارش شده‌اند؛ مواردی که از static inspection قابل اثبات قطعی نیستند با `POTENTIAL` یا `UNVERIFIED` علامت خورده‌اند.

ترتیب ۲۰ فایل: `sliceSymbolBody.ts`، پنج فایل type/test تا `schemaSync.test.ts`، هشت فایل utility تا `symbolSort.ts`، سپس `DependencyExtractorManager.ts`، `IDependencyExtractor.ts` و سه فایل heuristic.

## وضعیت اجرای تست

تلاش شد تست‌های مرتبط با این batch با `npm test -- --runInBand ...` اجرا شوند. اجرا انجام نشد و نتیجه blocker است، نه نتیجهٔ تست: `node_modules` در پروژه وجود نداشت (`NODE_MODULES_MISSING`) و lifecycle اسکریپت `pretest` قبل از Jest شکست خورد:

- `semantic-engine/scripts/gen-fixture.js:34` در خطای runtime: `ENOENT ... mkdir '/tasklet/.../semantic-engine/test-fixture/node_modules/left-pad'`
- بنابراین هیچ pass/fail از تست‌های انتخاب‌شده قابل استنتاج نیست.

## Findings قطعی

### F-01 — export barrel ناقص برای typeهای Blueprint
- **فایل/خط:** `src/core/types/index.ts:1-2`
- **نقش:** barrel عمومی typeها.
- **Evidence verbatim:** `export * from './common.types';` و `export * from './project-index.types';`
- **نتیجهٔ قطعی از متن فایل:** `blueprint.types.ts` در barrel export نمی‌شود؛ مصرف‌کننده‌ای که فقط از `src/core/types` import کند به `Blueprint` و typeهای Blueprint دسترسی ندارد. این finding دربارهٔ export surface است، نه امنیت.
- **Call path:** import از barrel → فقط common/project-index؛ مسیر مستقیم import از `./blueprint.types` جداست.
- **Dependency:** common و project-index در همین barrel.
- **Error behavior:** compile-time missing export برای import از barrel؛ runtime error از خود barrel مشاهده نمی‌شود.
- **Multi-project scope:** typeها دادهٔ پروژه را مدل می‌کنند، ولی barrel هیچ project registry/selection ندارد؛ finding مستقل از تعداد پروژه‌هاست.
- **Test مرتبط:** در batch تست مستقیمی برای barrel نیست؛ `schemaSync.test.ts` فقط `blueprint.types.ts` را مستقیم با `path.join(TYPES_DIR, 'blueprint.types.ts')` می‌خواند (`src/core/types/schemaSync.test.ts:185-187`)، پس این نقص export را پوشش نمی‌دهد.
- **محدودیت:** static inspection؛ تست به‌علت blocker اجرا نشد.

### F-02 — `sliceSymbolBody` فقط subset محدودی از symbolها را executable می‌داند
- **فایل/خط:** `src/core/metrics/sliceSymbolBody.ts:22-25`
- **Evidence verbatim:** `return symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'property';`
- **نتیجه:** symbolهای `class`/`module`/`namespace` یا سایر kindها—even اگر parent container محاسبهٔ جداگانه بخواهد—nested حذف نمی‌شوند. این یک محدودیت رفتاری قطعیِ پیاده‌سازی است؛ اینکه برای همهٔ kindها defect محسوب شود `POTENTIAL` است.
- **Call path:** caller متریـک → `sliceSymbolBody(content, symbol, siblings)` (`:33-37`) → lines را می‌گیرد (`:38-49`) → nested executableها را blank می‌کند (`:51-63`) → body را برمی‌گرداند (`:65`).
- **Dependency:** `SymbolEntry` از `../types/project-index.types` (`:20`)، و `kind/line/endLine/id`.
- **Error behavior:** برای `endLine` نامعتبر fallback به `start` و clamp به تعداد خطوط دارد (`:40-47`)، throw ندارد.
- **Multi-project scope:** تابع file-local است؛ هیچ project/root/fileId در API ندارد؛ caller باید siblings همان فایل را بدهد (محدودیت scope قطعی از signature و doc `:30-31`).
- **Test مرتبط:** تست همراه همین فایل در batch نیست؛ تست متریـک موجود در status قبلاً کامل است اما تست اختصاصی این تابع در این snapshot یافت نشد (`UNVERIFIED` دربارهٔ absence کامل).
- **محدودیت:** intentional semantics برای body تو در تو محتمل است؛ defect برای class/module فقط `POTENTIAL`.

### F-03 — root type `Blueprint` با schemaVersion literal و قراردادهای دارای optional field مدل شده است
- **فایل/خط:** `src/core/types/blueprint.types.ts:7-19`, `:104-127`
- **Evidence verbatim:** `readonly schemaVersion: '2.0.0';` و `readonly handlerSymbolId: string | null;` و `readonly authRequired: boolean;`
- **نقش:** typeهای derive‌شده از `contracts/blueprint.schema.json` (`:1-4`).
- **Call path:** مصرف‌کنندهٔ Blueprint → interfaceهای همین فایل؛ generation/validation خارج از فایل است.
- **Dependency:** typeهای داخلی همین فایل (`BlueprintMeta`, `ModuleEntry`, `ApiEntry`, ...).
- **Error behavior:** compile-time تنها؛ runtime validation ندارد.
- **Multi-project scope:** `BlueprintMeta.projectName` و `sourceProjectIndex` را مدل می‌کند (`:21-33`)، اما selection/registry چند پروژه‌ای در این فایل نیست؛ صرفاً data contract است.
- **Test:** `schemaSync.test.ts:229-234` ریشهٔ Blueprint را مقایسه می‌کند؛ اجرای آن blocker داشت.
- **نتیجه:** mismatch قطعی بدون خواندن schema قابل اعلام نیست؛ `UNVERIFIED` بماند. تنها قطعی این است که پشتیبانی runtime ندارد.

### F-04 — `common.types.ts` اعتبار Confidence را runtime enforce می‌کند ولی برند فقط compile-time است
- **فایل/خط:** `src/core/types/common.types.ts:17-24`
- **Evidence verbatim:** `export type Confidence = number & { readonly __brand: 'Confidence' };` و در `makeConfidence`: `if (value < 0 || value > 100 || !Number.isInteger(value)) { throw new RangeError(...) }`.
- **نقش/call path:** سازندهٔ confidence → validation → cast در `:23`.
- **Dependency:** `Result`, `IDisposable`, `FileChangeEvent` در همان فایل؛ dependency خارجی ندارد.
- **Error behavior:** ورودی خارج از ۰..۱۰۰ یا غیرصحیح throw می‌کند؛ comment `:16` می‌گوید 0-100.
- **Multi-project scope:** pure value type، بدون project context.
- **Test:** تست مستقیم این فایل در ۲۰ مورد نیست؛ مصرف در `symbolSort.test.ts:23` با `makeConfidence(80)`.
- **محدودیت:** overflow/NaN به دلیل شرط‌ها رد می‌شود؛ `Infinity` نیز رد می‌شود. موردی برای finding قطعی نیست.

### F-05 — `project-index.types.ts` بخش بزرگی از قرارداد ProjectIndex را فقط به‌صورت TypeScript تعریف می‌کند و validation ندارد
- **فایل/خط:** `src/core/types/project-index.types.ts:17-58`
- **Evidence verbatim:** `export interface ProjectIndex { ... readonly files ... readonly symbols ... readonly graphs ... readonly diagnostics ... readonly metrics ... }`
- **Call path:** consumers → interfaceها؛ parser/validator در این فایل نیست.
- **Dependency:** `ExtractionSource, Confidence` از `./common.types` (`:8`) و typeهای داخلی.
- **Error behavior:** هیچ function/class runtime در این فایل وجود ندارد؛ خطای contract فقط در compile/test validator بیرونی آشکار می‌شود.
- **Multi-project scope:** rootPath اختیاری است (`:31`) و خود interface پروژهٔ واحد را مدل می‌کند؛ registry/multi-project orchestration در scope این فایل نیست.
- **Test:** `schemaSync.test.ts` ریشه و defs را مقایسه می‌کند (`:222-257`)، ولی runtime JSON validation نیست؛ اجرا blocker.
- **محدودیت:** mismatch schema به‌طور قطعی گزارش نمی‌شود مگر تست/contract اجرا شود؛ `UNVERIFIED`.

### F-06 — `schemaSync.test.ts` فقط حضور property و optionality را می‌سنجد، نه type/enum/nesting/value constraints
- **فایل/خط:** `src/core/types/schemaSync.test.ts:131-177`
- **Evidence verbatim:** doc می‌گوید «سه چیز را می‌سنجد: property گمشده، property اضافی، و عدم تطابق اجباری‌بودن» و `compare` فقط `Object.keys(schema.properties ?? {})`، required و `member.questionToken` را بررسی می‌کند (`:142-175`).
- **نتیجهٔ قطعی:** حتی در صورت pass، هم‌نوع بودن `string`/`number`، enum، array item، `$ref` و nested value constraints از این guard اثبات نمی‌شود.
- **Call path:** Jest describe → `readTypes` (`:99-123`) و `loadSchema` (`:125-129`) → `compare` (`:135-177`).
- **Dependency:** `fs`, `path`, `typescript` (`:12-14`)، دو JSON contract.
- **Error behavior:** malformed JSON/TS read/parse throw می‌کند؛ mismatch با `expect(...).toEqual([])` fail می‌شود (`:256-257`, `:296-297`).
- **Multi-project scope:** contractهای repository-level هستند؛ project ID در test input ندارد.
- **تست مرتبط:** خود فایل دارای تست‌های mapping و mutation guard (`:303-324`) است، ولی اجرا blocker.
- **محدودیت:** این finding دربارهٔ coverage test است، نه ادعای mismatch فعلی schema.

### F-07 — `openapiSync.test.ts` فقط وجود مسیرها را چک می‌کند و operation/response/parameter schema را verify نمی‌کند
- **فایل/خط:** `src/core/types/openapiSync.test.ts:19-46`
- **Evidence verbatim:** `const paths = Object.keys(parsed.paths);` و loop با `expect(paths).toContain(p);`.
- **نتیجه:** route path می‌تواند با method اشتباه، response ناقص یا parameter/schema نادرست باشد و این تست همچنان pass شود.
- **Call path:** Jest → `fs.readFileSync(CONTRACT_PATH)` → JSON.parse → Object.keys(paths) → required paths.
- **Dependency:** `fs`, `path` (`:5-6`)، `contracts/platform-v1.openapi.json` (`:8`).
- **Error behavior:** نبود فایل/JSON نامعتبر/عدم وجود مسیر test failure؛ هیچ graceful Result ندارد.
- **Multi-project scope:** OpenAPI پلتفرم‌سطح است؛ pathهای `{id}` را مدل می‌کند اما تست نمی‌کند id متعلق به کدام project/registry است.
- **تست مرتبط:** تست version/title در `:10-17` و endpoint list در `:19-47`; اجرا blocker.
- **محدودیت:** امنیت خارج از scope؛ عدم بررسی auth intentionally report نشده.

### F-08 — export barrel utility ناقص است
- **فایل/خط:** `src/core/utils/index.ts:1-2`
- **Evidence verbatim:** فقط `export { sha256, generateFileId, generateSymbolId, normalizePath } from './hash';` و `export { isBinaryBuffer, detectEncoding, countLines } from './encoding';`
- **نتیجهٔ قطعی:** `decodeBuffer`, `normalizeLineEndings`, `getLineNumber/LineIndex`, و `sortSymbolsDeterministically` از barrel عمومی export نمی‌شوند؛ import از فایل مستقیم لازم است.
- **Call path:** consumer → `core/utils` → API محدود به همان دو export line.
- **Dependency:** hash و encoding.
- **Error behavior:** missing named export compile-time است.
- **Multi-project scope:** pure utilities؛ multi-project context ندارند.
- **Test:** utility tests مستقیم از فایل‌ها import می‌کنند؛ مثلاً `encoding.test.ts:1` از `./encoding` و `lineNumber.test.ts:8` از `./lineNumber`، بنابراین barrel پوشش داده نمی‌شود.
- **محدودیت:** ممکن است barrel عمداً minimal باشد؛ exposed API نبودن موارد بالا قطعی، defect بودن آن `POTENTIAL`.

### F-09 — تشخیص binary فقط ۸۱۹۲ بایت اول را inspect می‌کند
- **فایل/خط:** `src/core/utils/encoding.ts:8`, `:26-32`
- **Evidence verbatim:** `const BINARY_CHECK_BYTES = 8192;` و `const checkLength = Math.min(buffer.length, BINARY_CHECK_BYTES);` سپس loop روی `checkLength`.
- **نتیجه:** NUL بعد از offset 8191 توسط این تابع دیده نمی‌شود؛ محدودیت قطعی implementation، نه لزوماً defect (heuristic مستند شده در `:1-5`).
- **Call path:** `isBinaryBuffer(buffer)` → `detectEncoding(buffer)` (`:21`) → scan prefix.
- **Dependency:** Buffer و `detectEncoding`.
- **Error behavior:** throw ندارد؛ buffer خالی false؛ BOMهای UTF16/UTF8 false (`:21-24`).
- **Multi-project scope:** file-content local، project/root ندارد.
- **Test:** `encoding.test.ts` فقط `countLines` را تست می‌کند (`:1-23`)؛ تست binary/encoding در این batch نیست.
- **محدودیت:** به‌علت BOM bypass، فایل UTF16 با NUL false می‌شود؛ صحت آن برای BOMدار مستند شده، فایل بدون BOM `POTENTIAL`.

### F-10 — `decodeBuffer` در ورودی encoding صریح، encoding را validate نمی‌کند
- **فایل/خط:** `src/core/utils/encoding.ts:89-111`
- **Evidence verbatim:** `const detected = encoding ?? detectEncoding(buffer);` و برای مقدار ناشناخته مستقیم `return buffer.toString('utf8');` (`:110-111`).
- **نتیجهٔ قطعی:** هر encoding ناشناخته silently به UTF-8 fallback می‌شود؛ caller نمی‌تواند typo را از decode واقعی تشخیص دهد. defect severity نیازمند contract بیرونی است، پس finding implementation قطعی و impact `POTENTIAL`.
- **Call path:** caller → `decodeBuffer(buffer, encoding)` → branches utf16le/BE/utf8-bom → fallback.
- **Dependency:** Buffer; `detectEncoding`.
- **Error behavior:** برای UTF16BE روی copy `swap16()` (`:102-104`) و برای BOM slice (`:107-108`)، encoding ناشناخته throw نمی‌شود.
- **Multi-project scope:** pure buffer utility.
- **Test:** `encoding.test.ts` فقط countLines؛ decode تست ندارد.
- **محدودیت:** ممکن است fallback قراردادی باشد؛ `POTENTIAL` برای bug.

### F-11 — `normalizeLineEndings` و `decodeBuffer` در utility barrel قابل دسترسی نیستند
- **فایل/خط:** implementation `encoding.ts:78-80`, `:89-111`؛ barrel `index.ts:2`
- **Evidence verbatim:** barrel فقط `isBinaryBuffer, detectEncoding, countLines` را export می‌کند.
- **نتیجه:** API عمومی barrel با implementation مستندشده هم‌سطح نیست. (هم‌پوشان F-08، اینجا روی دو تابع encoding متمرکز.)
- **Call path/dependency/test/scope:** همان F-08؛ تست موجود `encoding.test.ts:1` direct import است.
- **محدودیت:** اگر معماری عمداً direct-import باشد `POTENTIAL`.

### F-12 — `LineIndex.lineAt` offset بزرگ‌تر از متن را به آخرین line index clamp می‌کند، بدون اعلام invalid offset
- **فایل/خط:** `src/core/utils/lineNumber.ts:32-47`
- **Evidence verbatim:** فقط `if (offset <= 0) return 1;` و binary search؛ return `low + 1`.
- **نتیجه:** offset past-end عمداً lineCount برمی‌گرداند و test همین را تثبیت کرده: `lineNumber.test.ts:28-30` (`10000` → `4`). این رفتار قطعی و intentional-looking است؛ defect نیست مگر caller انتظار error داشته باشد (`POTENTIAL`).
- **Call path:** `getLineNumber` (`:64-69`) → cache یا `new LineIndex` → `lineAt`.
- **Dependency:** هیچ خارجی.
- **Error behavior:** negative و past-end throw نمی‌کنند؛ tests `:32-38` و `:28-30`.
- **Multi-project scope:** cache module-global است؛ project ID ندارد. چون key فقط string content است، دو پروژه با محتوای دقیقاً یکسان همان cache را share می‌کنند (نتیجه یکسان است؛ memory/scope concern `POTENTIAL`).
- **تست:** performance و edge cases در `lineNumber.test.ts:10-95`؛ blocker مانع اجرا.

### F-13 — cache `getLineNumber` فقط آخرین content را نگه می‌دارد و bounded multi-project cache نیست
- **فایل/خط:** `src/core/utils/lineNumber.ts:54-69`
- **Evidence verbatim:** `let cachedContent: string | null = null; let cachedIndex: LineIndex | null = null;` و شرط `cachedContent !== content`.
- **نتیجه قطعی:** interleaving چند متن باعث rebuild در هر switch می‌شود؛ project/file identity در کلید نیست. برای پروژه‌های متعدد bounded cache یا per-file index وجود ندارد. performance impact در workload چند پروژه‌ای `POTENTIAL` است.
- **Call path:** هر extractor caller → `getLineNumber` → single global cache.
- **Dependency:** `LineIndex`.
- **Error behavior:** no throw for normal strings.
- **Multi-project scope:** global per module, not project-scoped.
- **Test:** test switching strings فقط correctness را چک می‌کند (`lineNumber.test.ts:72-79`)؛ multi-project/performance interleaving ندارد.

### F-14 — `sortSymbolsDeterministically` kindهایی که در `KIND_ORDER` نیستند را به 999 می‌فرستد
- **فایل/خط:** `src/core/utils/symbolSort.ts:6-24`
- **Evidence verbatim:** `const KIND_ORDER = [...]` و `return idx === -1 ? 999 : idx;`.
- **نتیجه:** kindهای مجاز `SymbolKind` مانند `interface` در فهرست هستند، ولی `trait`, `decorator`, `struct`؟ `struct` هست؛ `trait` و `decorator` در `KIND_ORDER` نیستند و همه در bucket 999 می‌افتند. ترتیب بین unknownها سپس name/id است. این محدودیت قطعی؛ اینکه canonical contract باید همه kindها را order کند `POTENTIAL`.
- **Call path:** caller → copy/sort (`:31-38`) → kindOrder.
- **Dependency:** `SymbolEntry`.
- **Error behavior:** unknown kind throw نمی‌کند.
- **Multi-project scope:** sort fileId-first است؛ project ID جدا ندارد و caller باید symbols پروژهٔ درست را بدهد.
- **Test:** test فقط class/function/method (`symbolSort.test.ts:27-39`, `:41-52`)؛ trait/decorator پوشش ندارد.

### F-15 — `DependencyExtractorManager.extract` exceptionهای extractor را به Result تبدیل نمی‌کند
- **فایل/خط:** `src/dependencies/DependencyExtractorManager.ts:32-40`
- **Evidence verbatim:** حلقه مستقیماً `const available = await extractor.isAvailable(languageId);` و `const result = await extractor.extractDependencies(...)` را await می‌کند؛ فقط `if (!result.ok)` (`:37-40`) برای Result صریح رسیدگی دارد.
- **نتیجه قطعی:** اگر `isAvailable` یا `extractDependencies` throw/reject کند، کل `extract` reject می‌شود و fallback به extractor بعدی اتفاق نمی‌افتد؛ try/catch وجود ندارد.
- **Call path:** manager.extract → availability → extractDependencies → success/partial/fallback (`:42-57`).
- **Dependency:** `IDependencyExtractor`, `Result`, `ok`, `err`, `IDisposable` (`:1-5`).
- **Error behavior:** explicit error Result جمع‌آوری می‌شود (`:37-39`)، exception asynchronous عبور می‌کند.
- **Multi-project scope:** API فقط fileId/path/content/language دارد (`:23-28`)، workspace/project map ندارد؛ resolution cross-file در این manager انجام نمی‌شود.
- **Test:** test اختصاصی manager در این ۲۰ فایل نیست؛ `UNVERIFIED` دربارهٔ کل repo.
- **محدودیت:** interface contract شاید extractorها را ملزم به non-throw کند، اما `IDependencyExtractor.ts:21-34` چنین guarantee صریحی ندارد؛ impact operational `POTENTIAL`.

### F-16 — manager partial نتیجهٔ آخر را برمی‌گرداند و خطاهای جمع‌شده را دور می‌ریزد
- **فایل/خط:** `DependencyExtractorManager.ts:29`, `:46-56`
- **Evidence verbatim:** `const errors: string[] = [];`، `lastPartialResult = result.value;`، سپس `if (lastPartialResult) { return ok(lastPartialResult); }`.
- **نتیجه:** error/partial diagnostics فقط برای ساختن error نهایی وقتی هیچ partial نیست استفاده می‌شوند؛ در مسیر partial موفق هیچ metadata از خطاها به caller منتقل نمی‌شود. قطعی از code؛ خوب/بد بودن قرارداد `POTENTIAL`.
- **Call path:** extractor partial → errors push (`:47`) → next extractor → final lastPartial (`:50-52`).
- **Dependency:** Result wrapper.
- **Error behavior:** اگر هیچ partial نباشد error با `Tried: ${errors.join('; ')}` (`:54-56`).
- **Multi-project scope:** no project aggregation.
- **Test/limitation:** test مستقیم manager در batch نیست؛ اجرا blocker.

### F-17 — interface extraction عمداً resolvedFileId را به مرحلهٔ بعد واگذار می‌کند
- **فایل/خط:** `src/dependencies/IDependencyExtractor.ts:23-34`
- **Evidence verbatim:** `resolvedFileId در مرحله‌ی resolve (بعد از داشتن workspace map کامل) پر می‌شود ... اینجا فقط استخراج خام.`
- **نتیجه:** dependency extractor به تنهایی cross-file resolution/graph edge کامل تولید نمی‌کند؛ raw imports/exports contract است، نه finding defect.
- **Call path:** manager (`DependencyExtractorManager.ts:36`) → `extractDependencies(fileId,filePath,content,languageId)` → Result raw.
- **Dependency:** ImportEntry/ExportEntry و Result.
- **Error behavior:** Result may be error; no resolution method.
- **Multi-project scope:** workspace map کامل صراحتاً prerequisite است؛ multi-project resolution خارج scope این فایل.
- **Test:** heuristic tests فقط `from/type/specifiers` را assert می‌کنند، resolved IDs را نه (`HeuristicDependencyExtractor.test.ts:16-24`, etc.).
- **محدودیت:** نبود resolver در interface نباید به‌تنهایی bug نامیده شود؛ `POTENTIAL` اگر caller انتظار graph کامل داشته باشد.

### F-18 — heuristic `filePath` را عملاً نادیده می‌گیرد
- **فایل/خط:** `src/dependencies/heuristic/HeuristicDependencyExtractor.ts:110-115`, `:156-162`
- **Evidence verbatim:** parameter به نام `_fileId` و `filePath` وجود دارد، سپس `void filePath;`.
- **نتیجه قطعی:** مسیر فایل برای resolve/normalization استفاده نمی‌شود؛ local imports فقط با متن import و `resolvedFileId: null` برمی‌گردند (مثلاً `:194-201`, `:225-227`). این extractor raw extraction است، اما local dependency resolution در آن انجام نمی‌شود.
- **Call path:** manager → heuristic.extractDependencies → regex parse → parseImport → raw ImportEntry.
- **Dependency:** IDependencyExtractor, project-index types, common Result.
- **Error behavior:** زبان ناشناخته `ok({ imports: [], exports: [], partial: false })` (`:116-119`)، نه error.
- **Multi-project scope:** هیچ root/workspace/project map ندارد؛ حتی `filePath` نادیده است، پس path resolution چند پروژه‌ای خارج scope.
- **Test:** tests local classification را assert می‌کنند (`HeuristicDependencyExtractor.phase18.test.ts:52-65`, `:117-155`) ولی resolvedFileId را نه.
- **محدودیت:** مطابق comment interface، raw extraction intentional است؛ impact graph-level `POTENTIAL`.

### F-19 — comment پشتیبانی heuristic با implementation ناقص/قدیمی است
- **فایل/خط:** `HeuristicDependencyExtractor.ts:2-10` در برابر patterns `:21-100`
- **Evidence verbatim:** comment فقط `Python`, `Go`, `PHP`, `Bash` را فهرست می‌کند، اما `LANGUAGE_PATTERNS` همچنین `java`, `rust`, `csharp`, `c`, `cpp`, `ruby`, `swift`, `kotlin` دارد.
- **نتیجه قطعی:** مستندات inline با supported languages واقعی همگام نیستند. تست‌ها این زبان‌های اضافه را نیز exercise می‌کنند (`HeuristicDependencyExtractor.test.ts:71-171`).
- **Call path:** `isAvailable` با `languageId in LANGUAGE_PATTERNS` (`:106-108`) همهٔ patternها را expose می‌کند.
- **Dependency:** regex patterns.
- **Error behavior:** unsupported language returns empty successful result (`:116-119`).
- **Multi-project scope:** language-level only، no project.
- **محدودیت:** documentation drift؛ رفتار runtime از map قابل مشاهده است. severity functional `POTENTIAL`.

### F-20 — الگوهای heuristic با regex و بدون parser هستند و comment/string context را به‌طور عمومی نمی‌فهمند
- **فایل/خط:** `HeuristicDependencyExtractor.ts:21-100`, extraction loop `:124-129`
- **Evidence verbatim:** patternهایی مثل `^\s*import...` و اجرای مستقیم `regex.exec(content)` روی کل content (`:124-128`)؛ هیچ lexer/parser/comment stripping در این فایل نیست.
- **نتیجه:** این extractor ذاتاً heuristic است؛ false positive/negative برای syntaxهای چندخطی/کامنت/رشته، به‌جز چند مورد خاص Go، ممکن است. ادعای مورد خاص بدون fixture قطعی نیست و `POTENTIAL/UNVERIFIED` است.
- **Call path:** language map → هر regex → `parseImport` → ImportEntry.
- **Dependency:** only regex and type imports.
- **Error behavior:** malformed source معمولاً error نمی‌دهد؛ نتیجهٔ `ok` با `partial:false` (`:145`). این می‌تواند ناقص بودن را به‌عنوان کامل علامت بزند؛ impact `POTENTIAL`.
- **Multi-project scope:** raw, file-local; no AST/workspace resolution.
- **Test:** phase18 موارد Go/Rust/PHP و base test زبان‌ها را پوشش می‌دهد؛ هیچ property-based/fuzz یا comment coverage عمومی ندارد (`UNVERIFIED`). اجرای تست blocker.

## فایل‌های بررسی‌شده و وضعیت

هر ۲۰ مسیر فوق بررسی خط‌به‌خط شد و در status فقط همین ۲۰ مورد از `درانتظار` به `کامل` تغییر داده شدند. هیچ فایل دیگری تغییر status نداد.
