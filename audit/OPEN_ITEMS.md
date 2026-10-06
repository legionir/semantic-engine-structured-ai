# OPEN ITEMS — consolidated remediation backlog
Source of truth: user-supplied STATUS REPORT (2026-10-06) reconciled against the
repo's `audit/FINDING_INDEX.tsv` ledger and `audit/REMEDIATION_PLAN.md`
references. All ✅ DONE items from Section 1 of the source report are removed.
Blocked and deliberately-deferred items are kept visible but marked
explicitly so no one re-litigates them.

Legend
- 🟥 P0 — security / correctness; must land before release.
- 🟧 P1 — correctness / resource safety / authz.
- 🟨 P2 — hygiene / contract / CI self-covering.
- 📋 ledger / filing / housekeeping (no product code).
- ⛔ BLOCKED — owner action or environment we do not have here.
- ⏸️ DEFERRED — intentional non-fix, protected by rationale.

---

## 1. In progress (finish the loop)

| # | id | Plan | Finding | Priority | Summary | Remaining AC |
|---|---|---|---|---|---|---|
| 1 | c4lock | C-4 | F-0026 (MED) | 🟥 P0 | Atomic ProjectLock heartbeat, no live-lock steal. | ✅ Closed 2026-10-06: split the stale `half-written lock` test into (a) *owner-alive → held* (AC-1) and (b) *owner-gone → recovered* (AC-2). Suite `ProjectLock.test.ts` green, 6/6. |

## 2. P1 — security / authz / resource safety

| # | id | Finding | Title | Acceptance criteria |
|---|---|---|---|---|
| 2 | c5llm | F-0030 (MED) | LLM `fetch` has no AbortSignal / timeout — hung provider stalls index/watch runs. | Add `AbortSignal.timeout()` (configurable) around embedding/chat fetches; cancellation must interrupt in-flight request, not only between requests; test asserts a stalled server times out. |
| 3 | c6a10 | F-0010 (MED) | `allowedProjects` unenforced on the platform path. | Carry `allowedProjects` into `AuthContext` + `PermissionChecker`; gateway and platform enforce the same set; regression test. |
| 4 | c6a11 | F-0011 (MED) | Destructive/admin routes fall through to `defaultPermission`. | Explicit least-privilege permission per admin route; add repo-wide scan assertion in tests that no destructive route uses default. |
| 5 | c6a9 | F-0009 (MED) | Public `POST /auth/verify` is an enumeration oracle. | Rate-limit (429) *or* retire the endpoint. Test proves oracle closed. |
| 6 | c7a12 | F-0012 (MED) | Orphaned `IndexingWorker` / `InMemoryQueueAdapter`; `/ready` advertises a dead `jobQueue`. | Delete the dead modules *or* wire them, and make `/ready` report honestly. |
| 7 | c7a23 | F-0023 (MED) | IAM `POST /users` `/roles` `/permissions` are no-op 201 stubs. | Persist or return 501 — no success without a side effect. |
| 8 | c7a19 | F-0019 (MED) | `record-commit` builds O(n²) co-churn with unbounded growth. | Cap payload length; bound the co-churn maps. |

## 3. P2 — hygiene + self-covering CI

| # | id | Finding | Title | Acceptance criteria |
|---|---|---|---|---|
| 9 | c8l4 | F-0002 (MED, 2nd half) | CI does not typecheck `*.test.ts`. | Add `tsconfig.test.json`; CI step runs `tsc -p tsconfig.test.json --noEmit`; a green build cannot hide a non-compiling test. |
| 10 | c8a29 | F-0029 (LOW) | lone-CR (>maxFileSize) hash parity in `FileProcessor`. | Streaming path must call `normalizeLineEndings` before hashing. |
| 11 | c8a13 | F-0013 (LOW) | `direction: 'both'` behaves as forward. | Implement the union or remove the option. |
| 12 | c8a16 | F-0016 (LOW) | Impact severity non-monotonic by depth (else-if clobber). | Fix the branch chain; property-test severity monotonicity. |
| 13 | c8a18 | F-0018 (LOW) | Recursive Tarjan stack-overflows on deep graphs. | Convert to iterative; add a 20k-chain regression test. |
| 14 | c8a21 | F-0021 (LOW) | `GET /config` hardcodes the `embedding.model` literal (`Qwen3-Embedding-0.6B` at `configRoutes.ts:25`). | ⏳ OPEN — the server is not handed the resolved embedding model: `PlatformConfig` has no embedding-model field (the real model lives in `EmbeddingProviderService`). Honest fix requires threading the configured model into `PlatformConfig` + `HttpServer` (a config-contract change), not a one-line edit. Left open deliberately rather than guess a value. |
| 15 | c8a22 | F-0022 (LOW) | Unwired `query_index` / `queryPolicy` dead module. | Delete the module *or* lock its absence with a test that fails if it reappears. |
| 16 | c8a5 | F-0005 (LOW) | `SecurityPipeline` token compare is not constant-time. | ✅ DONE 2026-10-06 — `crypto.timingSafeEqual` on equal-length buffers; length pre-checked; added `authenticate` regression suite (correct / same-length-wrong / shorter / empty). |
| 17 | c8a3 | F-0003 (LOW) | Dead imports/vars (`loadSqlite`, `wantsVectors`, `DEFAULT_IGNORE_DIRECTORIES`). | ✅ DONE 2026-10-06 — removed `loadSqlite` + its dead `SqliteModule`/`SqliteDatabase` types, unused `wantsVectors` destructure, unused `DEFAULT_IGNORE_DIRECTORIES` import, and a stale eslint-disable. eslint now reports 0 warnings, exit 0. |
| 18 | c8a15 | F-0015 (LOW) | 17 handler families undocumented in OpenAPI (BND-0006). | Bring the diff to zero code-only routes. |
| 19 | c8a4 | F-0004 (INFO) | Bootstrap-token RBAC bypass. | Either document as an accepted risk with owner sign-off, or close the bypass. |

## 4. Ledger / filing / housekeeping (no product code)

| # | id | Task |
|---|---|---|
| 20 | l1ids | File finding ids F-0031..F-0037 under `audit/findings/` so the ledger matches Section B / this-cycle fixes. |
| 21 | l2count | Reconcile finding counts across `STATE.md` (30) / `EXECUTIVE_SUMMARY.md` (29) / `FINAL_REPORT.md` (26). |
| 22 | unk2 | Record native-optional-dependency evidence from this environment (UNKNOWN-0002). |
| 23 | fragile | Refile timing-fragile `AssembleContextTool` SE-AI-18 test budget (currently on the 5 s edge under load). |
| 24 | prune | Prune orphan project data dirs (`fcc08d5f`, `prj-base-*`, `prj-se-b4`). |
| 25 | sec08file | File SE-SEC-08 (`fs/browse` leak, already fixed) and update F-0011-adjacent ledger rows. |
| 26 | lspeperm | Record `lspIsolation` EPERM temp-cleanup as environmental, not a product defect. |

## 5. Blocked (needs owner or environment — leave visible, do not silently close)

| # | id | Why blocked / required action |
|---|---|---|
| 27 | blocked-ci | F-0006 CI/Linux jest evidence — ✅ RESOLVED 2026-10-06: push of consolidated `main` triggered `semantic-engine CI (Linux full test suite)`; Node 20.x + 22.x both green. |
| 28 | blocked-ks | Kotlin / Swift grammar support: requires a tree-sitter wasm toolchain not available in this sandbox. |
| 29 | ff-main | fast-forward `main` → `work/reconcile-remote`: must overwrite `structured-ai/agent/mcp/McpManager.js` and `structured-ai/test/web/web.test.js`, both held dirty by another agent — awaiting owner decision. |
| 29b | sa-web-flake | `structured-ai/test/web/web.test.js`: 2–5 of 28 specs fail nondeterministically (`no tool:graph`, `no run:loop`, approval timeout). Red on `main` since before this session; documented as timing/teardown fragility in the file's own comments. Follow-up: split per-server or serialize runs. Out of this report's scope (report is semantic-engine). |

## 6. Deliberately deferred (protected by rationale — do not re-open)

| # | id | Rationale |
|---|---|---|
| 30 | no-rust | Rust `impl`-trait typeGraph edges: not invented; avoids false edges; honestly under-declared. |
| 31 | no-go | Go struct-embedding parents: no guessing; needs type-resolution beyond grammar fields. |
| 32 | no-cs | C# class-vs-interface split: deliberately not separated in this pass. |
| 33 | no-cpp | C++ structural extraction: protected to avoid regressions in existing completeness. |
| 34 | no-ns | C#/Swift namespace import resolution: out of current scope. |

## 7. Test failures observed and closed (2026-10-06)

| Suite | Symptom | Root cause | Fix |
|---|---|---|---|
| `src/host/packaging.test.ts` | `files` entry `dist/` missing | CI runs `npx jest --ci` without `npm run build`; `dist/` is a build artifact. Test already skips `dist/`-prefixed bin paths. | Skip `dist/` in the `files` existence assertion; comment why. |
| `src/export/SQLiteExporter.phase24.test.ts` | `sqlite3` fallback fails to load | `sqlite3` is an *optional* native dep; this env's glibc 2.35 predates the prebuilt binary's 2.38 requirement. Product already degrades to `node:sqlite` (SE-BUILD-10). | Introduce `canLoadSqlite3()` sync probe; `itIfSqlite3` skips the fallback case honestly. |
| `src/gateway/ProjectLock.test.ts` | `recovers from a half-written lock file` fails | F-0026 fix intentionally refuses to steal a torn lock whose raw pid is *alive*. Test was written pre-fix with `isProcessAlive: () => true` and still asserted the old (live-lock-steal) behavior. | Split into `never steals a half-written lock whose owner is still alive` (AC-1) + `recovers from a half-written lock file whose owner is gone` (AC-2). Matches F-0026 design and closes plan id `c4lock`. |
| `src/lsp/lspTesting.test.ts` | `گیت ۵ — orphan` fails on Linux | Sandbox PID 1 (`sandbox-runtime`) is not a real reaper: after `SIGKILL` on the parent, the pipe FD on the child's stdin stays open, so the fake LSP never sees EOF and lives on. On real `ubuntu-latest` CI (systemd/PID 1 with proper reaping) the gate is meaningful. | Add `environmentReapsOrphans()` sync probe; wrap gate in `describeIfReaper`. Same policy as the `lspIsolation` EPERM entry: honest skip when the environment cannot execute the gate, never a false green. |
| `src/cli/cli.test.ts` MIG-51 (`test:gate`, CI) | `written.symbols.length` 201 ≠ golden 200 | The golden was last recorded at `cf94a13`, before the tree-sitter structural-extraction commits (`f4f315b`, `5ba1fcd`). Same 58-file fixture now emits 201 symbols with new grammar fields (params/returnType/extends/implements) and TS `interface`/`namespace` correctly reclassified. The symbol commits never bumped the golden. | `scripts/snapshot.js --update`, diff reviewed by hand (files identical at 58; symbol set +1 namespace, class→interface reclass), committed as `e17c476`. `snapshot.js` compare re-run → `unchanged`, deterministic. |

### 7a. structured-ai `web.test.js` — pre-existing, out of this report's scope
The `Test` workflow also runs `structured-ai`. Its `web.test.js` fails 2–5 of 28
specs (`no tool:graph event was streamed`, `no run:loop event`, an approval
timeout), and the failing set **varies run-to-run** locally (23/28 … 26/28).
This is **not** caused by any change in this session: the same `Test` workflow
was already red on `main` at commit `1555613` (before branch consolidation) and
across the Sept history. Root cause is timing/teardown fragility in the shared
single-server SSE suite (documented in that file's own comments as a known
flake), not a product regression. Deferred as a separate follow-up; recorded
here honestly rather than masked. See item `sa-web-flake` in §5.

## 8. Blocked item closed by this session
- `blocked-ci` (F-0006 Linux jest evidence): the push of the consolidated `main`
  triggered `semantic-engine CI (Linux full test suite)` on Node 20.x **and**
  22.x. Both passed (`✓ Full Jest suite (Linux)`). The gate evidence the P0
  `[APPLIED]` ACs were waiting on now exists. After the MIG-51 golden fix the
  authoritative `semantic-engine CI` run is green end-to-end.

## 9. Execution order (priority)

Work items top-to-bottom. The four sandbox test failures above are already
closed; from here the plan-of-record is:

1. `c4lock` remaining verification → mark FIXED-VERIFIED. (already closed)
2. P1 cluster: `c5llm` → `c6a10` → `c6a11` → `c6a9` → `c7a12` → `c7a23` → `c7a19`.
3. P2 cluster in listed order.
4. Ledger / filing / housekeeping items.
5. Blocked items: hand back to owner with a status note.
