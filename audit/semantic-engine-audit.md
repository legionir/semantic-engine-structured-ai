# Forensic audit — `semantic-engine/`

## Scope and method

- **Repository:** `legionir/semantic-engine-structured-ai`
- **Ref:** `main` at commit `3a20f3192e43c5cf2723cd524e08e013f941a4ed`
- **In scope:** only paths under `semantic-engine/`; workflows for multi-project registration, selection/switch, management, persistence, Gateway/API, dashboard, indexing, and the semantic-engine side of Structured-AI/MCP integration.
- **Out of scope:** security audit. Security-related code was read only where needed to follow routing and integration; no security finding is reported.
- **Evidence rule:** every finding below cites verbatim source/documentation text and manually counted line numbers. Documentation is used only to compare claims with implementation, not as proof that a workflow executes.
- **Execution:** no repository tests were run. The selected source/config/test/build files were retrieved with `github_get_file_content`; the test observations below are static observations of test code.

## File inventory and review coverage

The recursive GitHub tree contained **524 blobs** under `semantic-engine/` at the commit above. The complete machine-readable inventory is saved beside this report at `tree-files.tsv` (size and path for every blob).

| inventory group | count |
|---|---:|
| `src/` | 474 |
| `public/` | 14 |
| `scripts/` | 9 |
| `contracts/` | 4 |
| `tree-sitter-grammars/` | 7 |
| `docs/` | 2 |
| `bin/` | 1 |
| `test/` | 2 |
| root files (`README`, configs, lockfile, etc.) | 11 |
| **total** | **524** |

**Retrieved and reviewed:** **74 files** via `github_get_file_content`: 56 `src` files, 11 test files, 6 public files, 8 config/build/contract files, and 4 docs/README files (some files belong to more than one category, so category totals are not additive). The reviewed set was:

```text
Dockerfile
HANDOFF.md
INTEGRATION-STRUCTURED-AI.md
README.md
contracts/config.schema.json
contracts/platform-v1.openapi.json
contracts/project-index.schema.json
docs/architecture/multi-project-gateway.md
jest.config.js
package-lock.json
package.json
public/app.js
public/gateway.html
public/gateway.js
public/index.html
public/open.js
public/visualizer.js
tsconfig.json
src/ai/AiToolCommandHandler.ts
src/ai/AiToolRegistry.ts
src/ai/ProjectIndexReader.ts
src/ai/discovery/loadBlueprint.ts
src/ai/mcp/SemanticEngineMcpServer.ts
src/ai/mcp/cli.ts
src/ai/tools/ToolInputValidator.ts
src/ai/tools/types.ts
src/cli/commands/gateway-command.ts
src/cli/commands/index-command.ts
src/cli/commands/serve-command.ts
src/cli/main.ts
src/cli/projectPathsFromArgs.ts
src/core/config/DataRootResolver.ts
src/core/config/ProjectIdentity.ts
src/core/config/ProjectPaths.ts
src/core/config/ProjectRegistry.test.ts
src/core/config/ProjectRegistry.ts
src/core/config/migrateLegacyArtifacts.ts
src/core/config/structuredAiContract.test.ts
src/gateway/GatewayAuth.ts
src/gateway/GatewayServer.test.ts
src/gateway/GatewayServer.ts
src/gateway/McpProxy.test.ts
src/gateway/WorkerConfigSchema.ts
src/gateway/ProjectLock.ts
src/gateway/WorkerProcess.ts
src/gateway/WorkerSupervisor.ts
src/gateway/gatewayUi.test.ts
src/gateway/multiProject.e2e.test.ts
src/gateway/protocolMatrix.e2e.test.ts
src/gateway/types.ts
src/gateway/workerArgv.ts
src/gateway/wsProtocol.ts
src/incremental/IncrementalEngine.ts
src/incremental/ProjectIndexStore.ts
src/pipeline/IndexPipeline.ts
src/pipeline/OutputWriter.ts
src/server/HttpServer.ts
src/server/platform.e2e.test.ts
src/server/projectRegistryRoutes.test.ts
src/server/routes/analysisRoutes.ts
src/server/routes/chatRoutes.ts
src/server/routes/codeRoutes.ts
src/server/routes/configRoutes.ts
src/server/routes/jobRoutes.ts
src/server/routes/projectRoutes.ts
src/server/routes/searchRoutes.ts
src/server/routes/sourceRoutes.ts
src/server/v2.routes.test.ts
src/server/wsProjectChannel.ts
src/services/ProjectService.test.ts
src/services/ProjectService.ts
src/services/chat/ProjectChatService.ts
src/services/source/SourceSyncService.ts
src/vector/VectorStore.ts
```

**Not reviewed:** 450 inventory blobs (all paths in `tree-files.tsv` not in the reviewed list), including most unrelated analyzers, fixtures, scripts, grammar assets, contracts, and UI files outside the traced workflows. The bulk-fetch attempt also produced authentication failures (`Sandbox tool authentication token expired` / HTTP 401) for files not in the selected set; those files were not treated as reviewed. No `structured-ai/...` consumer source exists under the in-scope `semantic-engine/` tree: the attempted paths `semantic-engine/structured-ai/...` returned GitHub `Not Found`; the consumer-side repository was not audited because scope was explicitly limited to `semantic-engine/`.

## Traced workflows

### Registration and stable identity

`ProjectRegistry.register()` canonicalizes the root and persists a record. Source evidence: `src/core/config/ProjectRegistry.ts:174-216` calls `assertProjectRoot`, detects an existing canonical root, selects an ID, then saves the record and writes its manifest. `ProjectIdentity.ts:128-131` defines `prj-<slug>-<sha256(canonicalRoot)[0:8]>`; `src/server/projectRegistryRoutes.test.ts:77-112` exercises two same-named checkouts and verifies two IDs plus a data-root registry. This workflow is implemented and tested statically.

### Selection/switch and project context

`public/open.js:190-208` posts the selected root to `/api/v1/projects`, stores `project.id`, and builds a visualizer URL with `?project=<id>`. Gateway deep-link behavior is implemented in `GatewayServer.ts` (the UI redirects `/projects/:id` to `/visualizer?project=:id`), while `public/gateway.js:558-560` uses a project-specific dashboard/MCP URL. Gateway proxy routing uses `/api/v1/projects/:id/...` (`GatewayServer.ts:289-292`) and does not rewrite the project context. There is no separate mutable “current project” state; switching is URL/project-ID selection.

### Management and persistence

The standalone HTTP project routes expose list/register/get/PATCH/DELETE, but PATCH/DELETE are defective (F-01). The Gateway management route separately implements GET, DELETE, PATCH rename, and lifecycle actions (`GatewayServer.ts:638-686`), but Gateway registration does not persist `autoStart`, and `GatewayServer.start()` does not hydrate workers (F-04). The registry itself persists JSON atomically and writes a per-project manifest; this is positive storage evidence, not evidence that workers are restored.

### Gateway/API and workers

`GatewayServer.ts:275-291` recognizes only `start|stop|restart|reindex` for lifecycle routes and proxies project API paths to each worker. `WorkerSupervisor`/`WorkerProcess` were reviewed for deduplicated starts, capacity, process readiness, health, and stop behavior. The UI action list advertises additional actions that have no matching route (F-06). Gateway list entries expose hard-coded zero statistics (F-03).

### Dashboard and configuration

`public/gateway.js:32-73` presents project, indexing, watch, service, security, embedding, and advanced fields, and `gatewayUi.test.ts:49-99` statically tests schema/form mapping. However, the browser save handler sends only `path`, `name`, `id`, and `autoStart` to a POST endpoint (`public/gateway.js:595-614`), so the displayed configuration cannot be persisted (F-02). The project dashboard APIs in `projectRoutes.ts` use the in-process `ProjectService` stats, while Gateway dashboard list stats are zero (F-03).

### Indexing and reload

The real HTTP indexing flow is asynchronous: `jobRoutes.ts:173-239` starts an index job and returns `202` with a job ID/options; `public/open.js:249-306` starts, polls, and renders completion. The `ProjectService.indexProject()` method is a separate public service API but only reloads an existing artifact (F-05). MCP reload/watch behavior is implemented in `SemanticEngineMcpServer.ts:100-179`, including generation refresh and reload from disk.

### Structured-AI/MCP boundary

On the semantic-engine side, `SemanticEngineMcpServer.ts:207-228` returns `structuredContent` containing the tool result, optional `projectId`, and `indexGeneration`. The integration document claims the consumer is in `structured-ai/agent/mcp/...` (`INTEGRATION-STRUCTURED-AI.md:110-129`, `docs/architecture/multi-project-gateway.md:351-360`), but that consumer is outside the requested `semantic-engine/` scope and no such path exists under the in-scope tree. Therefore consumer behavior is not asserted; see P-01.

## Findings — CONFIRMED

### F-01 — Standalone project PATCH/DELETE report success without mutating project state

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Scope:** standalone `HttpServer` project API (`/api/v1/projects/:id`), not the separately implemented Gateway management route.
- **Evidence:** `src/server/routes/projectRoutes.ts:85-103`:

```ts
const project = projectService.getProject(ctx.params.id);
if (!project) {
  return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
}
const body = (ctx.body || {}) as { name?: string };
return {
  status: 200,
  json: {
    updated: true,
    id: project.id,
    name: body.name || project.name,
    status: project.status,
  },
};
```

The handler never mutates the project object, registry, or persisted name. DELETE has the same shape at `projectRoutes.ts:105-118`:

```ts
const project = projectService.getProject(ctx.params.id);
if (!project) {
  return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
}
return {
  status: 200,
  json: { deleted: true, id: ctx.params.id },
};
```

It never removes the project from the service/registry, stops a worker, or unregisters the project. This is not contradicted by the Gateway implementation: the Gateway has a separate, working mutation path at `GatewayServer.ts:643-660`.

### F-02 — Gateway dashboard configuration editing drops almost all form fields and cannot update an existing worker

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** the form declares fields through `public/gateway.js:32-73`, including indexing, watch, service, security, embedding, and `outOverride`. The save code at `public/gateway.js:595-614` constructs and sends only:

```js
const config = GatewayUi.formToConfig(values);
const body = {
    path: config.rootPath,
    name: config.name,
    id: config.projectId,
    autoStart: Boolean(start)
};
try {
    await api("/api/v1/gateway/projects", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, headers()),
        body: JSON.stringify(body)
    });
```

`editing` is set at `public/gateway.js:507-510`, but save never chooses PATCH and always posts to the collection endpoint. The Gateway server’s registration handler accepts only `path/rootPath`, `name`, and optional `id` (`GatewayServer.ts:551-566`), then reads `autoStart` transiently at `GatewayServer.ts:572-575`. Thus changing the displayed indexing/watch/service/embedding values, or editing an existing project, does not persist those values or update worker configuration.

### F-03 — Gateway project-list/dashboard statistics are hard-coded to zero

- **Status:** CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `src/gateway/GatewayServer.ts:509-527` builds each Gateway project entry and returns:

```ts
stats: {
  filesCount: 0,
  symbolsCount: 0,
  dependenciesCount: 0,
},
```

The same `projectEntry()` is used by list responses at `GatewayServer.ts:530-537`, so `/api/v1/gateway/projects` reports zero counts regardless of worker index content. The implementation does calculate worker state (`ready`, `indexing`, `missing`) at `GatewayServer.ts:512-521`, but no worker health/index statistics are wired into these three fields. This creates a dashboard inconsistency: a project can be `ready` while its listed counts remain zero.

### F-04 — Persisted `autoStart` intent is discarded, and Gateway restart does not restore persisted projects into workers

- **Status:** CONFIRMED
- **Severity:** High (lifecycle/persistence correctness)
- **Confidence:** High
- **Evidence 1 — registry supports persistence:** `src/core/config/ProjectRegistry.ts:203-216` creates and saves records, with `autoStart` defaulting when the input omits it:

```ts
const record: ProjectRecord = {
  id,
  name,
  rootPath: canonicalRoot,
  aliases: this.aliasesFor(input.id, id),
  enabled: input.enabled ?? true,
  autoStart: input.autoStart ?? false,
  createdAt: timestamp,
  lastSeenAt: timestamp,
};

records.push(record);
this.save(records);
this.writeManifest(record);
```

**Evidence 2 — Gateway registration omits it:** `src/gateway/GatewayServer.ts:560-575` passes only root/name/optional id to `registry.register`, then handles `autoStart` only in a local variable:

```ts
registered = this.registry.register({
  rootPath,
  name,
  ...(requestedId && isPathSafeProjectId(requestedId) ? { id: requestedId } : {}),
});
...
const autoStart = body['autoStart'] === true;
if (autoStart) {
  try {
    await this.startWorkerFor(registered.id, registered.rootPath, registered.name);
```

**Evidence 3 — startup does not hydrate/start records:** `src/gateway/GatewayServer.ts:90-92` contains the complete beginning of `start()`:

```ts
async start(): Promise<GatewayStartInfo> {
  this.supervisor.startHealthLoop();

  return new Promise((resolve, reject) => {
```

There is no registry enumeration, worker hydration, or `autoStart` handling in `start()`. The architecture document explicitly labels this gap at `docs/architecture/multi-project-gateway.md:115-117`:

```text
Not yet done: ProjectService does not hydrate itself from the registry
at startup; a fresh process starts empty and the Gateway loads projects in
فاز ۹.
```

The CLI’s optional one-project path also registers without `autoStart` (`src/cli/commands/gateway-command.ts:45-56`), reinforcing that persisted intent is not carried into the registry. A restart can therefore retain registry records but have no running workers until each is manually started.

### F-05 — `ProjectService.indexProject()` is a reload-only no-op indexing API

- **Status:** CONFIRMED (for callers expecting this service method to perform indexing)
- **Severity:** Medium
- **Confidence:** High
- **Qualification:** the HTTP job endpoint is a separate, real asynchronous indexing path; this finding does not claim `POST /api/v1/projects/:id/index` is broken.
- **Evidence:** `src/services/ProjectService.ts:371-389`:

```ts
/**
 * اجرای ایندکس پروژه به صورت همگام یا ناهمگام.
 */
async indexProject(
  id: string,
  _options?: { incremental?: boolean }
): Promise<{ filesCount: number; symbolsCount: number; edgesCount: number }> {
  const project = this.byId.get(id);
  if (!project) {
    throw new Error(`Project '${id}' not found`);
  }

  const reloaded = this.reloadProject(id);
  return {
    filesCount: reloaded?.stats.filesCount || 0,
    symbolsCount: reloaded?.stats.symbolsCount || 0,
    edgesCount: reloaded?.stats.dependenciesCount || 0,
  };
}
```

The method has no pipeline/job creation or index write. A source grep of the reviewed `src/` tree found only its definition as an internal caller; the actual indexing implementation is `jobRoutes.ts:173-239`.

### F-06 — Gateway UI advertises logs/events actions with no corresponding Gateway route

- **Status:** CONFIRMED
- **Severity:** Low–Medium
- **Confidence:** High
- **Evidence 1 — advertised actions:** `public/gateway.js:87-98`:

```js
const WORKER_ACTIONS = [
    { id: "open", label: "Open dashboard" },
    { id: "start", label: "Start" },
    { id: "stop", label: "Stop" },
    { id: "restart", label: "Restart" },
    { id: "reindex", label: "Reindex" },
    { id: "edit", label: "Edit configuration" },
    { id: "health", label: "Health detail" },
    { id: "logs", label: "View logs" },
    { id: "events", label: "View events" },
```

**Evidence 2 — browser dispatch:** `public/gateway.js:556-577` special-cases only `open`, `mcp`, `edit`, `health`, and `remove`; other actions become `POST /api/v1/gateway/projects/:id/<action>`:

```js
if (action === "remove") {
    await api("/api/v1/gateway/projects/" + encodeURIComponent(projectId), { method: "DELETE" });
} else {
    await api("/api/v1/gateway/projects/" + encodeURIComponent(projectId) + "/" + action, { method: "POST" });
}
```

**Evidence 3 — server route set:** `src/gateway/GatewayServer.ts:275-280` matches only:

```ts
const gatewayProject = /^\/api\/v1\/gateway\/projects\/([^/]+)(?:\/(start|stop|restart|reindex))?$/.exec(
  pathname
);
if (gatewayProject) {
  await this.gatewayProjectRoute(req, res, gatewayProject[1]!, gatewayProject[2], record);
  return;
}
```

`logs` and `events` therefore fall through to the generic 404 route rather than opening logs/events.

## Findings — POTENTIAL / UNVERIFIED

### P-01 — Structured-AI consumer-side project/generation integration is unverified within scope

- **Status:** POTENTIAL/UNVERIFIED
- **Severity:** Not rated (coverage limitation; no implementation failure asserted)
- **Confidence:** High that it is unverified; no confidence claim about the consumer implementation.
- **Evidence available in scope:** semantic-engine producer returns `structuredContent` and generation metadata at `src/ai/mcp/SemanticEngineMcpServer.ts:207-228`:

```ts
structuredContent: {
  ...result,
  ...(this.projectId !== undefined ? { projectId: this.projectId } : {}),
  indexGeneration: this.generation,
},
```

- **Why unverified:** the integration docs refer to consumer paths such as `structured-ai/agent/mcp/semantic.js` and `structured-ai/agent/mcp/enginePaths.js` (`INTEGRATION-STRUCTURED-AI.md:110-129`), but no `structured-ai/` path appears under the in-scope tree. Attempts to fetch those paths as `semantic-engine/structured-ai/...` returned `Not Found`; the separate consumer repository was intentionally not examined. The report therefore neither confirms nor rejects consumer parsing, project-ID derivation, or generation-based cache invalidation.

### P-02 — Gateway E2E verification is conditionally skipped without a build artifact

- **Status:** POTENTIAL/UNVERIFIED as a CI coverage limitation (not a product behavior claim)
- **Severity:** Low
- **Confidence:** High
- **Evidence:** `src/gateway/GatewayServer.test.ts:21-23`:

```ts
const PACKAGE_ROOT = path.join(__dirname, '..', '..');
const built = fs.existsSync(path.join(PACKAGE_ROOT, 'dist', 'cli', 'main.js'));
const describeIfBuilt = built ? describe : describe.skip;
```

The real-worker Gateway E2E suite is skipped whenever `dist/cli/main.js` is absent. No test command was run in this audit, so actual CI behavior was not inferred beyond this source guard.

## Positive controls observed (not findings)

- `ProjectRegistry.ts:174-217` canonicalizes roots, preserves IDs for repeated registration, persists registry state, and writes a manifest.
- `ProjectRegistry.ts:240-258` supports explicit relocation while preserving ID and rejecting a root clash.
- `ProjectRegistry.ts:393-413` writes registry JSON via temporary file plus rename.
- `ProjectIdentity.ts:128-131` makes IDs stable across repeated registration and distinct for distinct canonical roots.
- `GatewayServer.ts:255-293` separates Gateway administration from project proxying; `GatewayServer.ts:305-391` resolves project/worker before WebSocket upgrade and binds the socket to one worker.
- `WorkerSupervisor.ts:231-255` deduplicates concurrent starts and enforces worker capacity.
- `WorkerProcess.ts:173-201` launches a worker and waits for `/internal/ready`.
- `jobRoutes.ts:173-239` and `public/open.js:249-306` implement a real asynchronous indexing workflow.
- `SemanticEngineMcpServer.ts:100-179` reloads watched index/blueprint/manifest artifacts and tracks `indexGeneration`.
- `gatewayUi.test.ts:49-99` checks form/schema coverage and round-tripping of config values, although the browser save transport does not send that config (F-02).

## Files/areas not inspected or not executable in this audit

1. **453 of 524 in-scope blobs** were not selected for content retrieval; exact paths and sizes are in `tree-files.tsv`. They include most unrelated `src` modules, scripts, fixture files, grammar assets, and non-traced UI.
2. The initial full-fetch attempt timed out after 120 seconds and its subsequent local count command also timed out; the resulting local `work/repo` layout was inconsistent and was not used as authoritative evidence.
3. Some attempted bulk fetches failed with `Sandbox tool authentication token expired` / HTTP 401. No content from those failures is cited.
4. No tests were executed because the retrieved workspace had no `node_modules`; no claim of passing or failing runtime behavior is made. The report cites static source/test evidence only.
5. The separate `structured-ai` consumer repository was not inspected by design: the delegated scope was only `semantic-engine/`. Its absence from the in-scope tree leaves P-01 unverified rather than a confirmed defect.

## Finding index

| ID | status | severity | confidence |
|---|---|---|---|
| F-01 | CONFIRMED | Medium | High |
| F-02 | CONFIRMED | Medium | High |
| F-03 | CONFIRMED | Medium | High |
| F-04 | CONFIRMED | High | High |
| F-05 | CONFIRMED (qualified) | Medium | High |
| F-06 | CONFIRMED | Low–Medium | High |
| P-01 | POTENTIAL/UNVERIFIED | coverage only | High (unverified) |
| P-02 | POTENTIAL/UNVERIFIED | Low | High |

**Security findings:** intentionally omitted per scope instruction.
