# ADR — Multi-Project Gateway, per-project Workers, external data directory

**Status:** accepted (فاز ۱ of `MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md`)
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
instead of creating a second one. An externally supplied id matching
`^prj-[a-z0-9][a-z0-9-]{0,63}$` is adopted verbatim so structured-ai can keep
the ids it already stored.

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

## 5. Verified baseline (2026-08-26)

`cd semantic-engine && npm run build && npm run lint && npm test` →
`tsc -p ./` exit 0, `eslint src` silent, `Test Suites: 170 passed / 170 total`,
`Tests: 2483 passed / 2483 total`.

Running `npx jest` without `npm run build` fails only
`src/host/packaging.test.ts`, which asserts that every entry in
`package.json:files` exists — `dist/` is a gitignored build output. The
supported command is `npm test` (its `pretest` regenerates the fixture);
`npx jest` alone also breaks the scanner suites for the same reason.
