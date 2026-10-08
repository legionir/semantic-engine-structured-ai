# POST-AUDIT PLAN — new findings from independent re-review (2026-10-07, extended 2026-10-08)

Per §19–20, this plan assumes the prior reports were **not** complete and
re-reads the current implementation independently, focusing on the task's
central mission: semantic-engine output must not mislead an AI (§13–16, §25).

Executed this session (verified, committed):

| ID | Title | Severity | Category | Status |
|----|-------|----------|----------|--------|
| P-01 | Web console silently auto-denied a newer run's pending approval (cross-run state corruption) | High | RELIABILITY / INTEGRATION | FIXED + regression-locked |
| P-02 | `waitForRunEnd` matched a leaked terminal `run:status` from the previous run | Medium | TESTING_GAP / AI_CONTEXT | FIXED |
| P-03 | Six AI tools return capped result sets with no truncation signal | High | AI_CONTEXT_QUALITY / DATA_QUALITY | FIXED + regression-locked (`ToolTruncationHonesty.test.ts`) |

Planned next (dependency-ordered):

| ID | Title | Severity | Category | Depends on | Status |
|----|-------|----------|----------|------------|--------|
| P-04 | Reconcile `FINDING_INDEX.tsv` fix_status with real code state | Medium | HOUSEKEEPING / DOCUMENTATION | none | **PARTIALLY DONE 2026-10-07** — `audit/tools/reconcile_ledger.py` updated 27 rows (17 `fixed`, 10 `invalid`) with evidence; the remaining 132 `confirmed/open` rows were NOT individually verified this pass and stay honestly `open` pending per-row work |
| P-05 | Root-cause pass on 17 `potential/unverified` ledger rows | Medium | §7 investigation | P-04 | **DONE 2026-10-07** — 8 fixed+locked, 9 invalidated with evidence (`audit/findings/P05-ROOT-CAUSE-PASS.md`); found + fixed an extra real defect (HTTP `/impact` depth/truncation) |
| P-06 | Extend truncation honesty to remaining `limit`-bearing tools + document the output contract | Medium | AI_CONTEXT_QUALITY | P-03 | **DONE 2026-10-07** — semantic_search/explain_symbol/project_list_files/symbol_find/search_text/structural_search/symbol_references/impact_analysis/get_recent_changes; contract in `docs/CONTRACTS.md`; locked by `ToolTruncationHonesty.p06.test.ts` |
| P-07 | Audit AI-oriented decision quality for `impact_analysis` / `explain_symbol` completeness claims (§24) | Medium | TESTING_GAP | P-03, P-06 | **DONE 2026-10-07** — `AiDecisionQuality.p07.test.ts` (8 consuming-AI tasks vs known ground truth) |

## Cycle 4 (2026-10-08) — independent re-review findings, executed

§19 re-read of the CURRENT implementation (assuming prior reports incomplete),
focused on the central mission (§13–16, §25). Every row was verified against
live code before it was touched.

| ID | Title | Severity | Category | Status |
|----|-------|----------|----------|--------|
| P-08 | §4.1 caught the prior claim itself: bare `npx jest` silently skips 10 dist-gated suites while `check-tests.js` printed "all suites ran" | P1 | AI_CONTEXT_QUALITY / TESTING_GAP | FIXED — gate bounds skips via `test-skip-budget.json`; globalSetup prints an honest dist-skip notice (SE-F-049 / AI-16) |
| P-09 | `code_rename` renamed the FIRST textual match, not the designated range; `applied:true` was asserted even when nothing was written | P1 | AI_CONTEXT_QUALITY / DATA_QUALITY | FIXED + 3 regressions (SA-F-004 / AI-15) |
| P-10 | Job `POST …/cancel` ignored project binding — cross-project cancellation + `200 cancelled:false` for unknown jobs | P1 | RELIABILITY / INTEGRITY | FIXED + regression (SE-API-001 / AI-17) |
| P-11 | Dashboard project switch kept the previous project's id/visualizer link after a failed switch | P2 | AI_CONTEXT_QUALITY / RELIABILITY | FIXED + structural regression (SE-UI-001 / AI-21) |
| P-12 | Source Sync validation failures answered HTTP 500, mislabeling "your request was invalid" as "the server broke" | P2 | API_CONTRACT / ERROR_HANDLING | FIXED + regression (SE-API-002 / AI-18) |
| P-13 | Graduated context compression lost the immutable original (`original_chars` + fields degraded on escalation) | P2 | AI_CONTEXT_QUALITY / COMPLETENESS | FIXED without leaking the pristine copy to the wire (§17); regression (SA-F-002 / AI-19) |
| P-14 | Visualizer fabricated a per-node "✓ Covered by …test.ts" with no coverage field and no lookup | P2 | AI_CONTEXT_QUALITY (invented evidence) | FIXED (honest "not known", safe DOM); regression (SA-F-006) |
| P-15 | `core/types` barrel did not export Blueprint types (declared public surface incomplete) | P2 | API_CONTRACT | FIXED + regression (SE-F-009 / AI-20) |
| P-16 | `run-pipeline.js` indexed a NON-EXISTENT workspace to an empty index with exit 0 (§16: "no result exists" ≠ "no result found"); async `dispose()` was called without await in `finally` | P2 | RELIABILITY / ERROR_HANDLING | FIXED (pre-dist existence check + awaited guarded dispose); 2 regressions `runPipelineHonesty.test.ts` (SE-PIPE-001) |

New findings recorded but NOT fixed this cycle (left visible, §12/§42):

| ID | Title | Severity | Why not fixed now |
|----|-------|----------|-------------------|
| P-17 | `openProject()` overlay reads the process workspace's `.agent/project.json` as the floor layer for every project — cross-project settings contamination (SA-F-007) | MEDIUM | A partial fix was attempted and REVERTED: the current behavior is asserted by a documented contract ("without a modular project, behavior is bit-for-bit unchanged") and by `project-stores.test.js`; relocating the floor is a contract change + test rework, not a contained patch. Stays OPEN with rationale. |
| P-18 | Gateway `save()` posts only `{path,name,id,autoStart}`; 31 of 35 worker-config form fields never reach the server, and no per-project WorkerConfig persistence surface exists (SE-F-057) | MEDIUM | Create-only semantics are honest today (SE-F-040 locked that), but making Edit work requires a per-project config persistence + PATCH contract (a feature, not a defect patch). Kept visible; no guessed fix. |

## P-03 — Why this is the highest-value class

The task's Definition of Done (§41) and §25 make this the core measure: "can an
AI take the *right* decision from this output alone?" A capped list that does
not say it is capped fails exactly this test — the AI either stops searching too
early (misses a reference/dependency) or over-trusts a partial view. P-01/P-02
were correctness bugs; **P-03 is the AI-context bug the whole directive is
aimed at**, and it was present in six tools simultaneously and invisible to the
green test suite. It is why "tool executes successfully" ≠ "semantic result
correct" (§13).

## P-06 detail

`P-03` fixed the six tools that returned *no* `metadata` at all. There remain
tools whose truncation flag is set but whose total count is not exposed (e.g.
they report `truncated: true` but not `matchCount`). For an AI to decide
"raise the limit or narrow the query", the honest total (or at least
"more than N exist") matters. This item makes `truncated` consistently
accompanied by a count across every paged tool and records the rule in the
output-contract tests so it cannot silently regress.

## P-07 detail

§24 asks for tests that validate the *semantic representation*, not just code
paths. Existing tests assert `truncated === false` on small fixtures. This item
adds AI-oriented validation: for a fixture with a known call-graph, assert that
`impact_analysis` / `explain_symbol` (a) include all required fields, (b) do not
claim completeness when a budget cut a branch, (c) keep symbol/dependency
provenance traceable. Ties directly to the §26 final criterion.

## Out of scope for this cycle (recorded, not hidden)

- Background-run approval cleanup is a pre-existing limitation (DECISIONS D-12):
  background slots do not run the terminal approval sweep. P-01 preserves this
  behavior (only the automatic foreground sweep was scoped to its own run).
  Expanding it requires per-run turn bookkeeping for background slots; left
  visible, not silently "fixed" with a guess.
