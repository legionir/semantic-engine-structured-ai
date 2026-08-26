# قراردادهای ثبت‌شدهٔ Structured AI — EXECUTION_PLAN Phase 1 (گام ۳)

**تاریخ ثبت:** 2026-08-25 · **منبع حقیقت:** کد فعلی + fixtureهای `test/fixtures/` + تست‌های `test/contracts/`

این سند قراردادهای بیرونی و داخلی‌ای را ثبت می‌کند که در تمام فازهای refactor و Multi-Project باید حفظ شوند. هرگونه تغییر عمدی باید ابتدا در همین سند و fixtureها اعمال و سپس در کد پیاده شود.

---

## ۱. سیاست تغییر قرارداد (Additive-Only)

1. **افزودن فیلد جدید** به event payload، پاسخ API یا action envelope **مجاز** است.
2. **ممنوع:** حذف فیلد موجود، تغییر معنای فیلد، تغییر نام event/ابزار/action، تغییر نوع یک فیلد — مگر با migration عمدی و مستند در EXECUTION_PLAN.
3. نام‌گذاری فیلدهای جدید از قرارداد موجود پیروی می‌کند: رویدادها `snake_case` (`run_id`, `turn_id`, `project_id`) و پاسخ‌های JSON وب `camelCase` (`projectId`) — تصمیم 2026-08-25 (پیوست ب EXECUTION_PLAN).
4. تست‌های `test/contracts/` مرز را اعمال می‌کنند؛ شکست آن‌ها یعنی نقض قرارداد، نه «تست قدیمی».

---

## ۲. قرارداد رویدادها (Event Contract)

### envelope

هر رویداد از `agent/lib/events.js` عبور می‌کند و این فیلدها را **همیشه** دارد:

```json
{
  "seq": "number; افزایشی یکنواخت در هر process",
  "type": "string; نام رویداد",
  "at": "epoch ms",
  "run_id": "از context رویداد، مگر override در payload",
  "turn_id": "مانند بالا",
  "scope": "مانند بالا (main_agent یا scopeٔ Sub-Agent)",
  "iteration": "مانند بالا"
}
```

معنای `turn_id` (رسمی‌شده 2026-08-25): هر پیام کاربر در یک session مکالمه‌ای یک turn تازه است؛ قالب `<run_id>_t<N>` یا مقدار تأمین‌شده توسط caller (web server). سلسله‌مراتب پروژه‌ای هدف: `project_id ⊃ run_id ⊃ turn_id ⊃ iteration`.

### فهرست نام‌ها (inventory)

۶۳ نام در `test/fixtures/events.json` قفل شده‌اند. تست اسکن ایستا `test/contracts/events.contract.test.js` هر تغییری در مجموعهٔ نام‌های emitشده را می‌شکند. نام‌های مکانیکی bus (`event`, `change`) بخشی از قرارداد نیستند.

### payloadهای کلیدی

رویدادهای جریان اصلی و فیلدهای مهم فعلی‌شان (افزوده‌پذیر):

| رویداد | فیلدهای مهم فعلی |
|---|---|
| `run:start` | `run_id`, `turn_id`, `task` |
| `agent:iteration` | `iteration` |
| `request:start` / `request:end` | اطلاعات درخواست مدل |
| `agent:response`, `agent:action` | خلاصهٔ پاسخ/اکشن |
| `tool:start` | `id`, `name` |
| `tool:end` | `id`, `name`, `success` |
| `policy:decision`, `approval:request`, `approval:resolved` | چرخهٔ policy/approval |
| `context:compacted`, `context:memory` | مدیریت context |
| `run:nudge` | تکرار درخواست خروجی نهایی معتبر |
| `run:end` | `success` |
| `report:mismatch` | جلوگیری از ادعای تأییدنشده |

 سکانس baseline برای یک اجرای سادهٔ final (دو iteration به‌علت nudge) در `events.json.baseline_final_turn_sequence` قفل شده است.

---

## ۳. قرارداد Action

envelope پاسخ مدل (کلیدهای سطح-یک): `version`(`"1.0"`), `tool_calls`, `delegations`, `response`, `data`, `error`, `action`, `performed`. ورودی parser همان envelope خام provider است: `{ choices: [ { message: { role, content } } ] }`.

فیلدهای الزامی (تأییدشده با اجرای واقعی):

| نوع | فیلدهای الزامی هر آیتم |
|---|---|
| `tool_calls[]` | `id`, `name`, `arguments`, `depends_on` |
| `delegations[]` | `id`, `agent`, `persona`, `skills`, `tools`, `task`, `depends_on` |
| `response` (final) | `type`, `content` |

رفتارهای نرمال‌سازی/خطا (قفل‌شده در `actions.json`):

- `readModelAction` به tool call فاقد `depends_on` مقدار `[]` تزریق می‌کند.
- delegation به agent **ثبت‌شده** باید `persona`/`skills`/`tools` را `null` بگذارد؛ آرایهٔ خالی رد می‌شود.
- متن غیر JSON → پرتاب خطای modelResponseError با پیشوند `AI returned neither structured JSON nor a native tool call.`
- tool call بدون `id` → `Tool call is missing required field(s): id.`
- `parseStructuredResponse` خروجی `{ message, structured, source }` می‌دهد؛ fenceٔ مارک‌داون unwrap می‌شود (`source` متناسب).

---

## ۴. قرارداد Prompt و Request مدل

ساختار پیام‌ها (نقش‌ها و ترتیب بخش‌ها) در `prompt.fixture.json` قفل شده است:

- **Main:** system (متن system_prompt) ← system (EXECUTION RULES) ← system (json `runtime_context`) ← system (`available_skills`) ← system (`available_personas`) ← system (`available_agents`) ← user (task).
- **Sub-Agent:** system (قواعد اجرا) ← `runtime_context` ← `agent_profile` ← `available_tools` ← user(json `task`).
- `runtime_context` این کلیدهای سطح-یک را دارد: `workspace, environment, repository, execution, limits, security, plan, memory, archive, policy, endpoints, runtime, mcp`.

بدنهٔ request به مدل (capture واقعی): کلیدها `messages, model, parallel_tool_calls, response_format, temperature, tools`؛ با `temperature: 0.2`, `parallel_tool_calls: true`, `response_format: { type: "json_schema", json_schema: { name: "agent_action", strict: false, ... } }`. ابزارها در فیلد `tools` (schema کامل) و نه متن تکراری در پیام‌ها ارسال می‌شوند.

*رفتار dynamic که در فازهای بعد باید حفظ شود:* خواندن مجدد `system_prompt.txt`/registry در هر request؛ فیلتر قواعد بر اساس ابزارهای agent؛ کشف ابزارهای MCP پیش از اولین request؛ skill `semantic_engine` فقط هنگام ready بودن؛ settings جدید از iteration بعدی.

---

## ۵. قرارداد API وب

مسیرهای فعلی (literal) در `api-surface.json` ثبت‌اند؛ تست قرارداد، وجود همهٔ آن‌ها و عدم ظهور مسیر مستندنشدهٔ جدید را در `web/server.js` اعمال می‌کند. رفتار اثبات‌شده توسط تست‌های موجود: `POST /api/tasks`, `GET /api/events` (SSE), `GET /api/discussion/personas`, `POST /api/discussion`. ماتریس کامل method × route در فاز ۲۳ (Web Backend refactor) مستند می‌شود؛ در این فاز تغییر پاسخ/کد وضعیت endpointها ممنوع است.

---

## ۶. قراردادهای persistence و CLI

- مسیر state فعلی: `<workspace>/.agent/` (memory, plan, sessions, archive, journal, eventstore, searches, processes و `project.json`). در این فاز تغییر نمی‌کند؛ انتقال به data root مرکزی موضوع فاز ۸ است.
- **مرز دو مفهوم «Project» (رسمی‌شده 2026-08-25 در فاز ۲):**
  - `agent/lib/project.js` («workspace profile»): فایل `.agent/project.json` درون workspace؛ تنظیمات/proفایلِ بازدیدهای قبلیِ همان یک workspace. در نقشهٔ overlay (global ← workspace ← run) می‌ماند و export فعلی‌اش (از جمله `runtime.project`) تغییر نمی‌کند.
  - `agent/projects/` («multi-project registry»): ثبت/resolve چند workspace در فروگاه مرکزی داده (`~/.local/share/structured-ai/registry.json`، با override `STRUCTURED_AI_DATA_HOME`). سطح عمومی از طریق `runtime.projects` عرضه می‌شود.
  - این دو **ادغام نمی‌شوند**؛ مقصد نوشتن تنظیماتِ project-scoped در آیندهٔ فاز ۸ `projects/<id>/project.json` مرکزی است، ولی خواندنِ overlayِ workspace حفظ می‌شود.
- فرمت فایل‌های session/archive/journal/eventstore باید replay-compatible بماند.
- CLI: `node bin/agent.js -w <path> "<task>"` و REPL (`/help`, `/clear`, `/history`, `/approve`, `/tools`, `/save`) حفظ می‌شوند.

## ۷. flagهای migration (قانون ثابت ۸)

flagهای فاز-به-فاز در schema تنظیمات اعلان می‌شوند (نه env خام) تا resolver، UI و snapshot همه یک مقدار را ببینند:

- `PROJECT_CONTEXT_MODE` (پیش‌فرض `legacy`؛ مقدار مجاز دیگر `modular`) — از فاز ۲ موجود است.
- `RUN_CONTEXT_MODE` (پیش‌فرض `legacy`؛ مقدار مجاز دیگر `modular`) — از فاز ۳ موجود است؛ همراه آن `RUN_HISTORY_LIMIT` (NUMBER، پیش‌فرض ۱۰۰) برای ظرفیت تاریخچهٔ Runهای پایان‌یافتهٔ RunManager.
- `PROMPT_BUILDER_MODE` (پیش‌فرض `legacy`) — از فاز ۵.
- `SEMANTIC_POOL_MODE` (پیش‌فرض `legacy`) — از فاز ۶.
- `RUNTIME_ENGINE_MODE` (پیش‌فرض `legacy`؛ مقدار مجاز دیگر `modular`) — از فاز ۱۶؛ هر دو مقدار همان engine استخراج‌شده را اجرا می‌کنند (تصمیم ۳۵). مقدار غلط رفتار legacy دارد.
- `WEB_SERVER_MODE` هنگام ورود به فاز ۲۳ اعلان می‌شود.

## ۸. تغییرات additive فاز ۳ (ثبت‌شده ۲۰۲۶-۰۸-۲۵)

- رویدادهای emit‌شده **داخل scope یک Run در حالت `RUN_CONTEXT_MODE=modular`** فیلد envelope جدید `project_id` دارند (null وقتی پروژه‌ای resolve نشده). رویدادهای خارج از scope — و بنابراین کل رفتار حالت `legacy` — دقیقاً همان شکل قبلی را دارند؛ fixtureهای فاز ۱ بدون تغییر معتبرند.
- `agent/lib/events.js` یک API جدید additive دارد: `runWithScope(initial, fn)` که context هم‌بستگی را برای یک زنجیرهٔ async ایزوله می‌کند (`setContext` داخل scope به همان scope می‌نویسد). بدون فراخوانی آن، رفتار `emit`/`setContext` بیت‌به‌بیت همان است.
- سطح دسترسی runtime (exports در `agent/agent.js`) additive گسترش یافت: `AgentRunContext`, `runManager`, `runContextMode`, `cancelRunById`. امضاها و رفتار entry pointهای قبلی (`startRun`, `cancelRun`, `isRunCancelled`, `runRemainingMs`, `assertRunActive`, `runAgent`) بدون تغییر؛ در حالت legacy همان state سراسری را هدف می‌گیرند.
- قالب run id حالت modular همان `run-<ISO-timestamp>` است؛ در برخورد هم‌زمان در یک میلی‌ثانیه پسوند `-r<N>` اضافه می‌شود (فقط حالت modular).

## ۹. تغییرات additive فاز ۴ (ثبت‌شده ۲۰۲۶-۰۸-۲۵)

- امضای سطح ابزار: `executeTool(name, args, context)` بدون تغییر می‌ماند؛ `context` حالا می‌تواند `{ agent, runId, projectId, projectContext }` باشد (همیشه سازگار با شکل قدیمی `{agent}`) و به implementation به‌عنوان **پارامتر دوم** (`implementation(args, toolContext)`) می‌رسد — implementationهای قدیمی آن را نادیده می‌گیرند. schema و نام ابزارها در هیچ حالتی تغییر نمی‌کند.
- rule 9 مکانیکی: آرگومان‌های ابزار نمی‌توانند `projectId`/`project_id`/`project`/`projectRoot`/`root` داشته باشند (خطا)؛ هویت پروژه فقط از مسیر context ران‌تایم می‌رسد.
- `agent/lib/workspace.js` additive گسترش یافت: `resolvePathInRoot`/`assertPathSafeInRoot`/`toRelativeInRoot` و API پروژه‌ای `resolveProjectPath`/`isInsideProject`/`toProjectRelative`/`assertProjectPathSafe`/`projectRootOf`؛ امضای exportهای قبلی پین‌شده به WORKSPACE_ROOT دست‌نخورده.
- telemetry: رکوردها در حالت contextدار حامل `run_id`/`project_id` (additive، فقط در bucket per-run) هستند؛ `executedToolNames(runId?)` و `reset(runId?)` پارامتر اختیاری گرفتند؛ فرم خروجی runtime_stats جهانی تغییر نکرده است.
- sessionهای search با `run_id` علامت‌گذاری می‌شوند و `resetSessions(runId)` فقط همان Run را پاک می‌کند؛ فراخوانی بدون آرگومان رفتار جهانی تاریخی را دارد. sessionهای process دارای `run_id`/`project_id`/`root` هستند و در حالت scoped فقط برای پروژهٔ مالک قابل‌مشاهده/کنترل‌اند.

## ۱۰. تغییرات additive فاز ۵ (ثبت‌شده ۲۰۲۶-۰۸-۲۵)

- flag `PROMPT_BUILDER_MODE` (پیش‌فرض `legacy`) در schema تنظیمات اعلان شد؛ مسیر modular از builderهای تزریق‌پذیر `agent/prompt/` استفاده می‌کند و خروجی normalized آن با مسیر legacy برابر است (قانون ۸).
- `buildAgentRequest` اکنون از `agent/agent.js` export می‌شود (additive؛ شکل امضا آبجکت واحد `{messages, agentDefinition, tools, responseFormat, role, withSchema}` در هر دو حالت یکسان).
- پیام رویدادنما `project_context` (system+JSON) فقط در اجرای دارای پروژه (modular) به prompt افزوده می‌شود: Main پس از runtime_context و Sub-Agent پس از agent_profile. بدون پروژه هیچ کلید/پیام افزوده‌ای وجود ندارد (شکل prompt تاریخی دست‌نخورده — قانون ۵).
- در اجرای modular با پروژه، فیلدهای `workspace.root` و `runtime.workspace_root` و بخش `repository` پیام runtime_context **root پروژهٔ فعال** را گزارش می‌کنند (در legacy همان WORKSPACE_ROOT فرایند).

## ۱۱. تغییرات additive فاز ۶ (ثبت‌شده ۲۰۲۶-۰۸-۲۵)

- دو تنظیم schema اعلان شد: `SEMANTIC_POOL_MODE` (پیش‌فرض `legacy`؛ مقدار مجاز دیگر `modular`) برای routing پروژه‌ای Semantic و `SEMANTIC_POOL_CACHE_LIMIT` (NUMBER، پیش‌فرض ۲۰۰، ۰ = غیرفعال) برای سقف cache نتایج per-client.
- `agent/mcp/SemanticClient.js` / `SemanticClientPool.js` / `ProjectSemanticResolver.js` ساخته شدند؛ سطح export ماژول‌های قبلی (`lib/semantic.js`، `mcp/semantic.js`، `mcp/manager.js`، `mcp/client.js`) هیچ تغییری نکرده و در `SEMANTIC_POOL_MODE=legacy` رفتار بیت‌به‌بیت baseline است (تست identity: resolver همان آبجکت ماژول قدیمی را برمی‌گرداند).
- پیاده‌سازی ابزارهای code امضای `(args, context)` گرفت (قرارداد پارامتر دوم فاز ۴)؛ شکل نتایج ابزارها در هر دو حالت یکسان است. در حالت modular ابزار با `projectId`ِ ToolContext از pool client می‌گیرد؛ staleness از root پروژه و sessionهای index per-client است (جست‌وجوی session پروژهٔ دیگر «unknown» برمی‌گرداند).
- خانوادهٔ code از `PENDING_PROJECT_AWARENESS` خارج شد؛ رفتار خطای ریشهٔ خارجی در حالت legacy با همان الگوی «not yet project-aware» در resolver حفظ می‌شود (متن دقیق خطا مکمل است، الگوی اصلی ثابت).
- در حالت modular رویدادهای `mcp:call`/`mcp:result` با نام سرور پروژه‌محور `semantic-engine.project.<id>` منتشر می‌شوند (کلیدها همان envelope فاز ۱ + مقدار متفاوت `server` — افزودنی رفتاری، فقط در حالت pool).
- قراردادی که stub تستی و gateway آینده هر دو سرو می‌کنند: `POST /mcp/:projectId` با `initialize`/`tools/list`/`tools/call` روی Streamable HTTP؛ پاسخ tool در `structuredContent` است و marker افزودنی `{projectId, indexGeneration}` دارد؛ گزارش `indexGeneration` جدید cache سمت client را باطل می‌کند؛ endpoint ناشناخته/پروژه ناشناخته خطای HTTP کنترل‌شده است. تعویض gateway واقعی فقط با ویرایش `semanticEndpoint` در registry + `pool.reload(projectId)` انجام می‌شود.

## ۱۲. تغییرات additive فاز ۷ (ثبت‌شده ۲۰۲۶-۰۸-۲۵)

- **CLI:** فلگ `--project <id>` به `bin/agent.js` افزوده شد (نه delete/rename؛ گزینه‌های فعلی دست‌نخورده). رفتار اجرایی: root از registry خوانده می‌شود (با `-w` ناسازگار → usage error با پیام «does not match ... registry»؛ بدون `-w` → root ثبت‌شده = WORKSPACE_ROOT)؛ id ناشناخته → `Unknown project: <id>`؛ بدون فلگ هیچ تغییری در env/رفتار نیست. `--project` فلگهای `PROJECT_CONTEXT_MODE`/`RUN_CONTEXT_MODE`/`PROMPT_BUILDER_MODE` را modular می‌کند (بقیهٔ فلگها — از جمله `SEMANTIC_POOL_MODE` — دست‌نخورده).
- **Web API:** مسیر `POST /api/projects/:projectId/tasks` به `web/server.js` اضافه شد: 202 `{accepted:true, project_id}` (فیلد جدید فقط در همین مسیر)؛ 404 `Unknown project`؛ 409 `PROJECT_MODE_REQUIRED` هنگام نبود فلگهای modular؛ 400/409-running عین مسیر قدیمی. قرارداد `POST /api/tasks` بدون هیچ تغییری (202 `{accepted:true}` دقیقاً همان بدنه است — تست deep-equal).
- **امضای داخلی:** `startTask(task, runOptions)` در web/server.js پارامتر اختیاری دوم گرفت (پیش‌فرض `{}`؛ رفتار legacy یکسان)؛ runAgent همان گزینهٔ `{projectId}` فاز ۲ را می‌گیرد.
- **رویدادها:** در اجرای scoped (modular) رویدادهای run فیلدهای envelope موجود `run_id` + `project_id` (additive فاز ۲/۳) را دارند و در `/api/state` (فیلد `events`) بدون تغییر قرارداد دیده می‌شوند.

## ۱۳. تغییرات additive فاز ۸ (ثبت‌شده ۲۰۲۶-۰۸-۲۵)

- **`agent/lib/dataRoot.js` (ماژول جدید):** resolver واحد مسیر ذخیره‌سازی — `legacyDataRoot`, `modularPersistence`, `fromProject`, `fromContext`, `currentRoot`, `resolveRoot`, `dataRootForProjectId`, `ensureRoot`, `SCAFFOLD_DIRS`. ترتیب resolve: root صریح ← context ← پروژهٔ Run جاری (ALS) ← legacy `.agent/`؛ routing فقط در `PROJECT_CONTEXT_MODE=modular` فعال است (در legacy مسیرها بیت‌به‌بیت baseline).
- **پارامتر root اختیاری در storeها (additive):** `memoryPath/loadMemory/saveMemory`، `planPath/planDirectory` + `loadPlan/savePlan`، `sessionsDirectory/indexPath/sessionPath/loadIndex/saveIndex/loadSession/saveSession/listSessions/deleteSession`، `archiveDirectory/indexPath/segmentPath/loadIndex/saveIndex/appendBody/rollUp/compactSegments/maintain/readBody/findOrphanBody` و `options.root` جدید در `archiveEvents/searchArchive/getRecords/stats`، `storeRoot/fileFor/readDay/listDays` و `root` در `eventstore.query`، `journalRoot/fileFor`. حذف پارامتر = رفتار قبلی (legacy root / ریشهٔ Run جاری).
- **eventstore:** نویسنده با envelope رویداد route می‌کند — `project_id` ثبت‌شده در registry → store مرکزی پروژه؛ synthetic/ناشناخته/legacy → مسیر تاریخی. شکل خط JSONL و نام فایل روز بدون تغییر.
- **journal:** state attribution per `run_id` bucket می‌شود (جداسازی اجراهای هم‌زمان)؛ فیلدهای رکورد (`run_id`, `task`, ...) بدون تغییر شکل؛ export `_state` همان view تاریخی آخرین Run است و `_buckets` (additive) map داخلی را عرضه می‌کند.
- **ابزارها:** `plan_get/plan_set/plan_update` و `memory_get/archive_search/archive_get` پارامتر دوم context (قرارداد فاز ۴) را مصرف می‌کنند — schema و شکل خروجی تغییر نکرده؛ در اجرای scoped خروجی `path` ابزارهای plan/memory ممکن است مسیر **مطلق** مرکزی باشد (به‌جای نسبی درهم) — فیلد موجود، مقدار درست‌تر، فقط در حالت modular. ابزارهای search در اجرای scoped مسیرهای نسبی را نسبت به root پروژه گزارش می‌دهند (در legacy همان workspace-relative تاریخی). group/gate: `PENDING_PROJECT_AWARENESS` حالا فقط `runtime_stats` است؛ متن خطای «not yet project-aware» برای آن حفظ است.
- **overlay تنظیمات (`agent/lib/project.js`):** `openProject(projectId?)` پارامتر اختیاری گرفت؛ exportهای جدید additive: `overlayFor`, `centralProjectPath`, `loadOverlay`؛ پاسخ `openProject` فیلد `overlay_path` را **فقط** وقتی لایهٔ مرکزی هست دارد؛ `persist`/`saveProject` مقصد مرکزی را می‌پذیرند. بدون پروژهٔ modular رفتار بیت‌به‌بیت قبل است (خواندن/نوشتن همان `.agent/project.json`).
- **projects:** سطح `agent/projects` با `ProjectMigration` (`migrateProject(record) → {project_id, source, target, source_present, copied, skipped, errors}`) گسترش یافت — کپی بدون-overwrite، legacy حذف نمی‌شود، خطای per-file در گزارش.
- **CLI:** فلگ `--migrate <id>` افزوده شد (گزینه‌های فعلی دست‌نخورده): root از registry (با `-w` ثبت+مهاجرت یک‌جا)، گزارش روی stderr، exit 1 با خطای فایل، re-run ایدم‌پوتنت (copied=0).

## ۱۴. تغییرات additive فاز ۹ (ثبت‌شده ۲۰۲۶-۰۸-۲۵)

- **Web API (additive):** `GET/POST /api/projects`، `GET/PATCH/DELETE /api/projects/:id`، `GET /api/projects/:id/state`، `GET /api/projects/:id/sessions`، `GET /api/projects/:id/events`، `POST /api/projects/:id/chat`، `POST /api/projects/:id/cancel`. مسیر `POST /api/projects/:id/tasks` فاز ۷ دست‌نخورده است (202 `{accepted, project_id}`). `GET /api/state` و `POST /api/tasks` بدون تغییر قرارداد برای توکن master.
- **Event stream:** `GET /api/events?projectId=` همان فیلتر استریم پروژه‌ای را اعمال می‌کند. رویداد پروژهٔ الف در استریم ب نیست؛ رویداد بدون `project_id` فقط metadata تجمیعی (`aggregate: true`) می‌دهد. توکن master بدون query همهٔ رویدادها را می‌بیند (رفتار قبلی).
- **Token scope:** `AGENT_CONSOLE_TOKEN` همچنان توکن master با همهٔ پروژه‌ها و permissionهاست. `AGENT_CONSOLE_TOKENS` (JSON، secret) توکن‌های محدود `{ allowedProjects, permissions }` را اعلام می‌کند (`project:read`/`project:write`/`semantic:query`/`semantic:index`). دسترسی بدون اجازه → `403`. لاگ‌ها Bearer/token را mask می‌کنند.
- **Approval:** رکورد و رویداد `approval:request`/`approval:resolved` فیلد additive `project_id` دارند؛ prompt ترمینال در صورت وجود پروژه آن را نشان می‌دهد. pendingهای `/api/state` فیلد `project_id` می‌گیرند (UI فعلی نادیده می‌گیرد).
- **MCP scope:** فیلدهای additive `scope: "project"|"global"` (پیش‌فرض `global`) و `projects: [...]` در نرمالایز کانفیگ. `tools/list` و `catalogueEntries(projectId)` فقط سرورهای مجاز آن پروژه را می‌دهند؛ `call` ریشهٔ خارجی را با خطای کنترل‌شده رد می‌کند. در اجرای بدون projectId (legacy) همهٔ سرورها مانند قبل دیده‌ می‌شوند.
- **Gateway MCP approval:** برای سرور `scope: global` در Run دارای `project_id`، یک تأیید کافی است و استفاده‌های بعدی `gateway_cached: true` دارند و با `project_id` مصرف‌کننده audit می‌شوند. بدون `project_id` رفتار approval تاریخی است.

## ۱۵. تغییرات additive فاز ۱۰ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **تنظیمات schema:** `MAX_CONCURRENT_PROJECT_RUNS` (پیش‌فرض ۴)، `MAX_RUNS_PER_PROJECT` (۱)، `MAX_CONCURRENT_INDEX_RUNS` (۲)، `MAX_WORKERS_PER_USER` (۸)، `RUN_QUEUE_LIMIT` (۱۶)، `PROJECT_MEMORY_LIMIT` (۰ = بدون سقف سخت)، `PROJECT_CPU_LIMIT` (۰ = فقط observational).
- **Scheduler:** `agent/runtime/RunScheduler.js` فقط وقتی هر دو flag `RUN_CONTEXT_MODE` و `PROJECT_CONTEXT_MODE` modular باشند و Run یک `projectId` داشته باشد فعال است. overflow صف → خطای `RUN_QUEUE_FULL` با `status=429`. عبور از `PROJECT_MEMORY_LIMIT` → خطای `PROJECT_MEMORY_LIMIT` با `status=429` (صف نمی‌شود).
- **Run id:** `createRun` شناسه را همان لحظه در مجموعهٔ issued رزرو می‌کند تا دو Run هم‌زمان در یک میلی‌ثانیه شناسهٔ یکسان نگیرند (پسوند `-r<N>` مثل فاز ۳).
- **Web API (additive):** `GET /api/metrics`، `GET /api/health`، `GET /api/projects/:id/metrics`، `GET /api/projects/:id/health`. پاسخ `POST /api/projects/:id/cancel` فیلد additive `queued_dropped` دارد. `POST /api/projects/:id/tasks` و `/chat` در overflow صف `429 {code: RUN_QUEUE_FULL}` می‌دهند و در پذیرش فیلد additive `queued` دارند. `POST /api/tasks` بدون تغییر قرارداد است (قفل busy سراسری کنسول حفظ شد).
- **Observability:** سری‌های `project_*` و `gateway_*` از event bus جمع می‌شوند. crash یک پروژه health آن را `down` و gateway را حداکثر `degraded` می‌کند — هرگز `down`.
- **Index:** `code_index_start` سقف `MAX_CONCURRENT_INDEX_RUNS` را با `INDEX_LIMIT` اعمال می‌کند.
- **Exports additive:** `runScheduler` و `observability` از `agent/agent.js`.

## ۱۶. تغییرات additive فاز ۱۱ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **صفحهٔ کنسول:** header `#projectSwitcher` / `#newProjectButton` / `#projectsButton` / `#gatewayHealth` را دارد. انتخاب پروژه در `localStorage` کلید `structured-ai.currentProjectId` و query `?project=` حفظ می‌شود.
- **Static route (additive):** `GET /projects` و `GET /projects/:id` همان `index.html` کنسول را سرو می‌کنند تا deep-link داشبورد کار کند. قرارداد مسیرهای `/api/*` تغییر نکرد.
- **Graph:** `GET /api/graph/*?projectId=` ریشه و نام پروژه را از registry می‌خواند و `project:read` را اعمال می‌کند؛ بدون query همان workspace سرور است.
- **Composer:** radios `current|specific|multiple`. یک هدف → `POST /api/projects/:id/tasks`؛ چند هدف → صف ترتیبی labelدار. `POST /api/tasks` بدون پروژهٔ انتخاب‌شده دست‌نخورده است.
- **Events در UI:** استریم با `?projectId=` دوباره وصل می‌شود؛ رویداد دارای `project_id` ناسازگار وارد نما نمی‌شود؛ رویداد بدون `project_id` همچنان دیده می‌شود (سازگاری legacy).
- **Cancel:** با پروژهٔ فعال، `POST /api/projects/:id/cancel` علاوه بر `POST /api/cancel` صدا زده می‌شود.

## ۱۷. تغییرات additive فاز ۱۲ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **Action `delegate`:** آیتم‌های `delegations[]` فیلد اختیاری additive `projectId` (و alias `project_id`) را می‌پذیرند. نبود/null یعنی پروژهٔ فعال. فیلدهای ناشناخته همچنان رد می‌شوند. در schema غیرسخت `projectId` required نیست؛ در schema سخت (`response_format.strict.json`) با `anyOf: [string, null]` در `required` است.
- **اعمال سوئیچ:** فقط وقتی `PROJECT_CONTEXT_MODE=modular` و `RUN_CONTEXT_MODE=modular`. در legacy فیلد پذیرفته و نادیده گرفته می‌شود (ابزارها همان workspace فرایند را می‌بینند).
- **ایزوله‌سازی Sub-Agent:** `agent/runtime/ProjectOverride.js` با ALS؛ `effectiveProject()` = frame جاری یا پروژهٔ Run. هر فرزند داخل `runWithProject` + `events.withProjectId` اجرا می‌شود تا دو فرزند هم‌زمان `currentRun().project` را mutate نکنند. پروژهٔ یک Sub-Agent در میانهٔ loop عوض نمی‌شود؛ delegation تو در تو با `projectId` متفاوت frame تازه می‌سازد.
- **نتیجهٔ labelدار:** خروجی `executeDelegations` فیلدهای additive `projectId` و `findings` دارد (علاوه بر `id`/`success`/`result`/`agent`/`error`). گزارش موفق Sub-Agent هم `projectId`/`findings` دارد. id ناشناخته فقط همان فرزند را با `Unknown project` شکست می‌دهد.
- **Approval نوشتن:** ابزارهای `fs_write`/`fs_edit`/`fs_mkdir`/`fs_move`/`fs_delete` روی پروژه‌ای غیر از پروژهٔ Run → approval جدا با `rule: "cross_project_write"`؛ هر write پس از delegation به بیش از یک پروژه → `rule: "multi_project_write"`. این approval علاوه بر تصمیم عادی policy است.
- **Events:** `delegation:start`/`delegation:graph`/`delegation:end` فیلد additive `projectId` روی آیتم‌ها دارند. envelope `project_id` رویدادهای scoped فرزند، پروژهٔ همان Sub-Agent است. `policy:decision` فقط وقتی `project_id` دارد که پروژه‌ای واقعاً در scope باشد (مقدار null روی رویداد legacy stamp نمی‌شود).
- **Exports additive:** `effectiveProject`, `effectiveProjectId`, `runWithProject`, `isMultiProjectTask` از `agent/agent.js`؛ `events.withProjectId`.

## ۱۸. پذیرش MVP فاز ۱۳ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **بدون تغییر قرارداد محصول:** این فاز فیلد/مسیر/action/event تازه‌ای اضافه نمی‌کند. شواهد isolation/load/ده‌مرحله‌ای در `test/mvp/mvp.test.js` (۱۰ تست) قفل شده‌اند و در زنجیرهٔ `npm test` اجرا می‌شوند.
- **باندل runtime رسمی MVP:** `PROJECT_CONTEXT_MODE=modular`، `RUN_CONTEXT_MODE=modular`، `PROMPT_BUILDER_MODE=modular`، `SEMANTIC_POOL_MODE=modular` — فقط وقتی مسیر پروژه‌آگاه فعال است (تست‌ها صریحاً ست می‌کنند؛ CLI `--project` همان bundle سه‌تایی فاز ۷ را ست می‌کند).
- **پیش‌فرض schema:** هر چهار flag بالا پیش‌فرض `legacy` می‌مانند (تصمیم ۳۲). CLI بدون `--project` و `POST /api/tasks` بدون تغییر ظاهری‌اند (بدنهٔ 202 `{accepted:true}` بیت‌به‌بیت).
- **دوام eventstore روی خروج CLI:** `eventstore.flush()` قبل از `process.exit` در `bin/agent.js` و `agent.js#main` صدا زده می‌شود تا صف `appendQueued` با خروج ناگهانی از بین نرود (رفتار persistence فاز ۸؛ شکل فایل JSONL بدون تغییر).

## ۱۹. تغییرات additive فاز ۱۴ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **بدون تغییر قرارداد محصول:** نام ابزار، schema، event، API و CLI تغییر نکرد. استخراج ساختاری است.
- **Config:** پیاده‌سازی در `agent/config/`؛ `agent/lib/storage.js` wrapper سازگار با همان exportها (`get/set/reset/sourceOf/snapshot/all/describe/definitionOf/definitions/bus`).
- **Registry:** `loadRegistries()` از `RegistryLoader` می‌خواند؛ TOOLS از concat `tool-schemas/` می‌آید. `tools.json` snapshot سازگاری است. JSON خراب → `Registry file <path> is invalid JSON: ...`.
- **Application:** exportهای additive `application`، `registryLoader`، `registryValidator`. `runAgent`/`main` از facade به `application` delegate می‌شوند (همان توابع bound).
- **Live reload:** امضای registry شامل mtime/size فایل‌های `tool-schemas/` است (به‌جای فقط `tools.json`).

## ۲۰. تغییرات additive فاز ۱۵ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **بدون تغییر قرارداد محصول:** action envelope، نام/کد خطا، `response_diagnostics`، retry malformed و هر دو schema (`response_format.json` / `.strict.json`) دست‌نخورده‌اند. استخراج ساختاری است.
- **Actions:** پیاده‌سازی در `agent/actions/`؛ `agent/agent.js` wrapper سازگار با همان exportها (`parseStructuredResponse`، `adaptNativeToolCalls`، `parseToolArguments`، `repairStructuredAction`، `readModelAction`، `isModelResponseError`، `validateAction`).
- **Export additive:** `actions` از `agent/agent.js` همان kit را برمی‌گرداند. `bind({ toolsOf, events, logLine })` وابستگی زندهٔ registry/bus را تزریق می‌کند.
- **AGENT_SCHEMA:** همچنان `fixed` است (پیش‌فرض `default`)؛ شاخهٔ strict فقط با مقدار startup و فایل `response_format.strict.json` فعال می‌شود.

## ۲۱. تغییرات additive فاز ۱۶ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **بدون تغییر قرارداد محصول:** نام event، payload منطقی، action envelope، بودجه/عمق delegation، ترتیب wave و `depends_on` دست‌نخورده‌اند. استخراج ساختاری است.
- **Runtime engine:** پیاده‌سازی حلقه در `agent/runtime/{AgentRun,IterationRunner,ActionProcessor,ToolGraphExecutor,DelegationRunner,RetryController,RunState,ReportVerifier}.js`؛ `agent/agent.js` wrapper سازگار با همان exportها (`runAgent`، `callAI`، `executeDependencyGraph`، `executeToolGraph`، `normalizeToolCalls`، `resolveArgumentReferences`، `validateDelegationPolicy`، `resolveDepthBudget`، `checkPerformedClaim`، ...).
- **Export additive:** `runtimeEngine` و `runtimeEngineMode` از `agent/agent.js`. `bind({...})` وابستگی زندهٔ settings/events/run/tools را تزریق می‌کند.
- **Flag:** `RUNTIME_ENGINE_MODE` (پیش‌فرض `legacy`). هر دو مقدار همان engine را اجرا می‌کنند (تصمیم ۳۵)؛ misspell = legacy. پیش‌فرض schema عوض نمی‌شود (تصمیم ۳۲).

## ۲۲. تغییرات additive فاز ۱۷ (ثبت‌شده ۲۰۲۶-۰۸-۲۶)

- **بدون تغییر قرارداد محصول:** compaction (light/medium/heavy)، pairing tool call/result، محل memory message، نوشتن archive قبل از drop/fold، `archive_search`/`archive_get`، مسیر data root فاز ۸، و تنظیمات `MAX_CONTEXT_CHARS`/`CONTEXT_*`/`MEMORY_*`/`ARCHIVE_*` دست‌نخورده‌اند. استخراج ساختاری است.
- **Context kit:** پیاده‌سازی در `agent/context/{ContextManager,ConversationSizer,ExchangeDetector,ContextCompactor,MemoryCoordinator,ArchiveCoordinator}.js`؛ IO در `agent/persistence/{MemoryRepository,ArchiveRepository}.js`. `agent/lib/context.js`، `lib/memory.js` و `lib/archive.js` wrapper سازگار با همان exportها هستند.
- **Export additive:** `context` از `agent/agent.js` همان kit را برمی‌گرداند. `bind({ events, logLine, currentRun, assertRunActive, summariseTranscript })` وابستگی زنده را تزریق می‌کند. wrapperهای `maintainContext`/`foldIntoMemory`/`refreshMemoryMessage`/`archiveExchanges` در facade می‌مانند (قانون ۷).
- **Flag:** فاز ۱۷ `*_MODE` جدیدی اعلان نمی‌کند (تصمیم ۳۶). پیش‌فرض schema عوض نمی‌شود (تصمیم ۳۲).
