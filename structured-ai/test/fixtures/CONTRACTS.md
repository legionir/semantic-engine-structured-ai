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
- بقیه (`RUN_CONTEXT_MODE`, `PROMPT_BUILDER_MODE`, `SEMANTIC_POOL_MODE`, `RUNTIME_ENGINE_MODE`, `WEB_SERVER_MODE`) هنگام ورود به فاز خودشان اعلان می‌شوند.
