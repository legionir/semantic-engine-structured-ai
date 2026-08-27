# برنامهٔ پیاده‌سازی Gateway چندپروژه‌ای و ذخیره‌سازی متمرکز Semantic Engine

**وضعیت:** برنامهٔ اجرایی، هنوز پیاده‌سازی نشده است  
**تاریخ:** 2026-08-24  
**مخزن:** `legionir/semantic-engine-structured-ai`

---

> **Structured AI execution status:** the runtime-side phases and final
> acceptance are tracked in [`structured-ai/EXECUTION_PLAN.md`](structured-ai/EXECUTION_PLAN.md).
>
> **Engine-side execution plan:** فازبندی اجرایی، تصمیم‌های معماری قطعی و رفع
> شکاف‌های شناسایی‌شده نسبت به کد فعلی در
> [`MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md`](MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md)
> آمده است. این سند منبع نیازمندی‌ها می‌ماند؛ ترتیب و قرارداد فنی با سند اجرایی است.

## ۱. هدف

دو تغییر زیر باید هم‌زمان و هماهنگ پیاده‌سازی شوند:

1. نگهداری artifactهای تولیدی Semantic Engine خارج از root پروژه، در data directory کاربر.
2. ساخت یک Gateway مرکزی که روی یک پورت عمومی اجرا شود و چند Worker مستقل را مدیریت و route کند.

هدف نهایی:

```text
Browser / AI Client
        │
        ▼
Semantic Gateway :4000
        │
        ├── Worker Project A
        ├── Worker Project B
        ├── Worker Project C
        └── Worker Project D
```

هر Worker همچنان single-project باقی می‌ماند و فقط یک codebase را مدیریت می‌کند:

```text
Worker A
 ├── یک workspace root
 ├── یک project-index
 ├── یک blueprint
 ├── یک SQLite
 ├── یک vector index
 ├── یک LSP context
 ├── یک watcher
 └── یک MCP/REST runtime
```

Gateway مسئول multi-project orchestration است، نه تحلیل کد.

---

## ۲. تصمیم‌های معماری قطعی

### ۲.۱ پورت عمومی

فقط Gateway روی پورت عمومی bind می‌شود:

```text
Gateway: 4000
```

Workerها مستقیماً روی همین پورت bind نمی‌شوند. برای ارتباط Gateway و Worker یکی از این دو روش استفاده می‌شود:

- Linux/macOS: Unix domain socket
- Windows: named pipe یا پورت داخلی تصادفی روی loopback

نمونه:

```text
Gateway :4000
Worker A /run/semantic-engine/prj-a.sock
Worker B /run/semantic-engine/prj-b.sock
```

اگر Unix socket در یک محیط در دسترس نباشد:

```text
Gateway :4000
Worker A 127.0.0.1:41001
Worker B 127.0.0.1:41002
```

استفاده از `SO_REUSEPORT` برای چند Worker روی یک TCP port ممنوع است، چون routing پروژه deterministic نخواهد بود.

### ۲.۲ source و artifact از هم جدا هستند

کد منبع داخل root واقعی پروژه باقی می‌ماند:

```text
/home/user/projects/app/
```

اما artifactهای Semantic Engine در data directory کاربر ذخیره می‌شوند:

```text
{{USER_DATA}}/.semantic-engine/projects/<project-id>/
```

### ۲.۳ مسیر خام پروژه نام directory نیست

از این الگو استفاده نمی‌کنیم:

```text
{{USER_DATA}}/.semantic-engine/{{PROJECT_PATH.normalize()}}
```

مسیر normalize‌شده فقط در manifest ذخیره می‌شود. directory بر اساس `projectId` ساخته می‌شود تا مشکلات زیر ایجاد نشود:

- طول زیاد path
- `:` و `\\` در Windows
- کاراکترهای غیرمجاز
- symlink و case sensitivity
- path traversal
- تغییر نام directory بعد از جابه‌جایی پروژه
- افشای مستقیم path در نام پوشه

### ۲.۴ شناسهٔ پروژه

در Gateway شناسهٔ پروژه باید پایدار باشد و به root path وابسته نباشد:

```text
prj-<uuid>
```

برای CLI مستقل که registry ندارد، می‌توان از fingerprint مسیر canonical استفاده کرد:

```ts
canonicalRoot = realpath(rootPath);
fingerprint = sha256(canonicalRoot);
```

اما در Gateway، `projectId` در registry تولید و persist می‌شود تا با جابه‌جایی پروژه تغییر نکند.

---

## ۳. ساختار نهایی data directory

مسیر پیش‌فرض باید platform-aware باشد:

```text
Linux:
  $XDG_DATA_HOME/semantic-engine
  یا ~/.local/share/semantic-engine

macOS:
  ~/Library/Application Support/SemanticEngine

Windows:
  %LOCALAPPDATA%/SemanticEngine
```

قابل تنظیم با:

```bash
SEMANTIC_ENGINE_DATA_DIR=/custom/data/path
```

ساختار پیشنهادی:

```text
{{USER_DATA}}/.semantic-engine/
├── registry.json
├── projects/
│   ├── prj-a/
│   │   ├── manifest.json
│   │   ├── project-index.json
│   │   ├── blueprint.json
│   │   ├── project-index.sqlite
│   │   ├── project-artifacts.manifest.json
│   │   ├── locks/
│   │   │   ├── worker.lock
│   │   │   └── index.lock
│   │   ├── logs/
│   │   ├── events/
│   │   └── snapshots/
│   └── prj-b/
│       └── ...
└── gateway/
    ├── workers.json
    ├── sockets/
    └── logs/
```

---

# ۴. گام‌های پیاده‌سازی

## گام ۰ — ثبت قرارداد و جلوگیری از تغییر هم‌زمان معماری

### هدف

قبل از تغییر کد، قرارداد data path، worker lifecycle، API routing و project identity تثبیت شود.

### علت

اگر ابتدا Gateway ساخته شود و بعد مسیر artifact یا project identity تغییر کند، بخش‌های CLI، MCP، UI و migration چند بار نیازمند بازنویسی می‌شوند.

### نحوهٔ پیاده‌سازی

یک قرارداد داخلی با این مفاهیم تعریف شود:

```ts
interface ProjectPaths {
  workspaceRoot: string;
  dataRoot: string;
  artifactRoot: string;
  indexPath: string;
  blueprintPath: string;
  sqlitePath: string;
  manifestPath: string;
  lockPath: string;
}
```

و:

```ts
interface ProjectWorkerConfig {
  projectId: string;
  name: string;
  rootPath: string;
  dataDir?: string;
  autoStart: boolean;
  watch: boolean;

  indexing: {
    vectors: boolean;
    sqlite: boolean;
    blueprint: boolean;
    git: boolean;
    treeSitter: boolean;
  };

  watchOptions: {
    debounceMs: number;
    blueprintMode: 'always' | 'threshold';
  };
}
```

### فایل‌های اصلی

```text
semantic-engine/src/core/config/ProjectPaths.ts
semantic-engine/src/core/config/ProjectRegistry.ts
semantic-engine/src/gateway/types.ts
semantic-engine/docs/architecture/...
```

### معیار پذیرش

- قرارداد `workspaceRoot` و `artifactRoot` جدا باشد.
- هیچ کد جدیدی path artifact را با `path.join(root, '.semantic-engine')` حدس نزند.
- مشخص باشد کدام path source است و کدام path generated data.

---

## گام ۱ — ساخت Data Directory Resolver

### هدف

تولید مسیر data directory به‌صورت یکسان در CLI، Worker، Gateway، MCP و UI.

### علت

در حال حاضر بخش‌هایی از سیستم فرض می‌کنند artifact داخل root پروژه است. این فرض باید فقط در migration/legacy reader باقی بماند.

### نحوهٔ پیاده‌سازی

در `ProjectPaths.ts` این API اضافه شود:

```ts
resolveDataRoot(options?: {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
}): string;

resolveProjectPaths(options: {
  projectId: string;
  workspaceRoot: string;
  dataRoot?: string;
  outOverride?: string;
}): ProjectPaths;
```

رفتار:

```text
workspaceRoot = /repo/app
projectId     = prj-a
artifactRoot  = ~/.local/share/semantic-engine/projects/prj-a
```

اگر `--out` صریح داده شده باشد، برای backward compatibility override محسوب شود؛ اما default جدید external data directory باشد.

### تغییرات لازم

- `IndexPipeline` فقط workspace را برای خواندن source استفاده کند.
- `OutputWriter` مسیر artifact را از `ProjectPaths` بگیرد.
- `WatchPipeline` مسیر output/lock را از `ProjectPaths` بگیرد.
- `QueryIndexTool` فقط SQLite همان `artifactRoot` را باز کند.
- `ProjectService` مسیر source و artifact را جدا نگه دارد.

### معیار پذیرش

```bash
semantic-engine index --root /tmp/app
```

باید این فایل‌ها را خارج از `/tmp/app` بسازد:

```text
$USER_DATA/.semantic-engine/projects/<id>/project-index.json
$USER_DATA/.semantic-engine/projects/<id>/blueprint.json
$USER_DATA/.semantic-engine/projects/<id>/project-artifacts.manifest.json
```

و root پروژه نباید به‌خاطر artifactها dirty شود.

---

## گام ۲ — ایجاد Project Registry و identity پایدار

### هدف

Gateway بتواند چند پروژه را ثبت، پیدا، rename، relocate و حذف کند.

### علت

`basename(rootPath)` برای identity امن نیست؛ دو پروژه با نام `app` نباید با هم collision داشته باشند.

### نحوهٔ پیاده‌سازی

فایل registry:

```text
{{USER_DATA}}/.semantic-engine/registry.json
```

نمونه:

```json
{
  "version": 1,
  "projects": [
    {
      "id": "prj-a",
      "name": "Engine Core",
      "rootPath": "/home/user/projects/engine-core",
      "enabled": true,
      "autoStart": true,
      "createdAt": "2026-08-24T10:00:00.000Z",
      "lastSeenAt": "2026-08-24T12:00:00.000Z"
    }
  ]
}
```

در زمان register:

1. `realpath` و canonicalization انجام شود.
2. وجود root و directory بودن آن بررسی شود.
3. symlink policy اعمال شود.
4. duplicate root تشخیص داده شود.
5. projectId پایدار تولید شود.
6. manifest پروژه ساخته شود.

### معیار پذیرش

- دو پروژه با basename یکسان هم‌زمان ثبت شوند.
- ID آن‌ها متفاوت باشد.
- register کردن root تکراری، project جدید نسازد.
- تغییر name، projectId را تغییر ندهد.
- تغییر root با عملیات relocate/adopt کنترل‌شده انجام شود.

---

## گام ۳ — migration از artifactهای قدیمی

### هدف

پروژه‌های فعلی که artifact آن‌ها در root قرار دارد، بدون از دست دادن داده migrate شوند.

### مسیرهای legacy

```text
<root>/.semantic-engine/
<root>/.agent/semantic/
<root>/semantic/
```

### نحوهٔ پیاده‌سازی

اولویت خواندن:

1. data directory جدید
2. `<root>/.semantic-engine`
3. `<root>/.agent/semantic`
4. `<root>/semantic`

اگر مسیر جدید وجود نداشت:

1. artifact معتبر legacy پیدا شود.
2. در data directory جدید copy یا migrate شود.
3. manifest ساخته شود.
4. legacy حذف نشود.
5. migration در manifest ثبت شود.

نمونه:

```json
{
  "migratedFrom": "/repo/app/.agent/semantic",
  "migratedAt": "2026-08-24T12:00:00.000Z",
  "migrationMode": "copy-readonly-legacy"
}
```

### معیار پذیرش

- index قدیمی بدون error خوانده شود.
- artifact جدید ساخته شود.
- فایل legacy حذف نشود.
- پس از migration، write جدید فقط در data directory انجام شود.
- اگر artifact legacy خراب باشد، پروژه به `stale` یا `missing` برود و Gateway crash نکند.

---

## گام ۴ — تعریف Worker Project Config و schema

### هدف

تمام گزینه‌های CLI قابل تنظیم و validate شدن از طریق API و UI باشند.

### علت

Gateway نباید command خام از کاربر بگیرد. باید config type-safe را به argv امن تبدیل کند.

### گزینه‌های قابل تنظیم

#### پروژه

| گزینه | UI control | توضیح |
|---|---|---|
| `--root` | Text input + Browse | مسیر source پروژه |
| `--project-id` | Text input یا auto-generated | شناسهٔ پایدار |
| project name | Text input | نام نمایشی |
| `--data-dir` | Advanced text input | مسیر data override |
| `--out` | Advanced text input | override سازگاری قدیمی |
| auto start | Checkbox | اجرای Worker هنگام startup Gateway |
| watch enabled | Checkbox | فعال بودن watcher |

#### Indexing

| گزینه | UI control |
|---|---|
| `--vectors` | Checkbox: Enable vectors |
| `--sqlite` | Checkbox: Enable SQLite |
| `--no-blueprint` | Checkbox معکوس: Enable blueprint |
| `--no-git` | Checkbox معکوس: Collect Git metadata |
| `--no-tree-sitter` | Checkbox معکوس: Use Tree-sitter |
| `--pretty` | Checkbox |

#### Watch

| گزینه | UI control |
|---|---|
| `--debounce <ms>` | Number input |
| `--blueprint-mode always` | Select |
| `--blueprint-mode threshold` | Select |
| `--no-watch` | Checkbox: Disable watcher |
| `--skip-initial-index` | فقط internal/advanced؛ برای Worker موجود |

#### Service و transport

| گزینه | UI control | سیاست |
|---|---|---|
| `--host` | Read-only/Advanced input | Worker فقط loopback یا socket |
| `--token` | Secret input | token داخلی؛ token عمومی Gateway جداست |
| `--allow-remote` | Checkbox admin-only | برای Worker معمولاً ممنوع |
| `--port` | Read-only allocated port | Gateway تخصیص می‌دهد |
| `--ui-port` | Read-only allocated port | Gateway تخصیص می‌دهد |
| `--mcp-port` | Read-only allocated port | Gateway تخصیص می‌دهد |
| `--http` | Select | برای Worker HTTP داخلی |
| `--stdio` | Internal-only | برای اجرای مستقیم MCP |
| `--web` / `--ui` | Checkbox | فعال‌سازی dashboard پروژه |

گزینه‌های `--json`، `--help` و `--version` تنظیمات Worker نیستند و نباید در فرم پروژه نمایش داده شوند.

### validationهای فرم

- root باید وجود داشته باشد.
- root باید directory باشد.
- root canonical شود.
- project تکراری تشخیص داده شود.
- data directory داخل source root نباشد، مگر با override explicit.
- debounce بین حداقل و حداکثر امن باشد.
- portهای داخلی توسط Gateway رزرو شوند.
- token در manifest plain text ذخیره نشود.

### معیار پذیرش

- تمام optionهای عملیاتی بالا از UI قابل تنظیم باشند.
- فرم command preview معتبر تولید کند.
- Gateway هرگز shell command string خام از کاربر اجرا نکند.
- مقدارهای نامعتبر قبل از start شدن Worker با پیام واضح رد شوند.

---

## گام ۵ — ساخت Worker process مستقل

### هدف

هر پروژه با یک process مستقل اجرا شود و کد single-project فعلی در آن باقی بماند.

### command پیشنهادی

```bash
semantic-engine worker \
  --project-id prj-a \
  --root /home/user/projects/app \
  --data-dir ~/.local/share/semantic-engine/projects/prj-a \
  --socket /run/semantic-engine/prj-a.sock
```

در نسخهٔ انتقالی می‌توان Worker را با `start` فعلی اجرا کرد، اما command اختصاصی کنترل بهتری روی lifecycle و endpoint داخلی می‌دهد.

### اجزای Worker

```text
Worker process
 ├── ProjectPaths
 ├── ProjectIndexReader
 ├── AiToolRegistry
 ├── WatchPipeline
 ├── IncrementalEngine
 ├── VectorIndexer
 ├── LSP manager
 ├── REST server
 ├── MCP server
 └── health/metrics server
```

### معیار پذیرش

- Worker فقط یک `workspaceRoot` داشته باشد.
- Worker نتواند root پروژهٔ دیگر را از request دریافت کند.
- یک Worker بتواند بدون Gateway نیز در حالت standalone اجرا شود.
- stop کردن Worker فقط همان process و همان watcher را متوقف کند.

---

## گام ۶ — endpointهای داخلی Worker

### هدف

Gateway بتواند lifecycle، health و metrics Worker را کنترل کند.

### endpointها

```text
GET  /internal/health
GET  /internal/ready
GET  /internal/metrics
GET  /internal/status
POST /internal/reindex
POST /internal/reload
POST /internal/shutdown
```

نمونهٔ پاسخ:

```json
{
  "ok": true,
  "projectId": "prj-a",
  "pid": 9201,
  "state": "ready",
  "indexState": "fresh",
  "watcher": "running",
  "files": 269,
  "symbols": 4457,
  "dependencies": 510,
  "vectorChunks": 1504,
  "sqlite": true,
  "blueprint": true,
  "memoryMb": 312,
  "queueSize": 0,
  "lastIndexedAt": "2026-08-24T12:30:00.000Z"
}
```

### معیار پذیرش

- health بدون token عمومی source data ندهد.
- readiness قبل از load شدن index `503` بدهد.
- metrics شامل وضعیت watcher، index، SQLite و vectors باشد.
- `POST /internal/shutdown` graceful باشد.

---

## گام ۷ — Worker Supervisor و lifecycle

### هدف

Gateway بتواند Workerها را start/stop/restart و monitor کند.

### نحوهٔ پیاده‌سازی

کلاس‌های جدید:

```text
semantic-engine/src/gateway/WorkerSupervisor.ts
semantic-engine/src/gateway/WorkerRegistry.ts
semantic-engine/src/gateway/WorkerProcess.ts
semantic-engine/src/gateway/WorkerHealthMonitor.ts
```

مسئولیت‌ها:

- lazy start یا auto start
- تخصیص socket/port
- ثبت PID
- انتظار برای `/internal/ready`
- health check دوره‌ای
- crash detection
- restart با exponential backoff
- جلوگیری از crash loop
- graceful shutdown
- حفظ لاگ هر Worker در directory مستقل

سیاست restart پیشنهادی:

```text
restart 1 → 1s
restart 2 → 3s
restart 3 → 10s
بیش از 5 crash → degraded و نیازمند اقدام کاربر
```

### lock و concurrency

- برای هر پروژه یک lock مستقل.
- برای هر پروژه فقط یک index job فعال.
- پروژه‌های مختلف بتوانند همزمان index شوند.
- global worker pool برای کنترل CPU/RAM.

### معیار پذیرش

- crash Worker A روی Worker B اثر نگذارد.
- start هم‌زمان یک پروژه دو Worker نسازد.
- restart فقط endpoint همان پروژه را تغییر دهد.
- stop Gateway تمام Workerها را تمیز ببندد.
- Worker بدون پاسخ باعث block شدن کل Gateway نشود.

---

## گام ۸ — Gateway HTTP و project-scoped routing

### هدف

یک پورت عمومی برای تمام پروژه‌ها و تمام endpointها.

### APIهای مدیریتی Gateway

```text
GET    /api/v1/gateway/projects
POST   /api/v1/gateway/projects
GET    /api/v1/gateway/projects/:projectId
PATCH  /api/v1/gateway/projects/:projectId
DELETE /api/v1/gateway/projects/:projectId

POST   /api/v1/gateway/projects/:projectId/start
POST   /api/v1/gateway/projects/:projectId/stop
POST   /api/v1/gateway/projects/:projectId/restart
POST   /api/v1/gateway/projects/:projectId/reindex

GET    /api/v1/gateway/health
GET    /api/v1/gateway/ready
GET    /api/v1/gateway/metrics
GET    /api/v1/gateway/events
```

### APIهای proxy شدهٔ پروژه

```text
/api/v1/projects/:projectId/...
```

مثال:

```text
GET  /api/v1/projects/prj-a/status
GET  /api/v1/projects/prj-a/visualization/architecture
POST /api/v1/projects/prj-a/chat
```

Gateway بخش `:projectId` را resolve می‌کند و request را فقط به Worker همان پروژه می‌فرستد.

### MCP

```text
POST /mcp/:projectId
```

مثال:

```text
POST /mcp/prj-a → Worker A /mcp
POST /mcp/prj-b → Worker B /mcp
```

MCP connection از زمان ایجاد به یک project bind می‌شود و در طول session قابل تغییر نیست.

### معیار پذیرش

- request بدون projectId برای endpointهای project-scoped پذیرفته نشود.
- projectId نامعتبر `404` بدهد.
- request پروژهٔ A هرگز به Worker B ارسال نشود.
- پاسخ API شامل `projectId` و `indexGeneration` باشد.

---

## گام ۹ — proxy کردن protocolها

### REST

Proxy معمولی با حفظ method، headers، body، status و streaming response.

### SSE

برای event stream نباید buffering انجام شود:

```text
GET /api/v1/projects/:projectId/events
```

اتصال تا پایان stream باز بماند.

### WebSocket

مسیر قبل از upgrade شدن resolve شود:

```text
/ws/projects/:projectId
```

بعد از upgrade شدن، project context ثابت بماند.

### MCP Streamable HTTP

- body و response stream شوند.
- timeout معمولی روی stream اعمال نشود.
- disconnect client به Worker منتقل شود.
- اگر transport stateful باشد، connection به همان Worker sticky بماند.

### معیار پذیرش

- REST، SSE، WebSocket و MCP هم‌زمان روی Gateway کار کنند.
- قطع client باعث orphan connection نشود.
- stream پروژهٔ A در پروژهٔ B دیده نشود.
- active requestهای Worker هنگام health/metrics شمارش شوند.

---

## گام ۱۰ — امنیت و project authorization

### هدف

Gateway تنها public boundary باشد و Workerها private بمانند.

### نحوهٔ پیاده‌سازی

زنجیرهٔ هر request:

```text
authenticate
  → resolve projectId
  → authorize project access
  → get WorkerRuntime
  → proxy request
```

نمونهٔ token scope:

```json
{
  "tokenId": "key-1",
  "allowedProjects": ["prj-a", "prj-c"],
  "permissions": [
    "project:read",
    "semantic:query",
    "semantic:index"
  ]
}
```

قواعد:

- Worker روی loopback یا socket داخلی bind شود.
- `rootPath` از requestهای عادی پذیرفته نشود.
- فقط projectId ثبت‌شده معتبر باشد.
- path traversal و symlink escape کنترل شود.
- data directory با permission محدود ساخته شود.
- token و API key در log یا manifest ذخیره نشود.

### معیار پذیرش

- token بدون دسترسی، `403` بگیرد.
- کاربر نتواند با projectId پروژهٔ دیگر query کند.
- Worker از بیرون Gateway قابل دسترسی نباشد.
- هیچ requestی نتواند root دلخواه را به Worker تزریق کند.

---

## گام ۱۱ — Gateway UI: صفحهٔ مرکزی Workerها

### هدف

Gateway یک dashboard کامل برای تمام Workerها داشته باشد.

### فایل‌های پیشنهادی

```text
semantic-engine/public/gateway.html
semantic-engine/public/gateway.js
semantic-engine/public/gateway.css
```

یا در صورت حفظ UI فعلی:

```text
semantic-engine/public/index.html     ← Gateway shell
semantic-engine/public/visualizer.html ← Project dashboard
```

### اجزای صفحهٔ اصلی

#### کارت‌های کلی

- کل پروژه‌ها
- Workerهای `ready`
- Workerهای `indexing`
- Workerهای `degraded`
- Workerهای `crashed`
- مجموع فایل‌ها
- مجموع symbols
- مجموع dependencies
- مجموع vector chunks
- RAM کل
- CPU کل
- jobهای فعال
- queueهای pending

#### جدول Workerها

ستون‌ها:

```text
Project name
Project ID
Root path
Worker PID
State
Index state
Watcher state
Last indexed at
Files
Symbols
Dependencies
Vector chunks
SQLite
Blueprint
RAM
CPU
Queue size
Restart count
```

#### عملیات

```text
Open dashboard
Start
Stop
Restart
Reindex
Edit configuration
View logs
View events
Open MCP endpoint
Remove project
```

### live update

Gateway UI از این endpoint برای health/event استفاده کند:

```text
GET /api/v1/gateway/events
```

Polling فقط fallback باشد.

### معیار پذیرش

- داشبورد حداقل ۱۰ Worker را بدون تداخل نمایش دهد.
- وضعیت Workerها بدون refresh کامل UI به‌روز شود.
- crash، indexing و stale با رنگ و متن واضح نمایش داده شوند.
- کلیک روی هر Worker به dashboard همان پروژه برود.

---

## گام ۱۲ — فرم Worker Project با تمام CLI optionها

### هدف

کاربر بتواند Worker را بدون terminal بسازد و تمام optionهای واقعی CLI را تنظیم کند.

### طراحی فرم

فرم به بخش‌های زیر تقسیم شود:

```text
Project
Indexing
Watch
Embedding
Worker service
Security
Advanced
```

### کنترل‌های اصلی

- checkbox برای گزینه‌های boolean
- text input برای path/name/token
- number input برای debounce و limitها
- select برای mode و transport
- Browse برای انتخاب root
- command preview
- validation inline
- دکمهٔ `Save & Start`
- دکمهٔ `Save without starting`
- دکمهٔ `Reindex now`

### command preview

نمونه:

```bash
semantic-engine worker \
  --project-id prj-a \
  --root /home/user/projects/app \
  --data-dir /home/user/.local/share/semantic-engine/projects/prj-a \
  --vectors \
  --sqlite \
  --blueprint-mode always \
  --debounce 500
```

این preview فقط برای شفافیت است. Gateway باید argv را خودش از config معتبر تولید کند و shell string اجرا نکند.

### گزینه‌های embedding

اگر Worker از vector استفاده می‌کند، فرم باید این موارد را هم پوشش دهد:

```text
Embedding enabled
Provider: local / ollama / openai-compatible
Model
Base URL
API key reference
Normalize
```

API key فقط به‌صورت secret reference یا environment reference ذخیره شود.

### معیار پذیرش

- تمام checkboxها و text inputهای تعریف‌شده در گام ۴ در UI وجود داشته باشند.
- تنظیمات بعد از reload Gateway حفظ شوند.
- edit کردن config فقط Worker همان پروژه را restart کند.
- disable کردن vectors باعث حذف یا rebuild ناخواسته source نشود.
- user بتواند configuration مؤثر فعلی را ببیند.

---

## گام ۱۳ — Project Dashboard و deep link

### هدف

با کلیک روی Worker، dashboard کامل همان project باز شود.

### مسیر پیشنهادی

```text
/projects/:projectId
```

یا:

```text
/visualizer?project=:projectId
```

### تب‌های dashboard

```text
Overview
Architecture
Dependencies
Symbols
Impact Analysis
Tests
Diagnostics
Configuration Usage
Git Hotspots
Semantic Search
Project Chat
MCP
Events
Logs
Settings
```

تمام requestها باید project-scoped باشند:

```text
/api/v1/projects/:projectId/visualization/...
/api/v1/projects/:projectId/search
/api/v1/projects/:projectId/chat
```

### معیار پذیرش

- کلیک روی Worker A فقط data پروژهٔ A را load کند.
- باز کردن مستقیم URL پروژهٔ B نیز همان context را بسازد.
- refresh صفحه project context را از دست ندهد.
- Visualizer فعلی بتواند با projectId کار کند.

---

## گام ۱۴ — Metrics، Health و Observability

### Gateway metrics

```text
gateway_projects_total
gateway_workers_ready
gateway_workers_unhealthy
gateway_requests_total
gateway_request_duration_ms
gateway_active_requests
gateway_worker_restarts_total
gateway_proxy_errors_total
gateway_index_jobs_active
```

### Worker metrics

```text
worker_uptime_seconds
worker_memory_bytes
worker_cpu_percent
worker_active_requests
worker_queue_size
worker_index_duration_ms
worker_index_failures_total
worker_files_total
worker_symbols_total
worker_dependencies_total
worker_vector_chunks_total
worker_restart_count
```

### UI health detail

برای هر Worker نمایش داده شود:

```text
Process health
Index health
Watcher health
SQLite health
Blueprint health
Vector health
LSP health
Last successful operation
Last error
Restart history
```

### معیار پذیرش

- `/health` وضعیت کلی Gateway را بدهد.
- `/ready` فقط وقتی Gateway و dependencyهای ضروری آماده‌اند `200` بدهد.
- metrics تجمیعی و per-worker وجود داشته باشد.
- خطای یک Worker در metrics و UI ثبت شود، اما health سایر Workerها خراب نشود.

---

## گام ۱۵ — تست‌های isolation و end-to-end

### سناریوی اصلی

دو پروژه با نام یکسان:

```text
/tmp/client-a/app
/tmp/client-b/app
```

هرکدام symbols و source متفاوت دارند.

### تست‌ها

#### Data isolation

- artifactهای A در directory A باشند.
- artifactهای B در directory B باشند.
- SQLite A symbolهای B را نداشته باشد.
- vector search A نتیجهٔ B را برنگرداند.

#### Worker isolation

- تغییر فایل A فقط index A را تغییر دهد.
- crash A، B را متوقف نکند.
- restart A روی PID یا endpoint B اثر نگذارد.

#### Routing isolation

```text
/api/v1/projects/a/... → Worker A
/api/v1/projects/b/... → Worker B
/mcp/a                 → Worker A
/mcp/b                 → Worker B
```

#### Protocol

- REST
- MCP `tools/list`
- MCP `tools/call`
- SSE
- WebSocket
- cancellation
- timeout
- disconnect

#### UI

- ساخت Worker
- edit config
- command preview
- health refresh
- metrics refresh
- click-through به dashboard
- start/stop/restart
- نمایش crash و degraded

#### Migration

- خواندن artifact legacy
- انتقال به data directory جدید
- عدم حذف legacy
- ادامهٔ write فقط در مسیر جدید

### معیار پذیرش end-to-end

سناریوی زیر باید بدون خطا انجام شود:

1. Gateway روی `:4000` اجرا شود.
2. پروژه‌های A و B ثبت شوند.
3. هر دو Worker start شوند.
4. dashboard هر دو Worker `ready` نشان دهد.
5. query symbol یکسان روی A و B خروجی متفاوت اما صحیح بدهد.
6. فایل A تغییر کند.
7. فقط Worker A indexing نشان دهد.
8. index، blueprint، SQLite و vectors A به‌روز شوند.
9. Worker B بدون تغییر generation و بدون restart باقی بماند.
10. با کلیک روی A و B، dashboard درست باز شود.

---

## گام ۱۶ — performance، quota و cleanup

### هدف

چند Worker هم‌زمان باعث مصرف نامحدود RAM/CPU نشود.

### تنظیمات پیشنهادی Gateway

```text
maxWorkers
maxConcurrentIndexJobs
maxWorkersPerUser
workerStartupTimeoutMs
workerHealthIntervalMs
workerIdleTimeoutMs
maxProjectArtifactBytes
maxGatewayMemoryMb
```

### قابلیت‌های cleanup

```bash
semantic-engine cache list
semantic-engine cache clean --project prj-a
semantic-engine cache clean --older-than 30d
semantic-engine cache export --project prj-a
semantic-engine cache import --project prj-a
```

### معیار پذیرش

- Gateway با افزایش Workerها event loop را block نکند.
- index job پروژه‌های مختلف قابل parallel شدن باشند.
- یک project پرمصرف سهم پروژه‌های دیگر را نگیرد.
- cleanup هرگز source root را حذف نکند.

---

## گام ۱۷ — مستندسازی و انتشار

باید این موارد به‌روزرسانی شوند:

```text
semantic-engine/README.md
semantic-engine/HANDOFF.md
semantic-engine/INTEGRATION-STRUCTURED-AI.md
structured-ai/README.md
```

مستندات باید شامل این‌ها باشند:

- مسیر data directory در Linux/macOS/Windows
- register کردن پروژه
- اجرای Gateway
- اجرای Worker مستقل
- APIهای project-scoped
- MCP URL هر پروژه
- تمام فرم‌های UI
- migration از artifactهای قدیمی
- `--no-watch`، `--vectors` و `--sqlite`
- محدودیت‌های embedding provider
- health و metrics

نمونهٔ اجرای نهایی:

```bash
semantic-engine gateway \
  --port 4000 \
  --token gateway-secret
```

سپس پروژه‌ها از UI یا API ثبت می‌شوند.

---

# ۵. ترتیب اجرای واقعی کار

ترتیب پیشنهادی برای جلوگیری از دوباره‌کاری:

```text
1.  ProjectPaths و data directory
2.  Project Registry و project identity
3.  migration legacy artifacts
4.  WorkerConfig schema و CLI mapping
5.  Worker command و internal health API
6.  WorkerSupervisor
7.  Gateway routing برای REST
8.  MCP/SSE/WebSocket proxy
9.  authorization و security
10. Gateway dashboard UI
11. Worker configuration form
12. Project dashboard deep links
13. metrics و crash recovery
14. isolation/e2e/load tests
15. documentation و migration guide
```

نباید UI پیش از تثبیت API و config schema ساخته شود؛ در غیر این صورت فرم UI چند بار با تغییرات backend ناسازگار خواهد شد.

---

# ۶. معیار پذیرش کلی پروژه

این دو بروزرسانی زمانی پذیرفته‌شده محسوب می‌شوند که همهٔ موارد زیر برقرار باشند:

- چند پروژه با rootهای مستقل هم‌زمان سرو شوند.
- همهٔ Workerها از یک Gateway و یک پورت عمومی قابل دسترسی باشند.
- هر Worker single-project و process-isolated بماند.
- artifactها در user data directory ذخیره شوند.
- root پروژه به‌خاطر artifactها dirty نشود.
- projectIdها collision نداشته باشند.
- index، symbols، dependencies، blueprint، SQLite و vectors هر پروژه مستقل باشند.
- watcher و LSP پروژه‌ها با هم تداخل نداشته باشند.
- REST، MCP، SSE و WebSocket project-scoped باشند.
- health و metrics همهٔ Workerها در Gateway UI نمایش داده شوند.
- با کلیک روی هر Worker dashboard همان project باز شود.
- تمام CLI optionهای Worker از طریق checkbox، text input، number input یا select قابل تنظیم باشند.
- crash یک Worker روی Workerهای دیگر اثر نگذارد.
- migration از مسیرهای legacy بدون حذف داده انجام شود.
- تست‌های isolation، routing، protocol، UI و load سبز باشند.
