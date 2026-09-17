# ممیزی ادامه‌ای — batch 6

## دامنه و روش

۲۰ ورودی اولی که در `AUDIT_FILE_STATUS.md` وضعیت «درانتظار» داشتند بررسی شدند؛ هر فایل با شماره‌خط کامل خوانده شد و برای رابطهٔ آن با callerها، قراردادها و تست‌های موجود جست‌وجوی وابستگی انجام شد. دامنهٔ multi-project در این batch از طریق `workspaceRoot`/`FileEntry.path` و شناسه‌های فایل/گراف بررسی شد. امنیت عمداً خارج از scope است. تست اجرا نشد: در `semantic-engine`، `node_modules` وجود ندارد و `jest` و `ts-jest` نیز در PATH/local bin موجود نیستند.

## خلاصهٔ یافته‌ها

- **یافتهٔ قطعی:** `src/core/id/index.ts:1-2` فقط `FileIdGenerator` و `SymbolIdGenerator` را export می‌کند؛ `SymbolIdAllocator` و `buildFullyQualifiedName` که در `SymbolIdentity.ts:54,62` APIهای export‌شدهٔ همین batch هستند از barrel export نمی‌شوند. در نتیجه import از `core/id` به این APIهای جدید دسترسی ندارد. تست مستقیم (`src/core/id/SymbolIdentity.test.ts:20`) از فایل implementation import می‌کند، بنابراین این شکاف را نمی‌گیرد.
- **یافتهٔ قطعی:** قرارداد `SymbolKind` در `src/core/types/project-index.types.ts:159-162` فقط `function`, `method`, `property`, ... را دارد و `constructor`/`getter`/`setter` ندارد؛ بنابراین ادعای کامنت `SymbolMetricsCalculator.ts:4` دربارهٔ محاسبهٔ constructor/getter/setter فقط در صورت map شدن آن‌ها به `method`/`property` برقرار است. خود محاسبه‌گر نیز فقط سه kind را قبول می‌کند (`SymbolMetricsCalculator.ts:198-202` و `sliceSymbolBody.ts:22-25`). این یک mismatch قطعی بین documentation و type/implementation است؛ اثر دقیق روی extractorها بدون اجرای integration pipeline UNVERIFIED است.
- **POTENTIAL/UNVERIFIED:** محاسبه‌گرهای regex چند زبان در خطوط pattern، `else`/`switch`/`case` و syntax خاص زبان را به‌صورت تقریبی می‌شمارند؛ correctness کامل نسبت به تعریف cyclomatic یا nested syntax از خود فایل‌ها اثبات نمی‌شود. تست‌ها نیز عمدتاً `>=` هستند (`PatternComplexityCalculator.test.ts:34-36,52-54,104,122,...`) و محدودیت تقریبی در header صراحتاً اعلام شده (`PatternComplexityCalculator.ts:1-7`).

## گزارش فایل‌به‌فایل

### 1. `src/core/id/SymbolIdentity.ts`

- **نقش:** ساخت FQN و تخصیص شناسهٔ پایدار برای symbol؛ `SymbolIdRequest` در 34-39، خروجی در 41-46.
- **call path:** caller باید `SymbolIdAllocator.allocate` را صدا بزند (66-87)؛ hash نهایی از `../utils/hash` در 32 و 84 می‌آید. reset در 90-92 برای reuse وجود دارد.
- **وابستگی/دامنه:** file path ریشهٔ FQN است (`buildFullyQualifiedName`, 54-60)؛ allocator درون همان instance با کلید `fqName:kind` شمارنده نگه می‌دارد (62-74)، پس scope شمارنده global/process نیست و برای هر پروژه/گروه باید instance مناسب استفاده شود.
- **خطا/محدودیت:** path عمداً بخشی از هویت است (24-29، 54-60) و rename خودکار حفظ ID نمی‌کند؛ ordinal به ترتیب مشاهده وابسته است (14-16، 72-86). این قرارداد باید با ترتیب پایدار extractor رعایت شود.
- **تست:** `src/core/id/SymbolIdentity.test.ts` (جست‌وجوی مستقیم API در خط 20 و suite از 41 به بعد). اجرای تست ممکن نبود چون dependency نصب نیست.

### 2. `src/core/id/index.ts`

- **نقش/call path:** barrel دو export قدیمی را در خطوط 1-2 ارائه می‌کند.
- **وابستگی/دامنه:** هیچ export از `SymbolIdentity` ندارد؛ در نتیجه مصرف‌کننده‌ای که به barrel (`core/id`) import کند، allocator جدید را نمی‌بیند.
- **Finding قطعی:** mismatch با exportهای `SymbolIdentity.ts:34,54,62`؛ جزئیات در خلاصه بالا.
- **تست/محدودیت:** تست موجود مستقیم implementation را import می‌کند، نه barrel؛ تست barrel یا integration یافت نشد.

### 3. `src/core/metrics/BashComplexityCalculator.ts`

- **نقش:** factory برای Bash با patterns `if/elif/for/while/case/&&/||` در 7-15.
- **call path/وابستگی:** `createBashComplexityCalculator` در 17-22، از `PatternComplexityCalculator` و types آن در 5 استفاده می‌کند؛ در `SymbolMetricsCalculator.ts:115` ثبت شده.
- **دامنه:** محاسبهٔ یک body sliced برای هر symbol؛ languageId=`shellscript` و mask کامنت در 18-21.
- **تست/محدودیت:** `PatternComplexityCalculator.test.ts:74-88`; regex تقریبی و syntaxهای shell که الگو تشخیص نمی‌دهد POTENTIAL است.

### 4. `src/core/metrics/CSharpComplexityCalculator.ts`

- **نقش:** factory C# و patterns در 7-20؛ شامل null-coalesce و ternary.
- **call path/وابستگی:** factory 23-29؛ registry در `SymbolMetricsCalculator.ts:118`.
- **دامنه:** languageId=`csharp`, masking روشن (23-28).
- **تست/محدودیت:** تست 125-141؛ regex ternary `\?[^:]+:` و شمارش `else` تقریبی است؛ false positive/تعریف دقیق UNVERIFIED.

### 5. `src/core/metrics/CppComplexityCalculator.ts`

- **نقش:** factory مشترک C/C++، patterns 7-19.
- **call path/وابستگی:** factory 21-27؛ registry برای `c` و `cpp` در `SymbolMetricsCalculator.ts:119-120`.
- **دامنه:** languageId=`cpp` حتی برای C نیز استفاده می‌شود؛ masking فعال.
- **تست/محدودیت:** تست C++ در `PatternComplexityCalculator.test.ts:143-159`; تفکیک دقیق C/C++ یا همهٔ syntaxها اثبات نشده (POTENTIAL).

### 6. `src/core/metrics/CyclomaticComplexityCalculator.ts`

- **نقش:** AST calculator برای TS/JS؛ decision nodes در 27-50 و base=1 در 58-59.
- **call path/وابستگی:** `calculateComplexity` از `SymbolMetricsCalculator.ts:31,240` فراخوانی می‌شود؛ traversal با TypeScript در 21-56.
- **دامنه:** nested function-like از 23-25 prune می‌شود؛ TS/JS/TSX/JSX از `SymbolMetricsCalculator.ts:204-209` پشتیبانی می‌شوند.
- **خطا/محدودیت:** `switch` خودِ statement شمرده نمی‌شود و case/default هرکدام شمرده می‌شوند؛ این قرارداد با توضیح lines 6-10 همخوان است. decorators/name matching بیرون این فایل است. تست‌های caller در `SymbolMetricsCalculator.test.ts:71-89`.

### 7. `src/core/metrics/GoComplexityCalculator.ts`

- **نقش:** factory Go؛ patterns در 7-15.
- **call path/وابستگی:** factory 18-24؛ registry خط 113.
- **دامنه:** body slicing در caller و language-aware comments در 19-22.
- **تست/محدودیت:** تست 38-54 و integration تست `SymbolMetricsCalculator.multi-lang.test.ts:41-71`; parser ندارد و `range/select` regex approximation است.

### 8. `src/core/metrics/JavaComplexityCalculator.ts`

- **نقش:** factory Java؛ patterns 7-18.
- **call path/وابستگی:** factory 21-27؛ registry خط 116.
- **دامنه:** languageId Java و masking در 21-26.
- **تست/محدودیت:** `PatternComplexityCalculator.test.ts:90-105`; syntaxهای Java و nested scopes فقط به regex متکی‌اند (POTENTIAL).

### 9. `src/core/metrics/KotlinComplexityCalculator.ts`

- **نقش:** factory Kotlin؛ patterns 7-17.
- **call path/وابستگی:** factory 20-26؛ registry خط 123.
- **دامنه:** body sliced و masking از caller؛ languageId Kotlin.
- **تست/محدودیت:** `PatternComplexityCalculator.test.ts:194-209`; `when` به‌عنوان یک decision token و ternary-like pattern تقریبی است؛ صحت کامل UNVERIFIED.

### 10. `src/core/metrics/PatternComplexityCalculator.test.ts`

- **نقش:** تست smoke همهٔ factoryهای 11 زبان؛ importها در 5-17 و suite در 19-210.
- **call path/وابستگی:** مستقیماً factoryها را می‌سازد، نه `SymbolMetricsCalculator`؛ بنابراین registry، file I/O، slicing و cross-file scope را پوشش نمی‌دهد.
- **تست‌ها:** Python/Go/PHP/Bash/Java/Rust/C#/C++/Ruby/Swift/Kotlin در بازه‌های مربوط؛ غالب assertions حداقلی `>=` هستند.
- **محدودیت:** comments برخی expectedهای قدیمی را ذکر می‌کنند، اما assertions شل‌اند؛ این ضعف پوشش POTENTIAL است، finding قطعی correctness نیست.

### 11. `src/core/metrics/PatternComplexityCalculator.ts`

- **نقش:** engine عمومی regex؛ options در 35-51، محاسبه در 56-76.
- **call path/وابستگی:** همهٔ language factories به آن delegate می‌کنند؛ با `ignoreComments`، `maskLiteralsAndComments` از `../../symbols/heuristic/LiteralMask` در 33 و 57-59 استفاده می‌شود.
- **دامنه:** خودش project-aware نیست؛ فقط رشتهٔ ورودی را می‌بیند. scope فایل/symbol در `SymbolMetricsCalculator.ts:243-248` و `sliceSymbolBody.ts` اعمال می‌شود.
- **خطا/محدودیت:** اگر `ignoreComments` false/undefined باشد masking انجام نمی‌شود (57-59)؛ callerهای این batch همگی true هستند. reset `lastIndex` در 70، رفتار regexهای shared را deterministic می‌کند.
- **تست:** تست جامع زبان‌ها در 19-210 و زبان‌آگاه masking در `SymbolMetrics.phase23.test.ts:209-230`.

### 12. `src/core/metrics/PhpComplexityCalculator.ts`

- **نقش:** factory PHP؛ patterns 7-20.
- **call path/وابستگی:** factory 22-28؛ registry خط 114.
- **دامنه:** masking PHP و languageId در 23-27.
- **تست/محدودیت:** تست 56-72؛ ternary regex `\?.*?:` greedy/تقریبی است و صحت expressionهای چندگانه UNVERIFIED.

### 13. `src/core/metrics/PythonComplexityCalculator.ts`

- **نقش:** factory Python؛ الگوهای تصمیم در 38-46؛ عمداً with/assert/comprehension/ternary قدیمی را ندارد (مستندات 6-33).
- **call path/وابستگی:** factory 48-54؛ registry خط 112؛ masking زبان‌آگاه در Pattern calculator.
- **دامنه:** `languageId=python`, `ignoreComments=true`; slicing و nested removal از caller.
- **تست/محدودیت:** تست‌های دقیق `SymbolMetrics.phase23.test.ts:178-230` و smoke lines 20-36. `match/case` عمداً پشتیبانی نمی‌شود (27-29)؛ این limitation مستند است، نه finding.

### 14. `src/core/metrics/RubyComplexityCalculator.ts`

- **نقش:** factory Ruby؛ patterns 7-20.
- **call path/وابستگی:** factory 22-28؛ registry خط 121.
- **دامنه:** masking و body scope از caller.
- **تست/محدودیت:** smoke تست lines 161-175؛ block/iterator و modifier-if صرفاً با regex approximation پوشش دارند (POTENTIAL).

### 15. `src/core/metrics/RustComplexityCalculator.ts`

- **نقش:** factory Rust؛ patterns 7-17 و match-arm با `=>` در 14.
- **call path/وابستگی:** factory 19-25؛ registry خط 117.
- **دامنه:** masking فعال؛ هر `=>` در body می‌تواند match-arm فرض شود، limitation الگویی.
- **تست/محدودیت:** smoke lines 107-123؛ احتمال شمردن closure/دیگر fat-arrowها به‌صورت arm فقط POTENTIAL است و از فایل به‌تنهایی اثبات نشده.

### 16. `src/core/metrics/SwiftComplexityCalculator.ts`

- **نقش:** factory Swift؛ patterns 7-20.
- **call path/وابستگی:** factory 22-28؛ registry خط 122.
- **دامنه:** masking فعال، languageId Swift.
- **تست/محدودیت:** smoke lines 177-192؛ switch/case و optional syntax تقریبی‌اند.

### 17. `src/core/metrics/SymbolMetrics.phase23.test.ts`

- **نقش:** regression suite برای پنج موضوع SE-METRIC-01..05 (4-10).
- **call path/دامنه:** `SymbolMetricsCalculator.compute` با workspace موقت در 63-71؛ تست body slicing، nested functions، missing endLine، cache/dispose، decorator/name matching در 74-332.
- **وابستگی/تست مرتبط:** از `fs`, `os`, `path`, calculator و Python factory استفاده می‌کند (13-18). این suite cross-file callGraph را تست نمی‌کند.
- **محدودیت:** تست‌ها قراردادهای فعلی (از جمله endLine و line-based symbols) را تثبیت می‌کنند؛ صحت extractor upstream خارج از این فایل است.

### 18. `src/core/metrics/SymbolMetricsCalculator.multi-lang.test.ts`

- **نقش:** integration سبک برای Python و unsupported CSS؛ fixtures در 5-37.
- **call path/دامنه:** workspace `/tmp` و file path نسبی در 41-70؛ `compute` واقعی با file I/O اجرا می‌شود.
- **تست:** Python complexity و unsupported language در 40-86.
- **محدودیت:** cleanup دستی فقط بعد از assertion (`rmSync` در 70)، و تنها دو زبان/بدون callGraph یا incremental scope را پوشش می‌دهد؛ ضعف پوشش POTENTIAL است.

### 19. `src/core/metrics/SymbolMetricsCalculator.test.ts`

- **نقش:** suite اصلی TS/JS complexity، non-function، cross-file referenceCount، same-file filtering و file-level caller؛ fixtures/cleanup در 11-69.
- **call path/دامنه:** compute در 77-83 و چند suite بعدی؛ reference graph در 106-148 و module-level file caller در 151-214.
- **تست مرتبط:** decorator و same-line matching در phase23 تست می‌شوند؛ این فایل decorator را ندارد.
- **محدودیت:** assertionهای گراف فرض می‌کنند edge.caller fileId یا symbolId معتبر است؛ malformed/duplicate edge semantics و multi-project isolation مستقیم تست نشده‌اند.

### 20. `src/core/metrics/SymbolMetricsCalculator.ts`

- **نقش:** orchestrator metrics؛ input/option در 46-57، compute در 126-196؛ complexity و referenceCount را برمی‌گرداند.
- **call path/وابستگی:** imports در 27-44؛ TS/JS به AST calculator، سایر زبان‌ها به factories و `sliceSymbolBody`; graph counts در 374-416.
- **multi-project scope:** `workspaceRoot + file.path` برای I/O در 253-266 و `fileId` برای grouping/graph در 127-139,396-410؛ `changedFileIds` در 154-181 باعث skip کردن complexity فایل‌های خارج scope می‌شود، اما referenceCount را global graph traversal می‌کند (184-195).
- **قطعی‌های قابل اتکا:** missing file/AST به null ختم می‌شود (259-275)؛ cache LRU bounded و dispose دارد (76-109). `referenceCount` فقط callee معتبر و caller symbol/file معتبر را می‌شمارد (398-412).
- **Finding قطعی:** candidate predicate فقط `function|method|property` است (198-202) در حالی که header خطوط 4 و `CyclomaticComplexityCalculator.ts:13` constructor/getter/setter را جزو دامنهٔ complexity اعلام می‌کنند؛ contract kind نیز در `project-index.types.ts:159-162` آن سه نام را ندارد. اثر در extractorها نیازمند integration است و UNVERIFIED نگه داشته شد.
- **تست:** `SymbolMetricsCalculator.test.ts`, `.multi-lang.test.ts`, `SymbolMetrics.phase23.test.ts`; اجرا به علت نبود dependency ممکن نبود.

## وضعیت تست و محیط

- مسیر اجراشده: `/tasklet/threads/a_pjgnxp3j2201gp81brsm/work/repo/semantic-engine`.
- `node_modules`: موجود نیست.
- `jest`: در PATH و `node_modules/.bin` موجود نیست.
- `ts-jest`: در PATH موجود نیست.
- بنابراین تستی اجرا نشد؛ این وضعیت ثبت شد و از نصب dependency/تغییر محیط خودداری شد.
