# ادامهٔ ممیزی forensic — checkpoint 2026-09-15

## وضعیت

- scope: `semantic-engine/` و `structured-ai/`
- امنیت: عمداً خارج از scope
- این فایل findings جدید حاصل از ادامهٔ بررسی پس از F-001 تا F-012 را ثبت می‌کند.
- تست‌های کامل هنوز اجرا و pass نشده‌اند؛ یافته‌ها بر مبنای خواندن مستقیم، مسیر اجرایی و reproductionهای ثبت‌شده‌اند.
- هیچ فایل source مخزن تغییر نکرده است.

## یافته‌های جدید تأییدشده

### REL-013 — خطاهای run رویداد `run:error` تولید نمی‌کنند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/runtime/Observability.js:104-127`; `structured-ai/agent/agent.js:3522-3550`; `structured-ai/agent/runtime/ActionProcessor.js:491-502`
- Evidence:

```js
// Observability.js:104-127 — counters فقط برای run:end یا run:error کم می‌شوند.
// agent.js:3522-3550 — exception دوباره throw می‌شود و run:error emit نمی‌شود.
```

- Problem: در exceptionهای model/tool/cancellation/hook مسیر خطا event متناظر را منتشر نمی‌کند.
- Impact: شمارنده‌های `active_runs` و `gateway_active_runs` می‌توانند باقی بمانند و `failed_runs`/health/metrics وضعیت واقعی را نشان ندهند.
- Verification note: جست‌وجوی کل `agent/` مورد دیگری از `events.emit("run:error", ...)` پیدا نکرد.

### ARCH-014 — delegation به پروژهٔ دیگر در MCP از projectId والد استفاده می‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/runtime/DelegationRunner.js:422-437`; `agent/mcp/McpManager.js:33-44,414-423`; `agent/tools/mcp/McpTools.js:216-227,401-403`
- Problem: child با override پروژهٔ B اجرا می‌شود، اما `McpManager.currentProjectId()` project والد A را می‌خواند و effective project را لحاظ نمی‌کند.
- Impact: MCP serverهای پروژهٔ B ممکن است discover/call نشوند یا server پروژهٔ A انتخاب شود.
- Trigger: parent A → delegation override B → MCP discovery/call.

### ARCH-015 — پیکربندی `.mcp.json` به workspace اول pin می‌شود

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/mcp/McpManager.js:95-113,214-220`; `McpConfigLoader.js:159-180`; `agent/tools/ToolRuntime.js:151-154`
- Evidence:

```js
// McpManager.js:95-101
// load() در نبود root صریح به this.workspaceRoot یا settings.WORKSPACE_ROOT fallback می‌کند.
// McpManager.js:103-107
// پس از load همان root cache می‌شود.
```

- Problem: discovery بدون workspaceRoot پروژه اجرا می‌شود و manager config پروژهٔ اول را cache می‌کند.
- Impact: در workspaceهای متفاوت، `.mcp.json` پروژهٔ بعدی بارگذاری نمی‌شود و serverهای هم‌نام project-scoped تفکیک نمی‌شوند.

### API-016 — `runAgent({ project })` با `ProjectContext` نرمال‌شده ناسازگار است

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/projects/ProjectResolver.js:11-15,25-33,49-61`; `ProjectContext.js:50-58`
- Problem: قرارداد resolver پذیرش context را اعلام می‌کند، اما implementation فقط record با `id` و `rootPath` را می‌پذیرد؛ context ساخته‌شده `projectId` و `workspaceRoot` دارد.
- Reproduction: ارسال context نرمال‌شده خطای زیر تولید کرد:

```text
options.project must be a project record with id and rootPath (get it from projectRegistry.get(...) or register one first).
```

### REL-017 — signal handler runهای modular فعال را cancel نمی‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/application/lifecycle.js:37-40`; `agent/agent.js:1315-1318,1418-1438,1450-1483,3579-3597`; `agent/runtime/RunManager.js:146-155`
- Problem: signal path به `cancelRun()` و global legacy `RUN` متکی است؛ run modular داخل ALS/RunManager است و controller آن abort نمی‌شود.
- Impact: SIGINT/SIGTERM مسیر cancellation عادی run را طی نمی‌کند و shutdown می‌تواند run را بدون cleanup معمول قطع کند.

### REL-018 — runهای queued در RunManager ثبت و قابل cancellation نیستند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/agent.js:3502-3519`; `agent/runtime/RunManager.js:83-107,138-143,182-199`; `agent/runtime/RunScheduler.js:175-203,284-306`
- Problem: context/ID قبل از scheduler ساخته می‌شود، اما queue فقط function و resolve/reject را نگه می‌دارد؛ `active` فقط هنگام ورود به execute پر می‌شود.
- Impact: `cancelRunById()` queued run را پیدا نمی‌کند؛ jobهای rejected/never-executed cleanup ندارند و ID در `issued` می‌ماند.

### DB-019 — plan با write مستقیم و غیراتمی ذخیره می‌شود

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/tools/planning/PlanRepository.js:83-94`
- Evidence:

```js
fs.writeFileSync(
    planPath(root),
    `${JSON.stringify(plan, null, 2)}\\n`,
    "utf8"
);
```

- Problem: failure وسط write می‌تواند فایل قبلی را truncate/corrupt کند، درحالی‌که helper اتمیک در `agent/persistence/JsonRepository.js:36-44` موجود است.
- Impact: `plan_get`/`plan_update` بعداً با invalid JSON متوقف می‌شوند و نسخهٔ معتبر قبلی از دست می‌رود.

### DB-020 — migration دایرکتوری durable مربوط به discussion را منتقل نمی‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/persistence/DataRoot.js:23-32`; `agent/persistence/ProjectMigration.js:56-64,199-206`; `agent/discussion/TranscriptRepository.js:17-22`
- Evidence:

```js
const SCAFFOLD_DIRS = [
    "sessions", "archive", "journal", "eventstore",
    "searches", "processes", "logs", "discussion"
];
```

در migration:

```js
const DIRECTORIES = [
    "sessions", "archive", "journal", "eventstore",
    "searches", "processes", "logs"
];
```

- Problem: `discussion` در scaffold/data contract وجود دارد اما در candidateهای migration نیست.
- Impact: transcriptهای legacy در workspace باقی می‌مانند و در data root مرکزی پروژه قابل list/replay نیستند؛ migration بدون خطا تمام می‌شود.

### REL-021 — compaction در failure آرشیو، exchange را حذف می‌کند

- Severity: HIGH
- Confidence: HIGH
- Location: `structured-ai/agent/context/ContextCompactor.js:326-341`; `agent/context/ArchiveCoordinator.js:47-75`
- Evidence:

```js
if (typeof options.onDrop === "function") {
    try {
        options.onDrop(messages, oldest);
    } catch {
        /* archiving must never block staying inside the budget */
    }
}

messages.splice(
    oldest.start,
    oldest.end - oldest.start + 1
);
```

- Problem: callback failure نادیده گرفته می‌شود و exchange بدون تضمین archive حذف می‌شود.
- Impact: در failure persistence، tool result/transcript از context حذف و recovery archive از دست می‌رود.

### API-022 — search handleها هنگام retrieval project-scoped نیستند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/tools/search/SearchTools.js:465-485,571-581,614-625,635-645`
- Evidence:

```js
async function searchGet(args) {
    const session =
        SESSIONS.get(args.search_id);
    if (!session) {
        throw new Error(`Unknown search: ${args.search_id}`);
    }
}
```

- Problem: `search_start` context/root/run را در session ذخیره می‌کند، اما get/list/stop فقط global map را با handle می‌خوانند و context/مالکیت را validate نمی‌کنند.
- Impact: اجرای پروژهٔ دیگر می‌تواند نتیجهٔ search را بخواند، list کند یا stop کند؛ رفتار multi-project نادرست است.
- Reproduction ثبت‌شده: پروژهٔ B با handle پروژهٔ A نتیجهٔ `ALPHA_PROJECT_A` را دریافت و stop کرد.

### REL-023 — خطای spawn به‌اشتباه `exited` گزارش می‌شود

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/tools/process/BackgroundSession.js:177-200`
- Evidence:

```js
child.on("error", error => {
    ProcessManager.appendOutput(session, "stderr", error.message);
    session.status = "failed";
    session.finished_at = Date.now();
});

child.on("close", (code, signal) => {
    session.status = "exited";
    session.exit_code = code;
    session.signal = signal;
    session.finished_at = Date.now();
});
```

- Problem: `close` وضعیت `failed` را بدون توجه به خطای spawn overwrite می‌کند.
- Impact: مصرف‌کننده نمی‌تواند command failure در spawn را از exit عادی تشخیص دهد.
- Reproduction: shell نامعتبر → stderr شامل `spawn ... ENOENT`، اما status نهایی `exited` و exit_code `-2`.

### REL-024 — حذف chunkهای قدیمی cursor خروجی unread را اصلاح نمی‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `structured-ai/agent/tools/process/BackgroundSession.js:14-27`; `agent/tools/process/ProcessManager.js:181-205`
- Evidence:

```js
const chunks = session.output.slice(
    options.peek ? 0 : session.read_cursor
);
if (!options.peek) {
    session.read_cursor = session.output.length;
}
```

```js
const removed = session.output.shift();
session.buffered_chars -= removed.text.length;
session.dropped_chunks++;
```

- Problem: پس از `shift()`، `read_cursor` decrement نمی‌شود.
- Impact: بخشی از chunkهای باقی‌مانده که بعد از read قبلی تولید شده‌اند unread محسوب نمی‌شوند و بی‌صدا از دست می‌روند.
- Reproduction ثبت‌شده: پس از trimming، cursor=19 اما 19 chunk باقی‌مانده همگی بعد از read قبلی بودند؛ read بعدی فقط 5 chunk را برگرداند.

## Test gaps ثبت‌شده

- برای موارد بالا تستی برای `run:error` در exception، child delegation با project override، config جداگانهٔ `.mcp.json`، queued cancellation، migration discussion، archive failure، cross-project search handle، spawn error و cursor بعد از buffer trim پیدا نشد.
- تست‌های focused قبلی با timeout/exit 124 مواجه شدند؛ full test/build pass ادعا نمی‌شود.

## یافته‌های جدید این مرحله

### DASH-025 — dashboard مستقل وضعیت سلامت و چند آمار را ساختگی/ناقص گزارش می‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/server/routes/projectRoutes.ts:136-148` و `:70-76`
- Evidence:

```ts
health: { status: 'healthy', indexState: project.status },
statistics: {
  files: project.stats.filesCount,
  symbols: project.stats.symbolsCount,
  dependencies: project.stats.dependenciesCount,
  chunks: 0,
},
hotspots: [],
recentChanges: [],
```

و در پاسخ جزئیات پروژه نیز `chunks: 0` hard-coded است.
- Problem: پروژهٔ `missing` یا `stale` هم `healthy` گزارش می‌شود و فیلدهای dashboard بدون محاسبهٔ دادهٔ واقعی مقدار ثابت دارند.
- Impact: dashboard نمی‌تواند وضعیت واقعی پروژه و شاخص‌های اصلی آن را نشان دهد.

### API-026 — endpoint لغو job، project binding مسیر را بررسی نمی‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/server/routes/jobRoutes.ts:269-280`
- Evidence:

```ts
const cancelled = jobManager.cancelJob(ctx.params.jobId);
return {
  status: 200,
  json: {
    jobId: ctx.params.jobId,
    cancelled,
  },
};
```

در endpoint GET همان resource، تطبیق وجود دارد:

```ts
if (!job || job.projectId !== ctx.params.id) {
  return { status: 404, json: { error: `Job not found: ${ctx.params.jobId}` } };
}
```
- Problem: cancel فقط `jobId` را به manager می‌دهد و `ctx.params.id` را بررسی نمی‌کند.
- Impact: route پروژهٔ A می‌تواند job پروژهٔ B را cancel کند؛ job ناشناخته نیز پاسخ `200/cancelled:false` می‌گیرد.

### UI-027 — شکست یا تغییر project switch، state و لینک پروژهٔ قبلی را پاک نمی‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/public/open.js:191-210`
- Evidence:

```js
state.path = path;
$("pathInput").value = path;
try {
  const project = await api("POST", "/api/v1/projects", { path });
  state.projectId = project.id;
  ...
  if (project.status === "ready") {
    $("gotoVisualizerBtn").hidden = false;
    $("gotoVisualizerBtn").href = "/visualizer.html?project=" + encodeURIComponent(project.id);
  }
} catch (e) {
  log("bad", "Could not open project: " + e.message);
}
```

- Problem: در catch، `state.projectId` و visualizer link قبلی reset نمی‌شوند؛ در موفقیت پروژهٔ جدیدِ غیر-ready نیز branch برای hide/clear لینک قبلی وجود ندارد.
- Impact: کاربر می‌تواند بعد از switch ناموفق یا به پروژهٔ non-ready، همچنان به dashboard پروژهٔ قبلی هدایت شود و indexing بعدی روی `state.projectId` قبلی اجرا شود (`open.js:249-257`).

### API-028 — خطاهای validation در Source Sync به HTTP 500 تبدیل می‌شوند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/server/routes/sourceRoutes.ts:13-26`; `src/services/source/SourceSyncService.ts:74-91`; `src/server/HttpServer.ts:184-189`
- Evidence:

```ts
const result = await sourceSyncService.syncFromGit(projectId, project.rootPath, {
  repoUrl: body.repoUrl,
  branch: body.branch,
  commitHash: body.commitHash,
});
return { status: 200, json: result };
```

سرویس برای ورودی invalid exception می‌دهد:

```ts
throw new Error('repoUrl must be a valid HTTPS or HTTP URL.');
```

و server exception را 500 می‌کند:

```ts
this.handleRequest(req, res).catch(error => {
  if (!res.headersSent) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
```

- Problem: validation failure به‌عنوان server failure طبقه‌بندی می‌شود.
- Impact: clientها status اشتباه می‌گیرند، observability و retry behavior نیز می‌تواند آن را failure زیرساختی تلقی کند.

### CONF-029 — PATCH config موفقیت را اعلام می‌کند ولی runtime config را تغییر نمی‌دهد

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/server/routes/configRoutes.ts:35-53`
- Evidence:

```ts
return {
  status: 200,
  json: {
    updated: true,
    config: {
      port: platformConfig.port,
      host: platformConfig.host,
      allowRemote: platformConfig.allowRemote,
      maxBodyBytes: body.maxBodyBytes || platformConfig.maxBodyBytes,
      projectsRoot: platformConfig.projectsRoot,
    },
  },
};
```

- Problem: هیچ assignment، persistence یا reload برای `platformConfig` انجام نمی‌شود؛ فقط response ساخته می‌شود.
- Impact: GET بعدی مقدار قبلی را برمی‌گرداند و API موفقیت کاذب گزارش می‌کند؛ `0` نیز به‌علت `||` نادیده گرفته می‌شود.

### API-030 — OpenAPI قرارداد endpointهای dashboard موجود را ندارد

- Severity: LOW-MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/server/routes/projectRoutes.ts:121-123,157-159,169-171`; `semantic-engine/contracts/platform-v1.openapi.json:294-323`
- Evidence:

```ts
pattern: '/api/v1/projects/:id/dashboard/overview'
pattern: '/api/v1/projects/:id/dashboard/dependencies'
pattern: '/api/v1/projects/:id/dashboard/metrics'
```

در OpenAPI پس از visualization path مستقیماً `components` می‌آید و این سه path وجود ندارند.
- Problem: implementation و contract رسمی API همگام نیستند.
- Impact: client/code generatorها endpointهای dashboard را discover نمی‌کنند و schema/compatibility validation ناقص می‌ماند.

### P-031 — تست visualizer payload را بررسی نمی‌کند

- Classification: POTENTIAL / TEST GAP
- Severity: LOW
- Confidence: HIGH
- Location: `semantic-engine/src/gateway/GatewayServer.test.ts:201-208`
- Evidence:

```ts
expect(reply.status).not.toBe(404);
expect(reply.headers[PROJECT_ID_HEADER]).toBe(idA);
```

- Problem: پاسخ 500، payload خالی یا body فاقد `nodes`/`edges` نیز این assertion را pass می‌کند.
- Missing evidence: نتیجهٔ اجرای suite و قرارداد دقیق payload در فایل‌های خارج از مجموعهٔ خوانده‌شده.
- What would confirm it: اجرای تست و مقایسه با schema واقعی visualizer response.

## یافته‌های جدید این مرحله

### VIZ-032 — نمای Module یال‌های معلق تولید می‌کند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/services/visualization/LodService.ts:296-317`
- Evidence:

```ts
const fileIds = new Set(filteredFiles.map(f => f.id));
for (const dep of depEdges) {
  if (fileIds.has(dep.from) || fileIds.has(dep.to)) {
    edges.push(
      GraphViewModelMapper.createEdge(
        `edge-mod-${edges.length}`,
        dep.from,
        dep.to,
```

- Problem: edge با وجود یکی از endpointها خارج از nodeهای response اضافه می‌شود؛ package node نیز ساخته نمی‌شود.
- Impact: graph payload شامل dangling edge است و renderer/clientهایی که invariant دو endpoint را انتظار دارند، graph ناقص می‌گیرند.

### VIZ-033 — API nodeها در Architecture View حذف می‌شوند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/services/visualization/LodService.ts:83-93,170-178`
- Evidence:

```ts
// API nodes بدون edge ساخته می‌شوند.
const apiNodeId = `api-${route.method}-${route.path}`;
nodes.push(
  GraphViewModelMapper.createNode(apiNodeId, 'api', `${route.method} ${route.path}`, {
```

```ts
const prunedNodes = nodes.filter(n => {
  if (n.metadata.role === 'layer') return true;
  return connected.has(n.id);
});
```

- Problem: API nodeها edge ندارند و فقط layer از pruning مستثنا شده است.
- Impact: با وجود API map، API nodeها در خروجی architecture دیده نمی‌شوند؛ برخلاف contract/comment طراحی‌شده برای context dashboard.

### VIZ-034 — provenance/basis گراف یا جعل می‌شود یا خارج از contract برمی‌گردد

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/services/visualization/LodService.ts:311-314,137-142,259-262`; `src/server/types.ts:149-152`
- Evidence:

```ts
basis: (dep.provenance?.basis as 'resolved' | 'name-match' | 'transitive' | 'blueprint') ?? 'resolved',
```

و contract فقط این مقادیر را تعریف می‌کند:

```ts
readonly basis: 'resolved' | 'name-match' | 'transitive' | 'blueprint';
```

- Problem: TypeScript cast مقدار runtime را تبدیل نمی‌کند؛ provenanceهایی مانند `import-resolved` یا `unresolved` می‌توانند خارج از contract در JSON برگردند. در architecture/file view نیز basis واقعی به `resolved` یا `blueprint` تبدیل می‌شود.
- Impact: client فیلتر/نمایش کیفیت edge را اشتباه تفسیر می‌کند و confidence/basis ناسازگار می‌شود.

### VIZ-035 — `confidentRatio` در Module View همیشه `1.0` است

- Severity: LOW-MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/services/visualization/LodService.ts:311-329`
- Evidence:

```ts
confidence: dep.provenance?.confidence ?? 95,
...
summary: {
  totalNodes: nodes.length,
  totalEdges: edges.length,
  confidentRatio: 1.0,
},
```

- Problem: summary از confidence واقعی edgeها محاسبه نمی‌شود.
- Impact: graphی با edgeهای low-confidence، 100٪ confident گزارش می‌شود.

### VIZ-036 — fallback معماری با level اشتباه برمی‌گردد

- Severity: LOW-MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/services/visualization/LodService.ts:158-160,267-275`
- Evidence:

```ts
if (!hasInternalEdges) {
  return this.fileLevelDependencyView(project);
}
```

اما fallback:

```ts
return {
  level: 'architecture',
  nodes,
  edges,
```

در حالی‌که nodeها در fallback از نوع `file` ساخته می‌شوند.
- Impact: client بر اساس `level` layout/breadcrumb معماری انتخاب می‌کند اما payload file-level است.

### VIZ-037 — مقدار صفر در Neighborhood API به‌صورت silent به default تبدیل می‌شود

- Severity: LOW-MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/server/routes/visualizationRoutes.ts:140-142`
- Evidence:

```ts
const view = lodService.getNeighborhoodView(
  project,
  body.seedId,
  body.depth || 1,
  body.minConfidence || 70
);
```

- Problem: `0` برای `depth` و `minConfidence` با default جایگزین می‌شود؛ در GraphQueryEngine مقدار `minConfidence: 0` معنای مشخص «همهٔ edgeها» دارد. برای مقادیر منفی/بیرون بازه نیز validation دیده نمی‌شود.
- Impact: query نتیجهٔ متفاوت از درخواست کاربر می‌دهد و قرارداد فیلتر confidence دقیق نیست.

### DASH-038 — Git hotspot/co-churn به projectId bind نشده است

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/src/server/routes/historyRoutes.ts:11-43`
- Evidence:

```ts
const hotspots = historyMiner.getHotspots(10);
return { status: 200, json: { projectId, hotspots } };
```

```ts
const coChurn = historyMiner.getCoChurn(filePath, 10);
return { status: 200, json: { projectId, filePath, coChurn } };
```

و record نیز projectId را به miner نمی‌دهد:

```ts
historyMiner.recordCommit(body.filesChanged, body.linesDiff);
```

- Problem: envelope پاسخ projectId دارد، اما state miner با project key تفکیک نشده است.
- Impact: در چند پروژهٔ هم‌زمان، تاریخچهٔ پروژهٔ A می‌تواند در hotspot/co-churn پروژهٔ B ظاهر شود.

### P-VIZ-039 — تب‌های Impact و Git Hotspots احتمالاً backend متناظر ندارند

- Classification: POTENTIAL / UNVERIFIED
- Severity: LOW-MEDIUM
- Confidence: LOW
- Evidence available: routeهای visualization خوانده‌شده architecture، dependencies، module، file، workflow، business-mapping، test-map، neighborhood و path را دارند؛ routeهای `visualization/impact` و `visualization/hotspots` در همان فایل دیده نشدند.
- Missing evidence: dispatch/URL واقعی `public/visualizer.js` در فایل‌های مستقیم خوانده‌شده موجود نبود.
- What would confirm it: خواندن visualizer dispatch و اجرای هر دو تب در مرورگر.

## یافته‌های جدید این مرحله

### VIZ-040 — چند تب visualizer به endpoint نمای اشتباه متصل‌اند

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/public/visualizer.js:172-181`
- Evidence:

```js
workflow: id => `/api/v1/projects/${id}/visualization/business-mapping`,
...
impact: id => `/api/v1/projects/${id}/visualization/dependencies`,
hotspots: id => `/api/v1/projects/${id}/visualization/dependencies`,
```

- Problem: تب Workflow دادهٔ business mapping می‌گیرد و تب‌های Impact/Hotspots دادهٔ generic dependencies می‌گیرند؛ endpointهای واقعی workflow، impact و history hotspots در mapping استفاده نشده‌اند.
- Impact: switch تب در dashboard به‌جای نمای مورد درخواست، دادهٔ نمای دیگری را نمایش می‌دهد و خروجی از نظر معنایی نادرست است.

### UI-041 — در failure یا خالی‌بودن API، visualizer دادهٔ نمونهٔ ساختگی نمایش می‌دهد

- Severity: MEDIUM
- Confidence: HIGH
- Location: `semantic-engine/public/visualizer.js:187-200,1111-1195`
- Evidence:

```js
if (total === 0) generateFallbackData(viewType);
} catch (err) {
  generateFallbackData(viewType);
  projectTitleEl.textContent = `${state.projectId} — preview (index unavailable)`;
}
```

و fallback شامل داده‌های ثابت است:

```js
{ id: "mod-auth", type: "module", label: "Auth Module" },
{ id: "api-login", type: "api", label: "POST /auth/login" },
```

- Problem: خطای backend، پروژهٔ index نشده یا پاسخ خالی به graph نمونه تبدیل می‌شود.
- Impact: کاربر ممکن است دادهٔ preview را با intelligence واقعی پروژه اشتباه بگیرد؛ failure به‌جای error state به ظاهراً graph قابل استفاده تبدیل می‌شود.

## یافته‌های جدید این مرحله

### HOOK-042 — `on_failure: stop` اجرای graph را متوقف نمی‌کند

- Severity: MEDIUM; Confidence: HIGH
- Location: `structured-ai/agent/runtime/ToolGraphExecutor.js:282-293,312-362`; `agent/hooks/HookRunner.js:534-547`
- Evidence:

```js
const dependenciesComplete =
    item.depends_on.every(
        dependency => results.has(dependency)
    );
```

و خطاها به result تبدیل می‌شوند:

```js
return {
    id: item.id,
    success: false,
    result: null,
    error: { code: error.name || "EXECUTION_ERROR", message: error.message, retryable: false }
};
```

- Problem: وابستگی failed از نظر scheduler صرفاً complete محسوب می‌شود؛ `stopped` بعد از اتمام graph محاسبه می‌شود.
- Reproduction: hook اول با `on_failure: stop` failed شد اما hook وابسته نیز اجرا شد.

### POL-043 — regex نامعتبر در policy پذیرفته و در evaluation منفجر می‌شود

- Severity: MEDIUM; Confidence: HIGH
- Location: `structured-ai/agent/policy/PolicyMatcher.js:55-73`; `PolicyRegistry.js:39-67`
- Evidence:

```js
pattern => new RegExp(pattern, "i").test(text)
```

validation فقط action را بررسی می‌کند:

```js
if (!VALID_ACTIONS.includes(rule.action)) {
    problems.push(`Policy rule "${rule.id}" has an unknown action "${rule.action}".`);
}
```

- Problem: conditionی مانند `argument_matches.path: ["["]` از validation عبور می‌کند و هنگام evaluation `SyntaxError` می‌دهد.

### POL-044 — pending approval به cancellation متصل نیست

- Severity: MEDIUM; Confidence: HIGH
- Location: `structured-ai/agent/policy/ApprovalManager.js:272-302`; `PolicyEngine.js:273-276`; `agent.js:1418-1439`
- Evidence:

```js
return (evaluation, args) =>
    new Promise(resolve => {
        const request = { ...resolve };
        pendingStore.addPending(request);
    });
```

- Problem: Promise فقط با approval resolve می‌شود و AbortSignal/listener ندارد؛ abort run controller آن را settle نمی‌کند.
- Reproduction: بعد از abort، `pending:1` و `settled:false` باقی ماند.

### POL-045 — approval history بدون سقف رشد می‌کند

- Severity: LOW; Confidence: HIGH
- Location: `structured-ai/agent/policy/ApprovalStore.js:8-11,28-39`
- Evidence:

```js
record(value) {
    this.history.push(value);
    return value;
}
```

- Problem: برخلاف contract bounded history، eviction یا retention limit وجود ندارد.

### POL-046 — approval ردشده event/audit policy تولید نمی‌کند

- Severity: MEDIUM; Confidence: HIGH
- Location: `structured-ai/agent/policy/ApprovalManager.js:138-147`; `PolicyEngine.js:273-283`
- Evidence:

```js
if (mode === "deny") {
    record.approved = false;
    record.mode = "deny";
    this.store.record(record);
    throw unattendedApproval(evaluation.tool, evaluation.reason);
}
```

اما callback فقط بعد از resolve موفق approval اجرا می‌شود:

```js
const approval = await this.requestApproval(evaluation, args);
this.onDecision({ ...evaluation, approved: approval.approved });
```

- Impact: rejection در store هست اما event `policy:decision`/audit callback تولید نمی‌شود.

### PRJ-047 — hook registry به active project run متصل نیست

- Severity: MEDIUM; Confidence: HIGH
- Location: `structured-ai/agent/agent.js:3306-3313`; `agent/hooks/HookRunner.js:491-495`; `HookLoader.js:193-205`; `WorkspaceProfile.js:121-130`
- Evidence:

```js
HOOK_RUNNER = new HookRunner({
    settings,
    registry: hookRegistry,
});
```

```js
const declarations = this.registry.enabledHooks(phase);
```

```js
function projectPath() {
    return path.join(agentDirectory(), "project.json");
}
```

- Problem: hook loading از workspace profile ثابت استفاده می‌کند و `currentRun().project.workspaceRoot` را به loader نمی‌دهد.
- Impact: در اجرای چند پروژه، hookهای global/پروژهٔ دیگری می‌توانند برای run فعال استفاده شوند.

## Test gaps این مرحله

- تستی برای توقف graph پس از failed dependency، malformed regex، approval cancellation، denial event و project-scoped hook loading پیدا نشد.
- focused policy/hooks tests با timeout و exit `124` تمام شدند؛ pass کامل ادعا نمی‌شود.

## Checkpoint بعدی

1. بازبینی مستقیم شواهد line-level برای همهٔ موارد بالا و حذف مواردی که quote کافی ندارند.
2. ادامهٔ پوشش روی APIهای project، dashboard و workflowهای end-to-end هر دو پروژه.
3. ساخت coverage matrix تلفیقی و گزارش نهایی؛ تا آن زمان verdict نهایی صادر نمی‌شود.

## Checkpoint — 2026-09-17

- All 83 previously incomplete `semantic-engine` paths present as fetchable (`ok=true`) were directly reviewed in this pass; manifest: `semantic-completed-paths.txt`.
- All 29 previously incomplete `structured-ai` paths present as fetchable (`ok=true`) were directly reviewed in this pass; manifest: `structured-completed-paths.txt`.
- Two additional structured-ai findings were recorded in `structured-ai-audit-supplement.md` (F-013, F-014).
- `AUDIT_FILE_STATUS.md` was synchronized. Current repository inventory: 881 files; 540 marked `کامل`; 341 marked `درانتظار`; 0 marked `ناقص` among the fetchable files handled in this pass.
- Security review remains explicitly excluded. The 341 `درانتظار` files were not reclassified because their contents were not directly reviewed.


## Batch checkpoint — 2026-09-17

30 semantic-engine files were fully reviewed and moved from `درانتظار` to `کامل`; two confirmed findings (F-16, F-17) were added to the supplement. Evidence manifest: `semantic-batch-completed.txt`. Tests were not executed.


## Batch 2 checkpoint — 2026-09-17

30 additional semantic-engine files and 20 additional structured-ai files were directly reviewed. Findings F-18 and F-015 were recorded. No tests executed; static review only.


## Batch 3 checkpoint — 2026-09-17

20 semantic-engine and 22 structured-ai files were directly reviewed. Findings F-19, F-20, F-016 and F-017 recorded. One persistence test passed 9/9; no broader suite executed. Status table updated for matching paths only; manifest/status mismatches remain explicitly tracked.
