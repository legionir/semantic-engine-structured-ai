# Shared invariants (Phase 1 / step 4)

Contracts both `semantic-engine` and `structured-ai` must honour. "Enforced by" names the executable test that
pins the invariant today. Anything marked **Unknown / Requires Verification** is not proven in code or tests yet and
names the plan phase that must verify it before another phase may depend on it.

| # | Invariant | Enforced by | Status |
|---|---|---|---|
| 1 | Project identity is `(projectId, workspaceRoot)`. Two roots with the same directory name get different ids; one root always gets the same id. | `semantic-engine/src/core/contracts/sharedContracts.test.ts` (identity) | verified (semantic-engine) |
| 2 | Ids that could escape the data root (`..`, separators, leading dot, empty) are refused; a missing root is refused. | same file | verified (semantic-engine) |
| 3 | Artifact roots of two projects never overlap. | same file | verified (semantic-engine) |
| 4 | Ownership: an id/alias resolves only to its owning project; removing one project never touches another. | same file (ownership); `ProjectService.test.ts` | verified (semantic-engine) |
| 5 | Context propagation: a run/child run uses the root of the project it was started for. | `structured-ai/test/runs/*`, `test/tools/project-tools.test.js` | **Unknown / Requires Verification** on the current tip; 1 of 9 in `project-tools.test.js` fails on Windows (`terminal_exec` cwd). Enforced in Phase 6. |
| 6 | Cancellation is sticky and idempotent; `dispose()` never fakes a cancel; a linked token follows its parent. | `sharedContracts.test.ts` (cancellation) | verified (semantic-engine `CancellationTokenSource`) |
| 7 | Every run ends in exactly one terminal state (completed / failed / cancelled) and errors emit `run:error`. | — | **Unknown / Requires Verification**; audit findings REL-013/017/018 say this is not true yet. Enforced in Phase 7. |
| 8 | Graph traversal defaults (`depth`, `path depth`, `direction`, `maxNodes`, `minConfidence`) are one shared set; invalid options throw, `0` is a real value. | `sharedContracts.test.ts` (graph); `graphs/*.test.ts`, `SqliteGraphQuery.phase4.test.ts` | verified (semantic-engine) |
| 9 | Graph node/edge/provenance/level values are drawn from a closed enum. | `core/types/schemaSync.test.ts` (presence/optionality only) | partial — value/enum checks are added in Phase 9 (audit F-06) |
| 10 | Search mode / threshold: `vector`, `keyword`, `hybrid` are distinct and `minScore` is applied. | `SearchService` tests from Phase 4 | **Unknown / Requires Verification** on the current tip; re-run in Phase 9 |
| 11 | Config mutation: a PATCH either changes runtime state or is rejected; `0` is never turned into a default. | `server/configRoutes.test.ts` | verified (semantic-engine) |
| 12 | Persistence atomicity: a crash mid-write keeps the previous valid file. | registry writes via `save()`; structured-ai `PlanRepository`/session save are direct `writeFileSync` | partial — structured-ai side open (Phase 2 step 3) |
| 13 | API error format: every 4xx/5xx body is JSON with a non-empty string `error`. | `sharedContracts.test.ts` (API error format) | verified for the routes exercised; the full route set is checked in Phase 5/10 |

Shared defaults live in `semantic-engine/src/graphs/GraphQueryEngine.ts` (`DEFAULT_GRAPH_*`). The SQLite engine imports
them, so the two engines cannot drift. Path search deliberately uses `DEFAULT_GRAPH_PATH_DEPTH` (8), not the
neighbourhood depth (2): using 2 broke `LayeredGraph` cross-layer paths after the Phase 4 parity work.
