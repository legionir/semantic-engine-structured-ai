# Structured AI — Handoff

**تاریخ:** ۲۰۲۶-۰۸-۲۲  
**Branch:** `arena/01a02456-structured-ai`  
**Pull Request:** https://github.com/legionir/structured-ai/pull/9  
**دامنه:** Structured AI root runtime و `semantic-engine`  
**خارج از دامنه:** پروژه‌های تستی repository

این سند وضعیت فعلی، نحوه‌ی اجرا، مرزهای امنیتی، تست‌ها، تغییرات انجام‌شده و مواردی را که تیم بعدی باید بداند ثبت می‌کند.

---

## 1. خلاصه‌ی پروژه

Structured AI یک runtime چند-agent برای endpointهای سازگار با OpenAI است. مدل در هر iteration یکی از actionهای ساختاریافته‌ی زیر را برمی‌گرداند:

- `tool_call`
- `delegate`
- `final`

Runtime مسئول موارد زیر است:

- اجرای موازی و dependency graph ابزارها
- delegation و sub-agent budget
- policy و approval
- workspace confinement
- context compaction و working memory
- MCP client و transportهای stdio/http/SSE/WebSocket
- eventstore، journal، session و archive
- web console و SSE
- اتصال اختیاری به Semantic Engine برای code intelligence

Semantic Engine یک package مستقل TypeScript برای indexing کد، symbol/dependency/call graph، LSP enrichment، vector search، SQLite export و HTTP/MCP API است.

---

## 2. ساختار اصلی و entry pointها

### Structured AI root

| مسیر | مسئولیت |
|---|---|
| `package.json` | package metadata، scriptها، Node `>=18` و CLI binary |
| `bin/agent.js` | CLI اصلی، headless/interactive/web console |
| `bin/interactive.js` | REPL و approval prompt |
| `bin/backfill-eventstore.js` | migration/backfill رویدادهای قدیمی |
| `agent/agent.js` | orchestration loop، LLM request، action parsing، graph execution و delegation |
| `agent/lib/policy.js` | policy evaluation و approval enforcement |
| `agent/lib/workspace.js` | workspace path resolution، confinement و result capping |
| `agent/lib/storage.js` | runtime settings با precedence override → environment → default |
| `agent/lib/events.js` | event bus و correlation context |
| `agent/lib/eventstore.js` | append-only event persistence |
| `agent/lib/journal.js` | per-agent JSONL journal |
| `agent/lib/sessions.js` | persisted conversations |
| `agent/mcp/manager.js` | MCP registry، discovery و namespaced tools |
| `agent/mcp/transports/` | stdio، HTTP، SSE و WebSocket transportها |
| `agent/tools/index.js` | mapping نام tool به implementation |
| `web/server.js` | web console، REST control API و SSE |
| `web/public/` | frontend console و visualizer |

**اجرای CLI:**

```bash
npm start -- --workspace /path/to/project "task"
# یا
node bin/agent.js --workspace /path/to/project "task"
```

**اجرای interactive:**

```bash
node bin/agent.js --interactive --workspace /path/to/project
```

**اجرای web console:**

```bash
node bin/agent.js --serve --workspace /path/to/project
```

در حالت web، host پیش‌فرض `127.0.0.1` است و token در launch output چاپ می‌شود. برای دسترسی remote باید عمداً `--host` را تغییر داد و token را امن inject کرد.

### Semantic Engine

| مسیر | مسئولیت |
|---|---|
| `semantic-engine/bin/semantic-engine.js` | launcher package |
| `semantic-engine/src/cli/main.ts` | CLI dispatcher |
| `semantic-engine/src/cli/commands/index-command.ts` | full indexing |
| `semantic-engine/src/cli/commands/serve-command.ts` | UI، REST platform و MCP HTTP/stdio |
| `semantic-engine/src/cli/commands/watch-command.ts` | watch/incremental indexing |
| `semantic-engine/src/scanner/` | workspace scan و file processing |
| `semantic-engine/src/symbols/` | heuristic، tree-sitter و LSP symbol extraction |
| `semantic-engine/src/dependencies/` | dependency/import resolution |
| `semantic-engine/src/graphs/` | call/type/dependency graph |
| `semantic-engine/src/pipeline/` | indexing pipeline و output generation |
| `semantic-engine/src/runtime/` | JobManager، queue و worker lifecycle |
| `semantic-engine/src/server/` | HTTP server، routes، SSE، WebSocket و security pipeline |
| `semantic-engine/src/security/` | API keys، RBAC و audit logger |
| `semantic-engine/src/vector/` | hashing/remote embeddings و vector store |
| `semantic-engine/src/export/` | JSON، blueprint و SQLite export |

**CLI commandها:**

```bash
cd semantic-engine
npm ci
npm run build
node bin/semantic-engine.js index --root /path/to/project
node bin/semantic-engine.js ui --root /path/to/project
node bin/semantic-engine.js serve --stdio --root /path/to/project
node bin/semantic-engine.js doctor
```

---

## 3. Configuration و environmentهای مهم

### Root runtime

تنظیمات در `agent/lib/storage.js` تعریف می‌شوند. Environmentهای مهم:

| متغیر | مقدار پیش‌فرض/رفتار | توضیح |
|---|---|---|
| `WORKSPACE_ROOT` | `process.cwd()` | ریشه‌ای که agent مجاز به عمل در آن است؛ در startup ثابت می‌شود |
| `AGENT_BASE_URL` | endpoint localhost | base URL مدل سازگار با OpenAI |
| `AGENT_API_KEY` | خالی | API key مدل؛ در log/console کامل نمایش داده نمی‌شود |
| `AGENT_MODEL` | `auto-switch` | model پیش‌فرض |
| `AGENT_APPROVAL` | `prompt` | `auto` فقط با تصمیم صریح operator/محیط trusted استفاده شود |
| `AGENT_CONSOLE_TOKEN` | خالی؛ token تصادفی تولید می‌شود | token کنترل وب‌کانسول |
| `PROCESS_SANDBOX_MODE` | `deny` | `deny`، `bwrap` یا `test`; مقدار `test` فقط برای test harness |
| `MCP_AUTO_DISCOVER` | `false` | جلوگیری از اجرای خودکار config workspace |
| `MCP_TRUST_PROJECT_CONFIG` | `false` | stdio MCP از config پروژه فقط با trust صریح |
| `MCP_ALLOW_RUNTIME_ADD` | `true` | افزودن runtime MCP مشروط به policy و approval است |
| `ALLOW_PRIVATE_NETWORK` | `false` | کنترل دسترسی `net_fetch` به private/loopback |
| `EVENTSTORE_ENABLED` | `true` | ذخیره‌ی event stream |
| `JOURNAL_ENABLED` | `true` | ذخیره‌ی per-agent journal |
| `MAX_RUN_MS` | `600000` | سقف کل run |
| `MAX_REQUEST_MS` | `120000` | timeout درخواست مدل |
| `MAX_TOTAL_AGENTS` | `15` | سقف sub-agentهای هر run |

### Semantic Engine

- `SEMANTIC_ENGINE_TOKEN`: token لازم برای remote platform/MCP HTTP.
- `SEMANTIC_BENCHMARK_ROOT`: root اختیاری benchmark؛ اگر تنظیم نشود fixture استفاده می‌شود.
- `SEMANTIC_BENCHMARK_MAX_MS`: سقف benchmark؛ CI فعلاً `120000` قرار می‌دهد.
- config عمومی Semantic از `semantic-engine.config.json`، flags، environment و schema در `semantic-engine/src/host/Config.ts` پشتیبانی می‌کند.

---

## 4. مرزهای امنیتی فعلی

### Process execution

`PROCESS_SANDBOX_MODE=deny` پیش‌فرض امن production است و `terminal_exec`/`process_start` را مسدود می‌کند.

برای Linux با bubblewrap:

```bash
export PROCESS_SANDBOX_MODE=bwrap
```

حالت `bwrap`:

- workspace را به‌صورت writable bind می‌کند.
- filesystem پایه را read-only mount می‌کند.
- network namespace را جدا می‌کند.
- environment را پاک و حداقلی بازسازی می‌کند.
- process namespace/IPC/UTS را جدا می‌کند.

**هشدار:** `PROCESS_SANDBOX_MODE=test` فقط برای تست‌های repository است و نباید در production استفاده شود.

### Web console

`web/server.js`:

- API و SSE را token-protected می‌کند.
- token را با مقایسه‌ی timing-safe بررسی می‌کند.
- token launch URL را به HttpOnly/SameSite cookie تبدیل می‌کند.
- Origin را برای API بررسی می‌کند.
- API rate limit دارد.
- body size را محدود و stream بزرگ را destroy می‌کند.
- افزودن/حذف/فعال‌سازی MCP را از policy عبور می‌دهد.

### Workspace و network

- mutationهای filesystem پیش از اجرا path و symlink component را دوباره بررسی می‌کنند.
- source bundleها staged و rollback best-effort دارند.
- `net_fetch` hostname را resolve، private addressها را بررسی و به IP بررسی‌شده pin می‌کند.
- redirectها برای هر hop دوباره validate می‌شوند.
- responseها bounded خوانده می‌شوند.

### MCP

- auto-discovery پیش‌فرض خاموش است.
- project/workspace stdio config تا trust صریح اجرا نمی‌شود.
- toolها با namespace `mcp__<server>__<tool>` جدا می‌شوند.
- runtime management باید از policy/approval عبور کند.

### Semantic HTTP

- authentication با token یا API key انجام می‌شود.
- route permissionها در `RouteDefinition.permission` تعریف می‌شوند.
- `PermissionChecker` پیش از handler اجرا می‌شود.
- `resourceScope` روی project id و `projectId` body بررسی می‌شود.
- auth management نیازمند `auth:manage` است.

---

## 5. Persistence و artifactها

### Root runtime state

State زیر workspace و در `.agent/` ذخیره می‌شود:

- `eventstore/`: JSONL روزانه؛ writer صف‌بندی‌شده و async
- `journal/`: journal هر agent؛ queue و flush دارد
- `sessions/`: conversation/event/call state
- `archive/`: archive و rollup حافظه
- `project.json`: project settings، در صورت فعال بودن

Eventstore و journal خطای persistence را نباید باعث crash run کنند؛ بنابراین در صورت disk failure باید monitoring بیرونی وجود داشته باشد.

### Semantic artifacts

خروجی اصلی indexing:

- `project-index.json`
- `blueprint.json`
- `project-index.sqlite` در صورت فعال‌سازی
- `project-artifacts.manifest.json`

manifest شامل generation و hash artifactهاست. هنگام load، index/blueprint با manifest مقایسه می‌شوند تا artifact ناقص یا نسل‌های ناسازگار پذیرفته نشوند.

### Job state

Semantic `JobManager`:

- حداکثر ۴ job هم‌زمان دارد.
- برای هر project فقط یک job active اجازه می‌دهد.
- state را در `.agent/jobs.json` persist می‌کند.
- request data مربوط به indexing را ذخیره می‌کند.
- job interrupted را بعد از restart با recovery runner دوباره اجرا می‌کند.

این persistence برای یک instance مناسب است؛ برای چند replica هنوز queue و lock توزیع‌شده مثل PostgreSQL/Redis لازم است.

---

## 6. Docker و deployment محلی

### Semantic Engine

```bash
export SEMANTIC_ENGINE_TOKEN='replace-with-a-long-random-token'
export SEMANTIC_WORKSPACE=/absolute/path/to/project
docker compose up --build
```

Compose روی `127.0.0.1:4000` bind می‌شود و workspace را روی `/workspace` mount می‌کند.

### Root runtime

```bash
docker build -t structured-ai:local .
docker run --rm \
  -e AGENT_BASE_URL \
  -e AGENT_API_KEY \
  -e AGENT_MODEL \
  -v "$PWD/workspace:/workspace" \
  structured-ai:local \
  --workspace /workspace "run the tests"
```

Default container environment:

- `AGENT_APPROVAL=deny`
- `PROCESS_SANDBOX_MODE=deny`
- `ALLOW_UNSANDBOXED_PROCESS` استفاده نمی‌شود.

---

## 7. تست و validation

### Root

```bash
npm run check
npm test
```

Validation ثبت‌شده در این handoff:

- Root full test suite: **PASS**
- Web console: **25/25 passed**
- Tools: **55/55 passed**
- Runtime: **105/105 passed**
- Eventstore: **5/5 passed**
- Journal: **2/2 passed**

### Semantic Engine

```bash
cd semantic-engine
npm ci
npm run build
npm run lint
npm run test:gate
npm run snapshot
npm run benchmark
npm audit --omit=dev
```

نتایج ثبت‌شده:

- TypeScript build: **PASS**
- ESLint: **PASS — ۰ warning / ۰ error**
- Test gate: **169/169 suites، 2478/2478 tests passed**
- Snapshot: **PASS**
- Dependency audit: **۰ vulnerability**
- Benchmark فعلی workspace: حدود **14.6 ثانیه** برای 457 فایل و 26912 symbol، زیر سقف 120 ثانیه

تست‌های جدید/مهم:

- `semantic-engine/src/runtime/JobManager.test.ts`
- `semantic-engine/src/services/source/SourceSyncService.test.ts`
- `semantic-engine/src/server/v2.routes.test.ts`
- `semantic-engine/src/server/platform.e2e.test.ts`
- `test/web.test.js`
- `test/eventstore.test.js`
- `test/journal.test.js`

---

## 8. وضعیت findings

فایل مرجع:

`PRODUCTION-READINESS-FINDINGS-PRIORITIZED-2026-08.md`

وضعیت فعلی جدول:

| وضعیت | تعداد |
|---|---:|
| `fixed` | 20 |
| `partial` | 0 |
| `pending` | 0 |

این statusها بر اساس کد و تست‌های همین branch ثبت شده‌اند. با این حال، production sign-off نهایی هنوز به environment evidence وابسته است؛ مخصوصاً multi-replica queue، hardware/corpus واقعی، secret manager و deployment platform واقعی.

گزارش مبنای ممیزی:

`PRODUCTION-READINESS-AUDIT-2026-08.md`

---

## 9. تغییرات مهم branch فعلی

آخرین تغییرات مهم:

- token authentication و origin/rate protection برای root web console
- safe default برای approval و process execution
- MCP project trust و auto-discovery hardening
- RBAC/resource-scope enforcement در Semantic HTTP
- symlink/path revalidation و staged source writes
- real Git clone/fetch/checkout
- async eventstore/journal و chunked historical reads
- artifact generation manifest و hash validation
- durable/resumable Semantic indexing jobs
- local hashing embeddings به‌جای vulnerable transformer dependency
- Dockerfile/Compose/healthcheck/non-root deployment
- performance benchmark و CI budget
- zero-warning Semantic lint

---

## 10. Known limitations و نکات تحویل

1. **Distributed deployment:** `JobManager` و API-key store هنوز process-local هستند. برای چند replica باید state/queue/lock به backend مشترک منتقل شود.
2. **Process sandbox:** mode `bwrap` فقط در Linux و در صورت نصب bubblewrap کار می‌کند؛ نبود sandbox باید با `deny` باقی بماند.
3. **SLO:** benchmark فعلی روی workspace/fixture مشخص اجرا شده است، نه روی همه‌ی corpusهای مشتری. قبل از production مقدار `SEMANTIC_BENCHMARK_ROOT` و سقف واقعی را تعیین کنید.
4. **Audit durability:** eventstore/journal خطای write را swallow می‌کنند تا run متوقف نشود؛ disk monitoring و backup لازم است.
5. **External LLM:** timeout و URL egress guard وجود دارد، ولی انتخاب provider، data retention و policy ارسال source باید در deployment مشخص شود.
6. **Root web token:** token تولیدی در launch output و URL اولیه وجود دارد؛ log aggregation و shell history نباید آن را ذخیره کنند.
7. **SQLite/usearch:** optional native dependencies باید در image/CI هدف با architecture همان محیط تست شوند.
8. **No database migration:** Structured AI root از JSONL/local state استفاده می‌کند؛ Semantic SQLite یک export/cache است، نه source of truth مرکزی.

---

## 11. Release checklist

پیش از release:

- [ ] `WORKSPACE_ROOT` فقط به directory موردنظر اشاره کند.
- [ ] `AGENT_APPROVAL=prompt` یا `deny` باشد؛ برای CI معمولاً `deny`.
- [ ] `PROCESS_SANDBOX_MODE=deny` یا `bwrap` باشد؛ هرگز `test` نباشد.
- [ ] `AGENT_API_KEY` و `SEMANTIC_ENGINE_TOKEN` از secret manager inject شوند.
- [ ] root web console روی loopback یا پشت reverse proxy authenticated اجرا شود.
- [ ] `MCP_AUTO_DISCOVER=false` بماند مگر project trust بررسی شده باشد.
- [ ] فقط MCP serverهای مورداعتماد فعال شوند.
- [ ] `npm test` ریشه اجرا شود.
- [ ] در `semantic-engine`: build، lint، test gate، snapshot، benchmark و audit اجرا شوند.
- [ ] benchmark روی production-like corpus و hardware اجرا شود.
- [ ] Docker image با `USER node/structured` و capability drop اجرا شود.
- [ ] image digest، SBOM و rollback artifact ثبت شود.
- [ ] backup/retention برای `.agent/eventstore`، `.agent/journal` و `.agent/jobs.json` تعریف شود.
- [ ] اگر بیش از یک replica deploy می‌شود، queue/lock/API key store توزیع‌شده جایگزین شود.

---

## 12. Troubleshooting سریع

### `Process execution is disabled`
این رفتار پیش‌فرض امن است. برای Linux production:

```bash
export PROCESS_SANDBOX_MODE=bwrap
```

اگر bubblewrap در image نیست، process tools را فعال نکنید؛ یا image sandbox استاندارد سازمان را استفاده کنید.

### `console authentication required`
Token چاپ‌شده هنگام start را با یکی از روش‌های زیر استفاده کنید:

```bash
curl -H "Authorization: Bearer $AGENT_CONSOLE_TOKEN" http://127.0.0.1:7777/api/state
```

یا URL اولیه‌ی دارای `?token=...` را فقط در محیط trusted باز کنید تا cookie ایجاد شود.

### Semantic test gate failure
همیشه ابتدا fixture را regenerate کنید:

```bash
cd semantic-engine
npm run fixture
npm run test:gate
```

اگر snapshot تغییر کرده است، قبل از `npm run snapshot:update` علت تغییر output را review کنید.

### Index job بعد از restart
در یک instance، job interrupted باید با recovery runner دوباره اجرا شود. اگر project در startup register نشده باشد، recovery تا register شدن project انجام نمی‌شود. در deployment چند replica، queue توزیع‌شده لازم است.

### `npm audit` failure
Dependency graph را بررسی کنید و تا remediation، feature native/optional مشکل‌دار را وارد production image نکنید. وضعیت فعلی lockfile production با `npm audit --omit=dev` پاک است.

---

## 13. نقطه‌ی شروع برای مهندس بعدی

ترتیب پیشنهادی مطالعه:

1. این فایل
2. `README.md`
3. `PRODUCTION-READINESS-FINDINGS-PRIORITIZED-2026-08.md`
4. `agent/agent.js`
5. `agent/lib/policy.js` و `agent/lib/workspace.js`
6. `web/server.js`
7. `semantic-engine/src/server/HttpServer.ts`
8. `semantic-engine/src/server/SecurityPipeline.ts`
9. `semantic-engine/src/server/routes/jobRoutes.ts`
10. `semantic-engine/src/runtime/JobManager.ts`
11. `semantic-engine/src/pipeline/OutputWriter.ts`
12. تست‌های listed در بخش ۷

برای هر تغییر جدید:

```bash
git status --short
npm test
cd semantic-engine && npm run build && npm run lint && npm run test:gate && npm run snapshot
```

روی branch ثابت این session کار کنید:

`arena/01a02456-structured-ai`
