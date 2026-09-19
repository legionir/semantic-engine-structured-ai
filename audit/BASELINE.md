# Baseline (Phase 1) — revision 94955bcb82326644bbc3bb36fbb998627d2594fe, branch main, Node v24.15.0 / npm 11.12.1, Windows 11

Status: see the plan log. The first full baseline was taken on `94955bc`; production edits (project PATCH/DELETE, config PATCH, indexProject) began while the semantic-engine jest run was still in progress in the same working tree, so that run (22 failed suites) may be partly contaminated by those edits (ts-jest compiles lazily). This is why the tip re-baseline in a clean worktree below is the reference.

## Evidence so far
| Command | Result |
|---|---|
| `semantic-engine: npx tsc -p ./` | OK (~28 s), `dist/` produced |
| `semantic-engine: npm test` (pretest fixture: 62 files written) | RUNNING when recorded. 59 suites finished, 12 FAIL: lsp/LspClient, gateway/lspIsolation, cli/serve-watch, cli/cli, lsp/LspServerManager, server/gatewayManagedSecurity, gateway/protocolMatrix.e2e, lsp/InteractiveOps, lsp/LspEnrichmentService.integration, lsp/WorkspaceEdit, gateway/multiProject.e2e, gateway/GatewayServer. Root cause of each: **Unknown / Requires Verification** (Windows/Node 24 environment vs real defect). |
| `structured-ai: npm test` | EXIT 1 at 8th of 9 tests in `test/tools/project-tools.test.js`: `terminal uses the project cwd...` -> "terminal_exec ran in the wrong directory". Likely `pwd` POSIX vs Windows realpath (**Unknown / Requires Verification**). Because scripts are chained with `&&`, later suites did NOT run. |

## Not yet done
- Per-suite full jest summary (Tests/Suites counts), skipped suites, `check-tests.js`, `check:audit`, contract validation.
- Run structured-ai suites individually (not chained) to get a complete pass/fail map.
- Node 20/22 comparison (only Node 24 available so far).

## Final baseline numbers (2026-09-19, Node v24.15.0, Windows 11)
- **semantic-engine `npm test` (jest, 1738 s):** Test Suites 22 failed / 186 passed / 208 total; Tests 66 failed / 2731 passed / 2797 total. Failing suites: `audit/baseline-semantic-engine-failing-suites.txt`.
- **structured-ai (each of 51 suites run separately, 120 s cap):** 37 exit 0, 14 non-zero (list in `audit/baseline-structured-ai-suites.tsv`). Two are timeouts/limits (`e2e/e2e` exit 124, `web/routes` exit 127 after 8/8 passed), rest are assertion failures.
- `node scripts/check-tests.js`: "the test run failed" (it re-runs jest; not independent evidence).
- `node scripts/check-audit-coverage.js`: fails, `AUDIT-2026-08.md` missing (known blocker from plan rule 12; file is absent from the repo).
- Root causes of the failing suites: **Unknown / Requires Verification** (Windows path/shell, Node 24, missing LSP servers, or real defects). None is attributed yet, so no failure may be counted as "fixed" or "pre-existing environment" without a per-suite check.

## Tip re-baseline (main @ d7569d3 + local changes), semantic-engine
Run in a clean worktree WITHOUT `dist/`: 16 failed / 9 skipped / 186 passed of 211 suites. The 9 skipped suites need `dist` (gateway e2e); several failures there (`GitPerformance`, `FileWatcher`, `packaging`) pass in the main worktree, so they are worktree artefacts, not defects.

### Regressions found by comparing the tip with the original baseline (both reproduced in the main worktree)
| Suite | Cause | Resolution |
|---|---|---|
| `graphs/LayeredGraph.test.ts` (4 tests) | Phase 4 parity work changed the default depth of shortest-path search from 8 to 2 (`GraphQueryEngine.shortestPath`, `SqliteGraphQuery`), so cross-layer paths returned `null`. | Fixed: `DEFAULT_GRAPH_PATH_DEPTH = 8`, shared by both engines. 190/190 tests in `src/graphs` + `src/export/sqlite` pass. |
| `server/platform.e2e.test.ts` (test 4) | Phase 5 (VIZ-036) makes the architecture fallback report `level:'file'`; the old test demanded `'architecture'`. Intended behaviour change. | Test updated to accept `architecture` or `file` and require `state:'ready'`. Suite passes. |

### Remaining failing suites in the full-checkout baseline (22) — triage
Evidence-backed environment causes (Windows): `ai/mcp/cli.security` (`EPERM` on temp dir permissions), `server/gatewayManagedSecurity` (`listen EACCES` on a Unix-socket path `*.sock`), `cli/commands/doctorDataRoot` and `lsp/LspClient` (5000 ms timeouts).
All others fail with assertion errors whose cause has NOT been established: **Unknown / Requires Verification** — `cli/cli`, `cli/commands/workerCommand`, `cli/serve-watch`, `core/config/DataRootResolver`, `core/config/migration.e2e`, `gateway/GatewayServer`, `gateway/McpProxy`, `gateway/WorkerSupervisor`, `gateway/lspIsolation`, `gateway/multiProject.e2e`, `gateway/protocolMatrix.e2e`, `gateway/webSocketProxy`, `lsp/InteractiveOps`, `lsp/LspEnrichmentService.integration`, `lsp/LspServerManager`, `lsp/WorkspaceEdit`, `lsp/readiness`, `lsp/typescriptServer`. Each must be resolved (fixed or documented with an approved exception) in Phase 9; none may be counted as passing.

## Authoritative Linux CI evidence (GitHub Actions, ubuntu-latest)
| Run | Revision | Result |
|---|---|---|
| 35402288223 | `94955bc` (pristine, before any change in this session) | semantic-engine (Node 20) `test:gate` FAILED; structured-ai Node 20 success; structured-ai Node 18 `npm test` FAILED (`TypeError: client.close is not a function`) |
| 35406782380 | `d7569d3` (branch phases 4/5/6-step-1 + this session's PATCH/DELETE) | semantic-engine Node 20.20.2: 7 suites / 40 tests failed; structured-ai Node 20 success; Node 18 failed |

Consequences:
1. **The 14 structured-ai failures seen locally are Windows-only.** The same suites pass on Linux Node 20. They are not defects; they still need Windows-independent fixtures only if Windows is a supported platform (**Unknown / Requires Verification** — product decision).
2. **Real defect, confirmed:** on Node 20 the SQLite suites (`SQLiteExporter`, `SqliteGraphQuery`, `درایور SQLite`, `SE-EXP-07/08/09`) fail because `node:sqlite` needs Node >= 22.5 and `sqlite3` is **not declared** in `package.json`/`package-lock.json` (it exists only in the local `node_modules`). This is exactly plan Phase 2 / step 5. Locally the Node 20 run passes only because the undeclared `sqlite3` happens to be installed.
3. The `LayeredGraph` (3 tests) and `platform.e2e` LoD failures on d7569d3 were regressions of the branch's phase 4/5 work; both are fixed in this session (see above).
4. Still failing on CI, cause **Unknown / Requires Verification**: `MIG-51 — --artifact-location in-root` (`cli` suite); structured-ai Node 18 `client.close is not a function` (package `engines` says `>=18`).

## Node compatibility matrix (semantic-engine subset: core, server, services, graphs, export, dependencies, incremental — 76 suites)
| Node | Suites failed | Tests failed | Failing suites |
|---|---|---|---|
| 24.15.0 | see full-run above | | |
| 22.12.0 (local) | 3 / 76 | 11 / 716 | `core/config/DataRootResolver`, `core/config/migration.e2e`, `server/gatewayManagedSecurity` |
| 20.18.0 (local) | 3 / 76 | 11 / 716 | same three |
The three are Windows-only assumptions, proven by the assertions: POSIX paths such as `/home/u/...` become `\home\u\...` / `I:\...`, `chmod` mode `0o700` reads back as `0o666`, and Unix-socket `listen` fails with `EACCES`. They pass on Linux CI. The local Node 20/22 runs cannot reproduce the CI SQLite failure because `sqlite3` is installed locally (point 2 above).

## Other commands
- `node scripts/check-audit-coverage.js`: fails, `AUDIT-2026-08.md` does not exist (known blocker, plan rule 12). Decision required in Phase 9 (restore the file or change the checker).
- `node scripts/check-tests.js`: re-runs jest and reports "the test run failed"; not independent evidence.
- Fixtures/artifacts: `test-fixture/node_modules/left-pad` present; 7 tree-sitter WASM grammars present; `dist/` built with `tsc -p ./` (28 s).
