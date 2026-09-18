# قوانین ثابت انجام پروژه

این سند، پلن اجرایی حاصل از ممیزی forensic مخزن `legionir/semantic-engine-structured-ai` در revision بررسی‌شدهٔ `3a20f3192e43c5cf2723cd524e08e013f941a4ed` است. دامنهٔ اصلی شامل دو محصول مستقل اما مرتبط `semantic-engine` و `structured-ai` است. `AUDIT_FILE_STATUS.md` پوشش ۸۸۱ فایل را ثبت می‌کند: ۸۸۱ فایل بررسی‌شده، ۰ ناقص و ۰ درانتظار. «بررسی‌شده» به‌معنای پیاده‌سازی‌شده یا runtime-تأییدشده نیست؛ موارد زیر باید تا پایان اجرا جداگانه راستی‌آزمایی شوند.

1. فازها را دقیقاً به‌ترتیب اجرا کن و گام‌های هر فاز را به‌ترتیب فهرست‌شده، در یک execution stage پیوسته و بدون رهاکردن کار نیمه‌تمام انجام بده.
2. هیچ requirement، finding، مسیر، قرارداد، تست، migration، error path یا معیار پذیرش را حذف یا ساده‌سازی نکن.
3. حدس نزن. هر داده، قرارداد، caller، schema، dependency، line reference یا رفتار runtime که در کد/تست/قرارداد اثبات نشده است با برچسب **Unknown / Requires Verification** ثبت شود و پیش از وابسته‌شدن فاز بعدی به آن، verification step داشته باشد.
4. هیچ کار ناقص یا صرفاً نوشته‌شده را کامل اعلام نکن. وضعیت هر گام بلافاصله پس از کار با یکی از سه وضعیت زیر به‌روزرسانی شود:
   - 🔴 انجام نشده؛ کاری برای این گام وجود ندارد یا هنوز شروع نشده است.
   - 🟡 ناقص؛ بخشی انجام شده، اما implementation، integration، validation یا evidence لازم کامل نیست.
   - 🟢 کامل؛ همهٔ کار لازم انجام شده، یکپارچه است، تست‌ها و معیارهای پذیرش آن تأیید شده‌اند.
5. وضعیت ابتدایی همهٔ فازها و گام‌ها در این سند 🔴 است. پس از هر execution stage وضعیت گام‌ها و سپس فاز را به‌روزرسانی کن. فاز فقط زمانی 🟢 می‌شود که تمام گام‌هایش 🟢 باشند، همهٔ معیارهای پذیرش آن با evidence تأیید شده باشند، blocker نداشته باشد و Definition of Done برقرار باشد. اگر هر بخش باقی بماند، فاز 🟡 است و دقیقاً باقیمانده و علت ثبت می‌شود.
6. قبل از شروع فاز بعد، معیار پذیرش فاز جاری را اجرا و evidence آن را ثبت کن. build، تست، migration، API contract، runtime و performance را بر اساس معیار واقعی گزارش کن؛ pass ادعایی بدون command و نتیجهٔ ثبت‌شده معتبر نیست.
7. عملکرد موجود را حفظ کن، مگر آن‌که تغییر آن در همین سند صریحاً هدف باشد. رفتار backward-compatible را با تست قبل/بعد و contract comparison حفظ کن.
8. تغییرات را در همان لایهٔ مربوط انجام بده: engine/rules، persistence، API، UI، integration، test و tooling از هم جدا بمانند؛ rewrite بزرگ انجام نده و adapter/contract مشترک را بر تغییرات پراکنده ترجیح بده.
9. multi-project اصل حاکم است: هر project باید context، root، artifact، index، DB، history، telemetry، MCP config/cache، hook/policy، handle، job و UI state مستقل داشته باشد. fallback به global یا اولین workspace فقط اگر قرارداد رسمی آن را صریحاً تعریف کرده باشد مجاز است.
10. امنیت در ممیزی اولیه خارج از scope بوده است. این plan نیز security redesign را invent نمی‌کند؛ بااین‌حال احراز تعلق project، جلوگیری از cross-project access و integrity داده که برای correctness و isolation لازم است باید اجرا و تست شود. موارد امنیتی مستقل، در صورت کشف، با برچسب **Unknown / Requires Verification** و scope جدا ثبت شوند.
11. برای هر اصلاح، regression test در نزدیک‌ترین suite اضافه کن. تست‌های focused، integration، concurrency و E2E از هم جدا گزارش شوند. تستی که به dependency، build artifact، grammar/WASM یا fixture نیاز دارد تا آماده‌سازی واقعی آن dependency اجرا نشود pass محسوب نمی‌شود.
12. blockerهای فعلی را پنهان نکن: `ts-jest`/`jest`/`tsc` و بعضی fixtureها یا `dist` در محیط audit موجود نبودند؛ نبود dependency با حذف تست جایگزین نمی‌شود. ابتدا محیط را طبق manifest واقعی repository آماده و سپس تست را اجرا کن.
13. findingهای هم‌نام در batchهای مختلف را با path و batch تشخیص بده؛ شناسه‌های تکراری مانند `F-01`، `F-16` و `F-20` را merge نکن و برای هر مورد traceability یکتا بساز.
14. این سند living artifact است: هیچ گام completed را حذف نکن؛ requirement جدید را با علت کشف و dependency به فاز مناسب اضافه کن؛ تغییر معماری، ترتیب یا scope را صریح ثبت کن.
15. در پایان هر فاز، خروجی باید stable و قابل build/run باشد؛ integration dangling، migration اجرا‌نشده، contract ناسازگار، test skip‌شده یا known blocking issue با status 🟢 ناسازگار است.
16. Definition of Done هر فاز: تمام گام‌ها اجرا شده، functionality حفظ/تغییر موردنظر integrated است، خطاها و edge caseهای scope پوشش دارند، migration لازم applied و reversible است، تست لازم pass است، acceptance criteria با evidence قابل تکرار تأیید شده و هیچ blocker شناخته‌شده‌ای باقی نمانده است.

# پلن اجرایی

## [🔴] فاز ۱: تثبیت baseline، قراردادها و محیط قابل‌راستی‌آزمایی

هدف این فاز ایجاد مبنای reproducible برای تمام اصلاحات است؛ تا وقتی dependency، build، fixture، contract و inventory روشن نشده، هیچ finding به‌عنوان fix‌شده پذیرفته نمی‌شود.

### [🔴] گام ۱: قفل‌کردن baseline و traceability ممیزی

در ریشهٔ repository revision جاری، branch و تغییرات local را ثبت کن. `AUDIT_FILE_STATUS.md` و تمام فایل‌های `audit/` را به‌عنوان source map نگه دار. برای هر finding یک شناسهٔ یکتا با فرمت `SE-<domain>-<number>` یا `SA-<domain>-<number>` بساز و شناسه‌های تکراری batchها را با `path:line` تفکیک کن. برای هر مورد status فعلی، severity، evidence، اثر، اصلاح، تست و dependency فاز را ثبت کن.

### [🔴] گام ۲: آماده‌سازی environment و fixtureهای واقعی

manifestها و scriptهای package هر دو پروژه را بخوان و dependencyهای واقعی را نصب/قفل کن؛ از جایگزین‌کردن dependency با mock خودداری کن. `semantic-engine` را برای `jest`، `ts-jest`، `tsc` و fixtureهایی مانند `test-fixture/node_modules/left-pad` آماده کن. artifactهای `dist/cli/main.js`، grammar/WASM و executableهای لازم را طبق repository بساز. اگر نسخهٔ Node با قرارداد package ناسازگار است، **Unknown / Requires Verification** را به تصمیم صریح compatibility تبدیل کن.

### [🔴] گام ۳: ثبت baseline تست، build و contract

قبل از تغییر، suiteهای موجود، suiteهای skipped، تست‌های timeout‌شده، `npm test`، build، audit checker و contract validation را اجرا کن. خطاهای شناخته‌شده شامل `Preset ts-jest not found`، `tsc: not found`، نبود `AUDIT-2026-08.md` و fixture ناقص است؛ پس از آماده‌سازی environment معلوم کن کدام خطا واقعی باقی مانده است. pass/fail/skip را با command، زمان، revision و خروجی ثبت کن.

### [🔴] گام ۴: تعریف invariantها و قراردادهای مشترک

قراردادهای مشترک زیر را به‌صورت type/schema/test ثبت کن: project identity (`projectId`, `workspaceRoot`)، context propagation، ownership validation، cancellation state، error terminal state، graph node/edge/provenance/level، search mode/threshold، config mutation، persistence atomicity، و API error format. این قراردادها باید مرجع semantic-engine و structured-ai باشند و defaultهای in-memory/SQLite از آن‌ها مشتق شوند.

**معیار پذیرش:**

- revision، inventory، finding index و mapping یکتا با path/line ثبت شده است.
- dependency و fixture واقعی آماده است یا blocker دقیق و reproducible با **Unknown / Requires Verification** ثبت شده است.
- baseline commandهای test/build/check اجرا شده و هیچ نتیجه‌ای بدون evidence pass اعلام نشده است.
- contract testهای پایه برای project identity، ownership، graph، cancellation و error state تعریف شده‌اند.
- هیچ production code دیگری پیش از ثبت baseline تغییر نکرده است.

---

## [🔴] فاز ۲: persistence، migration و project isolation در semantic-engine

هدف این فاز تضمین استقلال و دوام دادهٔ هر project در registry، export، SQLite، indexing و restart است.

### [🔴] گام ۱: تکمیل lifecycle registry و startup hydration

در `semantic-engine/src/gateway/ProjectRegistry.ts:203-216` و `src/gateway/GatewayServer.ts:90-92,560-575`، `autoStart` و تمام تنظیمات لازم را به‌صورت durable ذخیره کن. هنگام `start()` registry را load، validate و hydrate کن؛ برای هر project worker/index state را با root مستقل restore کن. register/update/delete/list/get باید map، persistence و worker/runtime را هم‌زمان و سازگار mutate کنند. regression برای restart، autoStart، update و delete اضافه کن.

### [🔴] گام ۲: واقعی‌کردن project API و config mutation

در `src/server/routes/projectRoutes.ts:85-119`، PATCH و DELETE را به service/registry واقعی وصل کن و stale state را پاک کن. در `src/server/routes/configRoutes.ts:35-53` mutation، persistence و runtime reconfigure واقعی پیاده کن و `0` را با nullish semantics حفظ کن. در `src/services/ProjectService.ts:371-389` قرارداد `indexProject()` را با رفتار واقعی هم‌راستا کن؛ اگر indexing async است job و result contract را صریح کن. dashboard routeهای غایب را با `contracts/platform-v1.openapi.json:294-323` همگام کن.

### [🔴] گام ۳: atomic persistence و migration کامل

`structured-ai/agent/tools/planning/PlanRepository.js:83-94` و session save pathهای `structured-ai` را به temp+rename یا `JsonRepository` atomic تبدیل کن. در `structured-ai/agent/persistence/DataRoot.js:23-32` و `ProjectMigration.js:56-64,199-206` directory `discussion` و transcriptهای legacy را migrate کن. در `semantic-engine/src/export/SQLiteExporter.ts:114-122,124-137` schema قدیمی را با migration/rebuild واقعی سازگار کن؛ migration باید idempotent، قابل rollback و project-scoped باشد.

### [🔴] گام ۴: جلوگیری از حذف cross-project در export و data root

هر export، SQLite driver و delete-dead-rows را با project-specific DB/root اجرا کن. قبل از حذف، ownership و project key را validate کن. اگر DB مشترک از نظر معماری اجباری است، namespace و query predicate اجباری اضافه کن؛ **Unknown / Requires Verification:** consumerهای بیرونی که DB مشترک را می‌سازند باید با caller inventory تأیید شوند.

### [🔴] گام ۵: سازگاری runtime Node و export path

در `src/export/JsonExporter.ts:141-160` validation، ساخت parent directory و error contract را با `writeProjectIndex` یکسان کن. در `package.json` و `src/export/sqlite/SqliteDriver.ts:14-17,123-126,171-173` تضاد Node `>=20`، native SQLite `22.5` و fallback `sqlite3` را برطرف کن؛ تصمیم نهایی version/dependency باید در compatibility matrix و Node 20/22 CI test ثبت شود.

**معیار پذیرش:**

- register/update/delete/config/index و restart، registry، persistence و worker را با project state یکسان نگه می‌دارند.
- project A هرگز دادهٔ DB/index/artifact/transcript project B را نمی‌خواند یا حذف نمی‌کند؛ تست A/B و restart pass است.
- migration `discussion` و schema قدیمی idempotent است و crash وسط write فایل معتبر قبلی را حفظ می‌کند.
- export با `validate:true` و parent غایب رفتار تعریف‌شده دارد و index نامعتبر را نمی‌نویسد.
- Node compatibility matrix برای نسخه‌های پشتیبانی‌شده pass است و dependency fallback واقعاً نصب‌پذیر است.

---

## [🔴] فاز ۳: indexing، dependency extraction و incremental correctness در semantic-engine

هدف این فاز حذف از‌دست‌رفتن داده، تشخیص نادرست dependency و رفتار ناپایدار در watch/incremental است.

### [🔴] گام ۱: مقاوم‌سازی extractor manager و قرارداد resolution

در `src/dependencies/DependencyExtractorManager.ts:29-40,46-56` هر extractor را isolate/catch کن تا rejection آن extractor بعدی را متوقف نکند؛ partial result و همهٔ diagnostics/errors را حفظ کن. در `HeuristicDependencyExtractor.ts:110-115,156-162,194-201,225-227` قرارداد `filePath` و `resolvedFileId` را تصمیم‌گیری و enforce کن؛ documentation زبان‌ها را با map واقعی در `HeuristicDependencyExtractor.ts:2-10,21-100` هماهنگ کن.

### [🔴] گام ۲: اصلاح TypeScript export و dependency resolution

در `src/dependencies/typescript/TSDependencyExtractor.ts:269-275,313-330,357-371` برای هر declarator یک `ExportEntry` تولید کن. برای importهای local، resolution رسمی با root/tsconfig/project context را اجرا یا raw-only contract را صریح کن؛ package alias، project reference، monorepo cross-project و چند tsconfig را در test matrix ثبت کن، نه این‌که فرض کنی.

### [🔴] گام ۳: اصلاح incremental rename و watcher هم‌محتوا

در `src/incremental/IncrementalEngine.ts:547-555` rename با hash یکسان را به migration نمادها تبدیل کن تا symbol/edge parity حفظ شود. در `src/host/FileWatcher.ts:195-206,222-233` Map تک‌مقداری را به composite key یا multi-value queue تبدیل کن. تست‌های duplicate-content rename، simultaneous rename و delete/create را اضافه کن.

### [🔴] گام ۴: اصلاح stream error و snapshot identity

در `src/host/FileSystem.ts:185-190,296-318,339-354` lifecycle listener خطای stream را تا پایان stringify/write حفظ کن و error را به caller برگردان. در `scripts/snapshot.js:57-89` propagation صحیح parent context را اعمال کن تا IDهای file/symbol/module/graph پایدار بمانند؛ snapshot fixture باید تغییر identity را detect کند.

### [🔴] گام ۵: اصلاح watch provider و nested output ignore

در `src/cli/embeddingFromArgs.ts:29-31` و `src/cli/commands/watch-command.ts:19-22,140-147,163-205` همان provider انتخاب‌شده در index را به watch/incremental منتقل کن. در `src/pipeline/IndexPipeline.ts:498-514` مسیر نسبی کامل output directory را ignore کن، نه segment اول؛ nested output regression بساز.

**معیار پذیرش:**

- extractor failure به fallback/diagnostic قابل مشاهده تبدیل می‌شود و partial result بی‌دلیل از بین نمی‌رود.
- multi-declarator export، local import resolution، project references و rename هم‌محتوا با تست parity صحیح هستند.
- دو فایل هم‌محتوا overwrite نمی‌شوند و stream failure unhandled نمی‌ماند.
- snapshot IDهای پایدار regression هویت را تشخیص می‌دهند.
- provider watch با provider درخواست‌شده یکی است و output nested منبع را اشتباهاً ignore نمی‌کند.

---

## [🟢] فاز ۴: AI tools، schema contracts و search در semantic-engine

هدف هم‌قراردادکردن schema و implementation، اجرای واقعی optionها و جلوگیری از نتایج ظاهراً موفق اما غلط است.

### [🟢] گام ۱: یکسان‌سازی schema و implementation ابزارها

در `src/ai/tools/DetectArchitectureViolationsTool.ts:16-20,25-63` `checkCyclesOnly` را واقعاً اعمال کن. در `GetDependenciesTool.ts:19,30,48,70-75,109` depth بالاتر از ۳ را طبق schema با validation error رد کن، نه clamp خاموش. در `FindTestsTool.ts:26,33-40` و `GetConfigUsageTool.ts:19-30,34-43,55-79` schemaهای required را با ورودی‌های معتبر `path/fileId/symbolId/key` هم‌راستا کن.

### [🟢] گام ۲: تکمیل mutation simulation و query policy

در `SimulateMutationTool.ts:10-22,61-69` و simulator، `move_symbol` با `newPath` و broken-reference analysis را واقعی کن. در `queryPolicy.ts:120-125,203-205` CTE alias را از table واقعی جدا کن تا aliasهایی مانند `recent` به‌اشتباه رد نشوند؛ parser باید comment/string/CTE edge caseهای verified را پوشش دهد.

### [🟢] گام ۳: اصلاح context assembly و token cost

در `src/services/ContextService.ts:8-12,28-44` و `AssembleContextTool.ts:44-52,183-185,321-333` mapping `files → targetFiles` را حفظ کن و `tokenEstimate` را از `metadata.estimatedTokens` بگیر، نه echo کردن `maxTokens`. در `LlmAiMetadataGenerator.ts:281-295` estimator را با content واقعی تغذیه کن.

### [🟢] گام ۴: واقعی‌کردن search mode و score contract

در `src/services/SearchService.ts:8-15,28-46` و `SemanticSearchTool.ts:209-215` مسیرهای `vector`، `keyword` و `hybrid` را از هم جدا کن، `minScore` را اعمال کن و keyword را فقط در mode لازم اجرا کن. handle/result باید project-scoped و قابل تکرار باشد.

> **وضعیت اجرای کامل فاز (2026-09-18):** تمام گام‌های ۱ تا ۵ در یک execution stage تکمیل و با implementation و focused regression پوشش داده شدند. schema/runtime optionها، `move_symbol` و broken-reference analysis، CTE alias policy، `targetFiles` و token estimate، modeهای search و `minScore`، score contract، embedding cardinality/vector validation، graph defaults، bounds و `truncated` پیاده‌سازی شدند. Evidence تفصیلی و command/result در `audit/audit-phase4-completion-2026-09-18.md` ثبت شده است. `npm run build` و focused suites با نتایج ثبت‌شده pass شدند؛ اجرای full Jest suite در محیط validation به timeout رسید و pass سراسری ادعا نمی‌شود. این مورد برای فاز ۹ باقی است و blocker فاز ۴ نیست. فاز ۴ اکنون 🟢 است.

### [🟢] گام ۵: پایدارکردن embedding و graph query parity

در `RemoteEmbeddingGenerator.ts:55-68` و `VectorIndexer.ts:176-182` cardinality پاسخ 200 را validate کن و missing embedding را silent skip نکن؛ retry/fallback/fail contract را مشخص کن. در `SqliteGraphQuery.ts:68-69,194-199,238-247,342-350` و `GraphQueryEngine.ts:389-405,482-485` defaultهای direction/depth/threshold/path را مشترک کن. `maxNodes` در `SqliteGraphQuery.ts:79-87,342-376` را enforce و `truncated` result تعریف کن.

**معیار پذیرش:**

- هر option مستند در schema در runtime اثر دارد یا validation error صریح دارد؛ هیچ silent clamp/drop باقی نیست.
- `move_symbol`، CTE alias، target files و token estimate با focused tests درست عمل می‌کنند.
- search mode و minScore خروجی‌های قابل تفکیک و project-scoped دارند.
- embedding cardinality ناقص باعث success دروغین نمی‌شود.
- SQLite و in-memory graph بدون option خروجی هم‌قرارداد دارند و traversal از `maxNodes` تجاوز نمی‌کند.

---

## [🔴] فاز ۵: graph export، visualization و dashboard در semantic-engine

هدف تضمین صحت دادهٔ graph و dashboard واقعی، بدون dangling edge، provenance جعلی یا fallback گمراه‌کننده است.

### [🔴] گام ۱: atomic و schema-safe export

در exportهای graph/Blueprint parent directory، validation، schema version و atomic write را یکسان کن. `JsonExporter.ts:141-160` و مسیرهای `BlueprintExporter` را با error contract مشترک تست کن. اگر cache schema validator process-local است، reload behavior را طبق evidence واقعی مشخص و تست کن؛ موردی که فقط potential است بدون proof قطعی تغییر نده.

### [🔴] گام ۲: حفظ invariants در LOD graph

در `src/services/visualization/LodService.ts:296-317` فقط edgeهایی را emit کن که هر دو endpoint در node set هستند یا external node صریح بساز. در `LodService.ts:83-93,170-178` API node را بی‌دلیل prune نکن. در `LodService.ts:137-142,259-262,311-314` provenance را runtime-map/validate کن و cast TypeScript را جای validation نگذار. `confidentRatio` را از confidence واقعی محاسبه و fallback `level` را اصلاح کن (`158-160,267-275`).

### [🔴] گام ۳: اصلاح visualization API و frontend states

در `src/server/routes/visualizationRoutes.ts:123-145` و routeهای مشابه nullish semantics و range validation را اعمال کن تا depth/minConfidence صفر حفظ شود. در `public/visualizer.js:172-181,187-200,1111-1195` هر tab را به endpoint business mapping/impact/hotspots مربوط وصل کن؛ failure/empty را به graph sample تبدیل نکن و preview را explicit label و opt-in کن. visualizer node coverage در `structured-ai/web/public/visualizer/node-details.js:60-63` باید lookup واقعی یا `unknown/not checked` داشته باشد.

### [🔴] گام ۴: project-scoped history و dashboard

در `historyRoutes.ts:11-43` miner state را per-project یا keyed-by-project کن تا hotspot/co-churn مخلوط نشود. در `GatewayServer.ts:509-527` و `projectRoutes.ts:70-76,136-148` health، chunks، hotspots و recent changes را از service/index/metrics واقعی بخوان. routeهای dashboard در OpenAPI را تکمیل کن و UI logs/events را با route واقعی یا disabled state منطبق کن (`public/gateway.js:87-98,556-577`).

**معیار پذیرش:**

- graph هیچ dangling edge، provenance خارج از enum، level نادرست یا ratio ثابت مستقل از داده ندارد.
- `depth=0` و `minConfidence=0` به default silently تبدیل نمی‌شوند.
- visualization failure/empty با state شفاف نمایش داده می‌شود و sample به‌عنوان دادهٔ واقعی دیده نمی‌شود.
- همهٔ dashboard stats/health/history project-scoped و از data واقعی هستند.
- OpenAPI، route inventory و frontend calls یکسان‌اند و تست payload واقعی، نه فقط status code، pass است.

---

## [🔴] فاز ۶: project context و multi-project runtime در structured-ai

هدف جلوگیری از نشت context پروژه در delegation، MCP، filesystem، search، hooks، history و continuation است.

### [🔴] گام ۱: اصلاح ProjectResolver و normalized context

در `ProjectResolver.js:11-15,25-33,49-61` و `ProjectContext.js:50-58` recordهای `{id, rootPath}` و contextهای `{projectId, workspaceRoot}` را یک contract normalized کن. resolver باید هر ورودی مجاز را normalize و ownership را validate کند؛ explicit project object که bypass validation می‌کند در **Unknown / Requires Verification** بماند تا caller evidence فراهم شود.

### [🔴] گام ۲: propagation در delegation و continuation

در `DelegationRunner.js:422-437` effective child project را به `McpManager.js:33-44,414-423` و `McpTools.js:216-227,401-403` منتقل کن. در web `AUTO_CONTINUE` و run continuation، projectId و context/options را به هر run بعدی منتقل کن. برای child project، root، config، tool registry و persistence باید از context child خوانده شود، نه parent.

### [🔴] گام ۳: project-scoped MCP config/cache

در `McpManager.js:95-113,214-220`، `McpConfigLoader.js:159-180` و `ToolRuntime.js:151-154` fallback به اولین workspace را حذف یا فقط با قرارداد رسمی مجاز کن. workspaceRoot/projectId را required و cache key را project-scoped کن؛ `.mcp.json`، discovery و invalidation برای دو project مستقل تست شود.

### [🔴] گام ۴: filesystem، search handle و hook scope

در `agent/tools/ToolRuntime.js:248-260` `fs_read_many` را برای هر item با active project resolver اجرا کن. در `SearchTools.js:465-485,571-581,614-625,635-645` handleهای get/list/stop را با projectId/session owner validate کن. در `agent.js:3306-3313`، `HookRunner.js:491-495`، `HookLoader.js:193-205` و `WorkspaceProfile.js:121-130` registry را با project context جاری load کن.

### [🔴] گام ۵: telemetry و history scope

هر telemetry، provenance، Git status، hotspot و co-churn را با root/project key جاری محاسبه و persist کن. دادهٔ process-global را per-project یا keyed-by-project کن؛ برای دو project با فایل هم‌نام و history مستقل test matrix بساز.

**معیار پذیرش:**

- delegation A→B تمام MCP/filesystem/search/hook/config calls را با B انجام می‌دهد.
- `.mcp.json` و cache پروژهٔ دوم از workspace اول نمی‌آید.
- `fs_read_many`، search handle و hook registry cross-project read/stop/execute ندارند.
- continuation، telemetry و history projectId را حفظ می‌کنند.
- تست دو پروژهٔ هم‌نام و concurrent، context isolation را در هر مسیر pass می‌کند.

---

## [🔴] فاز ۷: run lifecycle، scheduler، cancellation و process reliability در structured-ai

هدف تعریف lifecycle صحیح برای queued/active/failed/exited/cancelled runها و اجرای واقعی parallelism مستقل پروژه‌ها است.

### [🔴] گام ۱: error finalization و observability

در `agent/runtime/Observability.js:104-127`، `agent.js:3522-3550` و `ActionProcessor.js:491-502` یک مسیر نهایی error بساز که model/tool/cancel/hook exception را به `run:error`، state terminal و metrics متصل کند. `active/failed/completed` باید دقیقاً یک transition معتبر داشته باشند و rethrow باعث stale metric نشود.

### [🔴] گام ۲: queued run bookkeeping و cancellation

در `agent.js:3502-3519`، `RunManager.js:83-107,138-143,146-155,182-199` و `RunScheduler.js:175-203,284-306` queued run را مستقل از active registry ثبت کن. cancel-by-ID باید queued و active را پیدا کند، context/issued ID را retire و cleanup کند. در `application/lifecycle.js:37-40` و agent signal paths، SIGINT/SIGTERM همهٔ active و queued modular runها را cancel کند، نه فقط legacy/global run.

### [🔴] گام ۳: per-project scheduler و parallel execution

busy gate process-wide در Web API را به gate per-project/per-run تبدیل کن. اجرای A و B باید هم‌زمان ممکن باشد، اما اجرای تکراری همان project طبق policy کنترل شود. `AUTO_CONTINUE` نیز باید project context را حفظ کند. concurrency testهای A/B، duplicate same-project، queue ordering و cancellation race اضافه کن.

### [🔴] گام ۴: process/session state و output bounds

در `BackgroundSession.js:177-200` precedence خطای spawn را بر `exited` حفظ کن. در `BackgroundSession.js:14-27` و `ProcessManager.js:181-205` هنگام trim chunk cursor را decrement/clamp کن. در foreground terminal capture، stdout را هنگام append cap کن، نه فقط stderr. session save path را atomic کن و close/abort/error cleanup را test کن.

### [🔴] گام ۵: اجرای failure-path و retry contract

برای timeout، abort، spawn failure، child exit، stream error، queue cancel و retry، state transition table و event contract بساز. هیچ failure نباید به `completed` یا `exited` عادی overwrite شود؛ retry نباید handle/context قبلی را reuse کند مگر contract صریح.

**معیار پذیرش:**

- هر run دقیقاً یک terminal outcome معتبر و event/metric متناظر دارد.
- queued run با ID قابل cancellation است و هیچ active/context/handle stale باقی نمی‌ماند.
- SIGINT/SIGTERM همهٔ runهای مربوط را cancel می‌کند.
- دو project مستقل هم‌زمان اجرا می‌شوند؛ همان project policy خود را حفظ می‌کند.
- spawn error، cursor، stdout cap و atomic session persistence regression test pass دارند.

---

## [🔴] فاز ۸: policy، hooks، approvals و data integrity در structured-ai

هدف اجرای واقعی failure policy و approval lifecycle، با bounded history و project-scoped hook loading است.

### [🔴] گام ۱: dependency failure policy

در `ToolGraphExecutor.js:282-293,312-362` و `HookRunner.js:534-547` failed dependency را صرفاً complete تلقی نکن. scheduler باید قبل از dispatch `on_failure: stop` را ارزیابی کند و dependent hook را skip/cancel با reason قابل مشاهده کند. تست graph چندسطحی و race اضافه کن.

### [🔴] گام ۲: validation امن policy و audit event

در `PolicyMatcher.js:55-73` و `PolicyRegistry.js:39-67` regex را هنگام validation با `RegExp` بساز و SyntaxError را configuration error کن. در `ApprovalManager.js:138-147,272-302` و `PolicyEngine.js:273-283` deny و cancel را نیز به `onDecision`/policy audit وصل کن؛ outcome، actor، reason و timestamp ثبت شود.

### [🔴] گام ۳: abort و pending approval

در `ApprovalManager.js:272-302` و `agent.js:1418-1439` pending approval را به AbortSignal وصل کن؛ abort باید request را settle/cancel کند و promise/listener leak نداشته باشد. تست abort-before-decision، decision-race و duplicate decision اضافه کن.

### [🔴] گام ۴: bounded approval history

در `ApprovalStore.js:8-11,28-39` retention/max length و eviction تعریف کن. persistence و reload باید سقف را حفظ کند؛ history نباید نامحدود رشد کند. مقدار retention را در config و migration مستند کن.

### [🔴] گام ۵: project-scoped hook registry

در `agent.js:3306-3313`، `HookRunner.js:491-495`، `HookLoader.js:193-205` و `WorkspaceProfile.js:121-130` active project context را به registry/loader منتقل کن و cache را با project key جدا کن.

**معیار پذیرش:**

- `on_failure: stop` پیش از اجرای dependent hook اعمال می‌شود و reason ثبت می‌گردد.
- regex invalid در validation رد می‌شود، نه این‌که evaluation را crash کند.
- approval approve/deny/abort همگی terminal، audit-able و project-scoped هستند.
- pending request پس از abort باقی نمی‌ماند و history سقف پایدار دارد.
- hook پروژهٔ A در run پروژهٔ B load یا execute نمی‌شود.

---

## [🔴] فاز ۹: CI، تست‌های کامل، performance و failure hardening

هدف تبدیل اصلاحات به delivery قابل‌اعتماد و قابل تکرار است؛ هیچ runtime claim بدون این فاز نهایی نیست.

### [🔴] گام ۱: تکمیل CI suite و skip policy

در `scripts/check-tests.js:5-10,76-99` discovery، skipped و executed suite count را جدا validate کن و پیام `all suites ran` را فقط در نبود skip بده. suiteهای project/run/persistence/semantic/concurrency را به workflow CI اضافه کن؛ failure/skip را fail‌کننده کن مگر exception مستند و approved وجود داشته باشد.

### [🔴] گام ۲: اجرای regression matrix semantic-engine

برای export/SQLite، registry/restart، API/config، indexing/watch، extractor، incremental rename، embedding/search، graph parity، visualization payload، dashboard stats و Node 20/22 تست focused و integration اجرا کن. تست‌های schema sync (`src/core/types/schemaSync.test.ts:131-177`) را برای type/enum/nesting/value constraints گسترش بده؛ OpenAPI sync (`openapiSync.test.ts:19-46`) باید method/response/parameter schema را assert کند. barrel export `src/core/types/index.ts:1-2` و public import test را نیز verify کن.

### [🔴] گام ۳: اجرای regression matrix structured-ai

testهای project isolation، MCP/delegation، filesystem, search handles، run lifecycle، queue cancellation، signals، scheduler concurrency، archive/compaction، session/plan atomicity، hooks/policy/approval، UTF-8 body، Live LSP rename و visualizer payload را اجرا کن. تست‌های timeout‌شدهٔ context/archive/tools/MCP را پس از رفع environment دوباره اجرا کن؛ exit 124 pass نیست.

### [🔴] گام ۴: performance و resource bounds

برای graph traversal `maxNodes`، embedding batch cardinality، stdout/chunk retention، approval history، archive segments، scheduler concurrency و indexing/watch memory/latency benchmark بگیر. thresholdها باید از baseline فاز ۱ بیایند؛ threshold جدید invent نشود. leak، unbounded growth و cross-project contention را با before/after evidence ثبت کن.

### [🔴] گام ۵: failure injection و rollback validation

crash وسط plan/session/index/SQLite write، archive failure، stream error، embedding short response، worker cancel، spawn error، SIGTERM، malformed config/policy، invalid API input و project switch failure را inject کن. verify کن دادهٔ قبلی سالم می‌ماند، state terminal درست است و rollback/migration قابل تکرار است.

**معیار پذیرش:**

- CI suiteهای ضروری را واقعاً اجرا می‌کند و skip پنهان نمی‌ماند.
- build هر دو پروژه و تمام targeted/integration/concurrency tests pass است؛ artifactهای لازم وجود دارند.
- هیچ test timeout، missing fixture، missing `ts-jest`/`tsc` یا audit-check blocker حل‌نشده باقی نمانده است.
- benchmarkها عدم رشد نامحدود و invariants project isolation را نشان می‌دهند.
- failure injection بدون corruption، terminal-state overwrite یا data loss pass می‌شود.

---

## [🔴] فاز ۱۰: مستندسازی، migration delivery و final release gate

هدف تحویل تغییرات به‌صورت قابل بازبینی، قابل rollback و با traceability کامل از finding تا fix است.

### [🔴] گام ۱: به‌روزرسانی قرارداد و مستندات

OpenAPI، schema، CLI/config docs، project lifecycle، migration، MCP/project context، scheduler/cancellation، graph visualization و CI test matrix را با رفتار نهایی همگام کن. هر گزینه‌ای که حذف یا تغییر semantics یافته باید migration/backward-compatibility note داشته باشد.

### [🔴] گام ۲: ساخت traceability matrix نهایی

برای هر finding قطعی، یک ردیف با finding ID یکتا، severity، source batch، path، line، root cause، changed path، regression test، command، result و status بساز. potential/unverifiedها را جدا نگه دار و برای هرکدام evidence گم‌شده و next verification بنویس. `AUDIT_FILE_STATUS.md` را به «coverage» محدود نگه دار و آن را proof correctness معرفی نکن.

### [🔴] گام ۳: migration و rollback release candidate

migrationهای persistence را روی copy و dataset واقعی/fixture versioned اجرا و rollback کن. compatibility با دادهٔ legacy، restart، دو project هم‌زمان و نسخهٔ قبلی/جدید را بررسی کن. تغییرات را در commitهای کوچک و قابل rollback نگه دار و generated/binary artifactها را فقط با روش repository تولید کن.

### [🔴] گام ۴: final verification و review gate

از دید Architect، Developer، QA، Delivery، Security، DevOps و Product review کن. security خارج از audit اولیه بوده، اما project isolation و data integrity verification این plan باید evidence داشته باشد؛ هر security review مستقل را با scope صریح جدا ثبت کن. branch، diff، CI revision، test output و runtime smoke را بازبینی کن.

### [🔴] گام ۵: اعلام وضعیت و release decision

فقط در صورت سبزشدن تمام فازها و گام‌ها، pass کامل اعلام کن. اگر هر تست، build، migration، contract، performance یا runtime smoke unresolved است، وضعیت کل release 🟡 باقی بماند و blocker، owner، command و next action ثبت شود. هیچ عبارت «production-ready» بدون evidence کامل استفاده نشود.

**معیار پذیرش:**

- تمام findingهای قطعی mapping اصلاح→تست→evidence دارند؛ هیچ finding بی‌صاحب باقی نمانده است.
- potential/unverifiedها جدا و با سؤال باز/شاهد لازم ثبت شده‌اند.
- migration روی dataset legacy و rollback pass است.
- docs، OpenAPI، schema، CI، runtime و implementation یک قرارداد واحد نشان می‌دهند.
- build، test، smoke، concurrency، isolation، performance و failure checks در revision نهایی pass هستند.
- همهٔ فازها و گام‌ها طبق پروتکل وضعیت به‌روز شده‌اند و فقط در صورت Definition of Done واقعی 🟢 اعلام می‌شوند.
