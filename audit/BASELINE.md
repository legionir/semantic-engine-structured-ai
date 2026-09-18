# Baseline (Phase 1) — revision 94955bcb82326644bbc3bb36fbb998627d2594fe, branch main, Node v24.15.0 / npm 11.12.1, Windows 11

Status: IN PROGRESS (🟡). No production code changed.

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
