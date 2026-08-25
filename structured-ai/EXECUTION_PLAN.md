# پلن اجرایی Structured AI — از Baseline تا Multi-Project و Refactor کامل

**وضعیت:** برنامهٔ اجرایی فعال؛ وضعیت گام‌ها و فازها در همین سند به‌روز می‌شود.
**تاریخ:** 2026-08-25
**بازبینی:** 2026-08-25 — ثبت ۶ تصمیم تکمیلی (پیوست ب)
**پروژه:** `structured-ai`

**منابع مرجع (دمایهٔ کامل نیازمندی‌ها):**

- `MULTI_PROJECT_REFACTOR_ORDER_PLAN.md` — سند حاکم بر **ترتیب** اجرا
- `MULTI_PROJECT_IMPLEMENTATION_PLAN.md` — دامنهٔ کامل فیچر Multi-Project
- `REFACTOR_EXECUTION_PLAN.md` — دامنهٔ کامل refactor ماژولار
- `MULTI_PROJECT_GATEWAY_PLAN.md` (ریشهٔ ریپو) — سمت Semantic Engine (خارج از دامنهٔ این سند)

**رابطه با اسناد مرجع:** این سند ترتیب اجرای سه سند مرجع را به فازهای قابل‌اجرا با معیار پذیرش تبدیل می‌کند و شکاف‌های شناسایی‌شده در بازبینی (از جمله ماژول `discussion/`) را جبران می‌کند. در صورت تعارض ترتیب اجرا میان اسناد مرجع، ترتیب فازهای همین سند معتبر است.

**وضعیت‌های مجاز:**

- 🔴 — پیاده‌سازی نشده
- 🟡 — ناقص/نیازمند تکمیل یا بازبینی
- 🟢 — کامل، یکپارچه و با معیار پذیرش تأییدشده

---

# قوانین ثابت انجام پروژه

قوانین زیر در تمام فازها و گام‌ها الزامی هستند و هیچ فازی مجاز به نقض آن‌ها نیست:

1. **بدون از دست رفتن scope.** هیچ نیازمندی از اسناد مرجع حذف، ساده‌سازی یا به‌تعویق نمی‌افتد مگر با مستندسازی صریح در همین سند. کار تازه‌کشف‌شده با ذکر دلیل به فاز مناسب اضافه می‌شود و گام‌های تکمیل‌شده حذف نمی‌شوند.
2. **حدس ممنوع.** اطلاعات ناموجود با برچسب «Unknown / Requires Verification: ...» و فرض اجتناب‌ناپذیر با برچسب «Assumption: ...» مشخص می‌شود. فرض‌ها بی‌صدا به نیازمندی تبدیل نمی‌شوند.
3. **قانون وضعیت.** پس از هر مرحلهٔ اجرا، status گام و فاز (🔴/🟡/🟢) به‌روز می‌شود. فاز فقط وقتی 🟢 می‌شود که همهٔ گام‌هایش 🟢 و همهٔ معیارهای پذیرشش برقرار باشند. تکمیل بدون verification هرگز اعلام نمی‌شود.
4. **حفظ رفتار موجود.** رفتار single-project فعلی (CLI، ابزارها، session، memory، archive، MCP، UI، eventها) حفظ می‌شود مگر تغییری عمدی و مستند در معیار پذیرش فاز آمده باشد.
5. **قراردادها فقط additive تغییر می‌کنند.** افزودن فیلد جدید به event/API مجاز است؛ تغییر معنای فیلد موجود، حذف فیلد، یا تغییر نام event/ابزار/action ممنوع است (جز با migration عمدی و مستند).
6. **هر فاز پایان‌پذیر و پایدار.** پایان هر فاز: `npm run check` و `npm test` سبز، پروژه در وضعیت سازگار و قابل‌اجرا و قابل rollback. شروع فاز بعدی فقط پس از 🟢 شدن فاز جاری، مگر موازی‌کاریِ مستندشده در همین سند.
7. **wrapperهای legacy** در تمام طول migration حفظ می‌شوند و فقط در فاز ۳۰ حذف می‌شوند.
8. **Feature flagها (لیست واحدِ حاکم):**
   ```text
   PROJECT_CONTEXT_MODE=legacy|modular
   RUN_CONTEXT_MODE=legacy|modular
   PROMPT_BUILDER_MODE=legacy|modular
   SEMANTIC_POOL_MODE=legacy|pool
   RUNTIME_ENGINE_MODE=legacy|modular
   WEB_SERVER_MODE=legacy|modular
   ```
   پیش‌فرض ابتدا legacy است؛ پس از برابری خروجی normalize‌شده و سبز بودن suite، پیش‌فرض به modular تغییر می‌کند؛ حذف flagها فقط در فاز ۳۰.
9. **مرز امنیتی مدل.** `projectId` و مسیر root فقط از runtime context می‌آیند و هرگز از آرگومان‌های قابل‌جعل توسط مدل پذیرفته نمی‌شوند. هیچ ابزار model-facingای برای تغییر project یا root فعال ساخته نمی‌شود.
10. **وابستگی‌ها محترم شمرده می‌شوند.** گامی که به قابلیتِ پیاده‌نشده وابسته است، فقط با stub/mock صریح و مستند اجرا می‌شود.
11. **نه تکه‌تکه، نه فشرده.** ترکیب گام‌ها نباید باعث کاهش اعتبارسنجی، coupling معماری یا ریسک شود؛ تقسیم بیشتر هم نباید فازهای مصنوعی بسازد.
12. **کیفیت production.** هر فاز در محدودهٔ خودش با کیفیت production تحویل می‌شود: خطاها کنترل‌شده، تست مرتبط نوشته‌شده، بدون regression.

---

# پلن اجرایی

**معماری وابستگی کلی:**

```text
فاز ۱ (baseline/contracts)
    └── فاز ۲ (ProjectRegistry + ProjectContext)
            ├── فاز ۳ (AgentRunContext/RunManager)
            │       └── فاز ۴ (Tool Runtime project-aware)
            │               └── فاز ۵ (Prompt Builder)
            │                       └── فاز ۶ (Semantic Pool)
            │                           └── فاز ۷ (اجرای task روی یک project)
            │                               └── فاز ۸ (Persistence per-project)
            │                                   └── فاز ۹ (API/Events/Authz/MCP scope)
            │                                       └── فاز ۱۰ (Concurrency/Observability)
            │                                           └── فاز ۱۱ (UI چندپروژه‌ای)
            │                                               └── فاز ۱۲ (Cross-Project Delegation)
            │                                                   └── فاز ۱۳ (تست‌های نهایی MVP)
            └── فازهای ۱۴ تا ۳۰ (refactorهای بزرگ؛ پس از تثبیت MVP)
```

---

## [🟢] فاز ۱: ثبت Baseline و قراردادهای Regression

**هدف و scope:** قبل از هر تغییر، رفتار فعلی single-project به‌صورت قابل‌تکرار ثبت شود تا در تمام فازهای بعدی بتوان «refactor یا رفتار جدید» را از «شکستن قرارداد» تفکیک کرد. خروجی: fixtureهای deterministic، normalizer، contract testهای اولیه و مستندات قرارداد رویداد/API/action.

**تکمیل 2026-08-25:** suite کامل سبز (437/437)؛ شواهد در `test/fixtures/baseline.md` و کامیت فاز.

### [🟢] گام ۱: اجرای کامل suite فعلی و ثبت نتیجه

**انجام شد (2026-08-25):** `npm run check` و `npm test` هر دو exit 0؛ ۱۴ فایل / ۴۱۵ تست سبز؛ ثبت کامل در `test/fixtures/baseline.md`.

کل تست‌های موجود (`test/*.test.js` — ۱۴ سری شامل tools، hooks، journal، eventstore، runtime، semantic، mcp، archive، e2e، cli، interactive، ui، discussion، web) با `npm test` اجرا شود. خروجی (command، exit code، تعداد تست‌ها، مدت‌زمان) در `test/fixtures/baseline.md` یا معادل آن ثبت شود. **پیش‌نیاز همهٔ فازها:** suite باید قبل از شروع هر تغییری سبز باشد؛ اگر سبز نیست، علت قبل از هر کاری رفع و در همین سند ثبت شود.

### [🟢] گام ۲: ساخت fixtureهای deterministic و normalizer

**انجام شد (2026-08-25):** normalizer در `test/helpers/normalize.js` با تست واحد `test/helpers/normalize.test.js` (6/6)؛ fixtureهای action/prompt/events/api در `test/fixtures/` — همه از روی خروجی واقعی runtime capture شده‌اند (بدون حدس). fixtureهای compaction/delegation/MCP/UI با ارجاع مستند به پوشش موجود در `baseline.md` ثبت شدند و تبدیل به fixture مستقل به فاز ۲۹ موکول شد (تصمیم مستند، نه حذف scope).

در `structured-ai/test/fixtures/` فیکسچر بساز: prompt Main Agent، prompt Sub-Agent، tool requestها، action parsing، context compaction، delegation، MCP discovery، UI state و یک default project ثابت. در `test/helpers/normalize.js` نرمالایزر بساز که timestamp، PID، duration و ترتیب keyهای object را حذف/نرمال کند؛ متن‌ها و فیلدهای قراردادی باید دقیقاً برابر بمانند.

### [🟢] گام ۳: ثبت قرارداد event، API و action

**انجام شد (2026-08-25):** `test/fixtures/CONTRACTS.md` — سیاست additive-only (بخش ۱)، قرارداد event با envelope و inventory (بخش ۲)، قرارداد action (بخش ۳)، قرارداد prompt/request (بخش ۴)، API (بخش ۵)، persistence/CLI (بخش ۶). یافتهٔ باارزش: `turn_id` از قبل مفهوم runtime است و معنایش ثبت شد.

رویدادهای فعلی (نام‌ها و payloadها: `run:start`، `run:end`، `agent:*`، `tool:start/end`، `policy:decision`، `approval:*`، `context:compacted` و سایر موارد موجود)، پاسخ endpointهای Web Console و قرارداد actionهای `tool_call`/`delegate`/`final` را inventory و مستند کن. **سیاست additive-only** (قانون ثابت ۵) به‌صورت صریح در مستند قرارداد درج شود؛ فیلدهای افزودنیِ آینده (`projectId`، `runId`، `turnId`) به‌عنوان تغییر مجاز additive تعریف شوند.

### [🟢] گام ۴: ساخت contract testهای اولیه

**انجام شد (2026-08-25):** سه فایل قرارداد + تست normalizer به زنجیرهٔ `npm test` متصل شدند (اسکریپت `test:contracts` نیز موجود): `test/contracts/events.contract.test.js` (5/5)، `test/contracts/prompt.contract.test.js` (5/5)، `test/contracts/actions.contract.test.js` (6/6). نکتهٔ capture واقعی: request مدل با stub server زنده capture و قفل شد (نه بازسازی فرضی body).

`test/contracts/events.contract.test.js` و `test/contracts/prompt.contract.test.js` را بساز که خروجی فعلی را در برابر fixtureها قفل کنند. این تست‌ها در تمام فازهای بعدی اسکلت regression هستند و با تکمیل هر فاز گسترش می‌یابند (action، tool، api، persistence).

**معیار پذیرش:**

- `npm test` و `npm run check` سبز و نتیجهٔ baseline مستندشده.
- حداقل یک fixture برای هر action (`tool_call`، `delegate`، `final`) و هر بخش اصلی prompt وجود دارد.
- normalizer روی خروجی واقعی تست شده و نویز timestamp/PID/duration را حذف می‌کند.
- contract تست‌های event و prompt اجرا و سبز می‌شوند و با خروجی فعلی سازگارند.
- سیاست additive-only قرارداد به‌صورت مکتوب ثبت شده است.

---

## [🟢] فاز ۲: Project Registry و Project Context

**هدف و scope:** مدل پروژه، ثبت چند پروژه بدون collision، و ساخت context صریح پروژه که تمام runtime آن را دریافت می‌کند. این فاز زیربنای همهٔ فازهای Multi-Project است و هنوز هیچ رفتار model-facingای را تغییر نمی‌دهد (default project رفتار امروز را حفظ می‌کند).

**تکمیل 2026-08-25:** ۱۷ تست جدید سبز؛ suite کامل ۴۵۴/۴۵۴. ماژول‌ها در `agent/projects/`؛ wiring پشت flag `PROJECT_CONTEXT_MODE` (اعلان‌شده در schema تنظیمات).

### [🟢] گام ۱: پیاده‌سازی ProjectRegistry و ProjectStore و ProjectResolver

**انجام شد (2026-08-25):** `agent/projects/ProjectRegistry.js` (canonicalization با `fs.realpathSync`، dedupe روی root canonical، id = slug(name)+hash8(root canonical)، immutable identity fields)، `agent/projects/ProjectStore.js` (registry.json در `~/.local/share/structured-ai` با override `STRUCTURED_AI_DATA_HOME`، نوشتن atomic temp+rename، خطای صریح برای فایل corrupt)، `agent/projects/ProjectResolver.js` + `index.js`. یافتهٔ مهم: قرارداد داخلی repo «هر env var باید تعریف schema داشته باشد» اجرا شد — `STRUCTURED_AI_DATA_HOME` و `PROJECT_CONTEXT_MODE` به DEFINITIONS در `lib/storage.js` افزوده شدند (به‌جای خواندن خام env).

فایل‌های `agent/projects/ProjectRegistry.js`، `agent/projects/ProjectStore.js` و `agent/projects/ProjectResolver.js` را بساز. مدل پروژه طبق سند مرجع: `id`، `name`، `rootPath`، `semanticEndpoint`، `enabled`، `autoStart` و `permissions` (read/write/terminal/git). API: `register`، `get`، `list`، `remove`، `update`، `resolveDefault`. قواعد: root با `realpath` canonical شود؛ root تکراری تشخیص داده شود و پروژهٔ جدید نسازد؛ project ID از root خام ساخته نشود و با rename تغییر نکند؛ root path فقط از registry خوانده شود. registry در data directory مرکزی (`registry.json`) ذخیره شود.

### [🟢] گام ۲: پیاده‌سازی ProjectContext و تزریق آن به مسیر اجرا

**انجام شد (2026-08-25):** `agent/projects/ProjectContext.js` با dataRoot مرکزی برای پروژه‌های ثبت‌شده و dataRoot legacy (`<ws>/.agent`) برای default synthetic؛ `runAgent` حالا `project`/`projectId` می‌پذیرد و در `modular` mode قبل از startRun حل می‌کند (fail-fast) و بعد از آن به `RUN.project` نسبت می‌دهد؛ ناسازگاری root با WORKSPACE_ROOT خطای صریح با ارجاع به فاز ۴ می‌دهد. `legacy` mode به‌صورت کامل رفتار قبلی را حفظ می‌کند (تست: `projectId` نامعتبری در legacy نادیده گرفته می‌شود).

`agent/projects/ProjectContext.js` را بساز با مدل: `projectId`، `projectName`، `workspaceRoot`، `dataRoot` (`{{USER_DATA}}/.structured-ai/projects/<id>`)، `semanticEndpoint`، `permissions`. نقطهٔ ورود `runAgent` توسعه یابد تا یک project یا `{ projectId, projectRegistry }` بپذیرد و بدون آن‌ها default project را resolve کند (سازگاری با CLI فعلی `node bin/agent.js -w <path> "<task>"`). در نبود project معتبر، خطای واضح تولید شود. **پشت flag:** `PROJECT_CONTEXT_MODE`.

### [🟢] گام ۳: تعیین تکلیف `agent/lib/project.js` موجود (تداخل نام‌گذاری)

**انجام شد (2026-08-25):** مرز دو مفهوم در `test/fixtures/CONTRACTS.md` §۶ رسمی شد — ماژول legacy به‌عنوان overlay خوانده می‌شود (رفتار exportها بدون تغییر: `project`/`openProject`/`persistProject`) و سطح multi-project با نام مجزای `projects` از `agent.js` export می‌شود؛ rename ای انجام نشد تا contract حفظ شود.

ماژول فعلی `agent/lib/project.js` مسئول `.agent/project.json` (تنظیمات per-workspace) است و با مفهوم جدید «Project» تداخل مفهومی/نام‌گذاری دارد. **تصمیم تأییدشده (2026-08-25) — مدل Overlay:** فایل legacy `.agent/project.json` در workspace به‌عنوان لایهٔ overlay تنظیمات همچنان **خوانده** می‌شود و در زنجیرهٔ اولویت (global ← project ← run) جای خود را حفظ می‌کند؛ اما مقصد **نوشتنِ** جدید `projects/<id>/project.json` مرکزی است. اجرای کامل این ادغام در فاز ۸ گام ۲ انجام می‌شود؛ در این فاز فقط نام‌گذاری ماژول‌های جدید از این فایل قابل‌تفکیک انتخاب شود (مثلاً `WorkspaceProfile` برای موجودی قدیمی در صورت rename) و boundary دو مفهوم مستند شود. رفتار فعلی `project.openProject()`/`persist()` و exportهای `project`/`openProject`/`persistProject` از `agent.js` بدون تغییر باقی بماند.

**معیار پذیرش:**

- دو پروژه با basename یکسان اما root متفاوت هم‌زمان ثبت می‌شوند و ID متفاوت دارند.
- ثبت مجدد همان root پروژهٔ جدید نسازد؛ rename، ID را تغییر ندهد.
- CLI فعلی بدون `projectId` رفتار قبلی را حفظ می‌کند (default project) و تمام suite سبز می‌ماند.
- `runAgent` بدون ورودی project خطای واضح نمی‌دهد بلکه default را resolve می‌کند؛ با project نامعتبر خطای واضح می‌دهد.
- رفتار `agent/lib/project.js` قدیمی و exportهای مرتبط بدون تغییر است.
- تست‌های unit جدید برای registry (canonicalization، duplicate، rename، remove) وجود دارد و سبز است.

---

## [🟢] فاز ۳: AgentRunContext و RunManager

**هدف و scope:** حذف تدریجی state سراسری `RUN` (خط ۱۷۳۹ `agent/agent.js`) و `AGENT_BUDGET` به‌نفع context متعلق به هر اجرا؛ پیش‌نیاز اجرای هم‌زمان چند task و انتقال امن context در فاز ۴. خروجی: `agent/runtime/AgentRunContext.js`، `agent/runtime/RunManager.js`، `agent/runtime/RunBudget.js`، `agent/runtime/RunCancellation.js`.

**تکمیل 2026-08-25:** ۵ تست جدید سبز؛ suite کامل ۴۵۹/۴۵۹. ماژول‌ها در `agent/runtime/`؛ wiring پشت flag `RUN_CONTEXT_MODE` (اعلان‌شده در schema تنظیمات، همراه `RUN_HISTORY_LIMIT`). گسترش‌های additive در `test/fixtures/CONTRACTS.md` §۸ ثبت شد.
**مرز ثبت‌شده:** جداسازی تضمین‌شده messages/budget/delegation budget/cancellation است؛ state اشتراکی `toolRuntime` (search sessions، telemetry، process sessions) عمداً process-global مانده و در فاز ۴ (Tool Runtime) per-run/per-project می‌شود. اجرای هم‌زمان دو پروژه با دو **root متفاوت** نیز همچنان محدودیت fail-fast فاز ۲ (`assertWorkspaceMatch`) را دارد و با ابزارهای project-aware فاز ۴ باز می‌شود؛ تست هم‌زمانی فاز ۳ با دو پروژهٔ متمایز روی یک root (registered + default synthetic) معیار پذیرش را اقناع می‌کند.

### [🟢] گام ۱: پیاده‌سازی AgentRunContext

**انجام شد (2026-08-25):** `agent/runtime/AgentRunContext.js` با فیلدهای خواسته‌شده (`runId`, `project`, `projectId`, `task`, `parentRunId`, `turnId`, `messages`, `budget`, `cancellation`, `agentBudget`) + سطح سازگاری با فیلدهای legacy `RUN` (getter/setter روی اعضای معنایی) تا مسیر اجرای مشترک بدون fork کار کند. `agent/runtime/RunBudget.js` دو کلاس `RunBudget` (ساعت/ددلاین/hook swap) و `AgentSpawnBudget` (شمارندهٔ spawn) دارد؛ `agent/runtime/RunCancellation.js` مالکیت controller/reason هر Run. در `agent.js` هر ۹۲ دسترسی `RUN.` و ۶ دسترسی `AGENT_BUDGET.` به wrapperهای سازگار `currentRun()`/`currentAgentBudget()` منتقل شد — در legacy همان globalها، در modular context متعلق به زنجیرهٔ async جاری (AsyncLocalStorage در RunManager). flag `RUN_CONTEXT_MODE` در DEFINITIONS تنظیمات اعلان شد (قانون repo که runtime.test اجرا می‌کند). خروجی normalized رفتار single-Run حالت modular با حالت legacy (baseline فاز ۱) بیت‌به‌بیت برابر است (تست اختصاصی؛ تنها تفاوت مجاز: فیلد additive `project_id`).

کلاس `AgentRunContext` با فیلدهای `runId`، `project` (ProjectContext)، `projectId`، `task`، `parentRunId`، `turnId`، `messages`، `budget`، `cancellation`، `agentBudget` را بساز. دسترسی‌های فعلی به `RUN`/`AGENT_BUDGET` در `agent.js` و ماژول‌های lib به context جدید delegate شود (ابتدا wrapper سازگار: getterهای قدیمی contextِ Run جاری را می‌خوانند). **پشت flag:** `RUN_CONTEXT_MODE`.

### [🟢] گام ۲: پیاده‌سازی RunManager و اجرای هم‌زمان

**انجام شد (2026-08-25):** `agent/runtime/RunManager.js` چرخهٔ حیات را مدیریت می‌کند: `createRun` (id یکتا با قالب legacy + پسوند `-r<N>` فقط هنگام برخورد در یک میلی‌ثانیه)، `execute` (دو async scope توأمان: store مخصوص Run برای `currentRun()` و `events.runWithScope` جدید additive در `lib/events.js` که context هم‌بستگی را per-run ایزوله می‌کند)، ردیابی active/finished (سقف `RUN_HISTORY_LIMIT`)، و `cancelRunById` برای لغو خارج از scope. `runAgent` در حالت modular از مسیر `runAgentModular` می‌رود که بعد از resolve پروژه (fail-fast) context را می‌سازد؛ منطق after-task-hook معادل مقایسهٔ previousRunId در legacy دقیقاً بازسازی شده (سیگنال `started_at`). تست‌های `test/runs/run-context.test.js`: legacy بدون رد RunManager، برابری normalized با baseline (تنها تفاوت مجاز `project_id` additive روی همهٔ رویدادهای scoped)، `Promise.all` دو Run روی دو پروژهٔ متمایز بدون تداخل messages/بudget/cancellation/attribution رویدادها (`run_id`+`turn_id`+`project_id`)، و لغو Run الف در میانهٔ پرواز بدون اثر روی Run ب (`status` پایانی: `cancelled`/`completed`).

`RunManager` چرخهٔ حیات Runها (ایجاد، ردیابی، پایان، لغو) را مدیریت کند و اجرای `Promise.all([runAgent(...), runAgent(...)])` را برای دو project متفاوت ممکن سازد. پیام‌ها، budget، شمارندهٔ delegation و cancellation هر Run کاملاً جدا باشد. رویدادهای runtime `runId` (و در حالت modular `projectId` و `turnId`) را به‌صورت additive حمل کنند.

**معیار پذیرش:**

- دو Run هم‌زمان روی دو project مختلف بدون تداخل messages/budget/cancellation اجرا می‌شوند.
- لغو Run الف روی Run ب اثر ندارد.
- خروجی normalize‌شدهٔ رفتار single-Run با baseline فاز ۱ برابر است (نام‌ها و payload منطقی eventها حفظ؛ افزودن `runId`/`projectId` طبق سیاست additive مجاز).
- wrapperهای دسترسی قدیمی به `RUN`/`AGENT_BUDGET` حذف نشده‌اند و suite فعلی سبز است.

---

## [🟢] فاز ۴: Tool Runtime و ابزارهای project-aware (File/Process/Git)

**هدف و scope:** انتقال امن ProjectContext/RunContext به ابزارها و project-aware کردن ابزارهای filesystem، process و git به‌جای اتکای به `WORKSPACE_ROOT` سراسری. خروجی: `agent/tools/ToolContext.js`، API کار در workspace و تبدیل کامل ابزارهای لیست‌شده.

**تکمیل 2026-08-25:** ۹ تست جدید سبز؛ suite کامل ۴۶۸/۴۶۸. اجرای cross-root وقتی فعال می‌شود که هر دو flag `RUN_CONTEXT_MODE=modular` و `PROJECT_CONTEXT_MODE=modular` باشند (در بقیهٔ حالت‌ها guard فاز ۲ ساری است). ابزارهای هنوز تبدیل‌نشده (code_*، plan_*، memory/archive، search_*، runtime_stats) روی root خارج از workspace خطای صریح «not yet project-aware» می‌دهند (فازهای ۶/۸).

### [🟢] گام ۱: اصلاح نقطهٔ اجرای ابزار

**انجام شد (2026-08-25):** `agent/tools/ToolContext.js` ساخته شد — context اجرای ابزار (`{agent, runId, projectId, projectContext}`) را normalize می‌کند، در مفطوم identity را از روی context می‌سازد و helperهای `resolvePath/assertSafe/isInside/relative/root/scoped` را به root مؤثر متصل می‌کند؛ در legacy دقیقاً همان توابع pinned روی WORKSPACE_ROOT صدا زده می‌شوند (رفتار بیت‌به‌بیت قبلی؛ بازگشت context پین‌شده، هرگز null). قانون ۹ به‌صورت مکانیکی اجرا شد: `assertNoIdentityArguments` هر projectId/project/root ورودی از سمت آرگومان‌ها را رد می‌کند و context متناقض (projectId بدون context، context بدون workspaceRoot) خطای صریح دارد؛ در `PROJECT_CONTEXT_MODE=modular` اجرای ابزار بدون context معتبر خطاست. امضای `executeTool(name, args, context)` حفظ و context به implementation به‌عنوان پارامتر دوم رسید (`implementation(args, toolContext)`؛ context.raw همیشه با `{agent}` سازگار است). نقطهٔ فراخوانی در `agent.js` در حالت Run modular از روی `currentRun()` context کامل می‌سازد، در legacy دقیقاً شکل قبلی `{agent}`.

امضای اجرا به `executeTool(name, args, { agent, runId, projectId, projectContext })` تغییر کند؛ implementationها به شکل `implementation(args, context)` سازمان‌دهی شوند. `projectId` در آرگومان‌های کاربر/مدل تزریق نشود (قانون ثابت ۹). ابزار بدون context معتبر اجرا نشود. در حالت `legacy` همان امضای فعلی حفظ شود؛ schema ابزارها و نام آن‌ها در هر دو حالت بدون تغییر.

### [🟢] گام ۲: ساخت Workspace API پروژه‌ای

**انجام شد (2026-08-25):** هستهٔ مرز در `agent/lib/workspace.js` به توابع پارامتردار root استخراج شد (`resolvePathInRoot`، `assertPathSafeInRoot`، `toRelativeInRoot`) و wrapperهای legacy با همان امضای قبلی روی WORKSPACE_ROOT پین ماندند. **انحراف نام‌گذاری مستندشده:** به‌جای overload کردن `resolveWorkspacePath` (که تغییر شکل امضای export موجود = نقض قانون ۵ بود)، API پروژه‌ای با نام‌های جدید افزوده شد: `resolveProjectPath`، `isInsideProject`، `toProjectRelative`، `assertProjectPathSafe` (+ `projectRootOf`) که «project» را هر شیء دارای `workspaceRoot` می‌پذیرند و نبود root خطای صریح است. canonicalization و جلوگیری از escape (با realpath عمیق‌ترین جدِ موجود) عیناً به API پروژه‌ای رسید — تست امنیتی symlink بین دو پروژه سبز است.

`resolveWorkspacePath(projectContext, inputPath)`، `isInsideProject(projectContext, targetPath)` و `toProjectRelative(projectContext, targetPath)` را در لایهٔ workspace پیاده کن (با canonicalization و جلوگیری از path/symlink escape). `agent/lib/workspace.js` و استفاده‌کنندگانش به‌تدریج به این API مسیر شوند.

### [🟢] گام ۳: project-aware کردن ابزارهای فایل، process و git

**انجام شد (2026-08-25):** هر ۱۱ ابزار `fs_*` + `fs_info`؛ هر ۶ ابزار process با `cwd` از root مؤثر context (bwrap نیز همان root را bind می‌کند) و sessionهای دارای مالکیت (`run_id`/`project_id`/`root`; `process_list` در حالت scoped فقط sessionهای همان پروژه، دسترسی متقابل به session پروژهٔ دیگر = «Unknown process»)؛ هر ۷ ابزار git در repository پروژهٔ context. خروجی path نسبی همیشه نسبت به root همان context است. guard حذف root در `fs_delete` و پیام cd در `terminal_exec` به root مؤثر منتقل شدند. state اشتراکی باقی‌مانده از فاز ۳ نیز تثبیت شد: telemetry به bucketهای per-run (+ رکوردهای global با شکل تاریخی؛ `executedToolNames(runId)`) و search sessions با برچسب `run_id` و `resetSessions(runId)`؛ `startRunScope(runId)` فقط scope همان Run را ریست می‌کند و `checkPerformedClaim` هر Run را با تاریخچهٔ ابزار خودش می‌سنجد. ابزارهای تبدیل‌نشده (code_*، plan_*، memory_get/archive_*، search_*، runtime_stats) با gate مکانیکی (از روی کلیدهای خود ماژول‌ها ساخته می‌شود) روی root خارج از workspace خطای phase-tagged می‌دهند؛ معیار «مسیر امن» نه سکوت.

ابزارهای `fs_read`، `fs_read_many`، `fs_list`، `fs_tree`، `fs_stat`، `fs_info`، `fs_write`، `fs_edit`، `fs_mkdir`، `fs_move`، `fs_delete`؛ ابزارهای process (`terminal_exec`، `process_start`، `process_read`، `process_write`، `process_terminate`، `process_list`) با `cwd` گرفته‌شده از `projectContext.workspaceRoot` و sessionهای per-project؛ و ابزارهای git (`git_status`، `git_diff`، `git_log`، `git_branch`، `git_checkout`، `git_add`، `git_commit`) در repository پروژهٔ context.

### [🟢] گام ۴: مرز ماژول داخلی پروژه در tools (بدون ابزار model-facing)

**انجام شد (2026-08-25):** تست منفی در `test/tools/project-tools.test.js` (`no model-facing project tool exists anywhere`): نه `callableToolNames()` و نه خروجی model-facing `resolveTools("*")` هیچ نامی منطبق بر `/project/i` ندارد. منطق مشترک پروژه در لایهٔ tools در `agent/tools/ToolContext.js` زندگی می‌کند — ماژولی داخلی runtime که هرگز در IMPLEMENTATIONS/registry مدل وارد نمی‌شود.

**تصمیم تأییدشده (2026-08-25):** هیچ ابزار model-facingای برای پروژه ساخته نمی‌شود. در صورت نیاز به منطق مشترک پروژه در لایهٔ tools، یک ماژول **داخلی runtime** (مثل `agent/tools/project.js` در ساختار پیشنهادی اسناد مرجع) قابل ساخت است، اما هرگز در `tools registry` مدل قرار نمی‌گیرد و به‌عنوان tool schema در prompt/request ارسال نمی‌شود. لیست، انتخاب و تعویض پروژهٔ فعال فقط از طریق Web API فاز ۹ و UI فاز ۱۱ انجام می‌شود (قانون ثابت ۹). این گام صرفاً مستندسازی این مرز و افزودن تست منفی (عدم وجود ابزار پروژه در خروجی `resolveTools()`) است.

**معیار پذیرش:**

- `fs_read` در project الف نمی‌تواند فایل project ب را بخواند؛ symlink escape بین پروژه‌ها مسدود است (تست امنیتی مخصوص).
- terminal با `cwd` درستِ همان پروژه اجرا می‌شود؛ git در repository درست کار می‌کند.
- اجرای هم‌زمان ابزارهای دو پروژه (با Runهای فاز ۳) تداخل ندارد.
- schema و نام ابزارها و نتایج normalize‌شدهٔ آن‌ها با baseline برابر است؛ policy روی آرگومان‌های resolveشده و context درست اعمال می‌شود.
- telemetry اجرای ابزار شامل `projectId` و `runId` است (additive).

---

## [🟢] فاز ۵: استخراج Prompt Builder (به‌همراه Project-Awareness)

**هدف و scope:** استخراج کامل ساخت prompt از `agent/agent.js` به ماژول‌های مستقلِ تزریق‌پذیر — طبق گام ۳ سند refactor، اما با افزودن `ProjectContextBuilder` — که از این پس به‌جای اجرای دوباره در بخش refactor، **همین‌جا و زودتر** انجام می‌شود (تصمیم سند ترتیب). خروجی: دایرکتوری `agent/prompt/`.
**تکمیل 2026-08-25:** ۷ تست جدید سبز؛ suite کامل ۴۷۵/۴۷۵. ماژول‌ها در `agent/prompt/`؛ مسیر modular پشت flag `PROMPT_BUILDER_MODE` (اعلان‌شده در schema تنظیمات). برابری پیام‌به‌پیام legacy/modular در همان فرایند قفل شد (تست differential) و خروجی modular fixture فاز ۱ را هم ارضا می‌کند.

### [🟢] گام ۱: ساختار prompt/ و facade تزریق‌پذیر
**انجام شد (2026-08-25):** `agent/prompt/` با هر ۱۰ فایل خواسته‌شده ساخته شد. `PromptBuilder` facade فقط از روی closureهای تزریق‌شده کار می‌کند (هیچ import از `agent.js` در ماژول‌ها نیست؛ تنها `lib/storage` برای settings خوانده می‌شود). facade و resolverها در `agent.js` lazily ساخته می‌شوند تا constهای زمان‌بندی‌دار (TDZ) مسیر رجیستری نقض نشود و هیچ stateیی سطح ماژول capture نشود. `resolveTools`/`mcpToolRegistry` به `ToolResolver` و `resolveSkills` به `SkillResolver` منتقل شدند — انتقال واقعی با wrapper سازگار (نه کپی) تا همهٔ call siteهای runtime loop هم از همان نسخهٔ واحد استفاده کنند.


`agent/prompt/` را با `PromptBuilder.js`، `MainPromptBuilder.js`، `SubAgentPromptBuilder.js`، `RuntimeContextBuilder.js`، `ProjectContextBuilder.js`، `RequestBuilder.js`، `ToolResolver.js`، `SkillResolver.js`، `PromptMessages.js` و `index.js` بساز. `PromptBuilder` هیچ وابستگی مستقیم به globalهای `agent.js` نداشته باشد؛ وابستگی‌ها (settings، registry، builders، resolvers، providers) تزریق شوند. **پشت flag:** `PROMPT_BUILDER_MODE`.

### [🟢] گام ۲: انتقال منطق Main و Sub-Agent prompt
**انجام شد (2026-08-25):** ترتیب دقیق پیام‌ها در `MainPromptBuilder` (system ← rules ← runtime_context ← **project_context** ← skills ← personas ← agents ← task؛ `filter(Boolean)` تاریخی حفظ شد) و `SubAgentPromptBuilder` (متن system چندبخشی با join "\n\n" ← runtime_context ← agent_profile ← **project_context** ← available_tools ← task) بازتولید شد؛ درج project_context فقط وقتی پیام غیر null است، پس خروجی بدون پروژه با legacy بیت‌به‌بیت برابر است (تست). Sub-Agent پروژه را از `currentRun().project` می‌گیرد — به ارث از والد، چون زنجیرهٔ delegation در scope async همان Run اجرا می‌شود.


منطق فعلی `createMainAgentMessages` و `buildAgentSystemPrompt`/`createSubAgentMessages` را با ترتیب دقیق پیام‌ها به builderهای جدید منتقل کن. Main: system prompt ← execution rules ← runtime context ← **project context** ← skills ← personas ← agents ← task. Sub-Agent: persona ← execution rules فیلترشده ← agent rules ← skills ← output contract ← delegation policy ← **project context** (به ارث رسیده از والد) ← task/context والد.

### [🟢] گام ۳: RuntimeContextBuilder و ProjectContextBuilder
**انجام شد (2026-08-25):** `RuntimeContextBuilder` فیلد‌به‌فیلد همان ساختار تاریخی را می‌سازد و `refresh()` همان جایگزینی in-place پیام runtime_context را دارد؛ خوانده‌هایبudget/root از closureهای تزریقی می‌آیند (`agentsSpawned`، `runStartedAt`، `runRemainingMs` از context واقعی Run در هر دو حالت). در اجرای modular با پروژه، `workspace.root` و `runtime.workspace_root` و تشخیص repository **root پروژهٔ فعال** را نشان می‌دهند (`detectRepository(root)` پارامتردار شد؛ فراخوانی بدون آرگومان legacy دست‌نخورده). `ProjectContextBuilder` پیام additive `project_context` را با پروژهٔ فعال (id/name/workspace_root)، فهرست `available_projects` به‌جز خودی و سه قاعدهٔ رسمی می‌سازد و بدون پروژه null برمی‌گرداند.


`RuntimeContextBuilder` اطلاعات workspace، repository، plan، memory، archive، policy، endpoints، budget و MCP state را dynamic بسازد و `refreshRuntimeContext()` در ابتدای هر iteration به‌روز کند. `ProjectContextBuilder` پیام `project_context` را با project فعال، فهرست `availableProjects` (در صورت وجود) و قواعد سه‌گانهٔ اسناد مرجع بسازد («فقط project فعال»، «حدس مسیر پروژهٔ دیگر ممنوع»، «attribute به پروژه»).

### [🟢] گام ۴: RequestBuilder و حفظ رفتار dynamic
**انجام شد (2026-08-25):** `RequestBuilder` بدنهٔ درخواست را با همان منطق تاریخی می‌سازد (tool request با tools/parallel_tool_calls/response_format و variant خالی برای Summarizer)؛ `buildAgentRequest` ضمن حفظ امضا wrapper شد و حالا از `agent.js` export هم می‌شود (additive — رفع شکاف مستند refactor). رفتار dynamic با تست زنده قفل شد: ویرایش `system_prompt.txt` و `skills.json` بدون restart در هر دو حالت دیده می‌شود (readTextLive و loadSkills مبتنی بر mtime)؛ gate فعال‌سازی semantic_engine در هر دو حالت با `isActiveSkill` سنخرو است (معنا در این فاز همان اتصال single Semantic Engine — مستند Unknown تا فاز ۶).


بدنهٔ request OpenAI-compatible (model، messages، temperature، tools، `parallel_tool_calls`، `response_format`) را از `RequestBuilder` بساز؛ Summarizer همچنان با `responseFormat: null` و بدون tool schema. رفتار dynamic حفظ شود: خواندن مجدد `system_prompt.txt`/`execution_rules.txt` و registryها با live mtime؛ فیلتر execution rules بر اساس ابزارهای agent؛ کشف ابزارهای MCP قبل از اولین request؛ فعال‌بودن `semantic_engine` skill فقط وقتی Semantic MCPِ **پروژهٔ فعال** ready است؛ skills با `skill_get` on-demand؛ settings جدید از iteration بعدی اثر کنند. **Unknown / Requires Verification:** تا قبل از فاز ۶ که pool ساخته شود، «Semantic MCP پروژهٔ فعال» همان اتصال فعلی single Semantic Engine است.

**معیار پذیرش:**

- خروجی normalize‌شدهٔ prompt Main و Sub-Agent قبل و بعد از استخراج برابر است (با fixtureهای فاز ۱).
- تغییر `system_prompt.txt` یا `skills.json` در request بعدی بدون restart دیده می‌شود.
- خاموش‌کردن Semantic MCP، skill مربوط را از prompt حذف می‌کند.
- project فعال و محدودیت‌های آن در prompt مشخص است؛ Sub-Agent project والد را حفظ می‌کند؛ مدل مسیر/root دلخواه معرفی نمی‌کند.
- tool schemaها در فیلد `tools` (نه متن تکراری) و `response_format`/`temperature`/`parallel_tool_calls` بدون تغییر است.
- `createMainAgentMessages` و سایر exportهای فعلی به‌عنوان wrapper حفظ و suite سبز است.

---

## [🔴] فاز ۶: Semantic Client Pool و routing پروژه‌ای

**هدف و scope:** اتصال هر پروژه به Semantic Worker خودش و project-aware کردن ابزارهای code. **مرز دامنه (تصمیم تأییدشدهٔ 2026-08-25):** پیاده‌سازی Worker Supervisor / Gateway سمت **Semantic Engine** طبق `MULTI_PROJECT_GATEWAY_PLAN.md` انجام می‌شود، اما آن کار **هنوز شروع نشده است**. بنابراین این فاز وابستگی خود را با یک **stub مستند** از قرارداد `/mcp/:projectId` (گام ۴) تأمین می‌کند (قانون ثابت ۱۰) تا توسعه و تست مسدود نشود؛ پس از آماده‌شدن gateway واقعی، یکپارچه‌سازی فقط با تعویض endpoint در registry انجام می‌شود. خروجی: `agent/mcp/SemanticClient.js`، `agent/mcp/SemanticClientPool.js`، `agent/mcp/ProjectSemanticResolver.js` + stub تستی.

### [🔴] گام ۱: استخراج SemanticClient از tools/code.js

منطق اتصال و فراخوانی Semantic Engine (در `agent/tools/code.js`، ‎~۲۲KB) را به کلاس client مستقل با lifecycle روشن (connect/call/disconnect، timeout، خطای کنترل‌شده) منتقل کن. رفتار فعلی (پالت ابزارها، fallback، index sessionها) حفظ شود.

### [🔴] گام ۲: پیاده‌سازی SemanticClientPool

Pool با `get(projectId)`، `connect(project)`، `disconnect(projectId)`، `reload(projectId)` پیاده شود؛ endpoint از `project.semanticEndpoint` (registry) خوانده شود. **پشت flag:** `SEMANTIC_POOL_MODE`؛ در حالت legacy همان client تکیِ فعلی استفاده شود.

### [🔴] گام ۳: project-aware کردن ابزارهای code

ابزارهای `code_index_status`، `code_index_start`، `code_index_get`، `code_find_symbol`، `code_search`، `code_file_summary`، `code_dependencies`، `code_impact`، `code_find_tests`، `code_config_usage`، `code_context`، `code_diagnostics`، `code_callers`، `code_definition` و `code_rename` client را از pool با `projectId`ِ context اجرا بگیرند. cache نتایج Semantic با کلید `projectId` + index generation جدا شود. رفتار degradation (Worker down برای یک پروژه) کنترل‌شده و منحصر به همان پروژه باشد.

### [🔴] گام ۴: ساخت Stub Gateway/Worker برای توسعه و تست

چون gateway سمت engine هنوز پیاده نشده (تصمیم 2026-08-25)، یک server تستی حداقلی بساز که مسیرهای `/mcp/:projectId` را با پاسخ‌های تقلیدیِ قرارداد Semantic MCP (دست‌کم `tools/list` و `tools/call`) سرو کند و حداقل دو `projectId` متفاوت را با پاسخ‌های متمایز جواب دهد. stub در محیط تست نگه داشته می‌شود و در production استفاده نمی‌شود. هدف: اجرای تست‌های isolation pool و فازهای ۷ و ۱۳ بدون انتظار برای gateway واقعی. پس از آماده‌شدن gateway واقعی، تست یکپارچه‌سازی در برابر آن اضافه و stub صرفاً به‌عنوان ابزار unit/regression باقی می‌ماند.

**معیار پذیرش:**

- `code_search` در project الف نتیجهٔ ب را نمی‌دهد؛ index update الف اثری روی ب ندارد.
- اتصال MCP برای هر پروژه مستقل است؛ crash/unavailable شدن Worker یک پروژه فقط ابزارهای code همان پروژه را degrade می‌کند (خطای کنترل‌شده، نه crash runtime).
- در حالت legacy رفتار دقیقاً برابر baseline است؛ در حالت pool، suite سبز و تست‌های isolation برای دو پروژه عبور می‌کند.
- تست‌های pool روی stub با قرارداد `/mcp/:projectId` سبز است و تعویض endpoint در registry (به gateway واقعی در آینده) بدون هیچ تغییری در کد client کافی است.
- cache نتایج بین دو پروژه با root/ID مشابه قاطی نمی‌شود (تست باضافهٔ index generation).

---

## [🔴] فاز ۷: اجرای task روی یک project (زنجیرهٔ کامل)

**هدف و scope:** رساندن زنجیرهٔ `task → projectId → ProjectContext → AgentRunContext → Prompt → ابزارهای project-scoped → Semantic Worker همان پروژه` به یک قابلیت قابل‌استفادهٔ end-to-end برای **یک** project در هر task، هم از CLI و هم از API. این فاز MVPِ اصلی Multi-Project است.

### [🔴] گام ۱: پشتیبانی CLI از انتخاب پروژه

به `bin/agent.js` فلگ `--project <projectId>` اضافه شود تا در کنار `-w` کار کند: `node bin/agent.js --project prj-a -w /path "Run tests"`. قواعد: بدون `--project` همان default project (رفتار امروز)؛ `--project` نامعتبر خطای واضح؛ `--project` با `-w` متفاوت از root ثبت‌شده خطا بدهد (root از registry، نه آرگومان). همچنین `OPENAI-...`/interactive REPL مسیر فعلی را حفظ کنند.

### [🔴] گام ۲: endpoint اجرای task روی پروژه

در `web/server.js` (در این مرحله هنوز monolithic است — refactor آن فاز ۲۳ است) endpoint `POST /api/projects/:projectId/tasks` اضافه شود؛ بدنه `{ task }` را بگیرد، project را resolve کند و Run را با آن context اجرا کند. `POST /api/tasks` فعلی بدون تغییر به default project route شود. پاسخ‌ها و کدهای وضعیت با قرارداد فعلی سازگار باشند (additive برای فیلدهای جدید).

### [🔴] گام ۳: اعتبارسنجی زنجیرهٔ کامل

تست end-to-end برای هر دو مسیر CLI و API: task روی پروژهٔ انتخاب‌شده اجرا شود، همهٔ tool resultها context درست داشته باشند، prompt پروژهٔ درست را معرفی کند و query کد به Worker همان پروژه برود.

**معیار پذیرش:**

- `POST /api/projects/:projectId/tasks` و فلگ `--project` روی پروژهٔ درست اجرا می‌شوند؛ API قدیمی بدون تغییر کار می‌کند.
- در حالت‌های legacy، رفتار دقیقاً برابر baseline است.
- eventهای Run شامل `projectId` و `runId` هستند و در `/api/state` فعلی قابل‌مشاهده (بدون شکستن قرارداد).
- suite سبز + حداقل ۲ تست e2e جدید (یکی CLI، یکی API) موجود و پاس است.

---

## [🔴] فاز ۸: Persistence per-project و migration از single-project

**هدف و scope:** جداسازی کامل stateهای ذخیره‌شدهٔ هر پروژه و مهاجرت بدون‌تلفات state فعلی. **تصمیم سند (پذیرفته‌شده):** ذخیره‌سازی متمرکز در `{{USER_DATA}}/.structured-ai/` — trade-off در برابر نگه‌داشتن state در `.agent/` داخل هر workspace بررسی و در اسناد مرجع به نفع متمرکز (سازگاری با gateway و مستقل‌بودن از حذف workspace) تصمیم‌گیری شده است. خروجی: ساختار data root پروژه‌ای + اسکریپت/مسیر migration.

### [🔴] گام ۱: ساختار ذخیره‌سازی پروژه‌ای

ساختار `{{USER_DATA}}/.structured-ai/{registry.json, projects/<id>/{project.json, memory.json, plan.json, sessions/, archive/, journal/, eventstore/, searches/, processes/, logs/}, runtime/}` را بساز. ماژول‌های `agent/lib/memory.js`، `sessions.js`، `archive.js`، `journal.js`، `eventstore.js`، `plan` و sessionهای search/process مسیرهای خود را از `projectContext.dataRoot` بگیرند (wrapper سازگار: default project به مسیر resolve‌شده از تنظیمات کنونی اشاره می‌کند تا state موجود قابل‌خواندن بماند).

### [🔴] گام ۲: لایهٔ overlay تنظیمات

اولویت `global settings ← project settings ← run override` را پیاده کن؛ `agent/lib/project.js` (gام ۳ فاز ۲) در همین‌جا با تصمیم مستند ادغام/نگاشت شود: خواندن `.agent/project.json` قدیمی حفظ، مقصد نوشتن جدید مشخص، و رفتار overlay (ENV، فایل، runtime override فعلی) دست‌نخورده بماند.

### [🔴] گام ۳: Migration idempotent از `.agent/`

state موجود `<workspace>/.agent/` (memory، sessions، archive، journal، eventstore و project.json) به default project/پروژه‌های ثبت‌شده map شود، بدون حذف فایل‌های قدیمی. migration دوباره‌پذیر (idempotent) و با گزارش واضح باشد؛ corruption در یک فایل مهاجرت کل را متوقف نکند.

**معیار پذیرش:**

- memory/plan/sessions/archive/journal/eventstore/searches/processes هر پروژه کاملاً جداست: memory الف در ب دیده نمی‌شود؛ sessionهای هر پروژه جدا replay می‌شوند.
- sessionهای قدیمی و memory/archive قبلی پس از migration بدون نقص load می‌شوند؛ اجرای مجدد migration چیزی را تکرار/خراب نمی‌کند.
- restart runtime هیچ state پروژه‌ای را از بین نمی‌برد.
- suite فعلی + تست‌های isolation persistence سبز است؛ `npm run check` سبز.

---

## [🔴] فاز ۹: Web APIها، events، authorization و MCP scoping پروژه‌ای

**هدف و scope:** تفکیک کامل سطح دسترسی وب: endpointهای project-scoped، جداسازی event streamها، token scope با `allowedProjects`، approval per-project و scope دادن به MCP serverهای خارجی. خروجی: مجموعهٔ endpointها، event envelope جدید، middleware authorization.

### [🔴] گام ۱: endpointهای مدیریت و استفادهٔ پروژه

`GET/POST /api/projects`، `GET/PATCH/DELETE /api/projects/:projectId`، `GET /api/projects/:projectId/state`، `GET /api/projects/:projectId/sessions`، `POST /api/projects/:projectId/chat`، `POST /api/projects/:projectId/cancel` را پیاده کن (cancel فقط Runهای همان پروژه). رفتار state لاین‌فیلم `/api/state` فعلی برای default project حفظ شود.

### [🔴] گام ۲: event envelope و استریم‌های project-scoped

تمام eventهای runtime به‌صورت additive حامل `projectId`، `runId` و `turnId` شوند. **تعریف `turn_id` (رسمی‌شده پس از بررسی کد در 2026-08-25):** `turn_id` از قبل یک مفهوم runtime است: هر پیام/task کاربر در یک session مکالمه‌ای یک turn تازه می‌سازد؛ قالب `<run_id>_t<N>` با شمارندهٔ افزایشی در هر session، یا مقدار تأمین‌شده توسط caller (مثل web server برای هم‌تراز‌کردن پیام مکالمه با رویدادها). envelope موجود `(run_id, turn_id, scope, iteration)` در `agent/lib/events.js` حفظ می‌شود. سلسله‌مراتب رسمی شناسه‌ها: `project_id` ⊃ `run_id` ⊃ `turn_id` ⊃ `iteration`؛ فیلد additive جدید `project_id` به همان قرارداد snake_case رویدادها اضافه می‌شود (در پاسخ JSON وب با camelCase اسناد مرجع). endpointهای `GET /api/projects/:projectId/events` و `GET /api/events?projectId=...` پیاده شوند؛ event پروژهٔ الف در استریم ب دیده نشود؛ event global فقط metadata تجمیعی نشان دهد.

### [🔴] گام ۳: authorization با token scope

زنجیرهٔ `authenticate → resolve projectId → authorize project access → load ProjectContext → execute` را برای endpointهای پروژه‌ای پیاده کن. مدل token: `allowedProjects` + `permissions` (`project:read`، `project:write`، `semantic:query`، `semantic:index`). token بدون دسترسی `403` بگیرد. logها token و source content را mask کنند.

### [🔴] گام ۴: approval per-project و scoping MCP خارجی

approvalها به‌صورت per-project ذخیره/نمایش داده شوند و approval prompt شامل `projectId` باشد. برای serverهای خارجی در `mcp_servers.json` فیلد `scope: "project"|"global"` (و لیست `projects`) پذیرفته شود؛ `tools/list` فقط ابزارهای مجاز پروژهٔ context را بدهد؛ MCP server پروژهٔ الف به ب دسترسی نداشته باشد. **تصمیم تأییدشده (2026-08-25):** approval برای serverهای `scope: global` در سطح **gateway-level** نگهداری می‌شود و در رویداد/audit با attribution به پروژهٔ درخواست‌کننده (`project_id` در رویداد approval) ثبت می‌شود؛ یعنی یک تأیید global برای پروژه‌های مجاز token کافی است و هر استفاده با شناسهٔ پروژهٔ مصرف‌کننده audit می‌شود.

**معیار پذیرش:**

- token محدود به الف نمی‌تواند ب را query/اجرا کند (`403`)؛ state پروژهٔ الف در ب نمایش داده نمی‌شود.
- cancel پروژه‌ای Runهای پروژهٔ دیگر را متوقف نمی‌کند.
- eventهای additive با قرارداد فاز ۱ سازگارند؛ replay، project context را حفظ می‌کند؛ تعریف `turnId` مستند شده است.
- approval برای ابزارهای filesystem/terminal/MCP شامل `projectId` است و pendingها در UI فعلی (تا پیش از فاز ۱۱) خراب نمی‌شوند.
- approval سرورهای `scope: global` یک‌بار در سطح gateway صادر و هر استفاده با `project_id` مصرف‌کننده audit می‌شود (تست).
- `tools/list` per-project فیلتر می‌شود؛ suite سبز.

---

## [🔴] فاز ۱۰: Concurrency، Resource Limits و Observability

**هدف و scope:** اجرای parallel پایدارِ چند پروژه بدون قفل‌شدن runtime توسط یک پروژهٔ پرمصرف + دید کامل per-project/global. خروجی: محدودیت‌های قابل‌تنظیم، صف per-project، metrics و health surface.

### [🔴] گام ۱: محدودیت‌ها و صف اجرا

تنظیمات `MAX_CONCURRENT_PROJECT_RUNS`، `MAX_RUNS_PER_PROJECT`، `MAX_CONCURRENT_INDEX_RUNS`، `MAX_WORKERS_PER_USER`، `RUN_QUEUE_LIMIT`، `PROJECT_MEMORY_LIMIT` و `PROJECT_CPU_LIMIT` را با **مقادیر پیش‌فرض مستند** پیاده کن. صف اجرا per-project و سیاست عادلانهٔ تقسیم ظرفیت (مثلاً round-robin بین پروژه‌ها) پیاده و مستند شود. cancellation/خرابی یک پروژه صف دیگران را خراب نکند.

### [🔴] گام ۲: metrics و health per-project/global

metricهای `project_runs_total`، `project_active_runs`، `project_failed_runs`، `project_tool_calls_total`، `project_index_state`، `project_last_activity`، `project_memory_bytes`، `project_process_count`، `project_mcp_calls_total` و مجموعهٔ global `gateway_*` را expose کن (endpoint یا فایل telemetry موجود — مسیر دقیق در گام تعیین شود). health یک پروژه خراب، health کل را خراب نکند.

**معیار پذیرش:**

- Runهای پروژه‌های مختلف parallel و Runهای یک پروژه طبق policy serialize/محدود می‌شوند (تست با حداقل ۳ پروژه).
- عبور از حدّ صف، task را با خطا/وضعیت واضح queue/reject می‌کند، نه hang.
- هر event/log Run شامل `projectId` است؛ metrics بین project و global تفکیک‌شده و در API قابل‌خواندن است.
- crash یک پروژه (شبیه‌سازی) در metricها/health پروژهٔ دیگر اثری ندارد؛ suite سبز.

---

## [🔴] فاز ۱۱: UI چندپروژه‌ای (Web Console)

**هدف و scope:** تجربهٔ کاربری کامل مدیریت و استفادهٔ چند پروژه در Web Console موجود (بدون بازطراحی کلی؛ refactor فرانت‌اند در فاز ۲۴ است). خروجی: Project Switcher، صفحهٔ Projects، Task Composer با انتخاب scope، Project Dashboard با تب‌ها.

### [🔴] گام ۱: Project Switcher و مدیریت پروژه‌ها

در header کنسول `[ Project فعال ▼ ] [New Project] [Gateway Health]` اضافه شود. ایجاد/ویرایش/حذف پروژه از UI به API فاز ۹ وصل شود. انتخاب پروژه در store فرانت نگه‌داری و در refresh (localStorage یا URL) حفظ شود.

### [🔴] گام ۲: Task Composer با انتخاب scope

امکان ارسال task با scope «Current project / Specific project / Multiple projects (checkbox لیست)» پیاده شود. حالت چندپروژه‌ای در این فاز فقط به‌عنوان چند Run مستند labelدار (synthesis واقعی در فاز ۱۲) است؛ نتایج per-project گروه‌بندی و labelدار نمایش داده شوند.

### [🔴] گام ۳: Project Dashboard

مسیر `/projects/:projectId` با تب‌های Overview، Agent Runs، Sessions، Memory، Plan، Events، Approvals، Semantic Engine، MCP، Logs و Settings پیاده شود. deep-link مستقیم کار کند؛ Visualizer و Semantic Dashboardِ لینک‌شده `projectId` درست بگیرند.

### [🔴] گام ۴: جداسازی state نمایشی و events در UI

event stream، replay، history، chat و approvals در UI مطابق پروژهٔ فعلی فیلتر شوند (مصرف از endpointهای فاز ۹)؛ هیچ دادهٔ پروژهٔ ب در نمایش A ظاهر نشود. رفتارهای فعلی UI (markdown امن، RTL/LTR خودکار، modal lifecycle، execution blockها) بدون تغییر بماند.

**معیار پذیرش:**

- ساخت/انتخاب/حذف پروژه از UI انجام و task روی پروژهٔ انتخاب‌شده اجرا می‌شود؛ refresh صفحه project را از دست نمی‌دهد.
- dashboard پروژهٔ الف دادهٔ ب را نشان نمی‌دهد؛ deep-link به تب مشخص کار می‌کند.
- نتیجهٔ task چندپروژه‌ای per-project و labelدار نمایش داده می‌شود.
- تست‌های UI/web فعلی بدون تغییر user-facing سبزند؛ حداقل تست UI جدید برای switcher و dashboard وجود دارد.

---

## [🔴] فاز ۱۲: Cross-Project Delegation

**هدف و scope:** پشتیبانی امن از taskهای عمداً چندپروژه‌ای با Sub-Agentهای مستقل per-project و synthesis فقط از خروجی labelدار. خروجی: پشتیبانی delegation از `projectId` و قرارداد نتیجهٔ labelدار.

### [🔴] گام ۱: پشتیبانی `projectId` در delegation

action `delegate` بتواند `projectId` بگیرد؛ نبود آن یعنی «پروژهٔ فعال». Sub-Agent با ProjectContext مستقل (fاز ۵: project context به ارث رسیده/تنظیم‌شده) اجرا شود و تغییر آن در میانهٔ Sub-Agent ممنوع باشد. budget/depth لاین‌فیلم delegation (max depth، بودجهٔ Sub-Agentها) بدون تغییر.

### [🔴] گام ۲: قرارداد نتیجهٔ labelدار و قواعد نوشتن

نتیجهٔ هر delegation شامل `projectId`، `success` و یافته‌ها باشد؛ synthesis (گزارش نهایی Main Agent) فقط به نتایج labelدار ارجاع دهد. نوشتنِ cross-project (ابزار write روی پروژه‌ای غیر از پروژهٔ Sub-Agent — عملاً غیرممکن مگر با delegation جدید) و هر عمل write در task چندپروژه‌ای نیازمند approval جدا باشد.

**معیار پذیرش:**

- دو Sub-Agent روی دو پروژه هم‌زمان و بدون قاطی‌شدن ابزار/message اجرا می‌شوند.
- خرابی Sub-Agent یک پروژه مانع گزارش پروژهٔ دیگر نمی‌شود (partial failure کنترل‌شده).
- گزارش نهایی منشأ پروژه‌ای هر یافته را مشخص می‌کند (تست روی خروجی).
- approval برای عملیات write cross-project مجزا صادر می‌شود؛ suite + تست delegation جدید سبز.

---

## [🔴] فاز ۱۳: تست‌های Isolation، Load و پذیرش End-to-End (درگاه MVP)

**هدف و scope:** درگاه رسمی پذیرش MVP Multi-Project: اثبات ایزولیشن، پایداری و سازگاری قبل از شروع refactorهای بزرگ. این فاز feature جدید نمی‌سازد؛ شواهد می‌سازد.

### [🔴] گام ۱: سری تست‌های isolation

تست‌های: Project isolation (basename یکسان، root متفاوت، artifact و state مستقل، نتیجهٔ Semantic مستقل)؛ Tool isolation (read/write/terminal/git/process)؛ Runtime isolation (Run هم‌زمان، budget، cancellation، delegation)؛ MCP isolation (`/mcp/a` و `/mcp/b`: tools/list و tools/call جدا، connection و cache جدا)؛ Persistence isolation (memory/plan/session/archive/event replay جدا) — همه در `test/` با ساختار مناسب ثبت شوند.

### [🔴] گام ۲: تست بار و recovery

دو task سنگین هم‌زمان روی دو پروژه + یک پروژهٔ سوم در صف؛ شبیه‌سازی crash یک Worker و یک Run و ادامهٔ پروژه‌های دیگر بدون interruption؛ رفتار queue و limitها (fاز ۱۰) تحت بار.

### [🔴] گام ۳: سناریوی پذیرش end-to-end ده‌مرحله‌ای

اجرای خودکار/نیمه‌خودکار سناریوی سند مرجع: راه‌اندازی → ثبت پروژه‌های A و B → انتخاب‌پذیری → دو task هم‌زمان → workspace صحیح → Semantic route صحیح → state مستقل → خرابی یک Worker/Run → ادامهٔ پروژهٔ دیگر → نمایش درست UI. نتیجه و شواهد در سند ثبت شود.

**معیار پذیرش:**

- همهٔ تست‌های isolation و load و سناریوی ده‌مرحله‌ای سبز و در CI محلی قابل‌تکرار (`npm test` سبز، شامل سری‌های جدید).
- API و CLI single-project بدون تغییر ظاهری کار می‌کنند (قرارداد baseline سبز).
- MVP رسماً پذیرفته می‌شود و flagهای `*_MODE` روی مقادیر modular نهاییِ این scope قفل می‌شوند (پیش‌فرض برنامه برای فازهای refactor بعدی).

---

## [🔴] فاز ۱۴: Application Layer، Config و Registry

**هدف و scope:** آغاز refactorهای بزرگ: جداسازی نقطهٔ ورود runtime از منطق داخلی (facade سازگار) و خارج‌کردن تنظیمات و registryهای declarative از monolith. خروجی: `agent/application/` و `agent/config/` و `agent/registry/(loader|validator|...)`.

### [🔴] گام ۱: لایهٔ Application و facade سازگار

`agent/application/run-agent.js` (+ `run-session.js`، `lifecycle.js`) را بساز؛ startup/shutdown و lifecycle به آن منتقل شود؛ `agent/agent.js` facade موقت بماند و **همهٔ exportهای فعلی** (runAgent، main، callAI، parseStructuredResponse، adaptNativeToolCalls، validateAction، executeDependencyGraph، resolveTools، createRuntimeContext، maintainContext، refreshRuntimeContext، memoryStore، project، sessions، eventstore، openProject، persistProject، mcp و سایر موارد موجود) دقیقاً حفظ شود. eventهای `run:start`/`run:end` payload قبلی را داشته باشند.

### [🔴] گام ۲: تفکیک Config

`agent/config/SettingsSchema.js`، `SettingsStore.js`، `SettingsResolver.js`، `SecretMasker.js` را از `agent/lib/storage.js` (‎~۴۴KB) استخراج کن: schema (type/default/min-max/توضیح)، get/set/reset/sourceOf/snapshot، اولویت env/فایل/override فعلی حفظ، masking secretها در UI/log/context حفظ. تغییر setting از UI همچنان از iteration بعدی اثر کند.

### [🔴] گام ۳: تفکیک Registry و تقسیم tools.json

`RegistryLoader.js`، `RegistryValidator.js`، `AgentRegistry.js`، `ToolRegistry.js`، `SkillRegistry.js` را بساز و `loadRegistries()` فعلی با live reload (mtime/size) به loader جدید منتقل شود. `agent/registry/tools.json` (‎~۶۱KB) به گروه‌های `tool-schemas/{filesystem,process,git,code,planning,memory,mcp}.json` تقسیم شود و loader خروجی را در قالب آرایهٔ فعلی برگرداند (مدل و runtime تغییری نبینند). سایر فایلها (agents.json، personas.json، skills.json، tool_groups.json، policy.json، mcp_servers.json، hooks.json) در محل فعلی بمانند و از طریق loader خوانده شوند.

### [🔴] گام ۴: wrapperهای سازگار در agent.js

facade فقط delegate باشد و business logic جدیدی در آن نیاید؛ خروجی `resolveTools()` قبل/بعد برابر؛ registry خراب خطای واضح بدهد نه crash مبهم.

**معیار پذیرش:**

- CLI فعلی بدون تغییر کار می‌کند؛ `require('./agent/agent')` همان امضای امروز را برمی‌گرداند (تست سطح module).
- تمام settingها با default/type/اولویت قبلی موجودند؛ snapshot ماسک‌شده است.
- loader جدید همان آرایهٔ tools قدیمی را تولید می‌کند (تست parity)؛ live reload کار می‌کند.
- suite سبز؛ `npm run check` سبز.

---

## [🔴] فاز ۱۵: Action Parser و Response Normalizer

**هدف و scope:** خارج‌کردن خواندن/ترمیم/نرمال‌سازی/اعتبارسنجی پاسخ مدل از runtime loop. خروجی: `agent/actions/`.

### [🔴] گام ۱: استخراج ماژول‌ها

`ActionParser.js` (JSON، fenced JSON، provider response)، `NativeToolCallAdapter.js` (تبدیل native tool calls به action داخلی)، `ResponseRepair.js` (envelope ناقص، pathهای Markdown)، `ActionValidator.js` (schema و field matrix)، `ActionNormalizer.js` و `ActionErrors.js` را از `agent.js` استخراج کن. exportهای wrapper (`parseStructuredResponse`، `adaptNativeToolCalls`، `parseToolArguments`، `repairStructuredAction`، `readModelAction`، `isModelResponseError`، `validateAction`) حفظ شوند.

### [🔴] گام ۲: قفل‌کردن رفتار خطا و retry

پاسخ ناقص/خراب همان retry و error code و `response_diagnostics` فعلی را تولید کند؛ حالت strict/non-strict `response_format` حفظ شود. تست‌های malformed-response از fixtureهای فاز ۱ برابری خروجی را تأیید کنند.

**معیار پذیرش:**

- همهٔ actionهای معتبر فعلی معتبر می‌مانند؛ native tool calls همان action قبلی را می‌سازند.
- پیام‌های خطا و کدهای خطا (additive به استثنای سیاست) تغییر نکرده‌اند؛ تست‌های parser/validator جدید + suite سبز.

---

## [🔴] فاز ۱۶: Runtime Loop و Agent Orchestration

**هدف و scope:** استقلال حلقهٔ iteration، execution graph، delegation و budget. خروجی: `agent/runtime/` (تکمیل فاز ۳): `AgentRun.js`، `IterationRunner.js`، `ActionProcessor.js`، `ToolGraphExecutor.js`، `DelegationRunner.js`، `RetryController.js`، `RunState.js`، `ReportVerifier.js` (+ `RunBudget.js`/`RunCancellation.js` موجود).

### [🔴] گام ۱: استخراج حلقه و dispatch

جریان `initialize → discover → hooks(before) → iteration loop (maintain context → refresh → request → parse → process → append) → hooks(after) → verify report` را به ماژول‌ها منتقل کن؛ `ActionProcessor` فقط dispatch کند: `tool_call` به `ToolGraphExecutor`، `delegate` به `DelegationRunner`، `final` به finalization. **پشت flag:** `RUNTIME_ENGINE_MODE`.

### [🔴] گام ۲: حفظ معنای اجرا

ترتیب execution waveها، رفتار `depends_on`، max iterations، deadline، cancellation، بودجه و عمق delegation، و ReportVerifier (جلوگیری از ادعای تأییدنشده) دقیقاً حفظ شود؛ eventهای runtime همان زمان‌بندی و payload منطقی قبلی.

**معیار پذیرش:**

- تست‌های runtime/e2e فعلی بدون تغییر سبزند؛ خروجی normalize‌شدهٔ یک سناریوی delegation با baseline برابر است.
- در هر دو حالت flag رفتار برابر؛ suite سبز.

---

## [🔴] فاز ۱۷: Context، Memory و Archive

**هدف و scope:** استقلال مدیریت context از runtime و persistence. خروجی: `agent/context/` + repositoryهای مرتبط در `agent/persistence/`.

### [🔴] گام ۱: استخراج مدل context

`ContextManager.js`، `ConversationSizer.js`، `ExchangeDetector.js`، `ContextCompactor.js`، `MemoryCoordinator.js`، `ArchiveCoordinator.js` را از `lib/context.js`، `lib/memory.js`، `lib/archive.js` و بخش‌های `agent.js` استخراج کن. رفتار: recent exchanges دست‌نخورده، فشرده‌سازی light/medium/heavy، fold به archive، نوشتن archive قبل از compaction، جای memory message دست‌نخورده. تنظیمات `MAX_CONTEXT_CHARS`، `CONTEXT_COMPACT_AT`، `KEEP_RECENT_EXCHANGES`، `CONTEXT_LIGHT_CHARS`، `CONTEXT_MEDIUM_CHARS`، `CONTEXT_SUMMARY`، `MEMORY_*`، `ARCHIVE_*` بدون تغییر.

### [🔴] گام ۲: repositoryهای Memory/Archive

`MemoryRepository.js` و `ArchiveRepository.js` در مسیر data root پروژه‌ای (فاز ۸) عمل کنند؛ `archive_search`/`archive_get` نتایج برابر baseline بدهند؛ بازیابی پس از restart حفظ.

**معیار پذیرش:**

- تعداد/ترتیب پیام‌های نگه‌داشته‌شده و محل memory message برابر؛ جفت tool call/result از هم جدا نمی‌شود.
- سقف context هیچ request بزرگ‌تری از قبل تولید نمی‌کند (تست با fixture compaction).
- بازیابی memory/archive پس از restart و تست‌های archive/search سبز؛ suite سبز.

---

## [🔴] فاز ۱۸: Persistence Repositories و Atomicity

**هدف و scope:** فایل‌فرمت‌های session، memory، journal، eventstore و archive از implementation domain جدا شوند؛ نوشتن اتمیک و مقاوم به corruption.

### [🔴] گام ۱: لایهٔ پایه

`AtomicFile.js` (temp + rename)، `JsonRepository.js`، `SafeIdentifier.js`، `SchemaVersion.js` را بساز؛ قالب و محل فایل‌ها (مسیرهای فاز ۸ و `.agent/` legacy) تغییر نکند.

### [🔴] گام ۲: repositoryهای domain

`SessionRepository.js`، `JournalRepository.js`، `EventStoreRepository.js` (+ تکمیل `MemoryRepository`/`ArchiveRepository` فاز ۱۷) با fallback کنترل‌شده برای فایل خراب و version/migration handler. safe ID فعلی sessionها حفظ شود.

**معیار پذیرش:**

- فایل‌های موجود بدون migration دستی خوانده می‌شوند؛ replay session قدیمی سالم.
- crash وسط write فایل ناقص نمی‌گذارد (تست تزریق خطا)؛ خرابی یک فایل runtime را (مگر طبق قرارداد فعلی) متوقف نمی‌کند.
- suite سبز.

---

## [🔴] فاز ۱۹: تفکیک Tools و Tool Registry

**هدف و scope:** جداسازی implementation، lifecycle و گروه‌بندی ابزارها بدون تغییر schema/قرارداد. خروجی: زیرساختار `agent/tools/`. (ابزارها در فاز ۴ project-aware شده‌اند؛ این فاز ساختار داخلی‌شان را ماژولار می‌کند.)

### [🔴] گام ۱: ساختار گروهی ابزارها

`agent/tools/` با `ToolRuntime.js`، `ToolRegistryAdapter.js` و گروه‌های `filesystem/`(PathBoundary، ReadTools، WriteTools، DirectoryTools، FileMetadataTools)، `process/`(ProcessManager، ForegroundCommand، BackgroundSession)، `code/`(SemanticClient→ اشتراک با فاز ۶، SemanticTools، LiveLspTools، IndexSessions)، `planning/`(PlanModel، PlanRepository، PlanTools)، `memory/`(MemoryTools، ArchiveTools) و `index.js` بازسازی شود. تعریف و implementation قابل‌مقایسه بمانند (registry → schema، runtime → implementation، validator → parity check).

### [🔴] گام ۲: حفظ نگه‌دارنده‌های امنیتی/رفتاری

workspace boundary و symlink protection، process group kill و timeout، semantic fallback و index sessionها، tool result cap و telemetry با مقادیر/رفتار قبلی. امضای `executeTool()` (فاز ۴) سازگار بماند.

**معیار پذیرش:**

- همهٔ نام‌ها/schemaها/validationها برابر؛ parity loader=fаз ۱۴ سبز.
- testهای `tools.test.js` و سری‌های isolation فاز ۱۳ سبز؛ suite سبز.

---

## [🔴] فاز ۲۰: تفکیک MCP Layer

**هدف و scope:** ماژولارسازی config، connection، protocol، catalogue و transportهای MCP. خروجی: بازسازی `agent/mcp/` طبق سند refactor.

### [🔴] گام ۱: تقسیم manager و config

از `mcp/manager.js` (‎~۱۸KB) و `mcp/config.js` (‎~۱۵KB) بساز: `McpManager.js`، `McpConfigLoader.js`، `McpConfigValidator.js`، `McpConnection.js`، `McpCatalogue.js`، `McpTrustPolicy.js`؛ چهار transport فعلی در `transports/` (Stdio، Http، Sse، WebSocket) حفظ؛ protocol codecها در `protocol/` (JsonRpc، ContentLength، Ndjson، Errors). رفتار: discovery، namespaced tools، `mcp_call`، trust/approval، timeout، max message size، runtime add/remove و Semantic Engine به‌عنوان built-in server.

### [🔴] گام ۲: تست‌های framing و collision

split/merge شدن پیام‌ها درست decode شود؛ ابزارهای هم‌نامِ serverهای مختلف collision نداشته باشند؛ server خراب runtime را crash نکند.

**معیار پذیرش:**

- handshake هر ۴ transport موفق؛ `mcp.test.js` و `semantic.test.js` بدون تغییر سبز.
- scoping پروژه‌ای فاز ۹ (فیلتر `tools/list`) حفظ؛ suite سبز.

---

## [🔴] فاز ۲۱: Policy و Approval

**هدف و scope:** استقلال boundary امنیتی: matching، lifecycle تأیید و enforcement. خروجی: `agent/policy/`.

### [🔴] گام ۱: استخراج موتور و matcher

`PolicyEngine.js`، `PolicyMatcher.js`، `PolicyRegistry.js`، `ApprovalManager.js`، `ApprovalStore.js`، `PolicyErrors.js` را از `agent/lib/policy.js` و بخش‌های `agent.js`/`server.js` استخراج کن. flow: allowlist agent ← argument resolution ← PolicyMatcher ← allow/deny/approval ← execution ← audit event. حالت‌های `auto`، `prompt`، `deny` و approvalهای filesystem/terminal/MCP حفظ؛ policy روی آرگومان resolveشده اعمال شود؛ هیچ callای بدون عبور از policy.

### [🔴] گام ۲: سازگاری approval با Multi-Project

pendingها همان‌طور که فاز ۹ تعریف کرد per-project بمانند؛ eventهای `policy:decision`/`approval:request`/`approval:resolved` payload سازگار (به‌علاوهٔ فیلدهای additive) داشته باشند.

**معیار پذیرش:**

- تست‌های policy/approval (موجود در suite وب/runtime) سبز؛ deny/approval eventها payload قبلی+additive دارند.
- `policy.json` فعلی بدون تغییر معنایی خوانده می‌شود؛ suite سبز.

---

## [🔴] فاز ۲۲: Hooks

**هدف و scope:** تفکیک registry، شرط‌سنجی، rendering و اجرای hookها. خروجی: `agent/hooks/`.

### [🔴] گام ۱: استخراج ماژول‌ها

`HookRegistry.js`، `HookLoader.js`، `HookCondition.js`، `HookRenderer.js`، `HookRunner.js`، `HookResult.js` از `agent/lib/hooks.js` (‎~۱۷KB). رفتار: ترتیب before/after، `on_failure`، متغیرهای template، eventهای hook، hookهای نامعتبر/غیرفعال، hook commit و hook agent دقیقاً حفظ.

**معیار پذیرش:**

- `hooks.test.js` بدون تغییر سبز؛ `hooks.json` و `runHooks`/`hookRegistry` wrapper سازگار؛ suite سبز.

---

## [🔴] فاز ۲۳: Web Backend

**هدف و scope:** تفکیک `web/server.js` (‎~۷۲KB — اندازهٔ به‌روز، سند refactor مقدار ~۶۰KB را ذکر کرده) به server، router، controllerها، serviceها و serializerها بدون تغییر قرارداد. **پشت flag:** `WEB_SERVER_MODE`.

### [🔴] گام ۱: inventory و contract test مسیرها

همهٔ routeهای فعلی (شامل routeهای project-scoped فاز ۹ و discussion endpointها) فهرست و برای هر یک contract test (status + شکل JSON) ساخته شود.

### [🔴] گام ۲: انتقال به controller/service

ساختار `WebServer.js`، `Router.js`، `RequestBody.js`، `Response.js`، `Middleware.js`، `controllers/`(Task، Session، State، Settings، Approval، Mcp، Archive، Plan + Project/Run/Discussion controllers)، `services/`(Task، Session، Settings، EventStream)، `serializers/` و `SseHub.js` پیاده شود؛ handlerها یکی‌یکی منتقل شوند؛ server فقط routing/lifecycle نگه دارد. پاسخ‌ها و کدهای وضعیت دست‌نخورده؛ SSE قطع نشود.

**معیار پذیرش:**

- contract test همهٔ endpointها سبز؛ approval UI/API، session replay، settings و MCP live reload کار می‌کند.
- `web.test.js` و تست‌های API فاز ۹ سبز؛ suite سبز.

---

## [🔴] فاز ۲۴: Frontend Web Console

**هدف و scope:** تفکیک `web/public/app.js` (‎~۱۲۸KB — اندازهٔ به‌روز) به ماژول‌های مستقل بدون framework سنگین.

### [🔴] گام ۱: تصمیم قالب ماژول — Unknown / Requires Verification

قالب ماژول فرانت‌اند در اسناد مرجع تعیین نشده است. در همین گام تصمیم و مستند شود. **Assumption (پیش‌فرض اجرایی):** ESM نیتیو مرورگر (`<script type="module">`) بدون build step؛ اگر محدودیت نیتیو (مثل تعداد درخواست/سازگاری) اثبات شود، bundler سبک با خروجی به همان مسیرها انتخاب و این گام به‌روز شود.

### [🔴] گام ۲: تقسیم به ماژول‌ها و store دامنه‌ای

`app/` را با `main.js`، `store.js`، `api.js`، `event-stream.js`، `task-runner.js`، `chat.js`، `execution-view.js`، `event-view.js`، `settings-view.js`، `mcp-view.js`، `history-view.js`، `plan-view.js`، `modal-manager.js`، `markdown.js`، `direction.js`، `dom.js`، `formatters.js` (+ ماژول‌های project فاز ۱۱) بساز. state به domainهای `runtimeState`، `conversationState`، `executionState`، `eventState`، `approvalState`، `settingsState`، `mcpState`، `historyState`، `planState` (+ projectState) تقسیم شود؛ reducerها همان eventهای فعلی+additive را مصرف کنند.

### [🔴] گام ۳: حفظ رفتار کاربر

Markdown امن (بدون اجرای HTML خطرناک)، RTL/LTR خودکار (`dir="rtl"` برای فارسی/عربی/عبری)، execution block per iteration، modal lifecycle پایدار در باز/بسته متوالی، event replay بدون duplicate، history، cancel، MCP settings، plan display و **همهٔ selectorها و idهای HTML** حفظ شوند.

**معیار پذیرش:**

- تست‌های `ui.test.js`/`web.test.js` بدون تغییر user-facing سبز؛ replay duplicate ایجاد نمی‌کند؛ reasoning/پاسخ از بین نمی‌رود.
- بارگذاری بدون build step (یا با خروجی build سازگار با مسیرهای فعلی) کار می‌کند؛ suite سبز.

---

## [🔴] فاز ۲۵: Visualizer

**هدف و scope:** استقلال Visualizer از chat console و state عمومی UI.

### [🔴] گام ۱: تفکیک ماژول‌ها

`web/public/visualizer/` را با `main.js`، `api-client.js`، `graph-store.js`، `graph-model.js`، `graph-renderer.js`، `layout-client.js`، `selection-state.js`، `node-details.js`، `visualizer-events.js` بازسازی کن (از `visualizer.js` فعلی + workers). graphهای architecture/module/file/neighborhood، layout worker و fallback، انتخاب node و نمایش detail حفظ شود؛ API callهای semantic با همان URL/payload (به‌علاوهٔ `projectId` در حالت چندپروژه‌ای).

**معیار پذیرش:**

- رفتار graph/layout/selection برابر؛ نشتی state بین sessionها/پروژه‌ها نیست؛ تست‌های UI مرتبط سبز؛ suite سبز.

---

## [🔴] فاز ۲۶: CLI و Interactive REPL

**هدف و scope:** استقلال CLI اصلی و REPL. خروجی: `agent/cli/` و `agent/interactive/`.

### [🔴] گام ۱: تفکیک parsing و commandها

از `bin/agent.js` و `bin/interactive.js` (logic تعبیه‌شده) بساز: `ArgParser.js`، `CommandRegistry.js`، `OutputFormatter.js`، `RunCommand.js`، `ServeCommand.js`، `InteractiveCommand.js`، `HelpCommand.js` و `Repl.js`، `ReplCommands.js`، `InputReader.js`، `OutputRenderer.js`، `ApprovalPrompt.js`. binها wrapper نازک شوند. رفتار: commandها و فلگ‌های فعلی (شامل `--project` فاز ۷)، `--json` فقط JSON معتبر روی stdout، log stream و final output فعلی، فرمان‌های REPL (`/help`، `/clear`، `/history`، `/approve`، `/tools`، `/save`) و approval prompt سازگار با runtime.

**معیار پذیرش:**

- `cli.test.js` و `interactive.test.js` بدون تغییر سبز؛ `bin/backfill-eventstore.js` کار می‌کند؛ suite سبز.

---

## [🔴] فاز ۲۷: Event Contract و Observability Boundaries

**هدف و scope:** تفکیک تولید، اعتبارسنجی، ذخیره، replay و نمایش eventها با قرارداد پایدار. خروجی: `agent/events/`.

### [🔴] گام ۱: لایهٔ events

`EventBus.js`، `EventTypes.js`، `EventValidator.js`، `EventContext.js`، `EventProjector.js`، `EventRedactor.js` را بساز. نام‌های event فعلی حفظ؛ payload validation اضافه شود؛ secret و source content در log/redaction ماسک شوند؛ journal و eventstore همان eventها را ذخیره کنند؛ UI همان eventها (+ additive) را replay کند؛ telemetry از business event جدا باشد. تعریف مستند `turnId` (خروجی فاز ۹) در contract درج شود.

**معیار پذیرش:**

- contract test رویدادها (فاز ۱ + گسترش) سبز؛ replay در UI خراب نمی‌شود؛ دادهٔ پروژه‌ای در رویداد پروژهٔ دیگر ظاهر نمی‌شود (تست isolation)؛ suite سبز.

---

## [🔴] فاز ۲۸: ماژولارسازی و یکپارچه‌سازی ماژول Discussion (جبران شکاف)

**هدف و scope:** ماژول `agent/discussion/` (~۵۰KB در ۸ فایل: `engine`، `index`، `loopDetector`، `observerRunner`، `personaRunner`، `personas`، `transcript`، `types`) + ابزار `agent/tools/discussion.js` (~۱۱KB) + بخش‌های `web/server.js` (۵۲ ارجاع) در هیچ‌کدام از اسناد مرجع پوشش نداشته‌اند. این فاز جای آن‌ها را در معماری هدف تعیین و اجرا می‌کند. **پیش‌نیاز فازهای ۱۴–۱۶:** discussion از طریق `callAI` (مسیر request رانتایم) با endpoint resolution نقش‌محور کار می‌کند؛ بنابراین پس از تثبیت لایه‌های application/runtime اجرا می‌شود.

### [🔴] گام ۱: inventory مسئولیت‌ها و قراردادها

مرزهای ماژول را مستند کن: DiscussionEngine (ارکستر rounds)، PersonaRunner/ObserverRunner (فراخوانی LLM با `callAI` و `MAX_PARALLEL_AGENTS` budget)، LoopDetector، TranscriptStore (در حافظه)، personas ثابت + پروفایل‌های `discussion_*` در registry (که از تبلیغ delegation فیلتر می‌شوند)، ابزار `discussion_start`، endpointها/UI وب (۵۲ ارجاع در server.js). قرارداد هر سطح (tool args، APIها، eventها) مشخص و contract test ساخته شود.

### [🔴] گام ۲: سازگاری Multi-Project

discussion باید ProjectContext/RunContext فعلی را مصرف کند: `workspaceContext` و endpoint resolution از context پروژه؛ eventهای آن `projectId`/`runId` حمل کنند. **تصمیم تأییدشده (2026-08-25):** transcript discussion به‌صورت **per-project پایدار** می‌شود — علاوه‌بر `TranscriptStore` فعلیِ درون‌حافظه‌ای، خلاصه/خروجی هر session بحث در `dataRoot` پروژه (فاز ۸) با repository ساخته‌شده در فاز ۱۸ ذخیره و قابل مرور/replay شود؛ این تفاوت رفتاری به‌عنوان بهبود محصول تعمدی در همین گام مستند می‌گردد (قانون ثابت ۴).

### [🔴] گام ۳: ورود به ساختار هدف

جای نهایی ماژول در ساختار refactor تعیین و اجرا شود (پیشنهاد: باقی‌ماندن در `agent/discussion/` با facade `index.js` تزریق‌پذیر — `createLlmCaller` به‌جای وابستگی به globalهای `agent.js` روی interface application (فاز ۱۴) سوار شود)؛ وابستگی معکوس `discussion ← agent.js` حذف شود.

**معیار پذیرش:**

- `discussion.test.js` بدون تغییر رفتار سبز؛ discussion همراه Runهای پروژه‌ای درست (context صحیح، event labelدار) کار می‌کند.
- transcript هر بحث در `dataRoot` همان پروژه ذخیره و بازیابی می‌شود؛ transcript پروژهٔ الف در ب دیده نمی‌شود (تست isolation).
- contract testهای discussion (tool + API) موجود؛ وابستگی جهتی تمیز (بدون require چرخه‌ای به `agent.js`)؛ suite سبز.

---

## [🔴] فاز ۲۹: تفکیک Test Suite و تکمیل Contract Tests

**هدف و scope:** انتقال از «یک فایل برای همه‌چیز» به تست‌های domain-based بدون افت پوشش.

### [🔴] گام ۱: ساختار جدید تست‌ها

`test/` را به `contracts/` (action، tool، event، api، persistence + discussion)، `prompt/`، `runtime/`، `actions/`، `context/`، `tools/`، `mcp/`، `web/`، `ui/`، `projects/`، `discussion/` و `e2e/` سازمان‌دهی کن؛ ۱۴ فایل فعلی به ماژول‌های متناظر منتقل (منطق و assertions حفظ). `package.json` اسکریپت‌ها به‌روز شوند.

### [🔴] گام ۲: تثبیت تست differential

الگوی مقایسهٔ `normalize(legacy) === normalize(modular)` برای همهٔ استخراج‌های باقی‌مانده (در صورت وجود فلگ‌های فعال) به‌کار رود.

**معیار پذیرش:**

- تعداد تست‌ها کاهش نمی‌یابد (گزارش تعداد قبل/بعد)؛ هر ماژول جدید unit test و هر مرز عمومی contract test دارد.
- `npm test` کامل سبز؛ تست‌های e2e رفتار واقعی کاربر را پوشش می‌دهند.

---

## [🔴] فاز ۳۰: حذف Wrapperها، مستندات و پذیرش نهایی

**هدف و scope:** پاک‌سازی لایه‌های سازگاری پس از اثبات برابری، تکمیل مستندات و پذیرش رسمی کل برنامه.

### [🔴] گام ۱: حذف تدریجی wrapperهای legacy و flagها

پس از برابری خروجی‌ها و سبز ماندن suite در حالت modular، پیش‌فرض همهٔ flagها modular و سپس flagها و wrapperهای legacy حذف شوند (technical-debt صفر در سطح facade). هر حذف در کامیت جدا با تست مرتبط.

### [🔴] گام ۲: مستندات

README و مستندات توسعه به‌روز شود: ساختار نهایی دایرکتوری‌ها، روش افزودن tool/skill/agent/prompt section/event/project و راهنمای multi-project (رجیستری، flagهای حذف‌شده، مسیرهای data). لینک از سه سند مرجع به این پلن (و بالعکس) درج شود.

### [🔴] گام ۳: ممیزی scope و پذیرش نهایی

نگاشت دمایهٔ این سند (پیوست) مرور و هر ردیف «پوشش‌داده‌شده» علامت بخورد؛ معیارهای نهایی هر سه سند مرجع (MultProject §۷، Refactor §۶، Order §۱۱) یک‌جا اجرا و ثبت شود.

**معیار پذیرش:**

- هیچ requireای به مسیر legacy نیست؛ `npm run check` و `npm test` سبز.
- ساختار نهایی مطابق بخش ۴ سند refactor (+ `agent/discussion/` و `agent/projects/` و `agent/runtime/` و `agent/prompt/` و `agent/persistence/`) پیاده شده؛ monolithها تقسیم شده‌اند و dependencyها صریح‌اند.
- API/CLI single-project و همهٔ قابلیت‌های Multi-Project (پذیرش فاز ۱۳) و معیارهای نهایی اسناد مرجع برقرار؛ سند با status نهایی 🟢 تکمیل می‌شود.

---

# پیوست الف: نگاشت دامنه (Scope Traceability)

هر ردیف اسناد مرجع در این پلن پوشش داده شده است:

| منبع | بخش | فاز پوشش |
|---|---|---|
| Order §۳.۱ / Impl گام ۰ / Refactor گام ۰ | Baseline و قراردادها | فاز ۱ |
| Order §۳.۲ / Impl گام ۲ | ProjectContext | فاز ۲ |
| Order §۳.۳ / Impl گام ۱ | ProjectRegistry | فاز ۲ |
| Order §۳.۴ / Impl گام ۳ و ۶ | Tool Runtime و ابزارها | فاز ۴ |
| Order §۳.۵ / Impl گام ۵ | AgentRunContext/RunManager | فاز ۳ |
| Order §۳.۶ / Impl گام ۸ / Refactor گام ۳ | Prompt Builder | فاز ۵ |
| Order §۴.۱–۴.۳ / Impl گام ۷ | Worker/Pools | فاز ۶ (سمت engine: خارج از دامنه — Gateway Plan) |
| Order §۴.۴ / Impl گام ۱۰ (بخش task) | اجرای task تک‌پروژه | فاز ۷ |
| Order §۵.۱ / Impl گام ۴ و ۱۸ | Persistence و Migration | فاز ۸ |
| Order §۵.۲–۵.۳ / Impl گام ۱۰–۱۱ و ۱۴–۱۵ | API، Events، AuthZ، MCP scope | فاز ۹ |
| Impl گام ۱۶–۱۷ / Order فاز ۳ (metrics/recovery) | Concurrency و Observability | فاز ۱۰ |
| Order فاز ۴ / Impl گام ۱۲–۱۳ | UI و Dashboard | فاز ۱۱ |
| Order فاز ۵ / Impl گام ۹ | Cross-Project Delegation | فاز ۱۲ |
| Impl گام ۱۹ | تست‌های isolation/e2e | فاز ۱۳ |
| Refactor گام ۱–۲ | Application + Config/Registry | فاز ۱۴ |
| Refactor گام ۴ | Actions | فاز ۱۵ |
| Refactor گام ۵ | Runtime Loop | فاز ۱۶ |
| Refactor گام ۶ | Context/Memory/Archive | فاز ۱۷ |
| Refactor گام ۷ | Persistence Repos | فاز ۱۸ |
| Refactor گام ۸ | Tools | فاز ۱۹ |
| Refactor گام ۹ | MCP | فاز ۲۰ |
| Refactor گام ۱۰ | Policy/Approval | فاز ۲۱ |
| Refactor گام ۱۱ | Hooks | فاز ۲۲ |
| Refactor گام ۱۲ | Web Backend | فاز ۲۳ |
| Refactor گام ۱۳ | Frontend | فاز ۲۴ |
| Refactor گام ۱۴ | Visualizer | فاز ۲۵ |
| Refactor گام ۱۵ | CLI/REPL | فاز ۲۶ |
| Refactor گام ۱۶ | Events | فاز ۲۷ |
| **شکاف مؤید بازبینی** | ماژول Discussion | **فاز ۲۸ (جدید)** |
| Refactor گام ۱۷ | Test Suite | فاز ۲۹ |
| Refactor گام ۱۸ + معیارهای نهایی هر سه سند | Rollout/حذف wrapper/پذیرش | فاز ۳۰ |

---

# پیوست ب: ثبت تصمیم‌ها (Decision Log)

تصمیم‌های اخذشدهٔ 2026-08-25 که متون فازهای مربوط بر اساس آن‌ها به‌روز شد:

1. **Gateway سمت Semantic Engine:** جداگانه طبق `MULTI_PROJECT_GATEWAY_PLAN.md` پیاده می‌شود اما هنوز شروع نشده؛ فاز ۶ با stub قرارداد `/mcp/:projectId` اجرا می‌شود (فاز ۶ گام ۴) و تعویض به gateway واقعی فقط با endpoint در registry است.
2. **`.agent/project.json` موجود:** مدل overlay — خواندن از workspace حفظ و نوشتن جدید در `projects/<id>/project.json` مرکزی (فاز ۲ گام ۳؛ اجرا در فاز ۸ گام ۲).
3. **ابزار model-facing پروژه:** ساخته نمی‌شود؛ لیست/انتخاب پروژه فقط از طریق Web API و UI (فاز ۴ گام ۴).
4. **`turn_id`:** معنای موجود در کد رسمی و حفظ می‌شود — هر پیام کاربر در session مکالمه‌ای = یک turn (`<run_id>_t<N>` یا caller-supplied)؛ سلسله‌مراتب `project_id ⊃ run_id ⊃ turn_id ⊃ iteration`؛ رویدادها snake_case (فاز ۹ گام ۲، فاز ۲۷).
5. **Approval برای MCPهای `scope: global`:** gateway-level با attribution به پروژهٔ درخواست‌کننده؛ یک‌بار تأیید، audit per-project (فاز ۹ گام ۴).
6. **Transcript discussion:** per-project پایدار در `dataRoot` پروژه و قابل replay (فاز ۲۸ گام ۲) — تغییر رفتاری تعمدی و مستند.

ثبت‌های تکمیلی هنگام اجرا:

7. **مکانیزم ایزوله‌سازی Run (فاز ۳):** AsyncLocalStorage برای هر دو context Run و رویدادها؛ legacy بدون ورود به scope دقیقاً همان globalها. انتخاب ALS به‌جای پاس‌دادن صریح ctx به همهٔ فراخوانی‌ها برای حفظ شکل مسیر اجرا و wrapperهای سازگار بود (قانون ۷).
8. **مرز state اشتراکی toolRuntime (فاز ۳):** search sessions/telemetry/process sessions در `agent/tools` همچنان process-global است؛ per-run/per-project شدن آن‌ها صریحاً scope فاز ۴ (Tool Runtime) است. هم‌زمانی فاز ۳ روی messages/budget/cancellation/attribution تضمین می‌شود، نه روی state داخلی ابزارها.
9. **قالب run id در modular:** همان قالب legacy؛ پسوند `-r<N>` تنها هنگام برخورد دو Run در یک میلی‌ثانیه (additive؛ normalized بودن run id در fixtureها حفظ می‌شود).
10. **فعال‌شدن cross-root (فاز ۴):** اجرای پروژه روی root متفاوت از WORKSPACE_ROOT فقط وقتی مجاز است که `RUN_CONTEXT_MODE=modular` و `PROJECT_CONTEXT_MODE=modular` باشند (یعنی context ابزار per-run تضمین‌شده است). در غیر این صورت `assertWorkspaceMatch` فاز ۲ ساری می‌ماند. ابزارهای هنوز project-aware‌نشده (code_* → فاز ۶، plan/memory/archive → فاز ۸، search/runtime_stats به‌همراهان) روی root خارجی خطای صریح «not yet project-aware» می‌دهند تا سکوتِ mis-scope هرگز رخ ندهد.
11. **نام API پروژه‌ای workspace (فاز ۴ گام ۲):** به‌جای overload `resolveWorkspacePath` (نقض قانون ۵ روی export موجود)، نام‌های `resolveProjectPath`/`isInsideProject`/`toProjectRelative`/`assertProjectPathSafe` با همان الگوریتم مرز انتخاب شدند.
12. **الگوی wiring سازه‌های lazy (فاز ۵):** facade و resolverهای جدید در `agent.js` lazily نمونه‌سازی می‌شوند — قانون repo در برابر capture سطح ماژول و مشکل TDZ constهای registry را هم‌زمان حل می‌کند؛ وابستگی‌ها همیشه closure روی state زنده‌اند.
13. **`buildAgentRequest` حالا export می‌شود (فاز ۵):** رفع شکاف شناخته‌شدهٔ سند refactor؛ additive و بدون تغییر رفتار.
**موارد هنوز باز (با Assumption برچسب‌خورده در پلن):**
10. قالب ماژول فرانت‌اند → فاز ۲۴ گام ۱ (Assumption: ESM نیتیو بدون build step؛ در صورت اثبات محدودیت، bundler سبک).
