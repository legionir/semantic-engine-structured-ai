# ترتیب اجرایی Refactor و Multi-Project در Structured AI

> **سند حاکم بر اجرا:** پلن نهایی و وضعیت اجرایی همه فازها در [EXECUTION_PLAN.md](EXECUTION_PLAN.md) مستند شده و تمام فازهای آن به وضعیت 🟢 رسیده‌اند.

**وضعیت:** برنامهٔ اجرایی  
**تاریخ:** 2026-08-24  
**پروژه:** `structured-ai`

---

## تصمیم معماری

نباید ابتدا کل Structured AI را به‌صورت کامل refactor کنیم و بعد سراغ Multi-Project برویم.

همچنین نباید Multi-Project را مستقیماً روی stateها و globalهای فعلی پیاده کنیم.

مسیر پیشنهادی:

```text
Refactor foundation کوچک
        ↓
Multi-project MVP
        ↓
Hardening و تکمیل isolation
        ↓
ادامهٔ refactorهای بزرگ
```

این مسیر از یک big-bang rewrite جلوگیری می‌کند و در عین حال اجازه نمی‌دهد project context به‌صورت پراکنده و کنترل‌نشده وارد کد فعلی شود.

---

# ۱. چرا full refactor نباید اول انجام شود؟

اگر تمام Structured AI پیش از Multi-Project refactor شود:

- مدت زیادی feature قابل استفادهٔ جدیدی تحویل نمی‌شود.
- ریسک تغییر رفتار runtime بالا می‌رود.
- ممکن است abstractionهای انتخاب‌شده با نیازهای project context سازگار نباشند.
- Prompt، Runtime، UI، MCP و Persistence هم‌زمان تغییر می‌کنند.
- review و rollback بسیار سخت می‌شود.

بنابراین ابتدا فقط abstractionهای ضروری برای Multi-Project استخراج می‌شوند، نه تمام فایل‌های monolithic.

---

# ۲. چرا Multi-Project مستقیم روی کد فعلی نباید ساخته شود؟

Structured AI در وضعیت فعلی به stateهای global وابسته است:

```text
WORKSPACE_ROOT
RUN
AGENT_BUDGET
memory
plan
sessions
archive
search sessions
process sessions
Semantic Engine client
events
```

اگر فقط `projectId` به API اضافه شود، مشکلات زیر ایجاد می‌شود:

```text
task پروژهٔ A فایل پروژهٔ B را بخواند
memory دو پروژه ترکیب شود
Semantic query به Worker اشتباه برود
event پروژهٔ A در UI پروژهٔ B نمایش داده شود
cancellation یک Run روی Run دیگر اثر بگذارد
```

پس قبل از Multi-Project باید boundaryهای اصلی ساخته شوند.

---

# ۳. مرحلهٔ اول: Refactor Foundation

این مرحله refactor کامل نیست؛ فقط پایه‌هایی را ایجاد می‌کند که Multi-Project به آن‌ها نیاز دارد.

## ۳.۱ Baseline و contract tests

### هدف

رفتار فعلی single-project قبل از تغییرات ثبت و قابل مقایسه شود.

### کارها

- اجرای full test suite فعلی.
- ثبت event nameها و payloadها.
- ثبت API responseها.
- ثبت رفتار فعلی `WORKSPACE_ROOT`.
- ساخت fixture برای prompt، tool execution، MCP، session و UI.
- ایجاد normalizer برای timestamp، PID و duration.

### معیار پذیرش

- تمام تست‌های فعلی سبز باشند.
- behavior فعلی قابل replay باشد.
- API، event و action contract مستند شود.
- هیچ تغییر ساختاری بدون baseline انجام نشود.

---

## ۳.۲ ایجاد `ProjectContext`

### هدف

تمام عملیات runtime یک context صریح از پروژه دریافت کنند.

### مدل پیشنهادی

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

### معیار پذیرش

- هر Run یک `ProjectContext` داشته باشد.
- context پروژه در تمام tool callها قابل دسترسی باشد.
- در صورت نبود project، error واضح تولید شود.
- behavior single-project با default project حفظ شود.

---

## ۳.۳ ایجاد `ProjectRegistry`

### هدف

ثبت، resolve و مدیریت چند پروژه بدون collision.

### فایل‌ها

```text
structured-ai/agent/projects/ProjectRegistry.js
structured-ai/agent/projects/ProjectStore.js
structured-ai/agent/projects/ProjectResolver.js
```

### کارها

- تولید project ID پایدار.
- canonical کردن root با `realpath`.
- تشخیص root تکراری.
- تعریف default project برای CLI قدیمی.
- ذخیرهٔ registry در data directory مرکزی.

### معیار پذیرش

- دو project با basename یکسان هم‌زمان ثبت شوند.
- project ID آن‌ها متفاوت باشد.
- register مجدد root، project جدید نسازد.
- CLI بدون `projectId` همچنان default project را انتخاب کند.

---

## ۳.۴ Context-aware کردن ابزارهای اصلی

### هدف

File، Process و Git به‌جای `WORKSPACE_ROOT` global از `ProjectContext` استفاده کنند.

### API پیشنهادی

```js
resolveWorkspacePath(projectContext, inputPath)
isInsideProject(projectContext, targetPath)
toProjectRelative(projectContext, targetPath)
```

و:

```js
executeTool(name, args, {
  agent,
  runId,
  projectId,
  projectContext
});
```

### ابزارهای تحت پوشش

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

terminal_exec
process_start
process_read
process_write
process_terminate
process_list

git_status
git_diff
git_log
git_branch
git_checkout
git_add
git_commit
```

### معیار پذیرش

- ابزارهای project A نتوانند به B دسترسی پیدا کنند.
- terminal با cwd صحیح اجرا شود.
- Git در repository صحیح اجرا شود.
- symlink escape بین projectها مسدود شود.
- schema ابزارها تغییر نکند.

---

## ۳.۵ ایجاد `AgentRunContext`

### هدف

حذف تدریجی state global `RUN` و `AGENT_BUDGET`.

### مدل پیشنهادی

```js
{
  runId,
  projectId,
  task,
  parentRunId,
  turnId,
  messages,
  budget,
  cancellation,
  agentBudget
}
```

### معیار پذیرش

- دو Run هم‌زمان قابل اجرا باشند.
- messages دو Run قاطی نشود.
- cancellation یک Run روی Run دیگر اثر نگذارد.
- budget و delegation count مستقل باشند.
- eventها شامل `runId` و `projectId` باشند.

---

## ۳.۶ استخراج محدود Prompt Builder

### هدف

Prompt پیش از Multi-Project modular و project-aware شود، اما refactor کامل runtime به بعد موکول شود.

### ساختار پیشنهادی

```text
structured-ai/agent/prompt/
├── PromptBuilder.js
├── MainPromptBuilder.js
├── SubAgentPromptBuilder.js
├── RuntimeContextBuilder.js
├── ProjectContextBuilder.js
└── RequestBuilder.js
```

### Main Prompt

شامل:

```text
system prompt
execution rules
runtime context
active project context
available skills
available personas
available agents
user task
```

### Sub-Agent Prompt

شامل:

```text
persona
filtered execution rules
agent runtime rules
skills
output contract
delegation policy
project context
parent task
```

### Runtime Context پروژه‌ای

```json
{
  "type": "project_context",
  "project": {
    "id": "prj-a",
    "name": "Engine Core",
    "indexState": "fresh",
    "semanticState": "ready"
  },
  "rules": [
    "Use only the active project unless a cross-project task is explicit.",
    "Never access another project by guessing its filesystem path.",
    "Attribute every finding to its project."
  ]
}
```

### معیار پذیرش

- خروجی normalized prompt قبل و بعد برابر باشد.
- active project در prompt مشخص باشد.
- مدل نتواند root دلخواه تعیین کند.
- Semantic skill به Worker پروژهٔ فعال متصل باشد.
- Sub-Agent project context والد را حفظ کند.

---

# ۴. مرحلهٔ دوم: Multi-Project MVP

پس از foundation، قابلیت اصلی Multi-Project پیاده می‌شود.

## ۴.۱ حفظ Workerهای single-project

هر Worker فقط یک codebase را مدیریت کند:

```text
Worker A → Project A
Worker B → Project B
```

این تصمیم باعث می‌شود لازم نباشد تمام Semantic Engine را در یک process به multi-tenant تبدیل کنیم.

## ۴.۲ Worker Supervisor و Gateway

اضافه شود:

```text
ProjectRegistry
WorkerSupervisor
WorkerProcess
WorkerHealthMonitor
ProjectRouter
```

وظایف Gateway:

- start/stop/restart Worker
- health check
- routing
- project selection
- authentication
- metrics
- crash recovery

## ۴.۳ Semantic Client Pool

```text
SemanticClientPool
  ├── project-a → Semantic Worker A
  ├── project-b → Semantic Worker B
  └── project-c → Semantic Worker C
```

مسیر MCP پیشنهادی:

```text
/mcp/prj-a
/mcp/prj-b
```

### معیار پذیرش

- Semantic query project A فقط به Worker A برسد.
- index update A روی B اثر نگذارد.
- crash Worker A، B را متوقف نکند.
- cache Semantic برای هر project جدا باشد.

---

## ۴.۴ اجرای task روی یک project

API جدید:

```text
POST /api/projects/:projectId/tasks
```

نمونه:

```bash
node bin/agent.js \
  --project prj-a \
  -w /home/user/projects/app \
  "Run tests"
```

جریان:

```text
task
  → projectId
  → ProjectContext
  → AgentRunContext
  → Prompt
  → project-scoped tools
  → Semantic Worker همان پروژه
```

### معیار پذیرش

- task روی project انتخاب‌شده اجرا شود.
- API قدیمی بدون projectId همچنان default project را استفاده کند.
- تمام tool resultها project context درست داشته باشند.

---

# ۵. مرحلهٔ سوم: Isolation و State کامل

بعد از MVP باید isolation کامل شود.

## ۵.۱ Persistence per-project

```text
{{USER_DATA}}/.structured-ai/projects/<project-id>/
├── memory.json
├── plan.json
├── sessions/
├── archive/
├── journal/
├── eventstore/
├── searches/
├── processes/
└── logs/
```

### معیار پذیرش

- memory A در B دیده نشود.
- plan A در B دیده نشود.
- session و archive مستقل باشند.
- state قدیمی بدون از دست رفتن داده migrate شود.

## ۵.۲ project-scoped events

هر event:

```json
{
  "type": "tool:end",
  "projectId": "prj-a",
  "runId": "run-123",
  "turnId": "turn-1",
  "agent": "main_agent",
  "tool": "code_search"
}
```

### معیار پذیرش

- event A در stream B دیده نشود.
- run و turn در UI صحیح group شوند.
- replay eventها project context را حفظ کند.

## ۵.۳ authorization

```json
{
  "tokenId": "key-1",
  "allowedProjects": ["prj-a", "prj-c"],
  "permissions": [
    "project:read",
    "project:write",
    "semantic:query"
  ]
}
```

### معیار پذیرش

- token بدون دسترسی `403` بگیرد.
- projectId نتواند root دلخواه را انتخاب کند.
- approvalها project-scoped باشند.

---

# ۶. مرحلهٔ چهارم: UI چندپروژه‌ای

## ۶.۱ Project Switcher

در header:

```text
[ Engine Core ▼ ] [New Project] [Gateway Health]
```

## ۶.۲ Projects Dashboard

نمایش:

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

## ۶.۳ Task Composer

scopeهای قابل انتخاب:

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

## ۶.۴ Project Dashboard

مسیر:

```text
/projects/:projectId
```

تب‌ها:

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

- ساخت، انتخاب و حذف project از UI انجام شود.
- health و runهای هر project جدا نمایش داده شوند.
- کلیک روی project dashboard همان پروژه را باز کند.
- refresh صفحه project context را حفظ کند.
- cross-project نتیجه‌ها با project label نمایش داده شوند.

---

# ۷. مرحلهٔ پنجم: Cross-Project Delegation

### هدف

پشتیبانی امن از taskهای مقایسه‌ای و وابسته به چند codebase.

### نمونه

```text
Main Agent
 ├── Sub-Agent A → project-a
 └── Sub-Agent B → project-b
```

نمونهٔ delegation:

```json
{
  "id": "analyze-a",
  "agent": "code_analysis",
  "projectId": "prj-a",
  "task": "Analyze API usage.",
  "depends_on": []
}
```

### معیار پذیرش

- دو Sub-Agent روی دو project هم‌زمان اجرا شوند.
- toolهای آن‌ها قاطی نشود.
- failure یک project مانع گزارش project دیگر نشود.
- synthesis فقط از resultهای labelدار استفاده کند.
- cross-project write به approval جدا نیاز داشته باشد.

---

# ۸. مرحلهٔ ششم: Refactorهای بزرگ باقی‌مانده

پس از تثبیت Multi-Project، refactorهای بزرگ‌تر انجام شوند:

```text
1. Action Parser و Validator
2. Runtime Loop
3. Context / Memory / Archive
4. Persistence
5. Tools
6. MCP
7. Policy و Approval
8. Web Backend
9. Frontend
10. Visualizer
11. CLI و REPL
12. Event و Observability
```

## فایل‌های اصلی کاندید refactor

```text
agent/agent.js
web/server.js
web/public/app.js
agent/lib/storage.js
agent/lib/archive.js
agent/tools/filesystem.js
agent/tools/code.js
agent/mcp/manager.js
agent/mcp/config.js
agent/tools/plan.js
agent/lib/hooks.js
agent/lib/context.js
bin/interactive.js
bin/agent.js
```

### معیار پذیرش

- هیچ behavior جدیدی به‌صورت ناخواسته وارد نشود.
- wrapperهای legacy تا پایان migration باقی بمانند.
- event، API، schema و tool contract حفظ شوند.
- هر module مسئولیت مشخص داشته باشد.
- هر boundary تست مستقل داشته باشد.

---

# ۹. ترتیب واقعی اجرای کار

```text
Phase 0:
  baseline tests و contractها

Phase 1:
  ProjectContext
  ProjectRegistry
  AgentRunContext
  context-aware Tool Runtime
  Prompt Builder extraction
  Semantic Client Pool

Phase 2:
  Worker Supervisor
  Gateway
  project-scoped routing
  single-project task execution

Phase 3:
  per-project persistence
  per-project events
  health و metrics
  authorization
  crash recovery

Phase 4:
  Gateway UI
  Project Switcher
  Project Dashboard
  configuration UI

Phase 5:
  cross-project delegation

Phase 6:
  refactorهای باقی‌ماندهٔ runtime، MCP، web و frontend
```

---

# ۱۰. Feature Flag و rollback

در زمان migration، حالت legacy و modular باید قابل انتخاب باشند:

```text
PROJECT_CONTEXT_MODE=legacy|modular
PROMPT_BUILDER_MODE=legacy|modular
RUN_CONTEXT_MODE=legacy|modular
SEMANTIC_POOL_MODE=legacy|pool
```

رفتار پیش‌فرض ابتدا legacy باقی بماند. پس از برابر شدن خروجی‌ها و سبز شدن تست‌ها، modular به default تبدیل شود.

هر phase باید امکان rollback مستقل داشته باشد.

---

# ۱۱. معیار پذیرش نهایی

پروژه زمانی پذیرفته می‌شود که:

- چند project هم‌زمان قابل ثبت و اجرا باشند.
- هر Run به project صحیح متصل باشد.
- File، Process، Git و Semantic tools project-scoped باشند.
- memory، plan، session، archive و events مستقل باشند.
- Workerهای Semantic Engine مستقل route شوند.
- یک Worker خراب، Workerهای دیگر را متوقف نکند.
- UI projectها، health، metrics و runها را جدا نمایش دهد.
- cross-project فقط با انتخاب explicit یا delegation انجام شود.
- Prompt active project و محدودیت‌های آن را معرفی کند.
- API و CLI single-project فعلی بدون تغییر ظاهری کار کنند.
- full suite فعلی به‌علاوهٔ تست‌های isolation و concurrency سبز باشد.

---

# ۱۲. تصمیم نهایی

ترتیب صحیح این است:

```text
اول: Refactor Foundation ضروری
بعد: Multi-Project MVP
بعد: UI و hardening
در آخر: Full Modular Refactor
```

Prompt Builder باید قبل از Multi-Project به‌صورت محدود و project-aware استخراج شود، اما refactor کامل کل Structured AI نباید اجرای Multi-Project را به تعویق بیندازد.

این مسیر:

- ریسک نشت context بین پروژه‌ها را کنترل می‌کند.
- از تغییر هم‌زمان تمام بخش‌های سیستم جلوگیری می‌کند.
- امکان تحویل vertical slice قابل استفاده را فراهم می‌کند.
- رفتار single-project فعلی را حفظ می‌کند.
- مسیر توسعهٔ تدریجی به معماری modular را باز می‌گذارد.
