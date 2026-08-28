# برنامهٔ پیاده‌سازی Multi-Project در Structured AI

> **سند حاکم بر اجرا:** پلن نهایی و وضعیت اجرایی همه فازها در [EXECUTION_PLAN.md](EXECUTION_PLAN.md) مستند شده و تمام فازهای آن به وضعیت 🟢 رسیده‌اند.

**وضعیت:** برنامهٔ اجرایی  
**تاریخ:** 2026-08-24  
**پروژه:** `structured-ai`

---

## ۱. هدف

هدف، اضافه‌کردن قابلیت multi-project به Structured AI است؛ به‌گونه‌ای که چند پروژه به‌صورت هم‌زمان مدیریت شوند، اما هر task، agent، ابزار، session، memory و Semantic Engine به پروژهٔ صحیح متصل بماند.

معماری پیشنهادی:

```text
Structured AI Gateway / Web Console
        │
        ├── Project Registry
        ├── Project Selector
        ├── Run Manager
        ├── Session Manager
        └── Semantic Client Pool
                │
                ├── Project A → Semantic Worker A
                ├── Project B → Semantic Worker B
                └── Project C → Semantic Worker C
```

هر Run به‌صورت پیش‌فرض فقط یک پروژهٔ فعال دارد:

```text
Run 1 → project-a
Run 2 → project-b
Run 3 → project-a
```

taskهای چندپروژه‌ای باید explicit باشند و از delegation یا چند execution context مستقل استفاده کنند.

---

## ۲. مشکل معماری فعلی

Structured AI در حال حاضر در چند بخش به workspace global وابسته است:

```text
WORKSPACE_ROOT
```

ماژول‌های مهم وابسته به آن:

```text
agent/lib/workspace.js
agent/tools/filesystem.js
agent/tools/process.js
agent/tools/git.js
agent/tools/search.js
agent/tools/code.js
agent/tools/plan.js
agent/lib/memory.js
agent/lib/archive.js
agent/lib/sessions.js
agent/lib/journal.js
agent/lib/eventstore.js
agent/mcp/semantic.js
```

همچنین تعدادی state در سطح module/process قرار دارند:

```text
RUN
AGENT_BUDGET
memory
plan
sessions
archive
search sessions
process sessions
MCP manager
Semantic Engine client
events
```

در نتیجه فقط اضافه‌کردن `projectId` به UI کافی نیست؛ stateها باید به دو سطح تقسیم شوند:

```text
Project-scoped state
Run-scoped state
```

---

## ۳. اصول معماری

### ۳.۱ active project پیش‌فرض

هر task معمولی یک پروژهٔ فعال دارد و همهٔ ابزارها با همان پروژه اجرا می‌شوند.

```text
Task → active project → project context → tools
```

مدل نباید در هر فراخوانی بتواند root دلخواه انتخاب کند.

### ۳.۲ cross-project فقط به‌صورت explicit

برای taskهایی مانند:

```text
پروژهٔ frontend و backend را مقایسه کن
```

runtime باید context مستقل بسازد:

```text
Agent A → project-a
Agent B → project-b
Main Agent → synthesis only
```

### ۳.۳ backward compatibility

فرمان‌ها و APIهای فعلی که projectId ندارند، همچنان با default project کار کنند.

### ۳.۴ عدم اشتراک stateهای حساس

این موارد نباید بین دو پروژه share شوند:

```text
workspace root
filesystem boundary
terminal cwd
Git repository
Semantic Engine connection
memory
plan
sessions
archive
search sessions
process sessions
approvals
events
```

---

# ۴. ساختار directory پیشنهادی

```text
structured-ai/
├── agent/
│   ├── projects/
│   │   ├── ProjectRegistry.js
│   │   ├── ProjectContext.js
│   │   ├── ProjectResolver.js
│   │   └── ProjectStore.js
│   │
│   ├── runtime/
│   │   ├── AgentRunContext.js
│   │   ├── RunManager.js
│   │   ├── RunBudget.js
│   │   └── RunCancellation.js
│   │
│   ├── mcp/
│   │   ├── SemanticClient.js
│   │   ├── SemanticClientPool.js
│   │   └── ProjectSemanticResolver.js
│   │
│   ├── prompt/
│   │   ├── PromptBuilder.js
│   │   ├── ProjectContextBuilder.js
│   │   └── RuntimeContextBuilder.js
│   │
│   ├── persistence/
│   │   ├── ProjectPersistence.js
│   │   ├── SessionRepository.js
│   │   ├── MemoryRepository.js
│   │   └── ArchiveRepository.js
│   │
│   └── tools/
│       ├── ToolContext.js
│       ├── project.js
│       ├── filesystem.js
│       ├── process.js
│       ├── git.js
│       └── code.js
│
├── web/
│   ├── server/
│   │   ├── ProjectController.js
│   │   ├── RunController.js
│   │   ├── ProjectEventStream.js
│   │   └── ProjectAuthorization.js
│   │
│   └── public/
│       ├── project-switcher.js
│       ├── project-store.js
│       ├── project-api.js
│       ├── project-dashboard.js
│       └── project-events.js
│
└── test/
    ├── projects/
    ├── runtime/
    ├── tools/
    ├── mcp/
    ├── prompt/
    ├── web/
    └── e2e/
```

---

# ۵. گام‌های پیاده‌سازی

## گام ۰ — ثبت baseline و قرارداد regression

### هدف

قبل از شروع multi-project، رفتار single-project فعلی ثبت شود.

### علت

Multi-project نباید باعث شکستن CLI، ابزارها، session، memory، MCP یا UI فعلی شود.

### نحوهٔ پیاده‌سازی

1. اجرای تمام تست‌های فعلی.
2. ثبت event nameها و payloadها.
3. ثبت API responseها.
4. ساخت fixture برای default project.
5. ثبت رفتار `WORKSPACE_ROOT` فعلی.
6. تعریف normalizer برای timestamp، PID و duration.

### معیار پذیرش

- full test suite قبل از refactor سبز باشد.
- behavior single-project قابل replay باشد.
- API و event contract مستند شده باشند.
- حداقل یک تست برای هر tool مهم وجود داشته باشد.

---

## گام ۱ — ایجاد Project Registry

### هدف

ثبت و مدیریت چند پروژه در Structured AI.

### فایل‌ها

```text
agent/projects/ProjectRegistry.js
agent/projects/ProjectStore.js
agent/projects/ProjectResolver.js
```

### مدل پروژه

```js
{
  id: "prj-a",
  name: "Engine Core",
  rootPath: "/home/user/projects/engine-core",
  semanticEndpoint: "http://localhost:4000/mcp/prj-a",
  enabled: true,
  autoStart: true,
  permissions: {
    read: true,
    write: true,
    terminal: true,
    git: true
  }
}
```

### API

```js
projectRegistry.register(config)
projectRegistry.get(projectId)
projectRegistry.list()
projectRegistry.remove(projectId)
projectRegistry.update(projectId, patch)
projectRegistry.resolveDefault()
```

### قواعد

- root با `realpath` canonical شود.
- project تکراری بر اساس canonical root تشخیص داده شود.
- project ID از root خام ساخته نشود.
- root path فقط از registry خوانده شود.
- project name مستقل از project ID باشد.

### معیار پذیرش

- دو پروژه با basename یکسان هم‌زمان ثبت شوند.
- project ID آن‌ها متفاوت باشد.
- ثبت مجدد root موجود پروژهٔ جدید نسازد.
- تغییر نام project، ID را تغییر ندهد.
- حذف project فقط registry و state همان project را هدف بگیرد.

---

## گام ۲ — ایجاد ProjectContext

### هدف

تمام عملیات runtime با context پروژه انجام شوند.

### مدل

```js
{
  projectId: "prj-a",
  projectName: "Engine Core",
  workspaceRoot: "/home/user/projects/engine-core",
  dataRoot: "/home/user/.local/share/structured-ai/projects/prj-a",
  semanticEndpoint: "http://localhost:4000/mcp/prj-a",
  permissions: {
    read: true,
    write: true,
    terminal: true,
    git: true
  }
}
```

### نحوهٔ استفاده

```js
const project = projectRegistry.get(projectId);

await runAgent({
  task,
  project
});
```

یا:

```js
await runAgent({
  task,
  projectId,
  projectRegistry
});
```

### معیار پذیرش

- هر Run یک ProjectContext داشته باشد.
- context پروژه در تمام tool callها قابل دسترسی باشد.
- هیچ tool مهمی برای اجرای خود به `WORKSPACE_ROOT` global وابسته نباشد.
- در صورت نبود project، error واضح تولید شود.

---

## گام ۳ — project-aware کردن File، Process و Git Tools

### هدف

ابزارها به‌جای root global از ProjectContext استفاده کنند.

### Workspace API جدید

```js
resolveWorkspacePath(projectContext, inputPath)
isInsideProject(projectContext, targetPath)
toProjectRelative(projectContext, targetPath)
```

### ابزارهای فایل

```text
fs_read
fs_read_many
fs_list
fs_tree
fs_stat
fs_info
fs_write
fs_edit
fs_mkdir
fs_move
fs_delete
```

نمونه:

```js
fsRead(args, projectContext)
```

### Process

```js
processManager.start({
  projectId,
  cwd: projectContext.workspaceRoot,
  command
});
```

### Git

```js
gitStatus(projectContext)
gitDiff(projectContext)
gitLog(projectContext)
gitCommit(projectContext)
```

### معیار پذیرش

- `fs_read` پروژهٔ A نتواند فایل پروژهٔ B را بخواند.
- terminal با cwd صحیح اجرا شود.
- Git در repository درست اجرا شود.
- symlink escape بین projectها مسدود شود.
- اجرای هم‌زمان ابزارهای دو project تداخل نداشته باشد.

---

## گام ۴ — جداسازی stateهای per-project

### هدف

memory، plan، session، archive و eventهای هر project مستقل شوند.

### ساختار پیشنهادی

```text
{{USER_DATA}}/.structured-ai/
├── registry.json
├── projects/
│   ├── prj-a/
│   │   ├── project.json
│   │   ├── memory.json
│   │   ├── plan.json
│   │   ├── sessions/
│   │   ├── archive/
│   │   ├── journal/
│   │   ├── eventstore/
│   │   ├── searches/
│   │   ├── processes/
│   │   └── logs/
│   │
│   └── prj-b/
│       └── ...
└── runtime/
    ├── settings.json
    └── telemetry/
```

### per-project state

```text
memory
plan
sessions
archive
journal
eventstore
search sessions
process sessions
project hooks
semantic connection
project events
```

### global state

```text
agent profiles
tool schemas
skill registry
policy defaults
LLM endpoint settings
Gateway metrics
Project registry
```

تنظیمات باید overlay داشته باشند:

```text
global settings
    ↓
project settings
    ↓
run override
```

### معیار پذیرش

- memory پروژهٔ A در B دیده نشود.
- planها مستقل باشند.
- sessionهای هر project جدا replay شوند.
- archive جست‌وجوی cross-project ناخواسته نداشته باشد.
- eventstore هر project فقط eventهای خودش را نگه دارد.
- restart runtime باعث از بین رفتن state پروژه‌ها نشود.

---

## گام ۵ — ایجاد AgentRunContext و RunManager

### هدف

حذف state global `RUN` و پشتیبانی از اجرای هم‌زمان چند task.

### مدل

```js
class AgentRunContext {
  constructor({
    runId,
    project,
    task,
    parentRunId,
    turnId
  }) {
    this.runId = runId;
    this.project = project;
    this.task = task;
    this.parentRunId = parentRunId;
    this.turnId = turnId;

    this.messages = [];
    this.budget = new RunBudget();
    this.cancellation = new CancellationToken();
    this.agentBudget = new AgentBudget();
  }
}
```

### اجرای هم‌زمان

```js
await Promise.all([
  runAgent({
    projectId: "prj-a",
    task: "Analyze authentication"
  }),

  runAgent({
    projectId: "prj-b",
    task: "Run tests and fix failures"
  })
]);
```

### معیار پذیرش

- دو Run هم‌زمان قابل اجرا باشند.
- cancellation پروژهٔ A روی B اثر نگذارد.
- budget و iteration دو Run قاطی نشوند.
- messages و tool results جدا باشند.
- runId، projectId و turnId در eventها ثبت شوند.

---

## گام ۶ — اصلاح Tool Runtime

### هدف

context پروژه و run در زمان اجرای tool به‌صورت امن منتقل شود.

### API پیشنهادی

```js
executeTool(name, args, {
  agent,
  runId,
  projectId,
  projectContext
});
```

ترجیحاً implementation به دو پارامتر تقسیم شود:

```js
implementation(args, context)
```

نه اینکه projectId در user arguments تزریق شود.

### علت

`projectId` نباید بخشی از داده‌ای باشد که مدل بتواند جعل یا overwrite کند. این یک runtime context است.

### معیار پذیرش

- tool schemaهای فعلی تغییر نکنند.
- project context از runtime بیاید.
- telemetry شامل projectId و runId باشد.
- policy قبل از execution روی project context صحیح اعمال شود.
- ابزار بدون context معتبر اجرا نشود.

---

## گام ۷ — Semantic Client Pool

### هدف

هر project به Semantic Worker خودش متصل شود.

### ساختار

```text
agent/mcp/
├── SemanticClient.js
├── SemanticClientPool.js
└── ProjectSemanticResolver.js
```

### مدل

```js
class SemanticClientPool {
  clients = new Map();

  get(projectId) {}
  connect(project) {}
  disconnect(projectId) {}
  reload(projectId) {}
}
```

### routing

```text
project-a → /mcp/prj-a
project-b → /mcp/prj-b
```

### استفاده در code tools

```js
const client = semanticPool.get(projectId);
return client.call("find_symbol", args);
```

ابزارهای زیر باید project-aware شوند:

```text
code_index_status
code_index_start
code_index_get
code_find_symbol
code_search
code_file_summary
code_dependencies
code_impact
code_find_tests
code_config_usage
code_context
code_diagnostics
code_callers
code_definition
code_rename
```

### معیار پذیرش

- `code_search` پروژهٔ A نتیجهٔ B را ندهد.
- index update A روی B اثر نگذارد.
- Semantic MCP connection برای هر project جدا باشد.
- crash یک Semantic Worker فقط project خودش را affected کند.
- cache Semantic Engine با projectId و index generation جدا شود.

---

## گام ۸ — Project-aware کردن Prompt Builder

### هدف

Prompt فعال‌ترین project و محدودهٔ مجاز آن را به مدل معرفی کند.

### پیام project context

```json
{
  "type": "project_context",
  "project": {
    "id": "prj-a",
    "name": "Engine Core",
    "root": "/home/user/projects/engine-core",
    "indexState": "fresh",
    "semanticState": "ready"
  },
  "availableProjects": [
    {
      "id": "prj-a",
      "name": "Engine Core",
      "status": "ready"
    },
    {
      "id": "prj-b",
      "name": "Web Client",
      "status": "ready"
    }
  ],
  "rules": [
    "Use only the active project unless a cross-project task is explicit.",
    "Never access another project by guessing its filesystem path.",
    "Attribute every finding to its project."
  ]
}
```

### رفتار

Task معمولی:

```text
از active project استفاده کن
```

task چندپروژه‌ای:

```text
برای هر project یک Sub-Agent یا Run مستقل بساز
```

### Semantic skill

فعال بودن skill باید به پروژهٔ فعال وابسته باشد:

```text
Semantic Worker project فعال ready است → skill فعال
Semantic Worker project فعال unavailable است → skill غیرفعال یا degraded
```

### معیار پذیرش

- active project در prompt واضح باشد.
- model نتواند root دلخواه تعیین کند.
- Sub-Agent project والد را حفظ کند.
- cross-project result با project label برگردد.
- prompt پروژهٔ اشتباه را به مدل معرفی نکند.

---

## گام ۹ — Multi-project delegation

### هدف

پشتیبانی امن از taskهایی که عمداً چند پروژه را هدف می‌گیرند.

### نمونه

```text
پروژهٔ frontend و backend را برای تغییر API بررسی کن
```

runtime باید چیزی شبیه این بسازد:

```text
Main Agent
 ├── Sub-Agent A → project-a
 └── Sub-Agent B → project-b
```

هر delegation باید project context مستقل داشته باشد:

```json
{
  "id": "analyze-a",
  "agent": "code_analysis",
  "projectId": "prj-a",
  "task": "Analyze the API usage.",
  "depends_on": []
}
```

نتیجه:

```json
{
  "projectId": "prj-a",
  "success": true,
  "findings": []
}
```

### قوانین

- delegation بدون projectId از active project استفاده کند.
- تغییر project context در وسط Sub-Agent ممنوع باشد.
- cross-project write به approval جدا نیاز داشته باشد.
- synthesis فقط از resultهای labelدار استفاده کند.

### معیار پذیرش

- دو Sub-Agent روی دو project هم‌زمان اجرا شوند.
- toolهای A و B قاطی نشوند.
- نتیجهٔ final منبع هر finding را مشخص کند.
- failure یک project مانع گزارش project دیگر نشود.

---

## گام ۱۰ — Web APIهای project-scoped

### هدف

Task، chat، events، sessions و state از طریق projectId تفکیک شوند.

### APIهای جدید

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
DELETE /api/projects/:projectId

POST   /api/projects/:projectId/tasks
GET    /api/projects/:projectId/state
GET    /api/projects/:projectId/events
GET    /api/projects/:projectId/sessions
POST   /api/projects/:projectId/chat
POST   /api/projects/:projectId/cancel
```

### backward compatibility

API قدیمی:

```text
POST /api/tasks
```

اگر projectId نداشته باشد، default project استفاده شود.

API جدید:

```json
{
  "projectId": "prj-a",
  "task": "Run tests"
}
```

### معیار پذیرش

- task با projectId صحیح اجرا شود.
- `/api/tasks` قدیمی همچنان کار کند.
- state پروژهٔ A در B نمایش داده نشود.
- cancel فقط run همان project را متوقف کند.
- session endpointها project-scoped باشند.

---

## گام ۱۱ — project-scoped events

### هدف

event stream پروژه‌ها با یکدیگر مخلوط نشود.

### event envelope

```json
{
  "type": "tool:end",
  "projectId": "prj-a",
  "runId": "run-123",
  "turnId": "turn-1",
  "agent": "main_agent",
  "scope": "main_agent",
  "tool": "code_search"
}
```

### endpointها

```text
GET /api/projects/:projectId/events
GET /api/events?projectId=prj-a
```

### معیار پذیرش

- event پروژهٔ A در stream B دیده نشود.
- run و turn در UI درست group شوند.
- replay eventها project context را حفظ کند.
- event global فقط metadata تجمیعی نشان دهد، نه source data پروژه‌ها.

---

## گام ۱۲ — UI چندپروژه‌ای

### هدف

کاربر بتواند projectها را انتخاب، مدیریت و مشاهده کند.

### Project Switcher

در header:

```text
[ Engine Core ▼ ] [New Project] [Gateway Health]
```

### صفحهٔ Projects

برای هر پروژه:

```text
Project name
Project ID
Root path
Semantic worker state
Agent runs
Last activity
Index state
MCP state
```

عملیات:

```text
Open
Start
Stop
Restart
Settings
Open Semantic Dashboard
```

### Task Composer

انتخاب scope:

```text
Current project
Specific project
Multiple projects
```

حالت چندپروژه‌ای:

```text
☑ Engine Core
☑ Web Client
☐ Documentation
```

### نمایش نتیجهٔ چندپروژه‌ای

```text
Engine Core
  ✓ 12 findings

Web Client
  ✓ 8 findings

Synthesis
  ...
```

### معیار پذیرش

- ساخت و انتخاب project از UI انجام شود.
- task روی project انتخاب‌شده اجرا شود.
- project switcher state درست داشته باشد.
- refresh صفحه project را از دست ندهد.
- cross-project task نتایج labelدار نشان دهد.
- کلیک روی project، dashboard همان project را باز کند.

---

## گام ۱۳ — Project Dashboard

### هدف

هر پروژه dashboard و context اختصاصی داشته باشد.

### مسیر

```text
/projects/:projectId
```

### تب‌ها

```text
Overview
Agent Runs
Sessions
Memory
Plan
Events
Approvals
Semantic Engine
MCP
Logs
Settings
```

### معیار پذیرش

- dashboard پروژهٔ A دادهٔ B را نشان ندهد.
- deep link مستقیم کار کند.
- Visualizer و Semantic Dashboard projectId صحیح بگیرند.
- history و sessionهای همان project نمایش داده شوند.
- health و index generation پروژه واضح باشد.

---

## گام ۱۴ — project-scoped MCP و external serverها

### Semantic MCP

Semantic Engine باید با project endpoint صحیح استفاده شود:

```text
/mcp/prj-a
/mcp/prj-b
```

### External MCP scope

هر MCP باید scope داشته باشد:

```json
{
  "name": "database",
  "scope": "project",
  "projects": ["prj-a", "prj-b"]
}
```

یا:

```json
{
  "name": "github",
  "scope": "global"
}
```

### معیار پذیرش

- MCP server پروژهٔ A به B دسترسی نداشته باشد.
- tools/list فقط ابزارهای مجاز project را نشان دهد.
- MCP approval شامل projectId باشد.
- external server global و project-scoped تفکیک شوند.

---

## گام ۱۵ — امنیت و authorization

### هدف

هیچ project dataای از محدودهٔ مجاز خارج نشود.

### زنجیرهٔ هر request

```text
authenticate
  → resolve projectId
  → authorize project access
  → load ProjectContext
  → execute/proxy
```

### token scope

```json
{
  "tokenId": "key-1",
  "allowedProjects": ["prj-a", "prj-c"],
  "permissions": [
    "project:read",
    "project:write",
    "semantic:query",
    "semantic:index"
  ]
}
```

### قواعد

- projectId تنها شناسهٔ قابل انتخاب توسط client باشد.
- root path از مدل پذیرفته نشود.
- path escape و symlink escape مسدود شود.
- approval per-project باشد.
- logها token و source content را mask کنند.
- cache key شامل projectId باشد.

### معیار پذیرش

- token بدون دسترسی `403` بگیرد.
- token پروژهٔ A نتواند B را query کند.
- `fs_read`، terminal، Git و Semantic tools scope صحیح داشته باشند.
- هیچ project dataای در event یا cache پروژهٔ دیگر ظاهر نشود.

---

## گام ۱۶ — concurrency و resource limits

### هدف

چند project هم‌زمان اجرا شوند، اما یک project پرمصرف کل runtime را قفل نکند.

### تنظیمات پیشنهادی

```text
MAX_CONCURRENT_PROJECT_RUNS
MAX_CONCURRENT_INDEX_RUNS
MAX_RUNS_PER_PROJECT
MAX_WORKERS_PER_USER
PROJECT_MEMORY_LIMIT
PROJECT_CPU_LIMIT
RUN_QUEUE_LIMIT
```

### مدل اجرا

```text
Project A: run active
Project B: run active
Project C: queued
Project D: ready
```

### معیار پذیرش

- run پروژه‌های مختلف parallel اجرا شود.
- runهای یک project طبق policy serialize یا محدود شوند.
- queue هر project مستقل باشد.
- cancellation یک project صف دیگر را خراب نکند.
- memory و CPU limit قابل مشاهده باشند.

---

## گام ۱۷ — metrics و observability

### metrics per-project

```text
project_runs_total
project_active_runs
project_failed_runs
project_tool_calls_total
project_index_state
project_last_activity
project_memory_bytes
project_process_count
project_mcp_calls_total
```

### metrics global

```text
gateway_projects_total
gateway_active_runs
gateway_failed_runs
gateway_memory_bytes
gateway_tool_calls_total
gateway_mcp_errors_total
```

### UI

برای هر project نمایش داده شود:

```text
Worker state
Run state
Index state
Semantic state
MCP state
Last error
Last activity
Memory
CPU
Queue
```

### معیار پذیرش

- metrics project و global از هم قابل تفکیک باشند.
- crash یک project health کل سیستم را خراب نکند.
- event و log هر Run شامل projectId باشد.
- UI وضعیت real-time یا near-real-time داشته باشد.

---

## گام ۱۸ — migration از single-project

### هدف

کاربران فعلی بدون تنظیم مجدد کامل ادامه دهند.

### default project

اگر فقط `WORKSPACE_ROOT` موجود باشد:

```text
WORKSPACE_ROOT → default project
```

برای CLI قدیمی:

```bash
node bin/agent.js -w /path/to/project "Run tests"
```

runtime به‌صورت خودکار default project را resolve کند.

### state migration

state فعلی:

```text
<workspace>/.agent/
```

به project پیش‌فرض map شود، بدون حذف فایل‌های قدیمی.

### معیار پذیرش

- CLI فعلی بدون projectId کار کند.
- sessionهای قبلی قابل load باشند.
- memory و archive قدیمی از دست نروند.
- API فعلی به default project route شود.
- migration دوباره‌پذیر و idempotent باشد.

---

## گام ۱۹ — تست‌های اصلی

### Project isolation

- دو project با basename یکسان.
- rootهای متفاوت.
- artifact و state مستقل.
- نتیجهٔ Semantic مستقل.

### Tool isolation

- read/write در project A روی B اثر نگذارد.
- terminal cwd صحیح.
- Git repository صحیح.
- process session مستقل.

### Runtime isolation

- Run A و B هم‌زمان.
- budget مستقل.
- cancellation مستقل.
- delegation context صحیح.

### MCP isolation

```text
/mcp/a → Worker A
/mcp/b → Worker B
```

- tools/list جدا.
- tools/call جدا.
- connection و cache جدا.

### Persistence isolation

- memory A در B دیده نشود.
- plan A در B دیده نشود.
- session و archive جدا.
- event replay جدا.

### UI

- project switcher.
- create/edit/delete.
- start/stop/restart.
- dashboard.
- event stream.
- project-scoped chat.
- cross-project result display.

### معیار پذیرش end-to-end

1. Gateway یا Web Console اجرا شود.
2. projectهای A و B ثبت شوند.
3. هر دو project قابل انتخاب باشند.
4. دو task هم‌زمان اجرا شوند.
5. هر task فقط workspace خودش را ببیند.
6. Semantic query به Worker درست route شود.
7. memory، plan، session و archive مستقل باشند.
8. یک Worker یا Run خراب شود.
9. project دیگر بدون interruption ادامه دهد.
10. UI وضعیت هر دو را درست نشان دهد.

---

# ۶. ترتیب واقعی اجرای refactor

```text
1.  baseline و contract tests
2.  ProjectRegistry
3.  ProjectContext
4.  project-aware workspace/filesystem tools
5.  project-aware process و Git
6.  per-project persistence
7.  AgentRunContext و RunManager
8.  project-aware Tool Runtime
9.  SemanticClientPool
10. project-aware Prompt Builder
11. multi-project delegation
12. project-scoped Web API
13. project-scoped events
14. multi-project UI
15. project dashboard
16. MCP scope و authorization
17. concurrency و resource limits
18. metrics و observability
19. migration و documentation
20. load و end-to-end tests
```

---

# ۷. نتیجهٔ نهایی مورد انتظار

```text
یک process یا Gateway مرکزی
  ├── Project Registry
  ├── Project-aware Run Manager
  ├── Project-aware Prompt Builder
  ├── Project-aware Tool Runtime
  ├── Semantic Client Pool
  ├── Project-scoped Web API
  └── Multi-project UI
```

و برای هر task:

```text
Task
  → projectId
  → ProjectContext
  → AgentRunContext
  → Prompt
  → project-scoped tools
  → project-scoped Semantic MCP
  → project-scoped state/events
```

با این معماری، Structured AI هم رفتار single-project فعلی را حفظ می‌کند و هم می‌تواند چند پروژه را به‌صورت هم‌زمان، ایزوله و قابل مدیریت اجرا کند.
