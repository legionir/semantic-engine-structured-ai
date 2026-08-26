# ADR — Multi-Project Gateway, per-project Workers, external data directory

**Status:** accepted (فاز ۱–۴ of `MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md`)
**Date:** 2026-08-26
**Source of requirements:** [`MULTI_PROJECT_GATEWAY_PLAN.md`](../../../MULTI_PROJECT_GATEWAY_PLAN.md)
**Executable plan (order, contracts, acceptance):** [`MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md`](../../../MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md)

This record exists so the next implementer does not re-derive the decisions
from scratch, and so a decision that changes later changes *here* first.

---

## 1. The target shape

```text
Browser / AI client
        │
        ▼
Semantic Gateway :4000          ← the only public port
        │
        ├── Worker project A    ← one process, one workspace, one index
        ├── Worker project B
        └── Worker project C
```

A Worker stays single-project: one `workspaceRoot`, one project index, one
blueprint, one SQLite database, one vector index, one watcher, one MCP/REST
runtime. The Gateway orchestrates; it does not analyse code.

---

## 2. Decisions

### D1 — one platform-aware data root, no doubled directory

| platform | default data root |
|---|---|
| Linux / other POSIX | `$XDG_DATA_HOME/semantic-engine`, else `~/.local/share/semantic-engine` |
| macOS | `~/Library/Application Support/SemanticEngine` |
| Windows | `%LOCALAPPDATA%\SemanticEngine` |

Override: `SEMANTIC_ENGINE_DATA_DIR` (or config `semanticEngine.dataDir`).
Created with mode `0700`.

The reference plan wrote `{{USER_DATA}}/.semantic-engine/` in one section and
`$XDG_DATA_HOME/semantic-engine` in another; composed literally that yields
`~/.local/share/semantic-engine/.semantic-engine/…`. **The platform directory
name is the only nesting**; there is no `.semantic-engine` under it.
Implemented in `src/core/config/DataRootResolver.ts`.

A relative `XDG_DATA_HOME` is ignored (the spec calls it invalid) rather than
joined onto the cwd.

### D2 — configuration arrives through the existing schema

`semanticEngine.dataDir` and `semanticEngine.artifactLocation`
(`in-root` | `external`, default `in-root` until فاز ۴) are declared in
`contracts/config.schema.json`. Because `envVarNameFor`
(`src/host/Config.ts:105-110`) maps `semanticEngine.dataDir` to
`SEMANTIC_ENGINE_DATA_DIR`, no second hand-rolled environment variable exists.
`src/host/configSchemaSync.test.ts` keeps schema and code in sync.

Note: the schema uses `["string","null"]` with `default: null` for `dataDir`,
matching `semanticEngine.treeSitter.grammarDir`, instead of the empty string
the plan text mentioned.

### D3 — project id: `prj-<slug(name)>-<sha256(canonicalRoot)[0:8]>`

Identical to the algorithm already shipped by the consumer
(`structured-ai/agent/projects/ProjectRegistry.js:61`, e.g.
`prj-engine-core-3fa9c1d2`), so engine and consumer agree without a
translation table. The reference plan's `prj-<uuid>` is **replaced**, not
supplemented. Implemented in `src/core/config/ProjectIdentity.ts`.

Why not `basename`: `ProjectService.registerProject` used
`prj-${basename(root)}`, so `/tmp/client-a/app` and `/tmp/client-b/app` both
became `prj-app` and the second registration silently replaced the first
(measured: `listProjects().length === 1`).

An id is computed once at registration and persisted. Renaming changes the
display name only; moving is an explicit `relocate` (فاز ۲).

### D4 — the registry owns identity; the canonical root is the unique key

`<dataRoot>/registry.json` is authoritative for Worker/Gateway routing.
Registering a root that is already registered returns the existing record
instead of creating a second one. An externally supplied id is adopted
verbatim so structured-ai can keep the ids it already stored.

Implemented in `src/core/config/ProjectRegistry.ts`
(atomic `registry.json`, corrupt files quarantined as
`registry.json.corrupt-<ts>` instead of crashing, per-project
`<dataRoot>/projects/<id>/manifest.json`).

**Which ids are acceptable (refined in فاز ۲).** The generated form is
`prj-…`, but ids already in the wild are freer: `serve` registers the
workspace as `current` and `<basename>` (`serve-command.ts:171-173`) and
`HttpServer.test.ts:173` expects `sample-app` to survive. Three validators
therefore exist in `ProjectIdentity.ts`:

| validator | charset | used for |
|---|---|---|
| `isValidProjectId` | `^prj-[a-z0-9][a-z0-9-]{0,63}$` | ids the engine generates |
| `isSafeProjectId` | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, no `..` | lookup keys / aliases |
| `isPathSafeProjectId` | same, lowercase only | ids that become a **directory name** |

Lowercase is required for directory names because macOS and Windows are
case-insensitive: two ids differing only in case would collide on disk.

**Aliases.** Every id a project has ever been registered under resolves
through `ProjectService.getProject`, but `listProjects()` (and therefore
`GET /api/v1/projects`) returns each project **once**. That is an intentional
behaviour change: `serve` used to produce three rows for one workspace.

**Not yet done:** `ProjectService` does not hydrate itself from the registry
at startup; a fresh process starts empty and the Gateway loads projects in
فاز ۹. Re-registering a known root still yields the persisted id.

### D5 — Worker transport

Loopback TCP on a Gateway-allocated ephemeral port plus an internal worker
token is the default. A Unix domain socket is supported only after
`SecurityPipeline` understands it (فاز ۶). `SO_REUSEPORT` across workers is
forbidden: routing must stay deterministic.

### D6 — Origin policy behind the Gateway

Today `SecurityPipeline.checkOrigin` (`src/server/SecurityPipeline.ts:165-193`)
and `HttpGuard` (`src/cli/HttpGuard.ts:120-124`) reject any non-loopback
`Origin` with 403, and `checkConnection` (`:89-105`) rejects a Unix-socket
request outright because `req.socket.remoteAddress` is `undefined`. Both are
correct for a standalone local server and both break a proxied one, so:

- the Gateway strips the inbound `Origin` and sets `X-Forwarded-For/Proto/Host`;
- a Worker in `--gateway-managed` mode trusts the Gateway **only** when the
  internal worker token is valid;
- standalone behaviour (loopback + Origin check) is unchanged.

### D7 — API namespace

Workers keep `/api/v1/projects/:id/…` unchanged. Gateway administration lives
under `/api/v1/gateway/*`. `/api/v1/projects/:projectId/…` is proxied to the
owning worker **without path rewriting**. The Gateway itself answers
`GET/POST /api/v1/projects` with the same response shape as
`src/server/routes/projectRoutes.ts:12-52` so `public/open.js:195` keeps
working untouched.

### D8 — `indexGeneration`

A monotonic counter persisted in `<artifactRoot>/project-artifacts.manifest.json`,
incremented on every successful index/blueprint/SQLite write, published
additively as `structuredContent: { projectId, indexGeneration }` on MCP
results. The consumer already reads it
(`structured-ai/agent/mcp/SemanticClient.js:251-262`) and invalidates its
cache when it changes; the engine emits nothing today.

### D9 — WebSocket is implemented (owner decision, 2026-08-26)

There is no WebSocket in the codebase now: no `upgrade` listener, no `/ws`
route, no `ws` dependency, and `WebSocketManager`
(`src/server/WebSocketManager.ts:20-43`) writes SSE frames into an
`http.ServerResponse`. فاز ۱۱ adds a minimal RFC 6455 server (handshake with
`Sec-WebSocket-Accept`, text/ping/pong/close frames) without a new dependency,
plus a Gateway upgrade proxy that resolves the project *before* upgrading.

### D10 — backward compatibility

`--out` (absolute or relative) and `SEMANTIC_ENGINE_ARTIFACT_LOCATION=in-root`
remain supported for the whole project. The default flips in فاز ۴ together
with every consumer that guesses the artifact path. Removing either is a
separate decision.

### D11 — a managed Worker is genuinely single-project

In `--gateway-managed` mode the worker's own registry routes
(`POST /api/v1/projects`) are closed, any `rootPath`/`path` arriving in a
request that differs from the registered workspace is rejected, and
`/api/v1/fs/browse` (`src/server/routes/fsRoutes.ts:61-122`, which today lists
any path) is confined to the workspace subtree.

---

## 3. Contracts introduced in فاز ۱

```ts
// src/core/config/DataRootResolver.ts
resolveDataRoot(options?: DataRootOptions): string;   // pure
platformDataRoot(options?: DataRootOptions): string;
ensureDataRoot(options?: DataRootOptions): string;    // creates 0700, verifies writable

// src/core/config/ProjectIdentity.ts
canonicalizeRoot(rootPath: string): string;           // realpath, textual fallback
assertProjectRoot(rootPath: string): string;          // throws: missing / not a directory
projectIdFor(name: string, canonicalRoot: string): string;
isValidProjectId(id: unknown): boolean;
assertProjectId(id: string): string;                  // id is a directory name — validated first

// src/core/config/ProjectPaths.ts
resolveProjectPaths(options: ResolveProjectPathsOptions): ProjectPaths;
artifactRootFor(options: ResolveProjectPathsOptions): string;

// src/core/config/migrateLegacyArtifacts.ts (فاز ۳)
migrateLegacyArtifacts(options): MigrationResult;   // copy, never delete

// src/cli/projectPathsFromArgs.ts (فاز ۳)
projectPathsFromArgs(args, workspaceRoot, env?): ProjectPaths;
indexLookupFromArgs(args, workspaceRoot, env?): IndexLookupOptions;
artifactLocationFromArgs(args, env?): ArtifactLocation;

// src/core/config/ProjectRegistry.ts (فاز ۲)
class ProjectRegistry {
  register(input: RegisterProjectInput): ProjectRecord;   // duplicate root → existing record
  get(idOrAlias: string): ProjectRecord | undefined;
  getByRoot(rootPath: string): ProjectRecord | undefined;
  list(): ProjectRecord[];
  rename(id, name): ProjectRecord;                        // id never changes
  relocate(id, newRoot): ProjectRecord;                   // explicit only; refuses a claimed root
  remove(id): boolean;
  touch(id): ProjectRecord | undefined;
  writeManifest(record): string;                          // data root only
}
```

`ProjectPaths` separates the two kinds of path on purpose:

| field | meaning |
|---|---|
| `workspaceRoot` | source; read-only for the engine |
| `artifactRoot` | everything generated: index, blueprint, SQLite, manifest |
| `lockDir`, `logDir` | `locks/`, `logs/` under `artifactRoot` |

Rules that follow from this and are enforced by tests:

1. No caller re-derives an artifact path; `resolveProjectPaths` is the only
   source. A hand-written `path.join(root, '.semantic-engine')` is a bug.
2. `projectId` is validated before it is ever joined into a path, so
   `prj-../evil` is an error rather than an escape.
3. While `in-root` is the default, `resolveProjectPaths(...).indexPath ===
   canonicalIndexPath(root)` — the new API is a superset, not a change.

---

## 4. Endpoint map (targets; implemented in later phases)

| surface | route | phase |
|---|---|---|
| Worker internal | `GET /internal/health`, `/internal/ready`, `/internal/metrics`, `/internal/status`, `POST /internal/reindex`, `/internal/reload`, `/internal/shutdown` | ۷ |
| Worker public (unchanged) | `GET /health`, `/ready`, `/metrics`; `/api/v1/projects/:id/…` | — |
| Worker MCP | `POST /mcp` (guarded by `HttpGuard`) | — |
| Gateway admin | `GET/POST /api/v1/gateway/projects`, `GET/PATCH/DELETE /api/v1/gateway/projects/:projectId`, `POST …/start|stop|restart|reindex`, `GET /api/v1/gateway/health|ready|metrics|events` | ۹ |
| Gateway proxy | `/api/v1/projects/:projectId/…`, `GET /api/v1/projects/:projectId/events` (SSE) | ۹ |
| Gateway MCP | `POST /mcp/:projectId` → worker `/mcp` | ۱۰ |
| Gateway WebSocket | `/ws/projects/:projectId` (resolved before upgrade) | ۱۱ |

---

## 5. Artifact resolution and migration (فاز ۳)

**Resolution order** — identical for `index`, `watch`, `serve`, `ui`, `start`,
`query` and the standalone MCP entry point, all through
`src/cli/projectPathsFromArgs.ts`:

```text
--out (explicit, absolute or relative to the root)
  > --data-dir / SEMANTIC_ENGINE_DATA_DIR
  > platform default (D1)
```

The *location* comes from `--artifact-location` or
`SEMANTIC_ENGINE_ARTIFACT_LOCATION`; the default is still `in-root`, so nothing
changes until فاز ۴ flips it. A project id is `--project-id` when given and
path-safe, otherwise `projectIdFor(basename, canonicalRoot)` — deterministic,
so repeated runs land in the same directory.

**Read order** in `external` mode: the data directory first, then the three
in-root legacy locations as readable fallbacks
(`indexPathCandidates(workspaceRoot, lookup)`).

**Migration** (`migrateLegacyArtifacts`) copies `project-index.json`,
`blueprint.json`, `project-index.sqlite` and `project-artifacts.manifest.json`
from the first existing legacy directory into the artifact root and writes
`migration.json`:

```json
{
  "schemaVersion": 1,
  "migratedFrom": "/repo/app/.agent/semantic",
  "migratedAt": "2026-08-26T12:00:00.000Z",
  "migrationMode": "copy-readonly-legacy",
  "files": ["project-index.json", "blueprint.json"]
}
```

Legacy files are **never deleted**. A legacy index that fails to parse returns
`corrupt-legacy` instead of throwing, so one broken checkout cannot stop the
server; the project simply stays `stale`/`missing`.

**Process state** — job queue state and telemetry spans used to be written to
`<projectsRoot>/.agent/` (two such files are committed in this repository).
They now live in `<dataRoot>/runtime/` (`jobs.json`, `telemetry/spans.json`),
and when no `dataRoot` is configured nothing is persisted at all. Per-project
`locks/`, `logs/`, `events/` and `snapshots/` live under the artifact root.

**Gate** — `scripts/check-artifact-location.js` (wired into `npm run
test:gate`) fails when any non-test source file builds a path from the literal
`'.semantic-engine'` outside the allowlist
(`core/config/ProjectPaths.ts`, `core/config/defaultIgnorePatterns.ts`,
`services/source/SourceSyncService.ts`). Only the exact directory name counts,
so `doctor`'s temporary `.semantic-engine-doctor-<pid>` write probe is not
flagged.

## 6. The default flipped in فاز ۴

`semanticEngine.artifactLocation` now defaults to **`external`**: a fresh
`semantic-engine index --root <repo>` writes nothing into `<repo>`. `in-root`
remains a supported mode (`--artifact-location in-root` /
`SEMANTIC_ENGINE_ARTIFACT_LOCATION=in-root`) and `--out` overrides both.

The consumer side of the contract lives in
`structured-ai/agent/mcp/enginePaths.js` (data home + `projectIdFor` mirror),
used by `agent/mcp/semantic.js`; `SEMANTIC_ENGINE_DATA_DIR` is a declared
setting there. Three tests hold the two packages together:

| test | what it pins |
|---|---|
| `structured-ai/test/mcp/engine-paths.test.js` | data home per platform, id derivation, read order, `checkStaleness` on both locations |
| `semantic-engine/src/core/config/structuredAiContract.test.ts` | the engine and the consumer compute identical data homes, slugs and ids |
| `semantic-engine/src/cli/commands/artifactLocationExternal.test.ts` | the real CLI writes only under the data root |

Container: `SEMANTIC_ENGINE_DATA_DIR=/data` in
`semantic-engine/Dockerfile` and `structured-ai/docker-compose.yml`, with a
named volume mounted at `/data` — the compose service runs `read_only: true`,
so without the volume the default data directory would not be writable.

**Test hygiene.** Tests must not write into a developer's home. Two jest hooks
are required, because `process.env` inside a jest sandbox is a *copy* and never
reaches `child_process`: `globalSetup`
(`src/test/globalSetupDataDir.ts`) sets the temporary data root in the real
process environment so spawned CLI children inherit it, and `setupFiles`
(`src/test/setupDataDir.ts`) covers in-sandbox resolution.

## 7. Worker configuration and embedding providers (فاز ۵)

`src/gateway/types.ts` defines `ProjectWorkerConfig`: project identity,
`indexing`, `watchOptions`, `service`, `security` and `embedding`.
`WorkerConfigSchema.ts` supplies the defaults, the equivalent JSON Schema (used
for server-side validation and, in فاز ۱۲, to generate the UI form) and
`validateWorkerConfig`, which returns **every** problem at once.

Rules worth knowing:

- a `projectId` must be usable as a directory name;
- `dataDir` and `socketPath` must not live inside the checkout;
- `debounceMs` must be an integer in `[25, 60000]`;
- a gateway-managed worker must not allow remote connections and must name the
  environment variable holding its internal token;
- **a secret is not a field**: passing `token` or `apiKey` in a config is a
  validation error, and `redactWorkerConfig` projects onto known fields so a
  future field cannot leak into a log or a manifest by accident.

`workerArgv(config)` is the only place that turns a config into process
arguments. It is deterministic, whitelisted, contains no shell
metacharacters in its flags, and carries no secret — not even the token's
variable name, which the supervisor sets in the child's environment instead
(فاز ۶). `commandPreview` renders the same vector for display only.

**Embedding** now has one decision point, `vector/createEmbeddingGenerator`,
shared by `server/routes/jobRoutes.ts` and the CLI flags
(`--embedding-provider|-model|-base-url|-api-key-env|-normalize`). `local` is
deterministic hashing with no native dependency; `ollama` and
`openai-compatible` require a base URL and a model and fail loudly otherwise.
An API key is read from the environment variable *named* by
`--embedding-api-key-env`, at the last moment, and never appears on a command
line, in `--json` output, or in a log. Asking for a provider implies
`--vectors`.

## 8. Verified baseline (2026-08-26)

`cd semantic-engine && npm run build && npm run lint && npm test` →
`tsc -p ./` exit 0, `eslint src` silent, `Test Suites: 170 passed / 170 total`,
`Tests: 2483 passed / 2483 total`.

Running `npx jest` without `npm run build` fails only
`src/host/packaging.test.ts`, which asserts that every entry in
`package.json:files` exists — `dist/` is a gitignored build output. The
supported command is `npm test` (its `pretest` regenerates the fixture);
`npx jest` alone also breaks the scanner suites for the same reason.
