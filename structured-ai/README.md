# پلتفرم ران‌تایم ایجنت‌های سلسله‌مراتبی (Structured AI)
## Hierarchical Multi-Agent Runtime, Deterministic Execution & Autonomous Code Intelligence

پروژهٔ **`structured-ai`** یک فریم‌ورک و ران‌تایم چند‌ایجنت سلسله‌مراتبی (Hierarchical Multi-Agent) برای هدایت مدل‌های زبانی بزرگ (LLMs) بر پایهٔ قراردادهای اکشن ساختاریافته (Structured Action Contract) و اندپوینت‌های استاندارد سازگار با OpenAI (`/chat/completions`) است.

در این سیستم، مدل هوش مصنوعی تصمیم‌گیرندهٔ محض نیست؛ بلکه در هر تکرار، مدل دقیقاً یک اکشن استاندارد (`tool_call`، `delegate` یا `final`) برمی‌گرداند و **ران‌تایم سیستم**، زمان‌بندی موازی، تفویض وظایف (Delegation)، کنترل مرزهای امنیتی، اعمال پالیسی‌ها و تأییدیه‌ها را مدیریت می‌کند.

---

## فهرست مطالب
1. [معرفی و منشور معماری سیستم](#۱-معرفی-و-منشور-معماری-سیستم)
2. [معماری کلان و ساختار دایرکتوری‌ها](#۲-معماری-کلان-و-ساختار-دایرکتوریها)
3. [پیش‌نیازها و راه‌اندازی سریع](#۳-پیش‌نیازها-و-راه‌اندازی-سریع)
4. [حالت‌های سه‌گانهٔ استفاده (Usage Modes)](#۴-حالت‌های-سهگانه-استفاده-usage-modes)
5. [جدول کامل پیکربندی و متغیرهای محیطی](#۵-جدول-کامل-پیکربندی-و-متغیرهای-محیطی)
6. [مستندات کامل اندپوینت‌های سرور وب کنسول (Web Server & REST / SSE API)](#۶-مستندات-کامل-اندپوینتهای-سرور-وب-کنسول-web-server--rest--sse-api)
7. [کاتالوگ کامل ابزارها و گروه‌ها (Tools & Tool Groups)](#۷-کاتالوگ-کامل-ابزارها-و-گروهها-tools--tool-groups)
8. [خط‌لولهٔ امنیتی، پالیسی و گاردها (Security & Policy Engine)](#۸-خط‌لوله-امنیتی-پالیسی-و-گاردها-security--policy-engine)
9. [مدیریت بودجهٔ کانتکست و حافظه (Context Budget & Compaction)](#۹-مدیریت-بودجه-کانتکست-و-حافظه-context-budget--compaction)
10. [لایهٔ اتصال به MCP و پروتکل‌های چهارگانه](#۱۰-لایهٔ-اتصال-به-mcp-و-پروتکلهای-چهارگانه)
11. [Semantic Engine به‌عنوان سرور MCP داخلی](#۱۱-semantic-engine-بهعنوان-سرور-mcp-داخلی)
12. [آزمون‌ها و ارزیابی کیفیت](#۱۲-آزمونها-و-ارزیابی-کیفیت)

---

> **Execution record:** the canonical rollout status and verification history are in
> [`EXECUTION_PLAN.md`](EXECUTION_PLAN.md). The corresponding refactor and
> multi-project design documents are [`REFACTOR_EXECUTION_PLAN.md`](REFACTOR_EXECUTION_PLAN.md),
> [`MULTI_PROJECT_IMPLEMENTATION_PLAN.md`](MULTI_PROJECT_IMPLEMENTATION_PLAN.md) and
> [`MULTI_PROJECT_REFACTOR_ORDER_PLAN.md`](MULTI_PROJECT_REFACTOR_ORDER_PLAN.md).

## ۱. معرفی و منشور معماری سیستم

### ۱.۱ قرارداد اکشن ساختاریافته (Structured Action Contract)
در هر مرحله از اجرای تسک، مدل ملزم به ارسال یک ساختار JSON معتبر است که شامل یکی از موارد زیر است:
- **`tool_call`:** فراخوانی یک یا چند ابزار به صورت موازی (Parallel) یا دارای گراف وابستگی (`depends_on`).
- **`delegate`:** تفویض کار به یک Sub-Agent تخصصی با Persona و ابزارهای ایزوله.
- **`final`:** پایان موفق یا اعلام نیاز به اطلاعات تکمیلی.

### ۱.۲ انزوای کامل و زمان‌بندی موجی (Execution Waves)
ران‌تایم فرامین ارسال‌شده را به صورت خودکار به **امواج اجرایی (Execution Waves)** تقسیم می‌کند؛ ابزارهای مستقل به صورت همزمان (Concurrency کنترل‌شده) و ابزارهای وابسته پس از اتمام گام قبلی اجرا می‌شوند.

### ۱.۳ مهار مرزها و پیشگیری از توهم مدل
- **Workspace Confinement:** تمام مسیرهای فایلی به دایرکتوری ورک‌اسپیس محدود بوده و لینک‌های نمادین (Symlinks) خروج از مرز را مسدود می‌کنند.
- **Output Capping:** خروجی ابزارها پیش از ارسال به مدل برش داده می‌شود تا بودجهٔ توکن Context Window بهینه‌سازی شود.

---

## ۲. معماری کلان و ساختار دایرکتوری‌ها

```text
structured-ai/
├── bin/                         # agent، interactive و backfill entrypoints
├── agent/
│   ├── agent.js                # public application entrypoint and bindings
│   ├── actions/                # action parsing, repair and validation
│   ├── application/            # run/session lifecycle
│   ├── cli/                    # argument parsing and command dispatch
│   ├── config/                 # SettingsSchema، SettingsStore، secrets
│   ├── context/                # context budget، workspace boundary، memory
│   ├── discussion/             # discussion engine، service و transcripts
│   ├── events/                 # event bus، validation، projection، redaction
│   ├── hooks/                  # hook loading، conditions، rendering، runner
│   ├── interactive/            # REPL input/output و approval prompt
│   ├── mcp/                    # manager، connection، config، protocol و transports
│   ├── persistence/            # atomic JSON، JSONL، repositories و data roots
│   ├── policy/                 # policy matching، approval و errors
│   ├── projects/               # registry، context، migration و workspace profile
│   ├── prompt/                 # main/sub-agent/runtime/request builders
│   ├── registry/               # JSON registries و split tool schemas
│   ├── runtime/                # RunManager، engine، scheduler و telemetry
│   └── tools/                  # ToolRuntime و گروه‌های filesystem/process/code/
│                                 # planning/memory/git/network/search/skills/mcp
├── web/
│   ├── server.js               # canonical WebServer entrypoint
│   ├── server/                 # router، middleware، controllers، services
│   └── public/                 # app/ و visualizer/ native browser modules
├── test/                       # domain-based unit, contract و e2e suites
└── semantic-engine/            # gateway/engine مستقل Semantic (اختیاری)
```

در rollout نهایی Phase 30 هیچ facade انتخاب‌کننده‌ای برای حالت legacy وجود
ندارد. `agent/config`، `agent/persistence`، `agent/mcp`، `agent/tools` و
`web/server` مسیرهای canonical هستند. ریشهٔ `.agent/` فقط به‌عنوان data layout
سازگار برای synthetic default خوانده می‌شود؛ این موضوع با نگه‌داشتن کد legacy
یا flag اجرایی تفاوت دارد.

## ۳. پیش‌نیازها و راه‌اندازی سریع

### پیش‌نیازها
* **Node.js:** نسخهٔ `>= 18.0.0`
* **مدل زبانی سازگار با OpenAI:** یک اندپوینت فعال مانند Local vLLM, Ollama, OpenRouter, OpenAI یا LMStudio.

### تنظیم متغیرهای اولیه
```bash
# تنظیم اندپوینت و کلید دسترسی مدل
export AGENT_BASE_URL=http://localhost:11434/v1
export AGENT_API_KEY=your-api-key
export AGENT_MODEL=qwen2.5-coder:32b
```

### اجرای تست‌های ران‌تایم
```bash
npm test
```

---

## ۴. حالت‌های سه‌گانهٔ استفاده (Usage Modes)

---

### حالت ۱: اجرای تک‌تسک در ترمینال (Headless CLI)
مناسب برای خط‌لوله‌های CI/CD، اسکریپت‌ها و دستورات سریع:

```bash
# اجرای یک تسک مشخص روی ورک‌اسپیس
node bin/agent.js -w /path/to/project "بررسی کن چرا تست لاگین شکست می‌خورد و اصلاحش کن"

# اجرای خروجی ساختاریافته فقط در قالب JSON
node bin/agent.js -w /path/to/project --json "لیست تمامی کنترلرهای موجود"
```

---

### حالت ۲: نشست تعاملی در ترمینال (Interactive REPL)
مناسب برای کار پیوسته با امکان پرسش و پاسخ دنباله‌دار با حفظ کانتکست و پاسخ به درخواست‌های تأیید (Approval Prompt):

```bash
node bin/agent.js -i -w /path/to/project
```

دستورات داخلی در محیط تعاملی:
* `/help` — مشاهده لیست فرامین
* `/clear` — شروع یک مکالمه جدید با حفظ تنظیمات
* `/history` — مشاهده تاریخچه پیام‌ها
* `/approve` — تغییر حالت تأییدیه به `auto`، `prompt` یا `deny`
* `/tools` — مشاهده ابزارهای فعال
* `/save` — ذخیره آخرین پاسخ در یک فایل

---

### حالت ۳: کنسول وب و داشبورد زنده (Web Console & Visualizer)
راه‌اندازی سرور کنسول وب با رابط کاربری تعاملی، استریم زندهٔ گراف اجرای ایجنت‌ها، مانیتورینگ رویدادها و پنل تأییدیه:

```bash
node bin/agent.js --serve 7777 -w /path/to/project
```

سپس در مرورگر به آدرس `http://localhost:7777` مراجعه کنید.

---

### حالت ۴: بحث چندجانبه با پرسوناهای متخصص (Multi-Agent Discussion)
به‌جای درخت واکل، تعدادی پرسونای هم‌سطح (از ۱۵ پرسونای موجود) یک تسک را در چند دور با هم بحث می‌کنند: در دور ۱ هر پرسونا بدون دیدن بقیه نظر می‌دهد؛ از دور ۲ به بعد همه پیام‌های قبلی را می‌بینند و باید صریحاً موافق/مخالف/بهبوددهنده باشند. یک **Observer** (همیشه فعال، غیرقابل انتخاب) بعد از هر دور تصمیم می‌گیرد بحث ادامه یابد یا تمام شود؛ در صورت ادامه، دستورالعمل هدفمند برای هر ایجنت جداگانه می‌دهد. توقف اجباری با سقف دورها و تشخیص تکرار انجام می‌شود.

```bash
# اجرای بحث در ترمینال
node bin/agent.js -w /path/to/project --discussion \
  --personas security,backend,frontend,architect,performance,qa \
  --max-rounds 5 "طراحی ذخیره‌سازی نشست کاربر با JWT در اپلیکیشن Next.js"

# خروجی JSON کامل (شامل رونوشت دورها و تصمیمات Observer)
node bin/agent.js -w /path/to/project --discussion --personas security,frontend --json "..."
```

همچنین:
* **ابزار `discussion_start`** — ایجنت اصلی هرگاه کاربر تحلیل چندبُعدی بخواهد، خودش بحث را از داخل اجرای عادی شروع می‌کند.
* **کنسول وب** — دکمهٔ «Discussion» در هدر: انتخاب تسک، پرسوناها و سقف دورها، مشاهدهٔ زندهٔ دورها و پیام‌ها از طریق SSE، و در نهایت گزارش ساختاریافته (خلاصه، نقاط توافقی، اختلاف‌نظرهای باز با استدلال هر طرف، و گام‌های بعدی مرتب‌شده).

پرسونای موجود: `security, backend, database, frontend, architect, performance, qa, devops, cost, accessibility, data, compliance, mobile, ml, legacy` — تعریف کامل آن‌ها در `agent/discussion/personas.js` و نقشه‌راه پیاده‌سازی در `DISCUSSION_SYSTEM_IMPLEMENTATION.md` در ریشهٔ مخزن.

---

## ۵. جدول کامل پیکربندی و متغیرهای محیطی

تنظیمات runtime فقط از `agent/config/SettingsStore.js` و
`agent/config/SettingsSchema.js` خوانده می‌شوند. مقدارهای قابل تغییر از طریق
کنسول وب، فایل profile یا environment با همان precedence واحد resolve می‌شوند.

| متغیر | مقدار پیش‌فرض/رفتار | شرح |
|---|---|---|
| `WORKSPACE_ROOT` | `process.cwd()` | ریشهٔ ثابت اجرای process و fallback پروژهٔ synthetic |
| `STRUCTURED_AI_DATA_HOME` | `~/.local/share/structured-ai` | registry و data root مرکزی پروژه‌ها |
| `AGENT_BASE_URL` | endpoint سازگار با OpenAI | مسیر `/chat/completions` مدل |
| `AGENT_API_KEY` | خالی | کلید مدل؛ در log و پاسخ mask می‌شود |
| `AGENT_MODEL` | `auto-switch` | مدل اصلی runtime |
| `AGENT_APPROVAL` | `prompt` | `auto`، `prompt` یا `deny` برای approval policy |
| `PROCESS_SANDBOX_MODE` | `deny` | `deny`، `bwrap` یا `test` (فقط harness) |
| `SEMANTIC_ENABLED` | `true` | فعال بودن Semantic Engine |
| `SEMANTIC_ENGINE_URL` | خالی | endpoint اختیاری semantic gateway |
| `SEMANTIC_TRANSPORT` | `auto` | `stdio`، `http`، `sse` یا `websocket` |
| `MCP_ENABLED` | `true` | فعال بودن MCP manager |
| `MCP_AUTO_DISCOVER` | `false` | کشف خودکار configهای workspace |
| `MCP_TRUST_PROJECT_CONFIG` | `false` | trust لازم برای stdio پروژه |
| `MCP_ALLOW_RUNTIME_ADD` | `true` | افزودن/حذف runtime MCP، مشروط به policy |
| `MCP_APPROVAL` | `inherit` | approval برای فراخوانی MCP |
| `EVENTSTORE_ENABLED` | `true` | ذخیرهٔ eventهای durable |
| `JOURNAL_ENABLED` | `true` | ذخیرهٔ journal per-agent |
| `MAX_RUN_MS` | `600000` | سقف wall-clock هر run |
| `MAX_TOTAL_AGENTS` | `15` | سقف sub-agent هر run |
| `MAX_PARALLEL_AGENTS` | `4` | سقف اجرای موازی sub-agentها |
| `MAX_PARALLEL_TOOLS` | `8` | سقف اجرای موازی toolها |
| `MAX_CONTEXT_CHARS` | `300000` | بودجهٔ کل conversation |

فلگ‌های rollout موقت مراحل قبل (`PROJECT_CONTEXT_MODE`، `RUN_CONTEXT_MODE`،
`PROMPT_BUILDER_MODE`، `SEMANTIC_POOL_MODE`، `RUNTIME_ENGINE_MODE` و
`WEB_SERVER_MODE`) در Phase 30 از schema و runtime حذف شده‌اند؛ همهٔ مسیرها
اکنون implementation canonical را اجرا می‌کنند و setting ناشناخته خطای واضح
می‌دهد. برای فهرست کامل ۱۶۳ setting به `SettingsSchema.js` مراجعه کنید.

## ۶. مستندات کامل اندپوینت‌های سرور وب کنسول (Web Server & REST / SSE API)

سرور canonical با `node bin/agent.js --serve <port> -w <path>` اجرا می‌شود.
تمام APIها token-protected هستند و method/path کامل در
[`test/fixtures/api-surface.json`](test/fixtures/api-surface.json) و
`web/server/RouteInventory.js` ثبت شده‌اند.

### مسیرهای اصلی

| روش | مسیر | پاسخ قراردادی |
|---|---|---|
| `POST` | `/api/tasks` | `202 {"accepted":true}` برای مسیر single-project تاریخی |
| `GET` | `/api/events` | SSE event stream؛ با `projectId` قابل فیلتر است |
| `GET` | `/api/state` | snapshot وضعیت، messages، events، approvals و run |
| `POST` | `/api/cancel` | لغو run جاری |
| `POST` | `/api/approval-mode` | تغییر `auto`/`prompt`/`deny` |
| `GET/POST` | `/api/settings` | مشاهده یا تغییر settingهای schema |
| `GET` | `/api/health`، `/api/metrics`، `/api/stats` | سلامت و metrics gateway/project |
| `GET/POST` | `/api/mcp` | وضعیت یا افزودن MCP server |
| `GET/POST/DELETE` | `/api/sessions` و `/api/sessions/:id` | session persistence و replay |
| `GET` | `/api/calls/:key` | نتیجهٔ کامل یک tool call |
| `GET` | `/api/graph/:view` | graph/neighborhood/impact دادهٔ Semantic |

### API پروژه‌ها

| روش | مسیر | توضیح |
|---|---|---|
| `GET` | `/api/projects` | فهرست پروژه‌های ثبت‌شده، با فیلتر token |
| `POST` | `/api/projects` | ثبت پروژه با `rootPath` و permissionهای آن |
| `GET/PATCH/DELETE` | `/api/projects/:projectId` | دریافت، ویرایش یا حذف یک registry record |
| `GET` | `/api/projects/:projectId/state` | snapshot محدود به همان پروژه |
| `GET` | `/api/projects/:projectId/events` | event stream پروژه‌ای |
| `GET` | `/api/projects/:projectId/sessions` | sessionهای همان پروژه |
| `POST` | `/api/projects/:projectId/tasks` یا `/chat` | اجرای task با پاسخ `202 {accepted, project_id}` |
| `POST` | `/api/projects/:projectId/cancel` | لغو فقط runهای همان پروژه |
| `GET` | `/api/projects/:projectId/health` یا `/metrics` | سلامت و metrics همان پروژه |
| `GET/POST` | `/api/projects/:projectId/discussions` | list یا شروع discussion پایدار |
| `GET` | `/api/projects/:projectId/discussions/:discussionId` | replay transcript کامل همان پروژه |

### Discussion و approval

`POST /api/discussion` و `GET /api/discussion/personas` برای مسیر legacy
discussion حفظ شده‌اند. مسیر project-scoped علاوه بر `accepted`، شناسهٔ
پروژه و discussion را برمی‌گرداند:

```json
{
  "accepted": true,
  "id": "discussion-...",
  "project_id": "prj-a"
}
```

رونوشت کامل در `<project dataRoot>/discussion/<discussion-id>.json` با
نوشتار atomic نگه‌داری می‌شود. پروژهٔ دیگر نه در list آن را می‌بیند و نه
می‌تواند replay کند. Eventهای discussion شامل `project_id` هستند.

### استریم و امنیت

`GET /api/events?projectId=<id>` فقط eventهای همان پروژه را می‌فرستد؛ eventهای
global در stream پروژه‌ای صرفاً metadata aggregate هستند. token master یا
توکن scoped با permissionهای `project:read`، `project:write`،
`semantic:query` و `semantic:index` کنترل می‌شود. خطاهای validation کلید
`error` و در صورت نیاز `code` را به‌صورت additive حفظ می‌کنند.

## ۷. کاتالوگ کامل ابزارها و گروه‌ها (Tools & Tool Groups)

تمامی ابزارهای رجیسترشده دارای اعتبارسنجی دقیق اسکیما، محدودیت مرز ورک‌اسپیس و کنترل دسترسی پالیسی هستند:

```
┌──────────────────┬─────────────────────────────────────────────────────────────┐
│    گروه ابزار    │                           لیست ابزارها                      │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ filesystem.read  │ fs_read, fs_read_many, fs_list, fs_tree, fs_stat, fs_info  │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ filesystem.write │ fs_write, fs_edit, fs_mkdir, fs_move, fs_delete             │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ code.query       │ code_find_symbol, code_search, code_file_summary,           │
│                  │ code_dependencies, code_impact, code_find_tests,            │
│                  │ code_config_usage, code_context, code_index_status,         │
│                  │ code_architecture_violations, code_git_hotspots             │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ code.live        │ code_diagnostics, code_callers, code_definition,            │
│                  │ code_organize_imports                                       │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ code.write       │ code_rename, code_simulate_mutation                         │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ search           │ search_start, search_get, search_list, search_stop          │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ process          │ terminal_exec, process_start, process_read, process_write,  │
│                  │ process_terminate, process_list                             │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ git              │ git_status, git_diff, git_log, git_branch, git_checkout,    │
│                  │ git_add, git_commit                                         │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ planning         │ plan_get, plan_set, plan_update                             │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ memory & archive │ memory_get, archive_search, archive_get                     │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ knowledge        │ skill_get, skill_read                                       │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ mcp.inspect      │ mcp_servers, mcp_tools                                      │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ mcp.call         │ mcp_call, و هر ابزار کشف‌شده با نام mcp__<server>__<tool>    │
├──────────────────┼─────────────────────────────────────────────────────────────┤
│ mcp.manage       │ mcp_add, mcp_remove                                         │
└──────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## ۸. خط‌لولهٔ امنیتی، پالیسی و گاردها (Security & Policy Engine)

```text
فراخوانی ابزار توسط ایجنت
       │
       ▼
[ گارد مرز ورک‌اسپیس (Workspace Guard) ] ─── خارج از محدوده؟ ──► خطای رد فوری
       │ (مسدودسازی .. و سیم‌لینک‌های فرار)
       ▼
[ گارد دایرکتوری .git و اسرار ] ─────────── تلاش برای تغییر .git؟ ──► خطای دسترسی
       │
       ▼
[ موتور ارزیابی پالیسی (Policy Engine) ]
       │
       ├─ ابزارهای خواندنی (read-only) ────────────► مجاز فوری (Allow)
       ├─ ابزارهای مخرب (shell/edit/write/rename) ──► توقف و درخواست تأیید کاربر (Prompt)
       └─ فرامین غیرقابل بازگشت (rm -rf /) ────────► رد قطعی (Deny)
```

### محافظت‌های تعبیه‌شده:
1. **Loop Detection (ضد حلقه):** اگر یک ابزار با خطای یکسان بیش از ۳ بار متوالی تکرار شود، ران‌تایم بلافاصله حلقه را متوقف کرده و خطای ساختاریافته به مدل ارسال می‌کند.
2. **Secret Redaction (ماسک خودکار اسرار):** کلیدهای API و رشته‌های محرمانه در هیچ‌یک از لاگ‌ها یا خروجی‌های ارسالی به مدل به صورت خام درج نمی‌شوند.
3. **Strict Shell Isolation:** فرامین ترمینال در زیرپروسه با گروه کاربری ایزوله اجرا شده و در صورت انقضای مهلت (Timeout) کل درخت پروسه کشته می‌شود.

---

## ۹. مدیریت بودجهٔ کانتکست و حافظه (Context Budget & Compaction)

برای جلوگیری از سرریز کانتکست مدل و مدیریت هزینه‌ها، ران‌تایم از مکانیزم **فشرده‌سازی تدریجی (Graduated Compaction)** استفاده می‌کند:
* **پیام‌های جدید:** بدون تغییر و با جزئیات کامل حفظ می‌شوند.
* **پیام‌های میانی:** خروجی‌های حجیم ابزارها خلاصه می‌شوند.
* **پیام‌های قدیمی:** به یک خلاصهٔ فشرده (Summary Digest) تبدیل شده و به دایرکتوری بایگانی منتقل می‌شوند.
* **حافظه کاری (Working Memory):** اطلاعات و یافته‌های کلیدی در طول تسک‌های متعدد در حافظه پایدار ثبت می‌شوند تا در تسک‌های بعدی قابل استفاده باشند.

---

## ۱۰. لایهٔ اتصال به MCP و پروتکل‌های چهارگانه

ران‌تایم می‌تواند به هر سرور **Model Context Protocol** وصل شود و ابزارهای آن را در اختیار ایجنت‌ها بگذارد. کل این لایه در `agent/mcp/` است و هیچ وابستگی خارجی ندارد؛ حتی WebSocket مستقیماً پیاده‌سازی شده است.

### ۱۰.۱ پروتکل‌های پشتیبانی‌شده

| ترنسپورت | چطور کار می‌کند | چه زمانی انتخاب می‌شود |
|---|---|---|
| `stdio` | سرور به‌عنوان زیرپروسه اجرا می‌شود؛ پیام‌ها روی stdin/stdout با فریمینگ `Content-Length` یا NDJSON | وقتی `command` تعریف شده باشد |
| `http` | Streamable HTTP؛ هر پیام یک POST، پاسخ به‌صورت JSON یا استریم رویداد | آدرس `http(s)://` بدون مسیر `/sse` |
| `sse` | جفت قدیمی HTTP+SSE؛ یک استریم برای دریافت و یک مسیر POST برای ارسال | آدرسی که به `/sse` ختم شود |
| `websocket` | یک سوکت دوطرفه؛ هر پیام یک فریم متنی (RFC 6455) | آدرس `ws://` یا `wss://` |

ترنسپورت معمولاً از روی خود تعریف حدس زده می‌شود و نوشتنش اختیاری است.

### ۱۰.۲ محل تعریف سرورها

لایه‌های زیر به ترتیب خوانده می‌شوند و لایهٔ بعدی بر قبلی اولویت دارد:

```text
agent/registry/mcp_servers.json   سرورهای همراه ران‌تایم
<workspace>/.mcp.json             سرورهای پروژه (قابل کامیت)
<workspace>/.agent/mcp.json       سرورهای همین ورک‌اسپیس
MCP_SERVERS                       متغیر محیطی، بالاترین اولویت
```

هر سه شکل رایج پذیرفته می‌شود: `{"mcpServers": {...}}`، آبجکت ساده، و آرایه.

```jsonc
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
    },
    "docs": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "authorization": "Bearer ${env:DOCS_TOKEN}" }
    },
    "events": { "url": "wss://mcp.example.com/ws", "trust": "restricted" }
  }
}
```

مقدارهایی مثل `${env:TOKEN}` هنگام بارگذاری از محیط خوانده می‌شوند، بنابراین هیچ کلیدی داخل فایلی که در ریپازیتوری است نوشته نمی‌شود.

### ۱۰.۳ معرفی ابزارها به مدل

هر ابزار با فضای‌نام `mcp__<server>__<tool>` ثبت می‌شود تا دو سرور بتوانند ابزار هم‌نام داشته باشند. `MCP_EXPOSE_TOOLS` تعیین می‌کند مدل از کدام مسیر استفاده کند:

* **`namespaced`** — هر ابزار سرور مستقیماً به‌عنوان یک تابع با اسکیمای خودش اعلام می‌شود.
* **`gateway`** — فقط سه ابزار عمومی `mcp_servers`، `mcp_tools` و `mcp_call` وجود دارند.
* **`both`** (پیش‌فرض) — هر دو مسیر باز است.

| ابزار | کار |
|---|---|
| `mcp_servers` | فهرست سرورها با ترنسپورت، وضعیت اتصال و دلیل خطا |
| `mcp_tools` | کاتالوگ ابزارها به همراه پارامترهای هرکدام |
| `mcp_call` | فراخوانی هر ابزار روی هر سرور |
| `mcp_add` / `mcp_remove` | افزودن یا حذف سرور در حین اجرا (نیازمند تأیید) |

### ۱۰.۴ ایمنی و تخریب‌ناپذیری

* سروری که در دسترس نیست، **یک قابلیت کم‌شده است، نه یک ران شکست‌خورده**: ابزارهایش از کاتالوگ حذف می‌شوند، دلیلش نگه داشته می‌شود و بقیه به کار خود ادامه می‌دهند.
* ابزار یک سرور MCP بیرون از این ران‌تایم اجرا می‌شود، پس مرز ورک‌اسپیس شامل آن نمی‌شود. سرور با `trust: "restricted"` برای هر فراخوانی تأیید می‌خواهد و `MCP_APPROVAL=always` این را برای همهٔ سرورها اعمال می‌کند. هیچ‌کدام از این دو نمی‌توانند یک `deny` را باز کنند.
* با `include` و `exclude` می‌توان کاتالوگ یک سرور را قبل از رسیدن به مدل محدود کرد.

### ۱۰.۵ کنسول وب

دکمهٔ **MCP** در هدر کنسول، وضعیت زندهٔ سرورها را نشان می‌دهد و امکان اتصال سرور جدید، فعال/غیرفعال کردن و حذف را می‌دهد. همین کارها از طریق REST هم در دسترس‌اند:

* `GET /api/mcp` · `GET /api/mcp?refresh=1`
* `POST /api/mcp` — افزودن سرور
* `POST /api/mcp/:name/enabled` — روشن یا خاموش کردن
* `DELETE /api/mcp/:name` — حذف

---

## ۱۱. Semantic Engine به‌عنوان سرور MCP داخلی

موتور معنایی قبلاً کلاینت اختصاصی خودش را داشت: سوپروایز زیرپروسه، فریمینگ `Content-Length`، مسیر HTTP جداگانه، جدول فراخوانی‌های در انتظار و سیاست timeout — چیزهایی که هیچ‌کدام مخصوص هوش کد نبودند و هر سرور MCP به آن‌ها نیاز دارد.

اکنون همهٔ آن‌ها در `agent/mcp/` است و موتور معنایی به‌عنوان یک **سرور MCP داخلی به نام `semantic-engine`** ثبت می‌شود. چیزی که در `agent/mcp/semantic.js` باقی مانده فقط همان بخشی است که واقعاً به خود موتور مربوط است: یافتن مسیر باینری، بررسی در دسترس بودن، سنجش کهنگی ایندکس روی دیسک، و نشست‌های ایندکس.

```text
agent/tools/code/  ──►  agent/mcp/semantic.js  ──►  McpManager  ──►  یکی از چهار ترنسپورت
   (ابزارهای code_*)          (فقط منطق موتور)         (مشترک)
```

نتیجهٔ عملی:

* **ابزارهای `code_*` بدون هیچ تغییری کار می‌کنند** و از مسیر canonical `agent/mcp/semantic.js` و `ProjectSemanticResolver` استفاده می‌کنند.
* موتور معنایی هم می‌تواند از هر چهار ترنسپورت استفاده کند؛ `SEMANTIC_TRANSPORT` یا صرفاً مقداردهی `SEMANTIC_ENGINE_URL` آن را انتخاب می‌کند.
* یک پروژه می‌تواند در `.mcp.json` سروری با همین نام تعریف کند و موتور خودکار را کاملاً جایگزین کند.
* **پایش کهنگی ایندکس (Staleness Check)** مثل قبل باقی است: اگر ایندکس کهنه یا غایب باشد، ایجنت راهنمایی می‌گیرد و به ابزارهای متنی جایگزین سوییچ می‌کند.

---

## ۱۲. آزمون‌ها و ارزیابی کیفیت

سوئیت با Node scriptهای مستقل و بدون dependency تست‌رانر اجرا می‌شود. ساختار
domain-based و contractهای عمومی در [`test/README.md`](test/README.md) ثبت شده‌اند.

```bash
npm run check
npm test
npm run test:contracts
npm run test:tools
npm run test:mcp
npm run test:runtime
npm run test:context
npm run test:persistence
npm run test:projects
npm run test:discussion
npm run test:web
npm run test:ui
npm run test:e2e
```

در verification نهایی Phase 30، تعداد تست‌ها **694/694** در 49 entrypoint و
تماماً سبز است. `npm test` ترتیب serial را حفظ می‌کند و testهای contract قبل
از integration/e2e اجرا می‌شوند.

## ۱۳. راهنمای توسعهٔ canonical

### افزودن tool

1. declaration را در schema گروه متناظر زیر `agent/registry/tool-schemas/` اضافه کنید.
2. implementation را در گروه canonical زیر `agent/tools/<group>/` قرار دهید و
   آن را از `index.js` همان گروه export کنید.
3. `ToolRuntime.js` را برای اتصال نام model-facing به implementation به‌روز
   کنید و policy/group مربوط را در registry ثبت کنید.
4. برای schema و اجرای واقعی، contract/unit test در `test/contracts/` و
   `test/tools/` اضافه کنید؛ `ToolRegistryAdapter.assertParity()` باید سبز بماند.

### افزودن skill یا agent

- skillهای declarative در `agent/registry/skills.json` و منابع حجیم در
  `agent/skills/<name>/` قرار می‌گیرند؛ `SkillTools` آن‌ها را lazy می‌خواند.
- agent profile در `agent/registry/agents.json` و personaهای discussion در
  `agent/registry/personas.json` ثبت می‌شوند. toolها و policy آن profile باید
  هم‌زمان contract-tested باشند.

### تغییر prompt یا event

- sectionهای prompt در builderهای `agent/prompt/` اضافه می‌شوند و request
  contract باید در `test/contracts/prompt.contract.test.js` و differential
  test به‌روزرسانی شود.
- event جدید باید در `agent/events/EventTypes.js` و producer/consumer متناظر
  ثبت شود. event durable خام می‌ماند؛ redaction فقط برای log/external
  projection است و contract test isolation الزامی است.

### افزودن یا اجرای project

پروژه از طریق `ProjectRegistry` یا `POST /api/projects` ثبت می‌شود؛ root از
registry خوانده می‌شود و هویت از model/tool arguments پذیرفته نمی‌شود. state
پایدار project در `STRUCTURED_AI_DATA_HOME/projects/<id>/` قرار می‌گیرد و
synthetic default برای سازگاری از `<workspace>/.agent/` استفاده می‌کند.
برای اجرای پروژهٔ مشخص:

```bash
node bin/agent.js --project <project-id> "task"
```

هیچ rollout flag یا compatibility facade دیگری برای فعال‌سازی این مسیر لازم
نیست.

## مجوز (License)
این پروژه تحت مجوز **MIT** منتشر شده است.
