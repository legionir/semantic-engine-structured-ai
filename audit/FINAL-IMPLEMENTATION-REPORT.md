# Final Implementation Report

## Scope

- `semantic-engine`
- `structured-ai`
- All reports/artifacts under `audit/`, plus docs and the shared integration surface.

Repository: `legionir/semantic-engine-structured-ai` · branch `main`.

This report is written against a **live sandbox run**, not against the status
labels in the prior reports. Per §4.1, no finding was accepted as "closed"
because a report said so — each was re-verified in code and, where testable, in
behavior.

---

## Initial Findings (before any change)

| Project | Command | Result |
|---|---|---|
| semantic-engine | `tsc -p ./` | clean |
| semantic-engine | `tsc -p tsconfig.test.json` | clean |
| semantic-engine | `jest --ci` (build+fixture) | **262/262 suites, 3339 pass, 0 fail** |
| structured-ai | `npm test` (59-suite chain) | **exit 1** |
| structured-ai | `test/web/web.test.js`, repeated | intermittent: `a denied approval stops the tool` failed 2-of-3 early runs; after the AI-01 fix, `delegation is reported as a tree` failed 2-of-6 (the AI-02 leak) |

Baseline note: the first run looked like 6 failed suites. Root cause of that was
a sandbox artifact: `test-fixture` (created by `pretest`/`npm run fixture`) was
missing, which also made the LSP integration suites fail (they spawn the LSP
with `cwd = test-fixture`; missing cwd surfaces as `ENOENT`). With the fixture
generated and `npm run build` run (10 suites are `describe.skip` without
`dist/`), semantic-engine is fully green. This is recorded so a future run does
not misread it as product failure.

## Prior-backlog verification (all re-checked in code)

Every item the 2026-10-06 / 2026-10-07 reports claimed as fixed was independently
confirmed present — not taken on trust:

F-0030 (LLM `AbortSignal.timeout` + `AbortSignal.any`), F-0010 (`allowedProjects`
in `AuthContext`/`PermissionChecker`), F-0011 (repo-wide admin-route scan), F-0009
(`/auth/verify` 429 + `Retry-After`), F-0012 (dead `IndexingWorker`/`InMemoryQueueAdapter`
deleted, `/ready` honest), F-0023 (IAM stubs return 501), F-0019 (co-churn
top-`N` bound), F-0029 (lone-CR byte normalize), F-0013 (`direction:'both'`
forward∪backward), F-0016 (monotonic severity), F-0018 (iterative Tarjan),
F-0021 (`PlatformConfig.embeddingModel` threaded, reports `null` honestly),
F-0022 (`query_index` absence test), F-0015 (OpenAPI code-only diff 0), F-0004
(documented accepted risk), F-0005 (`crypto.timingSafeEqual`), F-0003 (dead
imports removed), F-0036 (`get_dependencies` backward parity at symbol level).

No duplicate backlog items were created for these (they are genuinely closed).

---

## Resolved Issues (this session)

### AI-01 · P0 · Cross-run approval corruption in the web console

A run that finishes on the shared web console resolves every pending approval
in its `finally` block. That `finally` awaits the git-report drain first. In
that window the *previous* run had already published `done` on `/api/state`, so
the *next* test run started and surfaced its own approval — which the previous
run's global sweep then silently auto-denied before the operator could see it.
This is a real product bug, not the "known timing flake" prior reports deferred
out of scope. The AI's tool result reflected the corruption rather than a real
decision.

Fix: each pending approval now carries `ownerTurnId = state.currentTurnId` when
surfaced; the automatic end-of-run sweep resolves only the ending run's own
approvals. User-initiated `/api/cancel` and `/api/clear` intentionally keep their
global sweep. Terminal `run:status` now carries `turn_id`.

### AI-02 · P1 · `waitForRunEnd` accepted a stale run's terminal status

`/api/events` replays prior-run history on connect. `waitForRunEnd` matched *any*
terminal `run:status`, so tests asserting `tool:graph` / `run:loop` /
`delegation:start` intermittently asserted before the current run emitted
anything. Fix: the wait keys on the current run's `run:start` `turn_id` and
requires the terminal status to match; the delegation test's raw `done` predicate
was routed through the same helper. (This also explains the "random tail of
failures" prior reports described.)

### AI-03 · P1 · Six AI tools presented capped results as complete

`find_symbol`, `find_tests`, `get_config_usage`, `get_file_summary`,
`get_dependencies`, `get_git_hotspots` each `.slice(0, limit)` yet returned
`{ success: true, items }` with **no** truncation signal — the exact §16 failure
"no result exists" vs "no result was found". This was invisible to the green test
suite because the tools "execute successfully" — precisely the §13 gap the task's
central mission calls out. Fix: each now emits `metadata.truncated` plus a
truthful count, matching the convention already used by the Phase1/2/3/4 tools and
`impact_analysis`. Signals reach the AI via `structuredContent`.

---

## New Findings (planned, not executed this cycle)

- **P-04** `FINDING_INDEX.tsv` (159 rows) still says `fix_status="(assigned when
  fixed)"` for every row — never reconciled to actual code state. Documentation
  contradicts implementation (§31).
- **P-05** 17 `potential/unverified` ledger rows still lack a §7 root-cause pass;
  they are neither confirmed defects nor cleared false-positives.
- **P-06** Extend truncation honesty so every paged tool pairs `truncated` with a
  count, and lock the rule in output-contract tests (a follow-up to AI-03).
- **P-07** AI-oriented decision-quality tests for `impact_analysis`/`explain_symbol`
  (§24): assert required fields present and completeness *not* claimed when a
  budget cut a branch.

Details, acceptance criteria and dependencies in `audit/POST-AUDIT-PLAN.md`.

## Architecture Changes

None. All edits are additive/minimal at existing boundaries:
- `web/server/ServerImplementation.js`: stamp ownership on pending approvals;
  scope the automatic end-of-run sweep; add `turn_id` to the terminal status.
- 6 semantic-engine tools: add `metadata.truncated` (+ counts) to the return.
- 1 web test helper: key the run-end wait on `turn_id`.
No API/schema breaks, no rewrite, output contract extended only by new fields.

## Tests Added

- `semantic-engine/src/ai/tools/ToolTruncationHonesty.test.ts` — 7 cases: each of
  the six tools' truncation signal, plus the honest empty-scope case
  (`find_symbol` with 0 matches → `truncated:false, matchCount:0`, not a silent
  "no results"). (§30: bug fixed → regression test.)
- The web-console behavior is now covered by `web.test.js` running deterministically
  across repeated full-suite runs (previously it masked AI-01/AI-02 as a flake).

## Tests Executed / Results

- **semantic-engine** `jest --ci`: **263/263 suites, 3346 tests, 0 failed,
  2 skipped (exit 0)** — includes the new 7-case suite. (262 suites baseline +1.)
- **semantic-engine** `tsc -p ./` and `tsc -p tsconfig.test.json`: both clean.
- **semantic-engine** `eslint` on all changed files: exit 0.
- **structured-ai** `npm test` (full 59-suite chain): **exit 0**.
- **structured-ai** `web.test.js` × 6 consecutive: **28/28 every run** (was ~5/8 red).
- **structured-ai** adjacent regression checks (`events.contract`, `web.routes`,
  `project-concurrency`, `e2e`): green after the `turn_id` addition.

Known failures: **0 new.** The 2 skipped semantic-engine tests are pre-existing
environment-probed skips (honest skips — e.g. the orphan-reaper and `sqlite3`
native-dep gates — not silent greens).

## AI Context Quality Validation

Self-check as a consuming AI (§25) for the target tasks:
- "Find where a symbol is defined" / "Find all references" / "How many dependents
  are there": the six tools no longer let a partial page read as complete; the AI
  can see `truncated` + the real count and decide to raise the limit or narrow the
  query instead of stopping early.
- "Determine whether a result is complete": now explicitly machine-readable rather
  than something the AI must guess from list length.
- Web console: a denied approval now reflects the operator's actual decision, not
  a sweep from an unrelated finished run, so the tool result fed back to the model
  is truthful.

No output was shortened by dropping required data; correctness and completeness
were prioritized over brevity per §17/§42.

## Performance

No new benchmarks. The changes are O(1) additions: a per-approval field and a
`Map.get` in the (already existing) end-of-run loop, and one count on the
`GetGitHotspots` return path (where the double-scan the first draft introduced
was removed so the ranked list is computed once). Correctness was not traded for
performance (§29); nothing regressed.

## Documentation

- `audit/ACTIVE-ISSUES.md` — single source of truth: consolidated, deduplicated,
  re-verified backlog with per-issue status/priority/root-cause/acceptance criteria.
- `audit/POST-AUDIT-PLAN.md` — independent re-review execution plan.
- `test-fixture` was missing in this sandbox; documented above as a generation
  requirement, not a defect.

## Git

- **Branch:** `main`
- **Commits:** `f2443da` (structured-ai), `3f4ec37` (semantic-engine), `84960bc` (audit docs)
- **Push status:** `b3e299d..84960bc → origin/main` — verified `origin/main` ==
  local `HEAD`; `git status` clean.
- **Secrets:** scanned before commit; no `.env`/credential/token values were
  added. Only generated `test-fixture/`, `dist/`, `node_modules/` remain
  (all gitignored).

## Remaining Issues

Open (verified, tracked, not silently dropped): **3**
- P-04 FINDING_INDEX reconciliation (Medium)
- P-05 root-cause pass on 17 unverified rows (Medium)
- P-06 truncation-honesty rollout + contract lock (Medium)
Blocked/environment (visible, owner action): **1**
- AI-06 Kotlin/Swift grammars (no wasm toolchain here)
Deliberately deferred (protected by rationale, not re-opened): **5**
- `no-rust`, `no-go`, `no-cs`, `no-cpp`, `no-ns`

These are quality/housekeeping/coverage items. No **product-code** defect remains
open that this session can fix in-scope: every P0 and every actionable P1/P2 in
the reports is implemented, tested, and re-verified against a clean full-suite run.

## Final Assessment

The §26 criterion can be answered **yes**: with the truncation-honesty fix, an
AI reading these tools now knows when it is seeing a capped slice, so it makes
fewer wrong "that's everything" decisions without the engine dumping full context.
The cross-run approval fix removes a real state-corruption path where the surface
fed the model a decision the operator never made. Both classes were invisible to
a green suite — exactly the "tool runs ≠ semantic result correct" gap the
directive targets — and were found only by re-verifying behavior, not labels.

The remaining items are documentation/ledger reconciliation, a §7 investigation of
previously-unverified rows, and environment-blocked grammar support; none are
correctness defects in the current executable surface. Tests: semantic-engine
263/263, structured-ai exit 0, web suite deterministic across repeated runs.

---

# Cycle 2 (2026-10-07, later session): P-04 → P-07 executed

## Scope

All four planned post-audit items from `audit/POST-AUDIT-PLAN.md`, executed in
dependency order, each re-verified against current source + live runs (§4.1).

## P-06 — truncation-honesty rollout (remaining paged surfaces)

AI-03 fixed six tools; this cycle completed the surface so *every* capped result
is machine-readable as capped (§16/§25). Fixed + regression-locked in
`ToolTruncationHonesty.p06.test.ts` (11 cases) and documented as a contract in
`semantic-engine/docs/CONTRACTS.md` ("Truncation-honesty output contract"):

- `semantic_search` — `truncated` + `totalMatches` + `limit`; zero-match scope honest.
- `explain_symbol` — pre-slice `callsCount`/`calledByCount` + per-section
  `truncated{calls,calledBy,members,any,limit}` (three lists share one `limit`;
  a single flag would hide which was cut).
- `project_list_files`, `symbol_find` — exact `matchCount`; corrected the
  `length >= limit` anti-pattern so a *full-but-final* page no longer falsely
  claims truncation.
- `search_text`, `structural_search` — scan stops at the cap so the total is
  unknown: honest `matchCountAtLeast` + `countNote`, never a fabricated exact count.
- `symbol_references` — **separated slice from filter**: the old
  `references.length > selected.length` reported `truncated:true` even when only
  `minConfidence` dropped items. Now `truncated` (slice), `droppedByConfidence`,
  `totalReferenceCount` — so the AI knows whether to raise `limit` or lower
  confidence.
- `impact_analysis` — **separated the two independent ceilings**: traversal
  `maxNodes` (`traversalExhausted`) vs output `limit` (`droppedByLimit`,
  `candidateCount`). Previously only traversal exhaustion was reported, so a
  50-candidate set capped at 30 read as complete.
- `get_recent_changes` — `truncated`/`limit`/`examinedCommits`/`oldestExamined`
  declare the scan window; `since`-past-window is now stated, not silent;
  malformed `since` fails closed instead of being ignored; `isGitRepository` +
  `emptyNote` separate "not a repo" from "no commits" (the §16 distinction the
  existing test had accepted as a known limitation).

## P-07 — AI-oriented decision-quality validation (§24/§25)

`src/ai/tools/AiDecisionQuality.p07.test.ts` (8 cases) puts a consuming AI in
front of a known ground-truth fixture and asserts it can answer: where a symbol
is defined, who calls it (exact set, no false members, file-traceable), which
files a change hits, "a budget cut is never reported as complete", honest empty
scope, provenance traceability, cross-tool consistency (`get_dependencies` vs
`impact_analysis` agree), and `find_symbol` answer shape.

## P-05 — §7 root-cause pass on the 17 `potential/unverified` rows

Every row went through the full chain; dispositions + evidence in
`audit/findings/P05-ROOT-CAUSE-PASS.md`. 8 real defects fixed with regression
tests, 9 invalidated with evidence. Highlights (all previously mislabeled
"flake/deferred" or unknown):

- **SE-P-002** `makeEdgeId` folded `occurrence:0` with absent → the first edge
  of every group collided (the collision the field exists to prevent). Fixed to
  `occ:N`; the LSP path (hardcoded `occurrence:0` per range) now numbers
  occurrences. Golden snapshot re-hashed (call-edge ids only).
- **SE-P-004** LSP enrichment opened every file with one `languageId`
  (`.js` as `typescript`) — findings mis-scoped. Now per-document derivation.
- **SE-P-006** `budgetExhausted` only honoured the references ceiling; hitting
  call-hierarchy/hover exactly left a partial result claiming completeness.
- **SE-F-031** `CapabilityProbe.forget()` didn't invalidate in-flight probes —
  a stale probe re-populated the cache, so forget was a no-op. Now epoch-gated.
- **SE-F-032** push-waiter cleanup compared the wrong function, so timed-out
  listeners leaked per-uri forever. Fixed + leak assertion added.
- **SE-F-034** `parseTraceparent` accepted any ≥4-dash string; a malformed
  header became a "valid" trace id (§15). Full W3C validation now.
- **SE-F-036** scanner outer-error diagnostic had no file path (unattributable).

Real defect surfaced *while investigating* SE-P-008: the HTTP `/impact` path
passed `maxDepth` where the tool reads `depth` (requested depth silently
dropped to the default 2) and discarded the tool's truncation metadata — filed
and fixed as `SE-AI-19` with `CodeIntelligenceService.impact.p008.test.ts`, not
hidden inside P-008's (false) premise. Visualizer now shows `≥N total` on a
capped impact page.

## P-04 — audit-ledger reconciliation

`audit/tools/reconcile_ledger.py` updates `FINDING_INDEX.tsv` **only where this
pass produced code evidence** (§4.1). Result: 29 rows dispositioned
(18 `fixed — verified 2026-10-07`, 11 `invalid — not a defect`), 132 pre-existing
`confirmed/open` rows left honestly `open` (not individually verified this pass,
not silently closed). Two new rows filed (SE-AI-19, SE-AI-20). `ACTIVE-ISSUES.md`
and `POST-AUDIT-PLAN.md` updated to match; AI-05 marked RESOLVED, AI-04
PARTIALLY_RESOLVED with exact counts.

## Tests Executed / Results (cycle 2)

- **semantic-engine** `npm run build` + `tsc -p tsconfig.test.json`: clean.
  `jest --ci`: **267/267 suites, 3381 passed, 0 failed, 2 skipped (exit 0)** —
  4 new suites this cycle (263 → 267), 35 more tests (3346 → 3381).
- **semantic-engine** `eslint` on every changed/new file: exit 0.
- **structured-ai** `npm test` (59-suite chain): **exit 0**. Also fixed a
  genuine test-timing defect (a fixed 50ms sleep racing an async sidecar) by
  polling to terminal state — `test/mcp/semantic.test.js` now 14/14 across
  repeated standalone and contention runs.

## Architecture Changes

None. All edits additive at existing boundaries; the output contract is extended
only by new machine-readable fields (backward compatible — consumers unpack
`structuredContent` by key). No API break, no rewrite.

## Remaining Issues

Open product-code defects this cycle can fix: **0**.
- AI-04 ledger: 132 pre-existing `confirmed/open` rows await per-row
  verification in a future cycle (honestly labeled, not silently dropped).
- AI-06 Kotlin/Swift grammars: OPEN·BLOCKED (no wasm toolchain here).
- 5 deliberately deferred (no-rust/go/cs/cpp/ns): unchanged, protected by rationale.

## Final Assessment (cycle 2)

§26 remains YES and is now stronger: every capped surface declares its cap with
an honest count, slice-vs-filter and the two impact ceilings are separated so an
AI can decide "raise the limit / lower confidence / widen depth" instead of
guessing from list length, and the previously-unverified rows are resolved into
either fixed-with-regression or documented-invalidation — no ambiguity hidden in
the trust surface. Correctness/completeness were prioritized over brevity
throughout (§17/§42); nothing was shortened by dropping required data.
