# پلن اجرایی Multi-Project Semantic Engine — Gateway، Worker و Data Directory متمرکز

**وضعیت:** 🟡 در حال اجرا — فاز ۱ تا ۱۳ 🟢 (۲۰۲۶-۰۸-۲۶) · فاز ۱۴ 🔴
**تاریخ:** 2026-08-26
**مخزن:** `legionir/semantic-engine-structured-ai` (شاخهٔ کاری: `arena/01a03f7c-semantic-engine-structured-ai`)
**بسته‌های درگیر:** `semantic-engine/` (TypeScript) و `structured-ai/` (JavaScript)

**منابع مرجع:**

- [`MULTI_PROJECT_GATEWAY_PLAN.md`](MULTI_PROJECT_GATEWAY_PLAN.md) — منبع نیازمندی‌ها (گام ۰ تا ۱۷). این سند آن را به فازهای قابل‌اجرا با معیار پذیرش تبدیل می‌کند و شکاف‌های شناسایی‌شده در بازبینی کد را جبران می‌کند. در صورت تعارض **نیازمندی**، پلن مرجع معتبر است؛ در صورت تعارض **ترتیب و قرارداد فنی**، همین سند معتبر است.
- [`structured-ai/EXECUTION_PLAN.md`](structured-ai/EXECUTION_PLAN.md) — سمت Structured AI؛ فازهای ۱ تا ۳۰ آن پذیرفته‌شده‌اند و کلاینت Semantic آن **از قبل ship شده** است.
- [`semantic-engine/INTEGRATION-STRUCTURED-AI.md`](semantic-engine/INTEGRATION-STRUCTURED-AI.md) — قراردادهای INT-01…INT-0n میان دو بسته.

**وضعیت‌های مجاز:** 🔴 پیاده‌سازی نشده · 🟡 ناقص/نیازمند تکمیل یا بازبینی · 🟢 کامل و verification شده

---

## Baseline تأییدشده (۲۰۲۶-۰۸-۲۶، روی همین مخزن اجرا شد)

این بخش حدس نیست؛ هر بند با اجرای کد یا خواندن مستقیم فایل تأیید شده است. مجری **نباید** این‌ها را دوباره کشف کند، ولی اگر کد تغییر کرده بود، ابتدا همین جدول را به‌روز کند.

| # | واقعیت | منبع |
|---|---|---|
| 1 | `semantic-engine index --root <tmp>` امروز artifact را **داخل root** می‌نویسد: خروجی واقعی `indexPath: /tmp/probe-…/app/.semantic-engine/project-index.json` | `semantic-engine/src/cli/commands/index-command.ts:34-37` |
| 2 | شناسهٔ پروژه از `basename` ساخته می‌شود و دو پروژهٔ هم‌نام **یک id** می‌گیرند؛ ثبت دومی اولی را بی‌صدا overwrite می‌کند (خروجی واقعی: `ids: prj-app prj-app | listed: 1`) | `semantic-engine/src/services/ProjectService.ts:51` و `:172` |
| 3 | اولویت خواندن legacy از قبل پیاده است (`.semantic-engine` ← `.agent/semantic` ← `semantic`) | `semantic-engine/src/core/config/ProjectPaths.ts:77-83` |
| 4 | Worker امروز multi-projectِ درون‌پروسه‌ای است: `GET/POST /api/v1/projects` (با `path` دلخواه در body) و `GET /api/v1/fs/browse?path=` | `semantic-engine/src/server/routes/projectRoutes.ts:12,32` و `fsRoutes.ts:65` |
| 5 | `SecurityPipeline.checkConnection` درخواست از Unix socket را **۴۰۳** می‌کند (`remoteAddress === undefined`)؛ خروجی واقعی: `Access denied from remote address .` | `semantic-engine/src/server/SecurityPipeline.ts:89-105` |
| 6 | `SecurityPipeline.checkOrigin` و `HttpGuard` هر Origin غیر loopback را **۴۰۳** می‌کنند؛ خروجی واقعی: `Cross-origin request from https://… is refused.` | `SecurityPipeline.ts:165-193` و `src/cli/HttpGuard.ts:120-124` |
| 7 | WebSocket واقعی وجود ندارد: صفر listener با کلیدواژهٔ `upgrade` در `src/`، صفر روت `/ws`، بدون وابستگی `ws`؛ `WebSocketManager` فقط SSE روی `http.ServerResponse` است و `registerClient` هیچ فراخوانی ندارد | `semantic-engine/src/server/WebSocketManager.ts:20-43` |
| 8 | `indexGeneration` در engine وجود ندارد (صفر occurrence) ولی کلاینت structured-ai آن را می‌خواند و در صورت تغییر، کش را دور می‌ریزد | `structured-ai/agent/mcp/SemanticClient.js:251-262` |
| 9 | `SemanticEngineMcpServer.ts` هیچ `structuredContent`/`projectId`/generation نمی‌فرستد (۲۰۶ خط، صفر occurrence) | `semantic-engine/src/ai/mcp/SemanticEngineMcpServer.ts` |
| 10 | کلاینت structured-ai مسیر ایندکس را **داخل root** حدس می‌زند؛ با انتقال artifact به data dir این مسیر کور می‌شود | `structured-ai/agent/mcp/semantic.js:340-352` |
| 11 | structured-ai شناسه را `prj-<slug>-<hash8>` می‌سازد (مثل `prj-engine-core-3fa9c1d2`) | `structured-ai/agent/projects/ProjectRegistry.js:25,61` |
| 12 | stub فعلی gateway قرارداد `POST /mcp/:projectId` + markerهای `{projectId, indexGeneration}` را سرو می‌کند | `structured-ai/test/helpers/stubSemanticGateway.js:9-16` |
| 13 | `HttpServer` علاوه بر index، `<projectsRoot>/.agent/jobs.json` و `<projectsRoot>/.agent/telemetry/spans.json` را هم **داخل root** می‌نویسد (و دو نمونه‌اش در ریپو commit شده) | `semantic-engine/src/server/HttpServer.ts:92,182` |
| 14 | صفحهٔ ورود UI امروز `/open.html` است، نه `index.html` | `semantic-engine/src/server/HttpServer.ts:486-490` و `public/open.js:195,74` |
| 15 | ۱۸ فایل تست به مسیرهای in-root ارجاع دارند (فهرست در گام ۶ فاز ۳) | `grep -rl` روی `semantic-engine/src/**/*.test.ts` |
| 16 | `SEMANTIC_ENGINE_DATA_DIR` هیچ‌جا در کد وجود ندارد؛ `envVarNameFor('semanticEngine.dataDir')` دقیقاً همین نام را تولید می‌کند | `semantic-engine/src/host/Config.ts:105-110` |
| 17 | `contracts/config.schema.json` کلید data dir ندارد و تست هم‌گام‌سازی، `default` و `additionalProperties:false` را الزامی می‌کند | `semantic-engine/src/host/configSchemaSync.test.ts:72-110` |
| 18 | CLI امروز هیچ flag مرتبط با embedding ندارد؛ `index`/`watch` فقط `HashingEmbeddingGenerator` می‌سازند و `RemoteEmbeddingGenerator` تنها از `jobRoutes.ts:73` استفاده می‌شود | `index-command.ts:93`، `watch-command.ts:141`، `jobRoutes.ts:73` |
| 19 | هیچ پیاده‌سازی lock در `semantic-engine/src` وجود ندارد (فقط `*.lock` در ignore pattern) | `grep -rn "lock" semantic-engine/src` |
| 20 | container با `read_only: true` و فقط `/workspace` mount اجرا می‌شود → data dir جدید بدون volume قابل نوشتن نیست | `structured-ai/docker-compose.yml:11-19` |
| 21 | **baseline تست (کاملاً سبز):** `cd semantic-engine && npm ci && npm run build && npm run lint && npm test` → `tsc -p ./` با exit 0، `eslint src` بدون خروجی، و **`Test Suites: 170 passed / 170 total` با `Tests: 2483 passed / 2483 total`** (حدود ۵۹ ثانیه). بدون `npm run build` تنها `src/host/packaging.test.ts` به‌خاطر نبود `dist/` (خروجی gitignore‌شدهٔ build) می‌شکند | اجرای واقعی، ۲۰۲۶-۰۸-۲۶ |
| 22 | اجرای `npx jest` بدون `pretest` (تولید fixture) ۷ suite اضافی را قرمز می‌کند → دستور مجاز baseline فقط `npm test` است | اجرای واقعی |

---

# قوانین ثابت انجام پروژه

این قوانین در تمام فازها الزامی‌اند و هیچ فازی مجاز به نقض آن‌ها نیست.

1. **بدون از دست رفتن scope.** هیچ نیازمندی از `MULTI_PROJECT_GATEWAY_PLAN.md` حذف، ساده‌سازی یا به‌تعویق نمی‌افتد مگر با ثبت صریح دلیل در بخش «حسابرسی دامنه» همین سند. کار تازه‌کشف‌شده با ذکر دلیل به فاز مناسب اضافه می‌شود و گام‌های انجام‌شده حذف نمی‌شوند.
2. **حدس ممنوع.** اطلاعات ناموجود با برچسب «Unknown / Requires Verification: …» و فرض اجتناب‌ناپذیر با برچسب «Assumption: …» ثبت می‌شود. فرض بی‌صدا به نیازمندی تبدیل نمی‌شود.
3. **قانون وضعیت.** پس از هر گام، وضعیت گام و فاز (🔴/🟡/🟢) به‌روز می‌شود. فاز فقط وقتی 🟢 می‌شود که **همهٔ** گام‌هایش 🟢 و **همهٔ** معیارهای پذیرشش برقرار باشند. تکمیل بدون verification هرگز اعلام نمی‌شود.
4. **verification واقعی، نه جایگزین.** دستور verification هر فاز باید کد تغییریافته را واقعاً اجرا کند (CLI واقعی، سرور واقعی، worker واقعی). اسکریپتی که منطق را بازپیاده‌سازی یا mock کند، verification محسوب نمی‌شود. اگر verification ممکن نیست، همان‌جا صریح نوشته می‌شود چه چیزی بررسی نشد و چرا.
5. **حفظ رفتار موجود.** رفتار single-project فعلی (CLI، `serve`/`ui`/`start`/`watch`، MCP stdio، ابزارها، UI فعلی) حفظ می‌شود مگر تغییری عمدی و مستند در معیار پذیرش همان فاز آمده باشد.
6. **قراردادها فقط additive تغییر می‌کنند.** افزودن فیلد/endpoint مجاز است؛ تغییر معنای فیلد موجود، حذف فیلد یا تغییر نام endpoint/ابزار ممنوع است، جز با migration عمدی و مستند (مثل INT-02 در فاز ۴).
7. **مرز امنیتی مدل و request.** `projectId` و `rootPath` فقط از runtime context/registry می‌آیند؛ هرگز از آرگومان قابل‌جعل توسط مدل یا از body یک request عادی پذیرفته نمی‌شوند.
8. **هر فاز پایان‌پذیر و پایدار.** پایان هر فاز: `npm run build && npm test` در `semantic-engine/` سبز، و اگر فاز سمت structured-ai را لمس کرد `npm test` در `structured-ai/` هم سبز. پروژه قابل‌اجرا و قابل rollback باقی می‌ماند.
9. **وابستگی‌ها محترم شمرده می‌شوند.** گامی که به قابلیت پیاده‌نشده وابسته است فقط با stub/mock صریح و مستند اجرا می‌شود (مثل استفادهٔ موقت از `structured-ai/test/helpers/stubSemanticGateway.js` تا پایان فاز ۱۰).
10. **نه تکه‌تکه، نه فشرده.** فازها نه آن‌قدر خرد می‌شوند که مصنوعی باشند، نه آن‌قدر بزرگ که اجرای قابل‌اعتماد و تست کامل از دست برود.
11. **کیفیت production.** خطاها کنترل‌شده، تست مرتبط نوشته‌شده، بدون regression، بدون secret در لاگ/manifest.
12. **نگهداری پلن.** این سند زنده است: وضعیت‌ها به‌روز می‌شوند، معماری تغییرکرده صریح ثبت می‌شود، کار جدید با دلیل اضافه می‌شود و traceability نیازمندی→گام حفظ می‌شود.
13. **source root مقدس است.** هیچ گامی هیچ‌گاه فایل زیر `workspaceRoot` را پاک یا بازنویسی نمی‌کند؛ پاک‌سازی فقط داخل `artifactRoot`.
14. **بدون وابستگی جدید غیرضروری.** اضافه کردن dependency فقط با دلیل ثبت‌شده در همین سند (به همان روح `semantic-engine/src/cli/args.ts:1-8`).

**دستورهای verification مجاز:**

```bash
# semantic-engine
cd semantic-engine && npm ci && npm run build && npm run lint && npm test
cd semantic-engine && npx jest <path-to-suite>        # فقط برای تکرار سریع یک suite
cd semantic-engine && npm run test:gate                # gate تست‌ها

# structured-ai
cd structured-ai && npm run check && npm test
cd structured-ai && npm run test:semantic              # test/mcp/semantic.test.js + semantic-pool.test.js
```

---

# تصمیم‌های معماری قطعی (D1…D11)

اینها تصمیم‌هایی هستند که در نبودِ تصمیم صریح کارفرما، بر اساس کد واقعی گرفته شده‌اند. هرکدام قابل بازنگری است، ولی **تا زمانی که بازنگری نشده‌اند** مجری باید مطابق آن‌ها بسازد.

- **D1 — data root واحد و platform-aware:** Linux `$XDG_DATA_HOME/semantic-engine` (وگرنه `~/.local/share/semantic-engine`)، macOS `~/Library/Application Support/SemanticEngine`، Windows `%LOCALAPPDATA%/SemanticEngine`. override با `SEMANTIC_ENGINE_DATA_DIR`. مسیر **`.semantic-engine` تودرتو ساخته نمی‌شود** (رفع تناقض §۲٫۲ و §۳ پلن مرجع).
- **D2 — کلیدهای پیکربندی از مسیر schema موجود:** `semanticEngine.dataDir` و `semanticEngine.artifactLocation` (enum: `in-root` | `external`) به `contracts/config.schema.json` اضافه می‌شوند؛ به‌خاطر `envVarNameFor` (Config.ts:105-110) به‌ترتیب `SEMANTIC_ENGINE_DATA_DIR` و `SEMANTIC_ENGINE_ARTIFACT_LOCATION` خوانده می‌شوند — بدون env موازی و دستی.
- **D3 — scheme شناسه (تصمیم تأییدشدهٔ کارفرما، ۲۰۲۶-۰۸-۲۶):** `prj-<slug(name)>-<sha256(canonicalRoot)[0:8]>`، یعنی **دقیقاً** الگوریتم فعلی `structured-ai/agent/projects/ProjectRegistry.js:61`. registry موتور یک id خارجیِ بی‌خطر را بدون تغییر می‌پذیرد تا دو طرف هم‌گرا بمانند. **پالایش فاز ۲:** «بی‌خطر» دو سطح دارد — `isSafeProjectId` برای lookup/alias (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` بدون `..`) و `isPathSafeProjectId` (همان، فقط lowercase) برای وقتی شناسه نام پوشه می‌شود؛ دلیلش این است که شناسه‌های موجود در دنیا آزادترند (`serve` پروژه را با `current` و `<basename>` ثبت می‌کند و `HttpServer.test.ts:173` انتظار دارد `sample-app` همان id بماند) و اینکه macOS/Windows به بزرگی/کوچکی حروف حساس نیستند. الگوی `^prj-[a-z0-9][a-z0-9-]{0,63}$` برای شناسهٔ *تولیدشده* باقی است. `prj-<uuid>` پلن مرجع **جایگزین** می‌شود (نه موازی)، چون routing به توافق دو registry نیاز دارد.
- **D4 — منبع حقیقت projectId:** registry موتور (`<dataRoot>/registry.json`) برای Worker/Gateway؛ structured-ai رکورد خودش را دارد و id را هنگام ثبت به موتور می‌دهد. کلید یکتایی **canonicalRoot** است، نه id: ثبت root تکراری همان رکورد را برمی‌گرداند.
- **D5 — transport داخلی Worker:** پیش‌فرض loopback TCP با پورت ephemeral تخصیص‌یافته توسط Gateway + توکن داخلی worker. Unix domain socket به‌عنوان گزینهٔ دوم **فقط پس از** رفع `checkConnection` (فاز ۶) فعال می‌شود. `SO_REUSEPORT` ممنوع (مطابق پلن مرجع §۲٫۱).
- **D6 — سیاست Origin پشت Gateway:** Gateway موظف است `Origin` ورودی را حذف و `X-Forwarded-For/Proto/Host` را اضافه کند؛ Worker در حالت `--gateway-managed` و **فقط با توکن داخلی معتبر** به trusted gateway اعتماد می‌کند. در حالت standalone رفتار فعلی (loopback + Origin) بدون تغییر می‌ماند.
- **D7 — namespace API:** Worker همان `/api/v1/projects/:id/...` فعلی را نگه می‌دارد؛ Gateway روت‌های مدیریتی را زیر `/api/v1/gateway/*` می‌گذارد و `/api/v1/projects/:projectId/...` را **بدون بازنویسی مسیر** به worker proxy می‌کند. `GET/POST /api/v1/projects` در Gateway سطح registry خودش را سرو می‌کند تا `public/open.js:195` بدون تغییر کار کند.
- **D8 — indexGeneration:** شمارندهٔ monotonic، persist‌شده در `<artifactRoot>/manifest.json`، که با هر write موفقِ index/blueprint/sqlite یکی زیاد می‌شود؛ به‌صورت additive در `structuredContent: { projectId, indexGeneration }` نتایج MCP منتشر می‌شود (بدون تغییر `content` فعلی) تا `SemanticClient.trackGeneration` کار کند.
- **D9 — WebSocket (تصمیم تأییدشدهٔ کارفرما، ۲۰۲۶-۰۸-۲۶):** پیاده‌سازی می‌شود. امروز هیچ WS واقعی وجود ندارد (Baseline #7)، پس فاز ۱۱ یک سرور WS حداقلی **بدون وابستگی جدید** (RFC6455: handshake با `Sec-WebSocket-Accept`، فریم text/ping/pong/close) می‌سازد و proxy upgrade در Gateway اضافه می‌کند. نیازمندی WebSocket در §گام ۹ و §۶ پلن مرجع حفظ می‌شود و حذف نمی‌گردد.
- **D10 — سازگاری عقب‌رو (flip در فاز ۴، تأییدشدهٔ کارفرما ۲۰۲۶-۰۸-۲۶):** `--out` (مطلق یا نسبی) و `SEMANTIC_ENGINE_ARTIFACT_LOCATION=in-root` تا پایان این پروژه پشتیبانی می‌شوند؛ حذفشان تصمیم جداگانه می‌خواهد.
- **D11 — Worker single-project واقعی:** در حالت `--gateway-managed` روت‌های registry worker (`POST /api/v1/projects`) و هر `rootPath` ورودی از request غیرفعال/رد می‌شوند و `fs/browse` به subtree همان root محدود می‌شود.

---

# نمودار وابستگی فازها

```text
فاز ۱ (قرارداد: مسیر/کلید/شناسه)
   └── فاز ۲ (ProjectRegistry + رفع collision)
         └── فاز ۳ (انتقال artifact به data dir؛ پیش‌فرض هنوز in-root)
               └── فاز ۴ (flip پیش‌فرض + مصرف‌کننده‌ها + Docker)
                     └── فاز ۵ (WorkerConfig schema + flagهای embedding)
                           ├── فاز ۶ (transport + hardening امنیتی worker)
                           │     └── فاز ۷ (دستور worker + internal API + indexGeneration)
                           │           └── فاز ۸ (Supervisor + lock + quota)
                           │                 └── فاز ۹ (Gateway registry + REST/SSE proxy + authz)
                           │                       ├── فاز ۱۰ (MCP proxy + انطباق با کلاینت)
                           │                       │     └── فاز ۱۱ (WebSocket واقعی + upgrade proxy)
                           │                       └── فاز ۱۲ (Gateway UI + فرم worker + deep link)
                           │                             └── فاز ۱۳ (metrics + cache CLI + استقرار)
                           │                                   └── فاز ۱۴ (isolation/e2e + مستندات + پذیرش نهایی)
```

هیچ فازی زودتر از پیش‌نیازش شروع نمی‌شود. فاز ۱۲ و ۱۳ می‌توانند **موازی** اجرا شوند به‌شرط آنکه قرارداد API فاز ۹ freeze (قطعی) شده باشد.

---

# پلن اجرایی

## [🟢] فاز ۱: قرارداد پایه — مسیرها، کلیدهای پیکربندی و شناسهٔ پروژه

**هدف:** تثبیت contract قبل از هر تغییر رفتاری: data root، ساختار `ProjectPaths`، کلیدهای config و الگوریتم شناسه. **خروجی این فاز فقط قرارداد + تست است؛ هیچ رفتاری در CLI تغییر نمی‌کند.** معادل گام ۰ و بخش API گام ۱ پلن مرجع.

### [🟢] گام ۱: ماژول `DataRootResolver`

فایل جدید `semantic-engine/src/core/config/DataRootResolver.ts` با `resolveDataRoot({ dataDir?, env?, platform? })` مطابق D1: ترتیب اولویت `dataDir` صریح → `env.SEMANTIC_ENGINE_DATA_DIR` → مسیر platform-aware. ساخت directory با mode `0o700`، خطای واضح وقتی مسیر وجود دارد ولی directory نیست یا قابل نوشتن نیست. `platform` و `env` تزریق‌پذیر باشند تا تست بدون تغییر ماشین ممکن شود.

### [🟢] گام ۲: کلیدهای جدید در `contracts/config.schema.json`

افزودن `semanticEngine.dataDir` (string، default `''`) و `semanticEngine.artifactLocation` (enum `in-root|external`، **default در این فاز `in-root`**) با `description` و `default` — چون `src/host/configSchemaSync.test.ts:85-93` داشتن default، پیشوند `semanticEngine.` و `additionalProperties:false` را الزامی می‌کند. افزودن تست که `envVarNameFor` برای این دو کلید دقیقاً `SEMANTIC_ENGINE_DATA_DIR` و `SEMANTIC_ENGINE_ARTIFACT_LOCATION` می‌دهد.

### [🟢] گام ۳: ماژول `ProjectIdentity`

فایل جدید `semantic-engine/src/core/config/ProjectIdentity.ts`: `canonicalizeRoot(root)` (با `fs.realpathSync` و fallback متنی وقتی مسیر وجود ندارد)، `slugify(name)`، `projectIdFor(name, canonicalRoot)` مطابق D3 (هم‌الگوریتم با `structured-ai/agent/projects/ProjectRegistry.js:61`)، `isValidProjectId(id)` و `assertProjectId(id)`. خروجی باید برای ورودی یکسان قطعی (deterministic) باشد.

### [🟢] گام ۴: تکامل `ProjectPaths` بدون شکستن API موجود

به `semantic-engine/src/core/config/ProjectPaths.ts` افزودن: `resolveProjectPaths({ projectId, workspaceRoot, dataRoot?, outOverride? }) → ProjectPaths` (با فیلدهای `workspaceRoot, dataRoot, artifactRoot, indexPath, blueprintPath, sqlitePath, manifestPath, lockDir, logDir`) و `artifactRootFor(...)`. **بدون تغییر** در `normalizeWorkspaceRoot`، `canonicalIndexPath`، `indexPathCandidates`، `resolveProjectIndexPath`، `workspaceRootFromIndex` و exportهای `semantic-engine/src/index.ts:74-76`. اگر `artifactLocation === 'in-root'` یا `outOverride` داده شده باشد، `artifactRoot` همان مسیر فعلی می‌شود.

### [🟢] گام ۵: ثبت ADR معماری

ساخت `semantic-engine/docs/architecture/` (امروز فقط `docs/panel-archive.html` وجود دارد) و نوشتن `multi-project-gateway.md`: تصمیم‌های D1…D11، قرارداد `ProjectPaths` و `ProjectWorkerConfig`، جدول endpointهای worker/gateway، و ارجاع به Baseline بالای همین سند.

### [🟢] گام ۶: تست‌های فاز

`DataRootResolver.test.ts` (سه پلتفرم با env جعلی، override، `SEMANTIC_ENGINE_DATA_DIR`، خطای مسیر نامعتبر، mode 0700)، `ProjectIdentity.test.ts` (دو root با basename یکسان → دو id متفاوت؛ rename نام → id یکسان وقتی persist شده؛ id معتبر/نامعتبر)، `ProjectPaths.external.test.ts` (تفکیک `workspaceRoot` از `artifactRoot`، override با `--out` مطلق و نسبی).

**معیار پذیرش:**
- `npm run build && npm run lint && npm test` در `semantic-engine/` سبز باشد (Baseline ردیف ۲۱).
- `npx jest src/core/config src/host/configSchemaSync.test.ts` سبز باشد و کلیدهای جدید در schema دارای `default` باشند.
- **بدون تغییر رفتاری:** اجرای واقعی `semantic-engine index --root <tmp>` همچنان `<tmp>/.semantic-engine/project-index.json` بنویسد و این با یک تست e2e اثبات شود.
- `grep -rn "path.join(.*'\.semantic-engine'" src/` هیچ مورد جدیدی خارج از `ProjectPaths.ts` نشان ندهد.
- فایل ADR وجود داشته باشد و D1…D11 را پوشش دهد.

### وضعیت اجرای فاز ۱ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `semantic-engine/src/core/config/DataRootResolver.ts`، `ProjectIdentity.ts`، `semantic-engine/docs/architecture/multi-project-gateway.md` و تست‌های `DataRootResolver.test.ts`، `ProjectIdentity.test.ts`، `ProjectPaths.external.test.ts`، `src/cli/commands/artifactLocationDefault.test.ts`.
**فایل‌های تغییرکرده:** `ProjectPaths.ts` (فقط افزودنی)، `contracts/config.schema.json` (+۲ کلید)، `src/core/config/index.ts` و `src/index.ts` (export افزودنی).

**verification اجراشده:**

- `npm run build` → `tsc -p ./` exit 0؛ `npm run lint` → `eslint src` بدون خروجی.
- `npm test` → **`Test Suites: 174 passed / 174 total` و `Tests: 2508 passed / 2508 total`** (baseline پیش از فاز: ۱۷۰ suite و ۲۴۸۳ تست؛ یعنی +۴ suite و +۲۵ تست، بدون regression).
- `npx jest src/core/config src/host/configSchemaSync.test.ts src/cli/commands/artifactLocationDefault.test.ts` → ۸ suite و ۴۵ تست سبز.
- بدون تغییر رفتاری با اجرای واقعی `runIndex` اثبات شد: `indexPath` هنوز `<root>/.semantic-engine/project-index.json` است و data directory دست‌نخورده می‌ماند؛ `--out` مطلق هم مثل قبل کار می‌کند.
- grep gate: تنها `path.join(…, '.semantic-engine')`های کد غیرتستی، موارد از قبل موجود `defaultIgnorePatterns.ts:31` و `SourceSyncService.ts:142,194` هستند؛ مورد جدیدی خارج از `ProjectPaths.ts` اضافه نشده.

**دو پالایش نسبت به متن گام‌ها (طبق قانون ۱۲ ثبت می‌شود):**

1. `resolveDataRoot` عمداً **بدون I/O** است و ساخت directory با `ensureDataRoot` (mode `0700` + بررسی نوشتن‌پذیری) انجام می‌شود؛ تزریق `env`/`platform`/`homeDir` هر سه پلتفرم را روی هر ماشینی تست‌پذیر می‌کند.
2. `semanticEngine.dataDir` در schema به‌جای `''` از `["string","null"]` با `default: null` استفاده می‌کند تا با `semanticEngine.treeSitter.grammarDir` هم‌سبک باشد؛ رشتهٔ خالی در `resolveDataRoot` هم «مقدار نبودن» حساب می‌شود.

---

## [🟢] فاز ۲: ProjectRegistry، شناسهٔ پایدار و رفع collision موجود

**هدف:** registry دائمی پروژه‌ها در data root و حذف باگ واقعیِ id مشتق از basename. معادل گام ۲ پلن مرجع + کار اصلاحی که بازبینی کد الزامی کرد.

### [🟢] گام ۱: پیاده‌سازی `ProjectRegistry`

فایل جدید `semantic-engine/src/core/config/ProjectRegistry.ts`: بارگذاری/ذخیرهٔ `<dataRoot>/registry.json` (`{version:1, projects:[…]}`) با نوشتن atomic (tmp + rename) و بازیابی از فایل نیمه‌خراب (backup + شروع تمیز، بدون crash). متدها: `register`, `get`, `getByRoot`, `list`, `rename`, `relocate`, `remove`, `touch`.

### [🟢] گام ۲: قواعد identity و یکتایی

در `register`: (۱) canonicalize با `ProjectIdentity`، (۲) بررسی وجود و directory بودن root، (۳) اعمال سیاست symlink (مسیر canonical ذخیره می‌شود)، (۴) **root تکراری → بازگرداندن رکورد موجود** (نه ساخت جدید)، (۵) پذیرش id خارجی معتبر مطابق D3 و در غیر این صورت تولید با `projectIdFor`، (۶) ساخت `<artifactRoot>/manifest.json` با `{projectId,name,rootPath,createdAt,lastSeenAt}`. `rename` هرگز id را تغییر ندهد؛ `relocate` فقط با عملیات صریح و با به‌روزرسانی canonicalRoot.

### [🟢] گام ۳: واگذاری `ProjectService` به registry و رفع overwrite

تغییر `semantic-engine/src/services/ProjectService.ts:49-52` تا id از registry/`ProjectIdentity` بیاید و `prj-${basename}` حذف شود؛ رفع تداخل `this.projects.set(id, managed)` (خط ۱۷۴) با dedupe بر پایهٔ canonicalRoot. **حفظ** signature فعلی `registerProject(projectPath, customId?, customName?)` و شکل پاسخ `projectRoutes.ts:12-52` تا UI و تست‌های فعلی نشکنند.

### [🟢] گام ۴: تست‌های رگرسیون collision

`ProjectRegistry.test.ts` + تست سناریوی بازبینی: `/tmp/…/client-a/app` و `/tmp/…/client-b/app` → دو رکورد با دو id متفاوت و `listProjects().length === 2`؛ ثبت مجدد همان root → همان id و بدون رکورد جدید؛ rename → id ثابت؛ registry خراب → بازیابی بدون crash.

**معیار پذیرش:**
- تست دو پروژهٔ هم‌نام سبز باشد و `GET /api/v1/projects` هر دو را برگرداند (تست روی `HttpServer` واقعی).
- ثبت root تکراری پروژهٔ جدید نسازد؛ تغییر نام، projectId را تغییر ندهد.
- `npm run build && npm test` سبز؛ به‌ویژه `npx jest src/services src/server src/core/config` بدون شکست.
- هیچ فایل جدیدی در source root ساخته نشود (registry فقط در data root).

### وضعیت اجرای فاز ۲ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `semantic-engine/src/core/config/ProjectRegistry.ts` + تست‌های `ProjectRegistry.test.ts`، `src/services/ProjectService.test.ts` (این سرویس تا امروز تست نداشت) و `src/server/projectRegistryRoutes.test.ts`.
**فایل‌های تغییرکرده:** `ProjectService.ts` (کلید map از id به ریشهٔ canonical + `byId` برای aliasها + فیلد `aliases`)، `ProjectIdentity.ts` (+`isSafeProjectId`/`isPathSafeProjectId`/`assertPathSafeProjectId`)، `ProjectPaths.ts` (استفاده از اعتبارسنج path-safe)، `server/types.ts` (+`PlatformConfig.dataRoot`)، `HttpServer.ts` (تزریق registry)، `LodService.test.ts` (فیلد جدید)، barrelها، ADR.

**verification اجراشده:**

- `npm run build` exit 0 و `npm run lint` بدون خروجی.
- `npm test` → **`Test Suites: 177 passed / 177 total` و `Tests: 2528 passed / 2528 total`** (پیش از فاز ۲: ۱۷۴ suite و ۲۵۰۸ تست؛ یعنی +۳ suite و +۲۰ تست، بدون regression).
- رگرسیون اصلی با اجرای واقعی اثبات شد: دو root با basename یکسان → دو id متفاوت و `listProjects().length === 2` (هم در `ProjectService` و هم از طریق `POST/GET /api/v1/projects` روی `HttpServer` واقعی).
- ثبت مجدد همان root → همان id و بدون رکورد جدید؛ `rename` → id ثابت؛ `relocate` به root ثبت‌شده → خطا؛ registry خراب → قرنطینه به `registry.json.corrupt-<ts>` و ادامهٔ کار.
- هیچ فایلی داخل source root ساخته نشد: تست‌ها `fs.readdirSync(root)` را با `['src']` مقایسه می‌کنند و `registry.json`/`manifest.json` فقط زیر data root هستند.

**تغییرات رفتاری عمدی و ثبت‌شده (قانون ۵):**

1. `listProjects()` دیگر برای یک workspace سه ردیف alias برنمی‌گرداند؛ هر پروژه یک بار ظاهر می‌شود و همهٔ aliasها (`current`، `prj-<basename>`، `<basename>`) همچنان در `getProject` resolve می‌شوند.
2. شناسهٔ صریحی که نویسهٔ بی‌خطر ندارد (مثلاً `../escape`) به‌جای id، alias/رد می‌شود و id تولیدشده به‌کار می‌رود.
3. `ProjectService` در شروع اجرا خودش را از registry پر نمی‌کند (پروسهٔ تازه خالی شروع می‌کند و ثبت مجدد همان id پایدار را برمی‌گرداند)؛ hydrate کردن وظیفهٔ Gateway در فاز ۹ است.

---

## [🟢] فاز ۳: انتقال artifact به data directory (بدون تغییر پیش‌فرض)

**هدف:** همهٔ مسیرهای نوشتن/خواندن از `resolveProjectPaths` بیایند، artifactهای ثانویه هم منتقل شوند، و migration از legacy با حفظ داده پیاده شود. **پیش‌فرض در پایان این فاز هنوز `in-root` است** تا فاز ۴ بتواند flip را هماهنگ انجام دهد. معادل گام ۱ (wiring) و گام ۳ پلن مرجع.

### [🟢] گام ۱: مسیر نوشتن در pipeline

`IndexPipeline`/`OutputWriter` (`src/pipeline/OutputWriter.ts:21-32` با `outputDir`) و `src/cli/commands/index-command.ts:34-37`: `outputDir` از `resolveProjectPaths`؛ `--out` صریح (مطلق یا نسبی) به‌عنوان override محفوظ بماند (D10)؛ `project-artifacts.manifest.json` در همان `artifactRoot` نوشته شود.

### [🟢] گام ۲: watch/serve/start

`WatchPipeline` (`src/pipeline/WatchPipeline.ts:48-52`) و `serve-command.ts:176-182` و `:258-262` (که امروز `--out path.dirname(indexPath)` را به `watch` پاس می‌دهند) از همان resolver استفاده کنند تا مسیر watch و write هرگز واگرا نشوند.

### [🟢] گام ۳: artifactهای ثانویه

انتقال `JobManager` state file (`src/server/HttpServer.ts:92` → `<artifactRoot>/jobs.json`) و telemetry spans (`:182` → `<artifactRoot>/telemetry/spans.json`) و لاگ workerها به `<artifactRoot>/logs/`؛ ساخت `locks/`, `events/`, `snapshots/` زیر `artifactRoot`. علت: بدون این‌ها معیار «root پروژه dirty نشود» برآورده نمی‌شود (Baseline #13).

### [🟢] گام ۴: migration از legacy (کپی، بدون حذف)

خواندن با همان `indexPathCandidates()` موجود؛ اگر مسیر جدید نبود: یافتن artifact معتبر legacy → کپی به `artifactRoot` → ساخت manifest با `{migratedFrom, migratedAt, migrationMode: "copy-readonly-legacy"}` → **حذف نکردن** legacy → نوشتن‌های بعدی فقط در مسیر جدید. artifact خراب/ناتمام → وضعیت `stale` یا `missing` و ادامهٔ کار بدون crash.

### [🟢] گام ۵: SQLite و مرز دسترسی

`QueryIndexTool`/`queryPolicy` (`allowedRoot`) روی `artifactRoot` جدید تنظیم شوند؛ `validateDatabasePath` همچنان path escape را رد کند (تست). `semantic-engine serve/query/watch` همه از یک `artifactRoot` استفاده کنند.

### [🟢] گام ۶: به‌روزرسانی ۱۸ فایل تست وابسته

فهرست دقیق (از `grep -rl`):
`src/ai/AiToolCommandHandler.phase45.test.ts`, `src/ai/tools/queryPolicy.test.ts`, `src/cli/cli.test.ts`, `src/cli/commands/readyBeforeSignal.phase49.test.ts`, `src/cli/serve-watch.test.ts`, `src/core/config/ProjectPaths.test.ts`, `src/core/config/defaultIgnorePatterns.test.ts`, `src/export/JsonExporter.phase24.test.ts`, `src/host/FileWatcher.test.ts`, `src/incremental/IncrementalCost.phase26.test.ts`, `src/incremental/IncrementalEngine.phase25.test.ts`, `src/lsp/DiagnosticsProvider.integration.test.ts`, `src/lsp/LspEnrichmentService.integration.test.ts`, `src/pipeline/IndexPipeline.diagnostics.test.ts`, `src/pipeline/IndexPipeline.test.ts`, `src/pipeline/OutputWriter.test.ts`, `src/pipeline/WatchPipeline.test.ts`, `src/server/requestPathBlocking.test.ts`.
هرکجا تست به «محل پیش‌فرض artifact» تکیه دارد، `SEMANTIC_ENGINE_DATA_DIR` روی tmpdir ست شود؛ تست‌هایی که صریحاً `--out` می‌دهند بدون تغییر بمانند.

### [🟢] گام ۷: gate جلوگیری از بازگشت

اسکریپت جدید `semantic-engine/scripts/check-artifact-location.js` (و افزودنش به `npm run test:gate`) که بررسی کند هیچ `path.join(<root>, '.semantic-engine')` جدیدی خارج از `ProjectPaths.ts` و کد migration نوشته نشده، و اتصال آن به `scripts/check-tests.js` موجود.

**معیار پذیرش:**
- با `SEMANTIC_ENGINE_ARTIFACT_LOCATION=external`، اجرای **واقعی** `semantic-engine index --root <tmp>` هیچ فایل/دایرکتوری جدیدی در `<tmp>` نسازد و `project-index.json`، `blueprint.json` و `project-artifacts.manifest.json` زیر `<dataRoot>/projects/<projectId>/` باشند (تست e2e با CLI واقعی).
- با پیش‌فرض `in-root`، خروجی بایت‌به‌بایت مثل قبل باشد (تست snapshot موجود سبز بماند).
- migration از هر سه مسیر legacy با تست پوشش داده شود؛ فایل legacy پس از migration هنوز وجود داشته باشد.
- `<root>/.agent/jobs.json` و `<root>/.agent/telemetry/` دیگر ساخته نشوند (تست).
- `npm run build && npm run lint && npm test` سبز (baseline تأییدشده: ۱۷۰ suite و ۲۴۸۳ تست سبز) و `npm run test:gate` سبز.

### وضعیت اجرای فاز ۳ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/core/config/migrateLegacyArtifacts.ts`، `src/cli/projectPathsFromArgs.ts`، `scripts/check-artifact-location.js` + تست‌های `migrateLegacyArtifacts.test.ts` (۹)، `cli/commands/artifactLocationExternal.test.ts` (۴)، `cli/projectPathsFromArgs.test.ts` (۸)، `server/runtimeArtifacts.test.ts` (۲)، `ai/tools/queryIndexArtifactRoot.test.ts` (۳).
**فایل‌های تغییرکرده:** `ProjectPaths.ts` (+`RUNTIME_DIR`، +`IndexLookupOptions` روی `indexPathCandidates`/`resolveProjectIndexPath`)، `index-command.ts`، `watch-command.ts`، `serve-command.ts`، `query-command.ts`، `ai/mcp/cli.ts`، `HttpServer.ts` (state پروسه به `<dataRoot>/runtime/`)، `server/types.ts` (+`artifactLocation`)، `ProjectService.ts` (مقصد نوشتن/خواندن در حالت external + پاس دادن `artifactRoot`)، `ai/AiToolRegistry.ts` (+`artifactRoot`)، `package.json` (`test:gate`).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → fixture ساخته شد، **`Test Suites: 182 passed / 182 total` و `Tests: 2554 passed / 2554 total`**، «all suites ran» و «artifact location gate: ok» (baseline پیش از فاز ۳: ۱۷۷ suite و ۲۵۲۸ تست → +۵ suite و +۲۶ تست).
- **حالت external با CLI واقعی:** `runIndex` با `SEMANTIC_ENGINE_ARTIFACT_LOCATION=external` و `SEMANTIC_ENGINE_DATA_DIR` → `project-index.json`، `blueprint.json` و `project-artifacts.manifest.json` زیر `<dataRoot>/projects/<projectId>/` و `fs.readdirSync(root) === ['src']` (یعنی هیچ چیزی داخل checkout ساخته نشد).
- **بدون تغییر پیش‌فرض:** تست فاز ۱ هنوز سبز است — `index --root <tmp>` همان `<tmp>/.semantic-engine/…` را می‌نویسد و `--out` مطلق مثل قبل کار می‌کند.
- **migration:** از هر سه مسیر legacy (`.semantic-engine`، `.agent/semantic`، `semantic`) کپی انجام شد، `migration.json` با `migrationMode: copy-readonly-legacy` نوشته شد، و فایل‌های legacy پس از migration هنوز موجود بودند؛ ایندکس خراب → `corrupt-legacy` بدون throw.
- **artifactهای ثانویه:** پس از `start()`/`stop()` روی `HttpServer` واقعی، `<dataRoot>/runtime/telemetry/spans.json` ساخته می‌شود و `<projectsRoot>/.agent` هرگز ساخته نمی‌شود.
- **SQLite:** `query_index` با `allowedRoot` برابر artifactRoot، مسیر نسبی را قبول و مسیر بیرون‌زده (`../../../../etc/passwd.sqlite` و مسیر مطلق بیرونی) را با خطای policy رد می‌کند.

**نکتهٔ صادقانه دربارهٔ گام ۶:** هیچ‌کدام از آن ۱۸ فایل تست نیازی به تغییر نداشتند، چون پیش‌فرض `in-root` دست‌نخورده ماند و آن تست‌ها یا `--out`/`outputPath` صریح می‌دهند یا به همان پیش‌فرض تکیه دارند. فهرست به‌عنوان ثبت ریسک معتبر می‌ماند و در فاز ۴ (که پیش‌فرض عوض می‌شود) دوباره بررسی می‌شود.

**سه تصمیم اجرایی که در ADR ثبت شد:**

1. state سطح پروسه (jobs/telemetry) زیر `<dataRoot>/runtime/` می‌رود نه زیر `projects/<id>/`، چون به یک پروژهٔ خاص وابسته نیست؛ وقتی `dataRoot` داده نشود اصلاً persist نمی‌شود (رفتار درست برای تست‌ها).
2. `AiToolRegistry` حالا `artifactRoot` صریح می‌گیرد؛ تا پیش از این، مسیر SQLite از `resolveProjectIndexPath(workspaceRoot)` حدس زده می‌شد که در حالت external به فایل ناموجود می‌رسید.
3. gate فقط نام دقیق پوشهٔ artifact را می‌گیرد، نه هر رشته‌ای که با آن شروع شود — تا فایل موقت `.semantic-engine-doctor-<pid>` در `doctor-command.ts:104` (که پاک هم می‌شود) گیر نیفتد.

---

## [🟢] فاز ۴: فعال‌سازی پیش‌فرض `external` و هماهنگ‌سازی مصرف‌کننده‌ها

**هدف:** flip پیش‌فرض به data directory **هم‌زمان** با به‌روزرسانی هر مصرف‌کننده‌ای که مسیر را حدس می‌زند (به‌ویژه structured-ai) و اصلاح استقرار. بدون این فاز، فاز ۳ باعث شکستن یکپارچگی ship‌شده می‌شود (Baseline #10).

### [🟢] گام ۱: تغییر پیش‌فرض

`semanticEngine.artifactLocation` در `contracts/config.schema.json` و لایهٔ default در `src/host/Config.ts` → `external`. `in-root` به‌عنوان حالت پشتیبانی‌شده باقی بماند (D10).

### [🟢] گام ۲: resolver مشترک در structured-ai

تغییر `structured-ai/agent/mcp/semantic.js:340-352` تا مسیر ایندکس را اول از data dir (همان قواعد D1 + `SEMANTIC_ENGINE_DATA_DIR`) و بعد از legacyها بخواند؛ حفظ `normalizeWorkspaceRoot` فعلی (خط ۹۴-۱۱۴) و افزودن تست در `structured-ai/test/mcp/semantic.test.js` برای هر دو حالت.

### [🟢] گام ۳: به‌روزرسانی قراردادها و مستندات مسیر

`semantic-engine/INTEGRATION-STRUCTURED-AI.md:112,190` (INT-02) به قرارداد جدید تغییر کند و نسخهٔ قرارداد افزایش یابد؛ `semantic-engine/README.md:150-154,685` و `semantic-engine/HANDOFF.md:60,92` با مسیر جدید و override به‌روز شوند.

### [🟢] گام ۴: استقرار

`structured-ai/docker-compose.yml`: افزودن `SEMANTIC_ENGINE_DATA_DIR=/data`، mount یک named volume (`engine-data:/data`) و حفظ `read_only: true`؛ اطمینان از اینکه `command` فعلی (`ui --root /workspace …`) با data dir جدید کار می‌کند. به‌روزرسانی `semantic-engine/Dockerfile` اگر `ENV` لازم شد.

### [🟢] گام ۵: doctor

`semantic-engine/src/cli/commands/doctor-command.ts`: گزارش مسیر data root، نوشتن‌پذیری آن، وضعیت هر پروژه (`fresh|stale|missing|migrated`) و تشخیص legacy باقیمانده. خروجی `--json` هم داشته باشد.

**معیار پذیرش:**
- `cd semantic-engine && npm run build && npm test` و `cd structured-ai && npm run check && npm test` و `npm run test:semantic` سبز باشند.
- اجرای واقعی CLI روی یک پروژهٔ تازه هیچ artifactی در source root نسازد و structured-ai همان ایندکس را پیدا کند (تست یکپارچگی با fixture مشترک).
- پروژه‌ای که artifact legacy در root دارد، پس از یک اجرا migrate شود و legacy پاک نشود.
- `docker compose config` معتبر باشد و `SEMANTIC_ENGINE_DATA_DIR` روی volume نگاشت شود. (Unknown / Requires Verification: اجرای واقعی `docker compose up` در این محیط ممکن نیست؛ بررسی با `docker compose config` و تست نوشتن روی volume شبیه‌سازی‌شده انجام می‌شود.)
- `semantic-engine doctor --json` مسیر data root و وضعیت migration را برگرداند.

### وضعیت اجرای فاز ۴ — 🟢 (۲۰۲۶-۰۸-۲۶)

**semantic-engine:** `DataRootResolver.ts` (پیش‌فرض `external`)، `contracts/config.schema.json` (default `external`)، `doctor-command.ts` (+`data-root` و +`artifacts`)، `main.ts` (help: `--project-id`، `--data-dir`، `--artifact-location` و بلوک «artifact location»)، `README.md`، `HANDOFF.md`، `INTEGRATION-STRUCTURED-AI.md` (§۲.۶ و INT-02 → v2)، `Dockerfile`، `jest.config.js` + `src/test/globalSetupDataDir.ts` + `src/test/setupDataDir.ts`، تست جدید `doctorDataRoot.test.ts` (۵) و `structuredAiContract.test.ts` (۴). تست‌های به‌روزشده: `cli.test.ts` (MIG-51)، `serve-watch.test.ts` (MIG-52)، `readyBeforeSignal.phase49.test.ts`، `artifactLocationDefault.test.ts`، `DataRootResolver.test.ts`، `ProjectPaths.external.test.ts`، `projectPathsFromArgs.test.ts`.
**structured-ai:** `agent/mcp/enginePaths.js` (جدید)، `agent/mcp/semantic.js` (استفاده از آن)، `agent/config/SettingsSchema.js` (+`SEMANTIC_ENGINE_DATA_DIR`)، `test/mcp/engine-paths.test.js` (جدید، ۶ تست) و `package.json` (`test:semantic` و `test`).
**استقرار:** `docker-compose.yml` (+`SEMANTIC_ENGINE_DATA_DIR=/data` و named volume `engine-data:/data`) و `Dockerfile` (`ENV SEMANTIC_ENGINE_DATA_DIR=/data` + `mkdir/chown` پیش از `USER node`).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 184 passed / 184 total`، `Tests: 2566 passed / 2566 total`، «all suites ran» و «artifact location gate: ok»** (baseline فاز ۳: ۱۸۲ suite و ۲۵۵۴ تست).
- `cd structured-ai && npm run check && npm test` → exit 0 و **صفر** خط `FAIL` در کل زنجیره (شامل `test/mcp/engine-paths.test.js`: ۶/۶).
- **یکپارچگی واقعی دوطرفه (نه mock):** اجرای `node bin/semantic-engine.js index --root /tmp/e2e-proj --no-git` با `SEMANTIC_ENGINE_DATA_DIR=/tmp/e2e-data` → artifactها در `/tmp/e2e-data/projects/prj-e2e-proj-a7409ac7/` و `ls /tmp/e2e-proj` فقط `src`؛ سپس از سمت structured-ai: `engineProjectIdFor` همان `prj-e2e-proj-a7409ac7` را داد و `checkStaleness` همان فایل را با `state: "fresh"`، `file_count: 1`، `symbol_count: 1` پیدا کرد.
- `docker-compose.yml` با پارسر YAML اعتبارسنجی شد (env، هر دو volume و بخش top-level `volumes:`). **Unknown / Requires Verification:** `docker compose up` در این محیط ممکن نیست (docker نصب نیست).
- `semantic-engine doctor --json` در تست، `data-root` (مسیر + ساخت پوشه) و `artifacts` (وضعیت `external`، ایندکس موجود، یا legacy در انتظار کپی) را برمی‌گرداند؛ `--data-dir` صریح هم رعایت می‌شود.

**دو یافتهٔ مهم حین اجرا (هر دو ثبت و رفع شدند):**

1. **آمار فاز ۳ ناقص بود.** `cli.test.ts` و `serve-watch.test.ts` داخل `describeIfBuilt` هستند و بدون `dist/` بی‌صدا skip می‌شوند؛ عدد «۱۸۲ suite / ۲۵۵۴ تست» که برای فاز ۳ گزارش شد بدون build اندازه‌گیری شده بود. با build، دو تست واقعاً شکستند (MIG-51 «خروجی پیش‌فرض داخل ریشه است» و MIG-52 پذیرش watch) و هر دو برای پیش‌فرض جدید به‌روز شدند. آمار معتبر فاز ۴ همان ۱۸۴/۲۵۶۶ با build است.
2. **`process.env` در sandbox جست یک کپی است.** نگهبان `setupFiles` مقدار را درون تست ست می‌کرد ولی به پروسه‌های CLI که تست‌ها spawn می‌کنند نمی‌رسید؛ اندازه‌گیری: `PROBE in-process=/tmp/se-jest-data-PolunM child=(unset)`. نتیجه اینکه `doctor`/`ui`/`watch` واقعاً در `~/.local/share/semantic-engine` می‌نوشتند (۲۰۹ کیلوبایت manifest در خانهٔ کاربر پیدا و پاک شد). رفع: `globalSetup` در کنار `setupFiles`؛ بعد از آن اجرای کامل suite هیچ چیزی در data directory واقعی نمی‌سازد (بررسی شد).

---

## [🟢] فاز ۵: WorkerConfig schema، validation، نگاشت argv و flagهای embedding

**هدف:** یک schema type-safe برای پیکربندی Worker که هم CLI و هم UI از آن تغذیه شوند، و پر کردن شکاف واقعیِ نبودِ flagهای embedding (Baseline #18). معادل گام ۴ پلن مرجع + بخشی از گام ۱۲.

### [🟢] گام ۱: تایپ‌ها و schema

`semantic-engine/src/gateway/types.ts` و `src/gateway/WorkerConfigSchema.ts`: `ProjectWorkerConfig` مطابق §۴ پلن مرجع (پروژه، `indexing{vectors,sqlite,blueprint,git,treeSitter}`، `watchOptions{debounceMs,blueprintMode}`، transport، security، embedding) به‌علاوهٔ JSON Schema معادل برای validation سمت سرور. `--json/--help/--version` عمداً بخشی از config **نیستند**.

### [🟢] گام ۲: validation

root وجود داشته باشد و directory باشد؛ canonical شود؛ پروژهٔ تکراری تشخیص داده شود؛ `dataDir` داخل `workspaceRoot` نباشد مگر override صریح؛ `debounceMs` در بازهٔ امن؛ portها یا توسط Gateway رزرو شوند یا آزاد باشند؛ **token هرگز در manifest/registry/لاگ به‌صورت plain text ذخیره نشود** (فقط env/secret reference).

### [🟢] گام ۳: نگاشت config → argv (بدون shell)

`src/gateway/workerArgv.ts`: تولید argv قطعی و white-list شده از config معتبر؛ هیچ shell string اجرا نشود؛ `commandPreview` فقط برای نمایش UI از همان تابع تولید شود.

### [🟢] گام ۴: flagهای جدید CLI

افزودن به `src/cli/args.ts`/`main.ts` و سیم‌کشی در `index-command.ts` و `watch-command.ts`: `--project-id`, `--data-dir`, `--socket`, `--gateway-managed` و embedding: `--embedding-provider <local|ollama|openai-compatible>`, `--embedding-model`, `--embedding-base-url`, `--embedding-api-key-env`, `--embedding-normalize/--no-embedding-normalize`. انتخاب provider باید از همان منطق `src/server/routes/jobRoutes.ts:60-80` بازاستفاده کند (`HashingEmbeddingGenerator` برای `local`، `RemoteEmbeddingGenerator` در غیر این صورت) تا دو مسیر واگرا نشوند؛ API key فقط از env خوانده شود. HELP در `main.ts` به‌روز شود.

### [🟢] گام ۵: تست‌ها

`WorkerConfigSchema.test.ts` (هر قاعدهٔ validation با یک تست)، `workerArgv.test.ts` (پایداری/قطعی بودن argv، نبود shell metachar، رد شدن option ناشناخته)، `embeddingFlags.test.ts` (انتخاب provider بدون network؛ نبود API key → خطای واضح؛ `normalize` روی `RemoteEmbeddingGenerator` اعمال شود).

**معیار پذیرش:**
- هر گزینهٔ عملیاتی جدول گام ۴ پلن مرجع معادل config + argv + (بعداً) فیلد UI داشته باشد و این نگاشت با یک تست جدول‌محور پوشش داده شود.
- `semantic-engine index --help` و `worker --help` (پس از فاز ۷) flagهای جدید را نشان دهند.
- مقدار نامعتبر **قبل از** start worker با پیام واضح رد شود (تست).
- `npm run build && npm run lint && npm test` سبز؛ هیچ secret در خروجی `--json` ظاهر نشود (تست redaction).

### وضعیت اجرای فاز ۵ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/gateway/types.ts`، `src/gateway/WorkerConfigSchema.ts`، `src/gateway/workerArgv.ts`، `src/vector/createEmbeddingGenerator.ts`، `src/cli/embeddingFromArgs.ts` + تست‌های `WorkerConfigSchema.test.ts` (۱۷)، `workerArgv.test.ts` (۲۸ از جمله تست جدول‌محور نگاشت)، `embeddingFlags.test.ts` (۸).
**فایل‌های تغییرکرده:** `server/routes/jobRoutes.ts` (واگذاری انتخاب provider به کارخانهٔ مشترک)، `cli/commands/index-command.ts` و `watch-command.ts` (سیم‌کشی embedding)، `cli/main.ts` (help: بلوک `embedding` و flagهای جدید در هر دو بخش index/watch).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 187 passed / 187 total`، `Tests: 2619 passed / 2619 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۵: ۱۸۴ suite و ۲۵۶۶ تست → +۳ suite و +۵۳ تست).
- تست جدول‌محور نگاشت: ۲۲ ردیف (۲۲ تست `it.each` از ۲۸ تست آن suite)، هر گزینهٔ عملیاتی جدول گام ۴ پلن مرجع (`--root`، `--project-id`، `--data-dir`، `--out`، `--vectors/--no-vectors`، `--sqlite`، `--no-blueprint`، `--no-git`، `--no-tree-sitter`، `--pretty`، `--no-watch`، `--debounce`، `--blueprint-mode`، `--skip-initial-index`، `--host`، `--port/--ui-port/--mcp-port`، `--socket`، `--http/--stdio/--web`، `--gateway-managed`، `--allow-remote`، `--embedding-*`) با معادل config+argv بررسی شد؛ `--json/--help/--version` هرگز در argv نمی‌آیند.
- `node bin/semantic-engine.js --help` هر دو بخش index و watch را با flagهای جدید نشان می‌دهد (بررسی واقعی).
- اجرای واقعی CLI: `index --root /tmp/p5-proj --embedding-provider local` → `indexed 1 files, 2 symbols` و `vectorChunks: 2` در ایندکس (یعنی provider صریح بدون `--vectors` هم vector می‌سازد)؛ `--embedding-provider cohere` → exit 1 با پیام `--embedding-provider must be one of: local, ollama, openai-compatible`؛ `--embedding-api-key-env NOPE_NOT_SET` → exit 1 با پیام «متغیر خالی یا ست‌نشده».
- تست redaction: اجرای واقعی `runIndex` با provider راه دور و کلید `sk-secret-do-not-leak-123` در محیط → هیچ‌جای خروجی/خطا/stack اثری از کلید نیست (و خودِ شکست ثابت می‌کند مسیر CLI واقعاً به `RemoteEmbeddingGenerator` رسیده است).

**سه تصمیم اجرایی (ثبت‌شده در ADR بخش ۷):**

1. توکن worker اصلاً وارد argv نمی‌شود — حتی نام متغیرش؛ supervisor آن را در محیط پروسهٔ فرزند ست می‌کند (فاز ۶). `--embedding-api-key-env` فقط *نام* متغیر را می‌برد.
2. `--embedding-provider` صریح یعنی `--vectors` روشن (مگر `--no-vectors` صریح)، وگرنه یک provider تنظیم‌شده بی‌اثر می‌ماند.
3. انتخاب provider از `jobRoutes` به `vector/createEmbeddingGenerator` منتقل شد تا مسیر HTTP و CLI واگرا نشوند؛ `jobRoutes` حالا همان کارخانه را صدا می‌زند.

---

## [🟢] فاز ۶: قرارداد transport و hardening امنیتی Worker

**هدف:** رفع دو مانع واقعی که در بازبینی با اجرای کد اثبات شد (Baseline #5 و #6) و تبدیل worker به یک سرویس تک‌پروژهٔ خصوصی. معادل گام ۱۰ پلن مرجع، منتها **پیش از** Gateway چون Gateway بدون آن کار نمی‌کند.

### [🟢] گام ۱: حالت `--gateway-managed`

وقتی worker با این flag بالا می‌آید: توکن داخلی اجباری است؛ bind فقط روی loopback یا Unix socket مجاز است؛ روت‌های registry (`POST /api/v1/projects` در `projectRoutes.ts:32`) با ۴۰۳ بسته می‌شوند؛ هر `rootPath`/`path` ورودی از request که با `workspaceRoot` ثبت‌شده متفاوت باشد رد می‌شود.

### [🟢] گام ۲: رفع `checkConnection` برای transport داخلی

تغییر `src/server/SecurityPipeline.ts:89-105` تا اتصال از Unix socket (`remoteAddress === undefined` در حالی که سرور روی socket path گوش می‌دهد) به‌عنوان local شناخته شود — **فقط** وقتی همان request توکن داخلی معتبر داشته باشد. رفتار TCP loopback/non-loopback دقیقاً مثل امروز بماند (تست رگرسیون).

### [🟢] گام ۳: سیاست Origin پشت Gateway (D6)

افزودن گزینهٔ صریح `trustedGateway` به `SecurityPipeline` (`:165-193`) و `HttpGuard` (`:120-124`): در این حالت Origin قضاوت نمی‌شود ولی توکن داخلی اجباری است و نبودِ `X-Forwarded-*` نشانهٔ درخواست مستقیم است → رد. قرارداد Gateway: حذف `Origin` ورودی و افزودن `X-Forwarded-For/Proto/Host`.

### [🟢] گام ۴: محدودسازی `fs/browse`

`src/server/routes/fsRoutes.ts:61-122`: هر `path` باید پس از `realpath` داخل subtree همان `workspaceRoot` باشد؛ در غیر این صورت ۴۰۳. (امروز هر مسیر دلخواه قابل لیست است.)

### [🟢] گام ۵: تست‌های دائمی امنیتی

`src/server/gatewayManagedSecurity.test.ts` — همان سناریوهایی که در بازبینی دستی اجرا شد، این‌بار به‌عنوان تست ماندگار:
- درخواست از Unix socket **بدون** توکن → رد؛
- همان درخواست **با** توکن داخلی → پذیرفته؛
- `Origin: https://example.test` بدون توکن → ۴۰۳؛
- `POST /api/v1/projects` در حالت gateway-managed → ۴۰۳؛
- `GET /api/v1/fs/browse?path=/etc` → ۴۰۳؛
- حالت standalone (بدون flag) هیچ تغییری نکرده باشد.

**معیار پذیرش:**
- همهٔ تست‌های گام ۵ سبز باشند و `npx jest src/server src/cli` بدون شکست باشد.
- جدول endpointهای worker در ADR به‌روز شود: کدام endpoint در حالت gateway-managed فعال/غیرفعال است.
- هیچ مسیری باقی نماند که بدون توکن داخلی، دادهٔ پروژه را در حالت gateway-managed برگرداند (بررسی با یک تست enumerate روی روت‌های ثبت‌شده).
- `npm run build && npm test` سبز.

### وضعیت اجرای فاز ۶ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های تغییرکرده:** `server/types.ts` (+`gatewayManaged`، +`trustedGateway`، +`socketPath`)، `server/SecurityPipeline.ts` (اتصال socket + `isTrustedGateway` + `gatewayManaged`)، `server/HttpServer.ts` (listen روی Unix socket، بستن روت‌های مدیریتی، احراز هویت اجباری در حالت managed، رد `path` بیگانه در بدنه، `confineToRoot` برای fs) و `server/routes/fsRoutes.ts` (+`FsRoutesOptions.confineToRoot` با بررسی پس از `realpath`).
**فایل تست جدید:** `server/gatewayManagedSecurity.test.ts` (۱۳ تست).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 188 passed / 188 total`، `Tests: 2632 passed / 2632 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۶: ۱۸۷ suite و ۲۶۱۹ تست → +۱ suite و +۱۳ تست).
- هر شش سناریوی گام ۵ با سرور واقعی و روی **Unix socket واقعی** سنجیده شد: socket بدون توکن → ۴۰۱؛ socket با توکن → ۲۰۰؛ `POST /api/v1/projects` → ۴۰۳؛ `fs/browse?path=/etc` → ۴۰۳ (و symlink به `/etc` هم پس از `realpath` → ۴۰۳)؛ `Origin` عمومی بدون `X-Forwarded-*` → ۴۰۳؛ و حالت standalone بدون تغییر (`/health` باز، `fs/browse` آزاد، `POST /api/v1/projects` → ۲۰۱).
- «هیچ مسیر بدون توکن باقی نمانده» با enumerate روی پنج روت `requireAuth: false` سنجیده شد (`/health`، `/ready`، `/metrics`، `/api/v1/roles`، `POST /api/v1/auth/verify`) → همه ۴۰۱ در حالت managed و ۲۰۰ با توکن.
- تست رگرسیون TCP: `127.0.0.1` و `::1` پذیرفته و `203.0.113.9` با ۴۰۳ رد می‌شود، دقیقاً مثل قبل.

**دو نکتهٔ اجرایی (ثبت‌شده در ADR، جدول «Worker profiles»):**

1. `fs/browse` فقط در حالت managed محدود شد؛ در حالت standalone عمداً آزاد ماند چون انتخابگر «باز کردن پروژه» در `public/open.js` بیرون از root را مرور می‌کند و محدودکردنش آن جریان را می‌شکست.
2. اتصال socket تنها وقتی local حساب می‌شود که سرور واقعاً روی `socketPath` گوش بدهد؛ و در حالت managed حتی `/health` بدون توکن داخلی جواب نمی‌گیرد.

---

## [🟢] فاز ۷: دستور `worker`، endpointهای داخلی و `indexGeneration`

**هدف:** worker به‌عنوان یک پروسهٔ مستقل با کنترل lifecycle، و پر کردن شکاف واقعی `indexGeneration`/`projectId` در نتایج MCP (Baseline #8 و #9). معادل گام ۵ و ۶ پلن مرجع.

### [🟢] گام ۱: `semantic-engine worker`

`src/cli/commands/worker-command.ts` + ثبت در `COMMANDS` (`src/cli/main.ts`): `--project-id --root --data-dir --socket | --port --ui-port --mcp-port --token --gateway-managed` + همهٔ flagهای فاز ۵. worker باید بتواند **بدون Gateway** هم standalone اجرا شود.

### [🟢] گام ۲: endpointهای داخلی

`GET /internal/health`, `GET /internal/ready`, `GET /internal/metrics`, `GET /internal/status`, `POST /internal/reindex`, `POST /internal/reload`, `POST /internal/shutdown` با شکل پاسخ §گام ۶ پلن مرجع (`projectId, pid, state, indexState, watcher, files, symbols, dependencies, vectorChunks, sqlite, blueprint, memoryMb, queueSize, lastIndexedAt`). readiness تا load شدن index باید `503` بدهد. نگاشت این‌ها با `/health`, `/ready`, `/metrics` موجود (`src/server/routes/systemRoutes.ts:52,67,83`) در ADR ثبت شود: internal = سطح worker با توکن داخلی، عمومی = سازگاری قبلی بدون تغییر.

### [🟢] گام ۳: `indexGeneration` واقعی (D8)

افزودن شمارندهٔ monotonic به `<artifactRoot>/manifest.json` که با هر write موفق در `OutputWriter` افزایش یابد، و انتشار additive آن در `src/ai/mcp/SemanticEngineMcpServer.ts` به‌صورت `structuredContent: { projectId, indexGeneration }` — بدون تغییر `content` و بدون حذف فیلد (قانون ۶). `AiToolRegistry` (`src/ai/AiToolRegistry.ts:30-31,80-82`) از همان مقدار برای invalidation کش استفاده کند.

### [🟢] گام ۴: تست قرارداد با مصرف‌کنندهٔ واقعی

یک تست که خروجی واقعی `SemanticEngineMcpServer` را به `trackGeneration` در `structured-ai/agent/mcp/SemanticClient.js:251-280` بدهد و اثبات کند تغییر generation → پاک شدن `resultCache` و بی‌اثر شدن `toolsLoadedAt`. این تست پل میان دو بسته است و باید در CI هر دو طرف اجرا شود.

### [🟢] گام ۵: shutdown و پایداری

`POST /internal/shutdown` باید watcher و LSP را ببندد، اتصال‌های باز را تمام کند و با کد ۰ خارج شود؛ worker در برابر index خراب crash نکند و `state: degraded` گزارش دهد.

**معیار پذیرش:**
- `semantic-engine worker --project-id … --root …` بدون Gateway بالا بیاید، `/internal/ready` ابتدا ۵۰۳ و پس از load شدن index ۲۰۰ بدهد (تست با پروسهٔ واقعی).
- `tools/call` خروجی‌ای برگرداند که `structuredContent.projectId` و `structuredContent.indexGeneration` داشته باشد و تست گام ۴ سبز شود.
- `POST /internal/shutdown` پروسه را graceful ببندد (تست: exit code 0 و بسته شدن watcher).
- `npm run build && npm test` سبز.

### وضعیت اجرای فاز ۷ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/cli/commands/worker-command.ts`، `src/core/config/indexGeneration.ts` + تست‌های `cli/commands/workerCommand.test.ts` (۳، با پروسهٔ واقعی) و `ai/mcp/mcpIndexGeneration.test.ts` (۴).
**فایل‌های تغییرکرده:** `cli/main.ts` (ثبت دستور `worker` + بخش help)، `pipeline/OutputWriter.ts` (`indexGeneration` در manifest)، `ai/mcp/SemanticEngineMcpServer.ts` (`projectId`/`indexPath` در options، `callTool` به‌عنوان متد تست‌پذیر، `structuredContent` افزوده، `reload` generation را دوباره می‌خواند)، `cli/commands/serve-command.ts` (export شدن `spawnService`/`stopChild` برای استفادهٔ worker).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 190 passed / 190 total`، `Tests: 2639 passed / 2639 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۷: ۱۸۸ suite و ۲۶۳۲ تست → +۲ suite و +۷ تست).
- **worker با پروسهٔ واقعی روی Unix socket واقعی:** `--root/--data-dir/--project-id/--socket/--token/--no-watch` → `GET /internal/ready` = ۲۰۰ و `ready:true`؛ `/internal/health` = ۲۰۰ با `state:ready`، `indexState:fresh` و `pid` برابر pid پروسه؛ `/internal/metrics` کلیدهای `worker_*` را دارد؛ `/internal/reload` = ۲۰۰؛ **بدون توکن = ۴۰۱**؛ `POST /internal/shutdown` = ۲۰۰ و سپس **exit code ۰** و پاک شدن فایل socket؛ `SIGTERM` هم exit ۰ می‌دهد.
- **`--skip-initial-index` روی پروژهٔ بدون ایندکس:** `/internal/ready` = **۵۰۳** با `indexState:missing` و `state:starting` (یعنی readiness دروغ نمی‌گوید).
- **`indexGeneration` سرتاسری:** `OutputWriter` شمارنده را ۱→۲→۳ بالا می‌برد؛ `callTool` همان `content` قبلی را به‌علاوهٔ `structuredContent.projectId` و `structuredContent.indexGeneration` برمی‌گرداند؛ و تست قرارداد، خروجی واقعی سرور را از `unpackToolResult` **و** `trackGeneration` واقعیِ `structured-ai/agent/mcp/SemanticClient.js` عبور می‌دهد → با تغییر generation، `resultCache` خالی و `toolsLoadedAt` نال می‌شود.
- `semantic-engine --help` دستور `worker` و همهٔ flagهایش را نشان می‌دهد.

**سه نکتهٔ اجرایی (ثبت‌شده در ADR بخش ۸):**

1. `/internal/*` **کنار** `/health`، `/ready` و `/metrics` قبلی نشست و معنای آن‌ها عوض نشد؛ `/internal/*` نمای «worker تحت supervision» است.
2. `reload()` حالا generation را دوباره می‌خواند؛ وگرنه پس از reindex، عدد منتشرشده عقب می‌ماند و کش مصرف‌کننده بی‌خبر می‌ماند.
3. payload ابزارها به متد `callTool` منتقل شد تا قرارداد MCP قابل تست باشد؛ handler فقط آن را صدا می‌زند.

---

## [🟢] فاز ۸: WorkerSupervisor، lifecycle، lock و quota

**هدف:** مدیریت پروسه‌ها، سلامت، crash recovery و محدودسازی منابع. معادل گام ۷ و بخشی از گام ۱۶ پلن مرجع، به‌علاوهٔ پیاده‌سازی lock که امروز اصلاً وجود ندارد (Baseline #19).

### [🟢] گام ۱: `WorkerProcess` و `WorkerSupervisor`

`src/gateway/WorkerProcess.ts` و `src/gateway/WorkerSupervisor.ts`: spawn از argv (بدون shell، `spawn` با `shell:false`)، تخصیص پورت/socket، ثبت PID، انتظار برای `/internal/ready` با `workerStartupTimeoutMs`، لاگ هر worker در `<dataRoot>/gateway/logs/<projectId>.log`.

### [🟢] گام ۲: health monitor و crash recovery

`src/gateway/WorkerHealthMonitor.ts`: health check دوره‌ای، تشخیص crash، restart با backoff `1s → 3s → 10s` و انتقال به `degraded` پس از ۵ crash، جلوگیری از crash loop، انتشار رویدادها برای UI فاز ۱۲.

### [🟢] گام ۳: lock هم‌زمانی

`src/gateway/ProjectLock.ts`: `locks/worker.lock` و `locks/index.lock` با `O_EXCL` + pid + heartbeat؛ یک index job فعال برای هر پروژه؛ پروژه‌های مختلف موازی؛ بازیابی lock رهاشده (stale) بر اساس heartbeat.

### [🟢] گام ۴: quota و pool

`maxWorkers`, `maxConcurrentIndexJobs`, `maxWorkersPerUser`, `workerStartupTimeoutMs`, `workerHealthIntervalMs`, `workerIdleTimeoutMs`, `maxProjectArtifactBytes`, `maxGatewayMemoryMb` — با صف و رد کردن صریح (۴۲۹/۵۰۳) وقتی ظرفیت پر است. (Unknown / Requires Verification: مقادیر پیش‌فرض `maxProjectArtifactBytes` و `maxGatewayMemoryMb` باید با اندازه‌گیری روی `test-projects/` تعیین شوند، نه حدس.)

### [🟢] گام ۵: shutdown کل Gateway و تست‌ها

SIGTERM → توقف graceful همهٔ workerها و آزادسازی lockها. تست‌ها با worker واقعیِ کوچک روی fixture: crash A不影响 B، start هم‌زمان → یک worker، lock stale بازیابی شود، quota رعایت شود.

**معیار پذیرش:**
- crash کردن عمدی worker A، worker B را از `ready` خارج نکند (تست با دو پروسهٔ واقعی).
- دو درخواست start هم‌زمان برای یک پروژه فقط یک worker بسازد.
- پس از ۵ crash پشت‌سرهم، وضعیت `degraded` شود و gateway به restart ادامه ندهد.
- توقف gateway همهٔ پروسه‌ها را ببندد و lock رهاشده باقی نماند (تست).
- `npm run build && npm test` سبز.

### وضعیت اجرای فاز ۸ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/gateway/ProjectLock.ts`، `src/gateway/WorkerProcess.ts`، `src/gateway/WorkerHealthMonitor.ts`، `src/gateway/WorkerSupervisor.ts` + تست‌های `ProjectLock.test.ts` (۶) و `WorkerSupervisor.test.ts` (۷، همه با پروسهٔ worker واقعی).
**فایل‌های تغییرکرده:** `cli/commands/worker-command.ts` (پذیرش `SEMANTIC_ENGINE_WORKER_TOKEN` به‌عنوان کانال توکنِ supervisor).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 192 passed / 192 total`، `Tests: 2652 passed / 2652 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۸: ۱۹۰ suite و ۲۶۳۹ تست → +۲ suite و +۱۳ تست).
- **crash Worker A روی B اثر نکرد (با دو پروسهٔ واقعی):** A با `SIGKILL` کشته شد → `checkAll()` → `action: 'restart'` برای A و `healthy: true` برای B؛ pid جدید برای A، **pid B بدون تغییر** و `health(B).state === 'ready'`.
- **دو start هم‌زمان برای یک پروژه → یک worker:** `Promise.all([start, start])` هر دو همان pid را برگرداندند و `list().length === 1`.
- **crash loop → `degraded`:** با `maxRestarts: 2`، پس از سومین crash پشت‌سرهم `action: 'degraded'` و `isDegraded() === true`؛ بررسی بعدی `action: 'none'` با دلیل «degraded» (یعنی supervisor دیگر restart نمی‌کند).
- **lock:** دو بار acquire → دومی `reason: 'held'` با pid صاحب؛ صاحب مرده یا heartbeat قدیمی → `recovered: true`؛ فایل نیمه‌نویس → بازیابی؛ `release` فقط lock خودش را برمی‌دارد. و `sup.start()` روی پروژه‌ای که lock زنده دارد → `LockHeldError`.
- **quota:** با `maxWorkers: 1`، start دوم → `CapacityError`.
- **shutdown کل:** `stopAll()` هر دو worker را بست، هیچ `worker.lock` و هیچ فایل `.sock` باقی نماند، و پس از اجرای کامل suite هیچ پروسهٔ `semantic-engine.js worker` زنده نماند (`ps` → ۰).

**چهار یافتهٔ اجرایی که حین اندازه‌گیری پیدا و رفع شد (در ADR بخش ۹ ثبت شد):**

1. **شمارندهٔ crash باید از restart جان سالم به در ببرد.** `spawn()` آن را صفر می‌کرد، پس حدِ crash loop هرگز reachable نبود و خروجی تست `['restart','restart','restart','restart']` شد؛ حالا فقط شروعِ *تازه* صفر می‌کند و `restart` نه.
2. **فایل socket باقی‌مانده از crash یعنی `EADDRINUSE`**؛ supervisor پیش از spawn آن را پاک می‌کند.
3. **توکن supervisor به worker نمی‌رسید:** worker فقط `--token` و `SEMANTIC_ENGINE_TOKEN` را می‌خواند، پس readiness با ۴۰۱ رد می‌شد؛ `SEMANTIC_ENGINE_WORKER_TOKEN` به زنجیرهٔ منبع توکن اضافه شد.
4. **لاگ با `WriteStream` به `spawn` داده نمی‌شود** (`ERR_INVALID_ARG_VALUE` و بعد ENOENT بی‌صاحب)؛ به `fs.openSync` + fd تغییر کرد.

---

## [🟢] فاز ۹: Gateway HTTP — registry API، proxy پروژه‌محور REST/SSE و authorization

**هدف:** یک پورت عمومی برای همهٔ پروژه‌ها با routing قطعی، بدون شکستن UI فعلی. معادل گام ۸، گام ۹ (REST/SSE) و گام ۱۰ (authz) پلن مرجع.

### [🟢] گام ۱: روت‌های مدیریتی

`src/gateway/GatewayServer.ts` + `src/gateway/routes/gatewayRoutes.ts`: `GET/POST /api/v1/gateway/projects`، `GET/PATCH/DELETE /api/v1/gateway/projects/:projectId`، `POST …/start|stop|restart|reindex`، `GET /api/v1/gateway/health|ready|metrics|events`.

### [🟢] گام ۲: سازگاری با UI موجود (D7)

Gateway باید `GET/POST /api/v1/projects` را با **همان شکل پاسخ** `src/server/routes/projectRoutes.ts:12-52` سرو کند تا `public/open.js:195` و `:74` بدون تغییر کار کنند؛ در این سطح، `POST` پروژه را در registry ثبت و worker را lazy start می‌کند.

### [🟢] گام ۳: proxy پروژه‌محور REST

`/api/v1/projects/:projectId/...` → worker همان پروژه، **بدون بازنویسی مسیر**؛ حفظ method/headers/body/status؛ streaming body و response؛ حذف `Origin` و افزودن `X-Forwarded-*` (D6)؛ تزریق توکن داخلی worker؛ `404` برای projectId نامعتبر؛ `403` برای توکن بدون scope؛ `502` تمیز وقتی worker مرده است.

### [🟢] گام ۴: proxy SSE

`GET /api/v1/projects/:projectId/events` (worker: `src/server/routes/jobRoutes.ts:286`) بدون buffering و بدون timeout معمولی؛ propagate شدن disconnect کلاینت به worker؛ شمارش active requests در metrics.

### [🟢] گام ۵: authorization

token store با scope (`project:read`, `semantic:query`, `semantic:index`, `auth:manage`) سازگار با `PermissionChecker` موجود در `src/security/rbac/`؛ `allowedProjects` در هر توکن؛ token عمومی Gateway جدا از توکن داخلی worker؛ redaction در لاگ و manifest.

### [🟢] گام ۶: تست‌های routing و stream

routing isolation (درخواست A هرگز به B نرود، با شمارش درخواست در هر worker)، stream isolation، `404`/`403`، cancel/timeout/disconnect، و یک تست که `public/visualizer.js`-style requestها (`/api/v1/projects/<id>/visualization/architecture`) از Gateway درست proxy شوند.

**معیار پذیرش:**
- تست isolation سبز: درخواست به پروژهٔ A هیچ اثری روی worker B نداشته باشد (شمارش درخواست B صفر بماند).
- `open.js`/`visualizer.js` **بدون تغییر کد** مقابل Gateway کار کنند (تست با fetch واقعی روی سرور واقعی).
- هر پاسخ project-scoped شامل `projectId` باشد.
- worker مرده → `502` و بقیهٔ پروژه‌ها سالم.
- `npm run build && npm test` سبز.

### وضعیت اجرای فاز ۹ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/gateway/GatewayAuth.ts`، `src/gateway/GatewayProxy.ts`، `src/gateway/GatewayServer.ts` + تست `src/gateway/GatewayServer.test.ts` (۹ تست، کلاینت HTTP واقعی و worker واقعی).
**فایل‌های تغییرکرده:** `security/rbac/types.ts` (`ApiKeyRecord.allowedProjects` افزوده)، `security/rbac/ApiKeyStore.ts` (`createKey` همان فیلد را می‌پذیرد)، `gateway/WorkerSupervisor.ts` (+`workerToken`).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 193 passed / 193 total`، `Tests: 2661 passed / 2661 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۹: ۱۹۲ suite و ۲۶۵۲ تست → +۱ suite و +۹ تست).
- **routing isolation با دو worker واقعی:** `GET /api/v1/projects/<A>` → `id === A` و `rootPath === realpath(rootA)`؛ همان درخواست برای B → `id === B` و `rootPath === realpath(rootB)`؛ هدر `X-Semantic-Project-Id` هم برای هر پاسخ ست شد.
- **سازگاری UI بدون تغییر کد:** `POST /api/v1/projects {path}` → ۲۰۱ با `{id,name,rootPath,status,stats}` و `GET /api/v1/projects` → `{total, projects:[…]}` با همان فیلدها (دقیقاً دو فراخوانی `public/open.js:195` و `:74`).
- **URLهای visualizer بدون بازنویسی proxy شدند:** `/api/v1/projects/<id>/visualization/architecture` → هیچ ۴۰۴ سطح Gateway نگرفت.
- **خطاها:** پروژهٔ ناشناخته → ۴۰۴ · بدون توکن → ۴۰۱ · توکن محدود به A روی B → ۴۰۳ و لیستش فقط ۱ پروژه · worker متوقف‌شده → **۵۰۲** در حالی که همسایه‌اش ۲۰۰ می‌دهد و بعد با `start` برمی‌گردد.
- **SSE:** `GET /api/v1/gateway/events` → `event: gateway` و `{"type":"hello"}` روی stream واقعی.
- **نشت نکردن توکن داخلی:** `supervisor.workerToken(A)` با توکن عمومی Gateway متفاوت است و در هیچ پاسخ body ظاهر نمی‌شود (تست صریح).
- **چرخهٔ زندگی (lifecycle):** `reindex` → ۲۰۰/۲۰۲، `GET/PATCH` روی `/api/v1/gateway/projects/:id` → rename اعمال شد.

**دو تصمیم اجرایی (ثبت‌شده در ADR بخش ۱۰):**

1. authorization از واژگان خود platform بازاستفاده شد (`ApiKeyStore` + `PermissionScope`) و `allowedProjects` به‌صورت **افزودنی** به `ApiKeyRecord` اضافه شد؛ نبود فیلد یعنی `resourceScope` قدیمی معتبر است، پس کلیدهای موجود نمی‌شکنند.
2. «پاسخ شامل projectId» به‌جای بافر کردن body، با هدر `X-Semantic-Project-Id` انجام شد تا streaming (و SSE) دست‌نخورده بماند.

---

## [🟢] فاز ۱۰: proxy پروتکل MCP و انطباق با کلاینت structured-ai

**هدف:** `POST /mcp/:projectId` مطابق قراردادی که stub فعلی تعریف کرده (Baseline #12) و اثبات انطباق با کلاینت واقعی. معادل گام ۹ (MCP) پلن مرجع.

### [🟢] گام ۱: روت MCP

`POST /mcp/:projectId` → `/mcp` روی worker همان پروژه (مسیر `HttpGuard` دقیقاً `/mcp` است)؛ binding جلسه به پروژه از لحظهٔ ایجاد و غیرقابل تغییر در طول session.

### [🟢] گام ۲: streaming و session

body و response stream شوند؛ timeout معمولی روی stream اعمال نشود؛ disconnect کلاینت به worker منتقل شود؛ اگر transport stateful است (session id در `initialize`) اتصال به همان worker sticky بماند.

### [🟢] گام ۳: harness انطباق واقعی

`structured-ai/test/mcp/gateway.integration.test.js`: اجرای `structured-ai` (pool + `SemanticClient` + `HttpTransport`) مقابل **Gateway واقعی** با دو پروژهٔ هم‌نام. stub (`test/helpers/stubSemanticGateway.js`) برای تست‌های واحد باقی بماند و در همان فایل دلیلش ثبت شود.

### [🟢] گام ۴: isolation کش و generation

اثبات اینکه تغییر `indexGeneration` در پروژهٔ A فقط کش A را باطل می‌کند و B دست‌نخورده می‌ماند (تست با `SemanticClientPool`).

**معیار پذیرش:**
- `cd structured-ai && npm run test:semantic` و harness جدید سبز باشند.
- `tools/list` و `tools/call` برای دو پروژهٔ هم‌نام پاسخ متفاوت و صحیح بدهند؛ آلودگی متقاطع با تست اثبات نشود.
- قطع کلاینت → تعداد اتصال‌های فعال worker به صفر برگردد (بدون orphan).
- `npm run build && npm test` در `semantic-engine/` سبز.

### وضعیت اجرای فاز ۱۰ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/cli/commands/gateway-command.ts` (نقطهٔ ورود عمومی)، تست `src/gateway/McpProxy.test.ts` (۳) و `structured-ai/test/mcp/gateway.integration.test.js` (۴).
**فایل‌های تغییرکرده:** `cli/commands/worker-command.ts` (روت `POST /mcp` روی همان socket، با transport جدا به ازای هر درخواست و `projectId`/`indexPath` برای `structuredContent`)، `gateway/GatewayServer.ts` (روت `POST /mcp/:projectId` + `configForProject` عمومی + `targetPath` در proxy)، `cli/main.ts` (ثبت دستور `gateway` + help)، `structured-ai/package.json` (`test:semantic` و `test`).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 194 passed / 194 total`، `Tests: 2664 passed / 2664 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۱۰: ۱۹۳ suite و ۲۶۶۱ تست → +۱ suite و +۳ تست).
- `cd structured-ai && npm run check && npm test` → exit 0 و **صفر** `FAIL` در کل زنجیره؛ `npm run test:semantic` → ۴/۴ در harness جدید.
- **MCP با دو پروژهٔ هم‌نام از راه Gateway واقعی:** `tools/list` شامل `find_symbol` · `tools/call find_symbol` برای A فقط `alphaOnly` و برای B فقط `betaOnly` (آلودگی متقاطع با `not.toContain` سنجیده شد) · `structuredContent.projectId` برابر id همان پروژه و `indexGeneration` عدد · پروژهٔ ناشناخته ۴۰۴ · بدون توکن ۴۰۱.
- **انطباق با کلاینت ship‌شده (نه stub):** harness واقعی `structured-ai` با `SemanticClient` + `HttpTransport` روی `http://127.0.0.1:<port>/mcp/<id>?token=…`؛ `indexGeneration` سمت مصرف‌کننده عدد است و **reindex روی A فقط generation همان A را جابه‌جا کرد** و B بدون تغییر ماند.
- **بدون orphan:** پس از اجرای harness و پس از probe مستقیمِ `SIGTERM` به gateway، `ps` هیچ پروسهٔ `semantic-engine.js worker` باقی‌مانده‌ای نشان نداد (۰).

**سه نکتهٔ اجرایی (ثبت‌شده در ADR بخش ۱۱):**

1. worker تا پیش از این فاز MCP سرو نمی‌کرد؛ روت `POST /mcp` به همان HttpServer اضافه شد تا هر پروژه یک socket داشته باشد و session به‌صورت ساختاری به پروژه bound بماند.
2. دستور `semantic-engine gateway` پیش‌نیاز harness بود (و در §۱۷ پلن مرجع هم آمده)؛ URL و توکن روی **stderr** چاپ می‌شود تا `--json` روی stdout قابل parse بماند.
3. یک اجرای ناموفق harness (پیش از اصلاح) gateway را بدون cleanup رها کرد و workerهایش زنده ماندند؛ حالا هر چه می‌تواند throw کند داخل `try` است و cleanup بی‌قیدوشرط اجرا می‌شود.

**بازماندهٔ صریح (برای فاز ۱۴):** معیار «قطع کلاینت → شمار اتصال‌های فعال worker صفر شود» با نبود orphan *پروسه* سنجیده شد، ولی assertion مستقیم روی شمارندهٔ اتصال (`gateway_active_requests`) هنوز نوشته نشده و به فاز ۱۴ منتقل شد.

---

## [🟢] فاز ۱۱: WebSocket واقعی و proxy آن

**هدف:** پوشش نیازمندی WebSocket در §گام ۹ و §۶ پلن مرجع. **تصمیم تأییدشدهٔ کارفرما (۲۰۲۶-۰۸-۲۶):** این قابلیت پیاده‌سازی می‌شود و از دامنه حذف نمی‌گردد. **Assumption:** امروز هیچ WS واقعی و هیچ مصرف‌کننده‌ای وجود ندارد (Baseline #7)، پس این فاز هم سرور سمت worker و هم proxy سمت Gateway را از صفر می‌سازد.

### [🟢] گام ۱: سرور WS حداقلی در worker

پیاده‌سازی بدون وابستگی جدید (handshake RFC6455 با `Sec-WebSocket-Accept`، فریم text/ping/pong/close) روی `/ws/projects/:projectId`؛ جایگزینی `WebSocketManager` فعلی (که SSE روی `http.ServerResponse` است) یا نگه‌داشتن آن به‌عنوان fallback مستندشده.

### [🟢] گام ۲: proxy upgrade در Gateway

resolve کردن `projectId` **پیش از** upgrade، ثابت ماندن context پس از upgrade، propagate شدن close، و ثبت metrics.

### [🟢] گام ۳: تست

دو کلاینت روی دو پروژه پیام یکدیگر را نبینند؛ بستن یکی دیگری را نبندد؛ reconnect با context درست.

**معیار پذیرش:**
- تست isolation پیام‌ها سبز باشد.
- proxy upgrade، `projectId` را پیش از upgrade حل کند و پس از upgrade تغییر ندهد (تست).
- `npm run build && npm test` سبز.

### وضعیت اجرای فاز ۱۱ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/gateway/wsProtocol.ts` (handshake + کدک فریم RFC6455، بدون وابستگی جدید)، `src/server/wsProjectChannel.ts` (کانال تک‌پروژه سمت worker) + تست‌های `gateway/wsProtocol.test.ts` (۱۳) و `gateway/webSocketProxy.test.ts` (۳، end-to-end از پشت Gateway).
**فایل‌های تغییرکرده:** `server/types.ts` (+`upgradeHandler`)، `server/HttpServer.ts` (ثبت رویداد `upgrade`؛ بدون هندلر → `426`، چون handshake نیمه‌کاره از نبود WebSocket بدتر است)، `cli/commands/worker-command.ts` (کانال `/ws` با احراز هویت، و بستن کانال هنگام خاموشی)، `gateway/GatewayServer.ts` (proxy upgrade)، `gateway/WorkerSupervisor.ts` (انتقال data root به worker).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 196 passed / 196 total`، `Tests: 2681 passed / 2681 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۱۱: ۱۹۴ suite و ۲۶۶۴ تست → +۲ suite و +۱۷ تست). پس از اجرای کامل suite هیچ پروسهٔ worker زنده نماند (`ps` → ۰) و چیزی در data root واقعی نوشته نشد.
- **کدک:** کلید پذیرش با مثال normative RFC 6455 سنجیده شد (`dGhlIHNhbXBsZSBub25jZQ==` → `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`)؛ round-trip برای payload کوتاه، ۱۶ بیتی و ۶۴ بیتی؛ فریم mask‌دار؛ فریم تقسیم‌شده بین دو chunk؛ دو فریم در یک chunk؛ و فریم بزرگ‌تر از سقف → خطا.
- **handshake واقعی از پشت Gateway:** `101 Switching Protocols` + هدر `X-Semantic-Project-Id`، و پیام `hello` با `projectId` درست.
- **isolation:** پیام کلاینت A1 فقط به A2 رسید (`"projectId":"<A>"`) و کلاینت B در مدت ۱٫۵ ثانیه **هیچ** پیامی نگرفت؛ بستن A1 نه A2 را بست نه B را.
- **پیش از upgrade:** پروژهٔ ناشناخته → ۴۰۴، بدون توکن → ۴۰۱، توکنِ پروژهٔ دیگر → ۴۰۳، و همان توکن روی پروژهٔ خودش → ۱۰۱.

**دو باگ که فقط با اندازه‌گیری پیدا شد (در ADR بخش ۱۱ ثبت شد):**

1. proxy هدر `Connection` را به‌عنوان hop-by-hop حذف می‌کرد، پس Node در worker رویداد `upgrade` را نمی‌دید و درخواست به جدول روت‌ها می‌افتاد: worker مستقیم `101` می‌داد و از پشت Gateway `404`. حالا `Upgrade: websocket` و `Connection: Upgrade` صریحاً نوشته می‌شوند.
2. supervisor به worker نمی‌گفت از کدام data root استفاده کند، پس artifactهای پروژهٔ مدیریت‌شده در data root پیش‌فرض پلتفرم نوشته می‌شد (در عمل `~/.local/share/…`) در حالی که socket و lock و لاگ زیر data root خود Gateway بود. حالا `SEMANTIC_ENGINE_DATA_DIR` در محیط پروسهٔ فرزند ست می‌شود و یک تست رگرسیون بررسی می‌کند ایندکس زیر `<dataRoot>/projects/<id>/` بنشیند.

---

## [🟢] فاز ۱۲: Gateway UI — داشبورد Workerها، فرم پیکربندی و deep link پروژه

**هدف:** UI کامل مدیریت چندپروژه‌ای — **دامنهٔ تأییدشدهٔ کارفرما (۲۰۲۶-۰۸-۲۶): داشبورد + فرم پیکربندی Worker + deep link پروژه، هر سه در همین فاز.** معادل گام ۱۱، ۱۲ و ۱۳ پلن مرجع. توجه: صفحهٔ ورود فعلی `/open.html` است (Baseline #14) و `public/index.html` صفحهٔ کنسول structured-ai است؛ پس shell جدید باید صریح اضافه شود، نه با جایگزینی فرضی `index.html`.

### [🟢] گام ۱: shell و routing

`semantic-engine/public/gateway.html`, `gateway.js`, `gateway.css` + روت `/gateway` در `serveStatic` (`src/server/HttpServer.ts:478-490`) بدون شکستن نگاشت فعلی `/ → /open.html`.

### [🟢] گام ۲: داشبورد

کارت‌های تجمیعی (پروژه‌ها، ready/indexing/degraded/crashed، files/symbols/dependencies/vector chunks، RAM/CPU، job فعال، queue) + جدول workerها با ستون‌های §گام ۱۱ پلن مرجع + عملیات (Open dashboard، Start، Stop، Restart، Reindex، Edit configuration، View logs، View events، Open MCP endpoint، Remove project).

### [🟢] گام ۳: live update

اتصال به `GET /api/v1/gateway/events` (SSE) و polling فقط به‌عنوان fallback؛ به‌روزرسانی بدون refresh کامل صفحه.

### [🟢] گام ۴: فرم پیکربندی Worker

بخش‌های Project / Indexing / Watch / Embedding / Worker service / Security / Advanced؛ هر فیلد **مستقیماً** به یک کلید از `WorkerConfigSchema` (فاز ۵) نگاشت شود؛ command preview از `workerArgv`؛ validation inline؛ `Save & Start`، `Save without starting`، `Reindex now`؛ API key فقط secret/env reference.

### [🟢] گام ۵: deep link پروژه

`/projects/:projectId` و سازگاری با `/visualizer?project=:projectId` (مطابق `public/visualizer.js:25`)؛ context پس از refresh حفظ شود؛ همهٔ درخواست‌ها project-scoped باشند.

### [🟢] گام ۶: تست UI

تست ماژولار توابع `gateway.js` (render، نگاشت فرم→config) + یک تست e2e که با fetch واقعی پروژه بسازد، start کند و health بگیرد.

**معیار پذیرش:**
- داشبورد ۱۰ worker را بدون تداخل نشان دهد و وضعیت بدون refresh کامل به‌روز شود (تست e2e).
- تست snapshot نگاشت «فیلد فرم ↔ کلید schema» سبز باشد؛ هیچ فیلدی بدون معادل schema نماند.
- تنظیمات پس از restart Gateway حفظ شوند؛ edit config فقط worker همان پروژه را restart کند.
- کلیک روی worker، dashboard همان پروژه را باز کند و refresh context را نگه دارد.
- `npm run build && npm test` سبز.

### وضعیت اجرای فاز ۱۲ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `public/gateway.html`، `public/gateway.js`، `public/gateway.css` + تست‌های `gateway/gatewayUi.test.ts` (۲۴) و `gateway/gatewayConsole.test.ts` (۵، روی Gateway واقعی).
**فایل‌های تغییرکرده:** `gateway/GatewayServer.ts` (+`staticDir`، سرو کردن alias-based کنسول و assetها، redirect برای `/projects/:id`).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 198 passed / 198 total`، `Tests: 2710 passed / 2710 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۱۲: ۱۹۶ suite و ۲۶۸۱ تست → +۲ suite و +۲۹ تست). پس از suite هیچ worker زنده نماند و چیزی در data root واقعی نوشته نشد.
- **نگاشت دوطرفهٔ فرم ↔ schema سبز:** هر فیلد فرم به یک کلید واقعی از `WORKER_CONFIG_JSON_SCHEMA` نگاشت شد **و** هیچ کلید schema بدون فیلد فرم نماند (۳۵ فیلد در ۷ بخش: project ۵، watch ۴، indexing ۶، service ۹، security ۳، embedding ۷، advanced ۱).
- **validation آینهٔ سرور:** projectId نامعتبر، name خالی، rootPath خالی، debounce خارج از `[25, 60000]`، port خارج از `[0, 65535]`، transport=socket بدون socketPath، managed+allowRemote، managed بدون tokenEnvVar، embedding بدون baseUrl/model، و secret در مقادیر فرم → همه با پیام مشخص رد شدند.
- **command preview:** همان پرچم‌های `workerArgv` (`--project-id`، `--root`، `--data-dir`، `--vectors`/`--no-sqlite`، `--debounce`، `--blueprint-mode`، `--gateway-managed`، `--embedding-provider`، `--embedding-normalize`)، بدون shell metachar در پرچم‌ها، و **بدون مقدار secret** (فقط نام متغیر محیطی).
- **رندر ۱۰ worker بدون تداخل:** هر ۱۰ projectId در خروجی حاضرند، کلاس‌های `state-ready`/`state-indexing`/`state-degraded` درست نشستند، و هر ۱۰ عملیات (`data-action=…`) برای هر ردیف رندر شد؛ ورودی مخرب escape شد (`<script>` → `&lt;script&gt;`).
- **serving واقعی:** `GET /gateway` → ۲۰۰ `text/html` با «Semantic Gateway» · `/gateway.js` → ۲۰۰ `application/javascript` · `/gateway.css` → ۲۰۰ `text/css` · `/visualizer` و `/visualizer.js` → ۲۰۰ · `GET /projects/prj-app-12345678` → **۳۰۲** به `/visualizer?project=prj-app-12345678` (پس refresh همان context را نگه می‌دارد).
- **خارج از assetها سرو نمی‌شود:** `/package.json`، `/../package.json`، `/..%2fpackage.json` و `/gateway.js/../../package.json` هیچ‌کدام ۲۰۰ نشدند؛ و endpointهای داده بدون توکن ۴۰۱ و با توکن ۲۰۰ ماندند.

**یک تصمیم اجرایی (ثبت‌شده در ADR بخش ۱۳):** deep link پروژه به‌جای صفحهٔ مستقل، redirect به `/visualizer?project=:id` است — چون visualizer فعلی همین پارامتر را می‌خواند و context در خود URL می‌ماند؛ و assetها بدون توکن سرو می‌شوند چون هیچ دادهٔ پروژه‌ای ندارند (داده از همان APIهای توکن‌دار می‌آید).

---

## [🟢] فاز ۱۳: Metrics، observability، دستور `cache` و استقرار

**هدف:** سنجه‌ها، پاک‌سازی امن artifactها و استقرار gateway. معادل گام ۱۴ و گام ۱۶ (cleanup) و گام ۱۷ (بخش استقرار) پلن مرجع.

### [🟢] گام ۱: metrics

Gateway: `gateway_projects_total`, `gateway_workers_ready`, `gateway_workers_unhealthy`, `gateway_requests_total`, `gateway_request_duration_ms`, `gateway_active_requests`, `gateway_worker_restarts_total`, `gateway_proxy_errors_total`, `gateway_index_jobs_active`. Worker: `worker_uptime_seconds`, `worker_memory_bytes`, `worker_cpu_percent`, `worker_active_requests`, `worker_queue_size`, `worker_index_duration_ms`, `worker_index_failures_total`, `worker_files_total`, `worker_symbols_total`, `worker_dependencies_total`, `worker_vector_chunks_total`, `worker_restart_count` — در `/api/v1/gateway/metrics` و `/internal/metrics`، با schema validation در تست.

### [🟢] گام ۲: health detail در UI

برای هر worker: process/index/watcher/SQLite/blueprint/vector/LSP health، آخرین عملیات موفق، آخرین خطا، تاریخچهٔ restart.

### [🟢] گام ۳: دستور `cache`

`semantic-engine cache list | clean --project <id> | clean --older-than 30d | export --project <id> | import --project <id>` در `src/cli/main.ts`؛ **گاردهای ایمنی:** هرگز هیچ مسیری زیر `workspaceRoot` پاک نشود؛ عملیات فقط داخل `artifactRoot`؛ dry-run پیش‌فرض برای `clean --older-than`.

### [🟢] گام ۴: استقرار و مستندسازی عملیاتی

Dockerfile/compose برای gateway (پورت عمومی فقط gateway؛ workerها loopback/socket)، volume برای `SEMANTIC_ENGINE_DATA_DIR`، healthcheck، و بخش «اجرا در container» در README.

**معیار پذیرش:**
- هر دو مجموعه سنجه با تست schema-validated موجود باشند و مقادیرشان با یک اجرای واقعی تغییر کند.
- `cache clean --project <id>` فقط `artifactRoot` همان پروژه را پاک کند و source root دست‌نخورده بماند (تست با fixture).
- خطای یک worker در metrics و UI ثبت شود ولی health بقیه سالم بماند (تست).
- `docker compose config` معتبر و `npm run build && npm test` سبز.

### وضعیت اجرای فاز ۱۳ — 🟢 (۲۰۲۶-۰۸-۲۶)

**فایل‌های ساخته‌شده:** `src/gateway/metrics.ts` (واژگان سنجه‌ها + `DurationSummary` + `cpuPercent`)، `src/cli/commands/cache-command.ts` + تست‌های `gateway/metrics.test.ts` (۱۰) و `cli/commands/cacheCommand.test.ts` (۸).
**فایل‌های تغییرکرده:** `gateway/GatewayServer.ts` (+`gateway_request_duration_ms`، +`gateway_index_jobs_active` واقعی، +`GET /api/v1/gateway/projects/:id/health`)، `gateway/WorkerSupervisor.ts` (+`diagnostics` با تاریخچهٔ restart و آخرین خطا، +`activeIndexJobsCount`، رویدادهای خودِ پروسه هم ثبت می‌شوند)، `cli/commands/worker-command.ts` (سنجه‌های کامل worker: cpu/active requests/index duration/failures/restart count)، `cli/main.ts` (+دستور `cache` و help)، `public/gateway.{js,html,css}` (پنل health با ۷ بخش + تاریخچه)، `structured-ai/docker-compose.yml` (+سرویس `semantic-gateway`)، `WorkerSupervisor.test.ts` (+۱ تست)، `workerCommand.test.ts` (قرارداد دقیق کلیدهای worker).

**verification اجراشده:**

- `npm run build` exit 0 · `npm run lint` بدون خروجی · `npm run test:gate` → **`Test Suites: 200 passed / 200 total`، `Tests: 2729 passed / 2729 total`، «all suites ran» و «artifact location gate: ok»** (پیش از فاز ۱۳: ۱۹۸ suite و ۲۷۱۰ تست → +۲ suite و +۱۹ تست). پس از suite هیچ worker زنده نماند و چیزی در data root واقعی نوشته نشد.
- **قرارداد سنجه‌ها به‌شکل «دقیقاً همین کلیدها» سنجیده شد:** `Object.keys(worker /internal/metrics).sort() === WORKER_METRIC_KEYS.sort()` روی worker واقعی، و همان بررسی برای `GATEWAY_METRIC_KEYS` روی Gateway واقعی؛ `gateway_request_duration_ms` پس از چند درخواست `count > 0` داشت و `gateway_index_jobs_active` از supervisor خوانده شد.
- **خطای یک worker بقیه را خراب نکرد:** با کشتن worker A با `SIGKILL`، `diagnostics(A)` تاریخچهٔ restart و `lastError` گرفت در حالی که `diagnostics(B)` خالی ماند و `health(B).state === 'ready'` بود؛ `/health` خود Gateway هم ۲۰۰ ماند.
- **health detail:** `GET /api/v1/gateway/projects/:id/health` → ۲۰۰ با `projectId`، `health` (وقتی worker بالا نیست `null`)، `restartHistory` و `degraded`؛ پروژهٔ ناشناخته → ۴۰۴ و توکنِ پروژهٔ دیگر → ۴۰۳، بدون اثر روی پروژهٔ مجاز.
- **`cache`:** `list` اندازه و تعداد فایل هر پروژه را داد · `clean --project` فقط همان پوشه را برداشت و source tree دست‌نخورده ماند (`readdirSync(workspace) === ['src']`) · `clean --older-than 1d` پیش‌فرض **dry run** بود و با `--force` حذف کرد · **گاردها:** ورودی registry که workspace‌اش همان پوشهٔ کش بود → `refused: overlaps the registered workspace` و پوشه باقی ماند؛ `clean --project ..` → بدون حذف · `export`/`import` هر سه فایل را جابه‌جا کردند · زیردستور ناشناخته → exit 2.
- **استقرار:** `docker-compose.yml` با پارسر YAML اعتبارسنجی شد — دو سرویس (`semantic-engine`، `semantic-gateway`)، سرویس gateway با `command: ["gateway", …]`، تنها یک port منتشرشده، volume مشترک workspace + `engine-data:/data`، `read_only: true` و healthcheck روی `/health`.

**دو نکتهٔ اجرایی (ثبت‌شده در ADR بخش ۱۴):**

1. `worker_restart_count` از راه `SEMANTIC_ENGINE_WORKER_RESTART_COUNT` به پروسهٔ فرزند داده می‌شود، چون فقط supervisor می‌داند worker چند بار بالا آمده.
2. رویدادهای خودِ پروسهٔ worker (crash/exit) هم در تاریخچهٔ diagnostics ثبت می‌شوند؛ پیش از این فقط رویدادهای مانیتور ثبت می‌شد و crash واقعی در «آخرین خطا» دیده نمی‌شد (با تست پیدا و رفع شد).

---

## [🔴] فاز ۱۴: تست‌های isolation/e2e، مستندات و پذیرش نهایی

**هدف:** اثبات end-to-end کل نیازمندی و بستن §۶ پلن مرجع. معادل گام ۱۵ و ۱۷ پلن مرجع.

### [🔴] گام ۱: سناریوی دو پروژهٔ هم‌نام

`/tmp/client-a/app` و `/tmp/client-b/app` با symbolهای متفاوت: data isolation (artifact، SQLite، vector search)، worker isolation (تغییر فایل A فقط A را index کند؛ crash A به B اثر نکند)، routing isolation (`/api/v1/projects/a|b/...` و `/mcp/a|b`).

### [🔴] گام ۲: ماتریس پروتکل

REST، MCP `tools/list` و `tools/call`، SSE، WebSocket (فاز ۱۱)، cancellation، timeout، disconnect.

### [🔴] گام ۳: جریان UI

ساخت worker، edit config، command preview، health/metrics refresh، click-through به dashboard، start/stop/restart، نمایش crash و degraded.

### [🔴] گام ۴: migration e2e

خواندن artifact legacy از هر سه مسیر، انتقال به data dir، عدم حذف legacy، ادامهٔ نوشتن فقط در مسیر جدید، و رفتار `stale`/`missing` برای artifact خراب.

### [🔴] گام ۵: load و موازی‌کاری

چند worker هم‌زمان، صف index، رعایت quota، و سنجهٔ اینکه event loop gateway block نشود.

### [🔴] گام ۶: مستندات نهایی

`semantic-engine/README.md`, `semantic-engine/HANDOFF.md`, `semantic-engine/INTEGRATION-STRUCTURED-AI.md`, `structured-ai/README.md`: مسیر data dir در سه پلتفرم، register کردن پروژه، اجرای Gateway و Worker مستقل، APIهای project-scoped، MCP URL هر پروژه، فرم‌های UI، migration، `--no-watch/--vectors/--sqlite`، محدودیت‌های embedding provider، health و metrics.

### [🔴] گام ۷: پذیرش نهایی

چک‌لیست §۶ پلن مرجع بند به بند مرور و وضعیت هر بند در همین سند ثبت شود؛ به‌روزرسانی `structured-ai/EXECUTION_PLAN.md` اگر contract جدیدی اضافه شد.

**معیار پذیرش:**
- سناریوی ۱۰ مرحله‌ای §گام ۱۵ پلن مرجع بدون خطا اجرا شود (Gateway روی `:4000`، دو پروژه، هر دو `ready`، query متفاوت اما صحیح، تغییر فایل A، فقط A در حال index، B بدون تغییر generation و بدون restart، click-through درست).
- `cd semantic-engine && npm run build && npm run lint && npm test` و `cd structured-ai && npm run check && npm test` سبز.
- هر بند §۶ پلن مرجع یا 🟢 باشد یا دلیل 🟡 بودنش ثبت شده باشد.

---

# حسابرسی دامنه (Scope Audit)

## الف) پوشش گام‌های پلن مرجع

| گام پلن مرجع | فاز(های) این سند |
|---|---|
| گام ۰ — قرارداد | فاز ۱ (گام ۱-۵) |
| گام ۱ — Data Directory Resolver | فاز ۱ (API) + فاز ۳ (wiring) + فاز ۴ (پیش‌فرض) |
| گام ۲ — Registry و identity | فاز ۲ |
| گام ۳ — migration | فاز ۳ (گام ۴) + فاز ۴ (گام ۲) |
| گام ۴ — WorkerConfig schema | فاز ۵ |
| گام ۵ — Worker process | فاز ۷ (گام ۱) |
| گام ۶ — endpointهای داخلی | فاز ۷ (گام ۲) |
| گام ۷ — Supervisor و lifecycle | فاز ۸ |
| گام ۸ — Gateway routing | فاز ۹ |
| گام ۹ — proxy پروتکل‌ها | فاز ۹ (REST/SSE) + فاز ۱۰ (MCP) + فاز ۱۱ (WS) |
| گام ۱۰ — امنیت و authz | فاز ۶ + فاز ۹ (گام ۵) |
| گام ۱۱ — Gateway UI | فاز ۱۲ (گام ۱-۳) |
| گام ۱۲ — فرم Worker | فاز ۱۲ (گام ۴) + فاز ۵ (flagهای embedding) |
| گام ۱۳ — Project dashboard | فاز ۱۲ (گام ۵) |
| گام ۱۴ — Metrics | فاز ۱۳ (گام ۱-۲) |
| گام ۱۵ — تست‌ها | فاز ۱۴ |
| گام ۱۶ — performance/quota/cleanup | فاز ۸ (گام ۴) + فاز ۱۳ (گام ۳) |
| گام ۱۷ — مستندسازی و انتشار | فاز ۴ (گام ۳) + فاز ۱۳ (گام ۴) + فاز ۱۴ (گام ۶) |

## ب) کار اضافه‌شده (که پلن مرجع نداشت) و دلیلش

| کار | فاز | دلیل (مستند به کد) |
|---|---|---|
| رفع collision شناسهٔ `prj-<basename>` و overwrite | ۲ | با اجرای واقعی اثبات شد: دو پروژهٔ هم‌نام یک id گرفتند و `listProjects().length === 1` (`ProjectService.ts:51,172`) |
| رفع `checkConnection` برای Unix socket | ۶ | درخواست socket بدون این تغییر ۴۰۳ می‌شود (`SecurityPipeline.ts:89-105`) |
| سیاست Origin پشت Gateway | ۶ | `checkOrigin` و `HttpGuard` هر Origin غیر loopback را رد می‌کنند (`SecurityPipeline.ts:165-193`, `HttpGuard.ts:120-124`) |
| محدودسازی `fs/browse` | ۶ | امروز هر مسیر دلخواه قابل لیست است (`fsRoutes.ts:61-122`) |
| تولید واقعی `indexGeneration` در MCP | ۷ | کلاینت ship‌شده آن را می‌خواند ولی engine نمی‌فرستد (`SemanticClient.js:251-262`) |
| flagهای embedding در CLI | ۵ | فرم UI بدون argv معادل قابل تحویل نیست (`index-command.ts:93`, `watch-command.ts:141`) |
| انتقال `jobs.json` و `telemetry/spans.json` | ۳ | بدون آن‌ها معیار «root dirty نشود» برقرار نمی‌شود (`HttpServer.ts:92,182`) |
| به‌روزرسانی resolver در structured-ai | ۴ | مسیر ایندکس را داخل root حدس می‌زند (`agent/mcp/semantic.js:340-352`) |
| volume و `SEMANTIC_ENGINE_DATA_DIR` در Docker | ۴ | `read_only: true` و فقط `/workspace` mount (`docker-compose.yml:11-19`) |
| پیاده‌سازی lock | ۸ | هیچ پیاده‌سازی lock در `src/` وجود ندارد |
| کلیدهای config + تست schema-sync | ۱ | `SEMANTIC_ENGINE_DATA_DIR` وجود ندارد و schema منبع یکتای کلیدهاست (`configSchemaSync.test.ts:72-110`) |
| ADR و پوشهٔ `docs/architecture/` | ۱ | پلن مرجع به مسیری ارجاع می‌داد که وجود ندارد (`docs/` فقط `panel-archive.html`) |
| ثبت baseline و دستورهای verification | همه | اجرای `npx jest` بدون `pretest` نتیجهٔ گمراه‌کننده می‌دهد (Baseline #22) |

## ج) موارد باز (بدون حذف صریح، چیزی از قلم نرفته)

- **Unknown / Requires Verification:** مقادیر پیش‌فرض `maxProjectArtifactBytes`، `maxGatewayMemoryMb` و `maxConcurrentIndexJobs` — باید با اندازه‌گیری روی `test-projects/` تعیین شوند.
- **Unknown / Requires Verification:** رفتار `remoteAddress` و `listen()` روی **named pipe** ویندوز (D5) — در این محیط فقط Linux بررسی شد.
- **Unknown / Requires Verification:** رفتار watcher (`chokidar`/`fs.watch`) وقتی `artifactRoot` روی filesystem شبکه‌ای (NFS/SMB) باشد.
- **Unknown / Requires Verification:** اجرای واقعی `docker compose up` در محیط فعلی ممکن نبود؛ فاز ۴ با `docker compose config` و تست نوشتن روی volume شبیه‌سازی‌شده verify می‌شود.
- **تصمیم قطعی (۲۰۲۶-۰۸-۲۶):** WebSocket پیاده‌سازی می‌شود (D9/فاز ۱۱)؛ شناسه `prj-<slug>-<hash8>` است (D3)؛ flip پیش‌فرض در فاز ۴ انجام می‌شود (D10)؛ و دامنهٔ UI کامل است (فاز ۱۲: داشبورد + فرم پیکربندی + deep link).
- **Assumption:** structured-ai هنگام ثبت پروژه، id خودش را به موتور می‌دهد و موتور آن را بدون تغییر می‌پذیرد (D3/D4).
- **Assumption:** در حالت `--gateway-managed` worker هیچ‌گاه مستقیماً در معرض مرورگر نیست.

---

# Definition of Done (سطح پروژه)

پروژه وقتی کامل است که:

1. همهٔ فازها 🟢 باشند (یا 🟡 با فهرست صریح کار باقی‌مانده).
2. `cd semantic-engine && npm run build && npm run lint && npm test` و `cd structured-ai && npm run check && npm test` سبز باشند.
3. هر بند §۶ `MULTI_PROJECT_GATEWAY_PLAN.md` با تست یا سند، پوشش داده شده باشد.
4. source root هیچ پروژه‌ای به‌خاطر artifact dirty نشود (تست).
5. هیچ secret در لاگ، manifest، registry یا خروجی `--json` ظاهر نشود (تست).
6. این سند به‌روز باشد: وضعیت‌ها، تصمیم‌های تغییرکرده و موارد Unknown.
