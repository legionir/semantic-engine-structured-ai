# Active Issues — single source of truth (verified 2026-10-07)

Supersedes `OPEN_ITEMS.md` (2026-10-06) and consolidates the 2026-10-07 remediation.
Every row was re-verified against **current source + a live sandbox run** — not
against prior "RESOLVED" labels (per §4.1: the label is not the proof).

## Summary (verified this session)

- semantic-engine: `tsc -p ./` = 0 · `tsc -p tsconfig.test.json --noEmit` = 0 · `jest --ci` green.
- structured-ai: `npm test` = exit 0.
- **2026-10-07 (second cycle):** P-04/P-05/P-06/P-07 from `POST-AUDIT-PLAN.md`
  executed — see AI-04/AI-05 below (now RESOLVED), `audit/findings/P05-ROOT-CAUSE-PASS.md`,
  and `audit/FINDING_INDEX.tsv` reconciled by `audit/tools/reconcile_ledger.py`.

## Counters

- Total tracked: 6 (AI-01…06)
- Critical: 0 · High: 0
- Medium: AI-05/P-06/P-07 RESOLVED this cycle; AI-04 PARTIALLY_RESOLVED (17
  unverified rows fully dispositioned; 132 pre-existing `confirmed/open` ledger
  rows remain for per-row verification in a future cycle)
- Low: AI-01/02/03 RESOLVED; AI-06 OPEN·BLOCKED (environment)

## Status legend (per §4)

- `RESOLVED` = re-verified fixed against current code + test.
- `OPEN` = still needs work.
- `PARTIALLY_RESOLVED` = fixed but a gap remains.
- `DUPLICATE` = same defect tracked under another id; kept once.
- `BLOCKED` = owner or environment needed; not silently closed.
- `DEFERRED` = intentional non-fix, protected by rationale.

---

## AI-01 — Cross-run approval corruption in the web console

- **Category:** Reliability · AI-context correctness
- **Status:** RESOLVED (verified 2026-10-07)
- **Priority:** P0
- **Source:** Live repro (`/tmp/repro-seq5.js`, denial landed *before* the run's own approval); `structured-ai-audit.md`, DECISIONS D-12 (per-project slots, not per-run ownership).
- **Symptom:** The test "a denied approval stops the tool" failed **deterministically 2-of-3**; when it "passed" it was a timing accident. In a failing run, a run on the shared web console finished, its `finally` block awaited `recordGitReport()`, and the *next* run's approval was silently auto-resolved with `approved=false` — the new run never had a chance to surface it.
- **Impact:** A finishing run's end-of-life sweep (`ServerImplementation.js` `startTask` finally) silently denied pending approvals belonging to a *different* run. This is state corruption: a real "approve/deny" decision an operator could still make was destroyed before they could see it, and the AI's tool result reflected the corruption instead of the user's intent.
- **Root cause:** The `for (const id of approvalStore.pendingKeys()) resolveApproval(id, false)` loop was unconditional. It executed after `await recordGitReport()`, which yields enough for a newer run to already have added its pending approval.
- **Change made:** Pending approvals now carry `ownerTurnId = state.currentTurnId` when surfaced (`onRequest` in the pending handler, `web/server/ServerImplementation.js:704-713`), and the end-of-run sweep resolves only approvals whose `ownerTurnId === turn_id` of the ending run (`:1328-1344`). Also emits `turn_id` on the terminal `run:status` (`:1341-1346`) so downstream consumers can correlate.
- **Acceptance criteria met:**
  - [x] `test('a denied approval stops the tool')` deterministic pass.
  - [x] `node test/web/web.test.js` × 6 consecutive → 28/28.
  - [x] `npm test` (full 59-suite chain) exit 0.
  - [x] Auto-clears from cancel/clear endpoints preserved (both iterate pendingKeys without owner filter and are still valid — they are user-initiated global sweeps).
- **Notes:** The `sa-web-flake` row in prior reports (`no tool:graph`, `no run:loop`, approval timeout) was the same root cause: leaked terminal `run:status` from the previous run prematurely satisfying `waitForRunEnd`. Now keyed by `turn_id`.

## AI-03b — truncation-honesty rollout to the remaining paged surfaces (P-06)

- **Category:** AI-context quality (§16, §24)
- **Status:** RESOLVED (2026-10-07)
- **Change made:** `semantic_search` (`truncated/totalMatches/limit`),
  `explain_symbol` (`callsCount/calledByCount/truncated{calls,calledBy,members,any,limit}`),
  `project_list_files` / `symbol_find` (`matchCount` + corrected slice flags —
  a full page no longer claims truncation), `search_text` / `structural_search`
  (`matchCountAtLeast` + honest `countNote` when the scan stops at the cap),
  `symbol_references` (slice-vs-confidence-filter now separated:
  `truncated`/`droppedByConfidence`/`totalReferenceCount`),
  `impact_analysis` (traversal-vs-page ceilings separated: `droppedByLimit`/
  `candidateCount`/`traversalExhausted`), `query_index` (verified honest),
  `get_recent_changes` (`truncated/limit/examinedCommits/oldestExamined/
  isGitRepository/emptyNote`; malformed `since` now fails closed instead of
  being silently ignored). Contract documented in
  `semantic-engine/docs/CONTRACTS.md` ("Truncation-honesty output contract")
  and locked by `ToolTruncationHonesty.p06.test.ts` (incl. a registry-driven
  "truncated is never count-less" guard).

## AI-05b — AI-oriented decision-quality validation for impact/explain (P-07)

- **Category:** §24/§25 testing gap
- **Status:** RESOLVED (2026-10-07)
- **Change made:** `src/ai/tools/AiDecisionQuality.p07.test.ts` runs eight
  consuming-AI tasks against a known ground-truth fixture: definition site,
  caller set (=ground truth, no false members), affected files, "budget cut is
  never reported as complete", honest empty scope, provenance traceability,
  cross-tool consistency (`get_dependencies` vs `impact_analysis`), and
  `find_symbol` answer shape.

---

## AI-02 — `waitForRunEnd` accepted a stale run's terminal status

- **Category:** Testing gap · AI-context correctness
- **Status:** RESOLVED (verified 2026-10-07)
- **Priority:** P1
- **Source:** Same repro as AI-01; `structured-ai/test/web/web.test.js` (its own comments called it a "known flake" and deferred it out of scope).
- **Symptom:** Tests asserting `tool:graph` / `run:loop` / `delegation:start` failed intermittently. Debug stream snapshot showed: `["snapshot","run:status","session:cleared"]` — i.e., the terminal `run:status` from the **previous** test arrived on the SSE connect replay before the current run emitted anything.
- **Root cause:** `/api/events` replays `state.events` (history of prior runs) on connect; the test's `waitForRunEnd` predicate matched **any** terminal `run:status`. Prior remediation deferred the whole class as "timing flake".
- **Change made:** `waitForRunEnd` now keys on the **last** `run:start`'s `turn_id` and requires the terminal `run:status` to match that same `turn_id` (`web.test.js:338-366`). The delegation test's inline `run:status==="done"` predicate was routed through `waitForRunEnd` for the same reason.
- **Acceptance criteria met:**
  - [x] No "known flake" left in web tests.
  - [x] Deterministic pass across six consecutive full runs.
- **Regression risk:** Low — the change is test-only and additive on the product side (added `turn_id`).

---

## AI-03 — Six AI tools present capped results as complete

- **Category:** AI-context quality (§15, §16 honesty about scope)
- **Status:** RESOLVED (verified 2026-10-07)
- **Priority:** P1 (this is the class of defect the task's central mission targets)
- **Affected tools:** `find_symbol`, `find_tests`, `get_config_usage`, `get_file_summary`, `get_dependencies`, `get_git_hotspots`.
- **Symptom:** Each tool `.slice(0, limit)` and returned `{ success: true, items }` with **no** truncation signal. An AI consuming them had no machine-readable way to distinguish "20 matches total" from "top 20 of 500 matches" — exactly the §16 failure "no result exists vs. no result was found". A codebase convention (`Phase1ReadTools`, `Phase2/3/4` tools, `impact_analysis`) already used `metadata.truncated`; these six were inconsistent omissions.
- **Change made:** Each tool now emits `metadata.truncated` plus a truthful count (`matchCount` / `publicSymbolCount` / `candidateCount` / `limit`). `GetFileSummaryTool` explicitly counts the *full* public-symbol set (not the 20-item slice). `GetDependenciesTool` reports `truncated` when the traversal exhausted the page (`results.length >= limit`). `GetGitHotspotsTool.format` receives the candidate count so it can flag truncation on the ranked slice.
- **Acceptance criteria met:**
  - [x] New regression suite `src/ai/tools/ToolTruncationHonesty.test.ts` — 7 cases covering each tool + empty-scope (`find_symbol` with no matches says `truncated: false, matchCount: 0`, not a silent "no results").
  - [x] All 44 existing `src/ai` suites + `src/services/history` still green (422 tests, 0 regressions).
  - [x] `tsc -p tsconfig.test.json --noEmit` = 0.
- **Traceability:** Signals reach the AI through `structuredContent` (`SemanticEngineMcpServer.ts:229-256`), already wired to unpack on the structured-ai side (`JsonRpcCodec.js`).

---

## AI-04 — Audit ledger (`FINDING_INDEX.tsv`) not reconciled with code state

- **Category:** Housekeeping / documentation (§4.1: "closed" must mean verified)
- **Status:** PARTIALLY_RESOLVED (2026-10-07 — `audit/tools/reconcile_ledger.py`)
- **What landed:** all 17 `potential/unverified` rows dispositioned with
  evidence (6 fixed + regression-locked, 11 invalidated — see
  `audit/findings/P05-ROOT-CAUSE-PASS.md`), plus 12 other evidence-backed rows
  marked `fixed`/`invalid` (incl. two new rows filed this pass: SE-AI-19,
  SE-AI-20). Ledger now reads 18 fixed / 11 invalid / 132 open. The remaining
  `confirmed / open` rows were NOT individually code-verified this
  pass; they stay `open — not verified fixed` (honest state, not silently
  closed). Re-run the script after each future fix to extend coverage.
- **Priority:** P2
- **Problem:** `FINDING_INDEX.tsv` has 159 confirmed/potential finding rows, every one of which still carries `fix_status = "(assigned when fixed)"`. The remediation series (`REMEDIATION_BACKLOG.md`, closed 2026-10-07) and this session's AI-01/02/03 fixes are **not** back-propagated into that ledger. A fresh reader treating the ledger as the current state would incorrectly conclude 159 defects remain open.
- **Impact:** Documentation contradicts implementation (§31 violated); a future AI/human audit could re-litigate already-fixed items, or worse, skip the ledger entirely and lose the confirmed-but-still-open items in it.
- **Root cause:** The remediation cycle used a separate alias numbering (bare `F-0001..F-0037`) tracked in `REMEDIATION_BACKLOG.md`/`audit/findings/`, while the ledger uses prefixed ids (`SE-F-0xx`, `SA-*`, …). No mapping step existed to close rows back into `FINDING_INDEX.tsv`.
- **Required change:**
  - [ ] For each `REMEDIATION_BACKLOG.md` closed item, update the corresponding `FINDING_INDEX.tsv` row's `fix_status` to `fixed — verified <date>` and reference the code commit.
  - [ ] For each AI-01/02/03 finding, file a row under its real prefixed id (`SA-REL-*`, `SE-AI-*`).
  - [ ] For each confirmed-but-not-yet-remediated row in the ledger, either move it into this file's active backlog (below) with a plan id or explicitly mark it `SUPERSEDED`/`DUPLICATE` with a reason.
- **Acceptance criteria:** `FINDING_INDEX.tsv` and this `ACTIVE-ISSUES.md` agree; a scripted diff between the two yields no unexplained divergence.

---

## AI-05 — 17 `potential/unverified` ledger rows still awaiting a root-cause pass

- **Category:** §7 "investigate root cause" obligation
- **Status:** RESOLVED (2026-10-07)
- **Outcome:** every one of the 17 rows went through the §7 chain against
  current source: **6 confirmed as real defects → fixed + regression-locked**
  (SE-P-002/003/004/006, SE-F-034/036) and **11 invalidated with
  evidence** (SE-P-001/005/007/008/009/010, SE-SEC-002/003, SE-PERF-002,
  SE-ARCH-003, SE-F-035). Two confirmed-status rows (SE-F-031/032) were also
  root-caused and fixed in the same pass. Full dispositions + evidence in
  `audit/findings/P05-ROOT-CAUSE-PASS.md`; the ledger rows themselves now
  carry `fixed — verified 2026-10-07` / `invalid — not a defect`.
- **Bonus real defect found during the pass** (P-008 investigation): the HTTP
  `/impact` path passed `maxDepth` where the tool reads `depth` (requested
  depth silently dropped to the default) and discarded the tool's truncation
  metadata — a capped impact page read as complete. Fixed in
  `CodeIntelligenceService.analyzeImpact` + visualizer cap note; regression:
  `src/services/CodeIntelligenceService.impact.p008.test.ts`.

---

## AI-06 — Kotlin / Swift grammar support still blocked (environment)

- **Category:** BLOCKED (§5 rule: leave visible)
- **Status:** OPEN · BLOCKED
- **Priority:** P2
- **Reason:** The sandbox has no tree-sitter wasm toolchain to compile/validate those grammars; no false claim of support is permitted. Owner action required, not a code change.
- **Acceptance criteria:** Either the toolchain is provided here and the grammars are wired + tested, or a documented owner decision marks the scope out-of-scope and closes the item.

---

## Deliberately deferred (from `REMEDIATION_BACKLOG.md` §5, unchanged, protected by rationale)

`no-rust` · `no-go` · `no-cs` · `no-cpp` · `no-ns`

## Duplicate / superseded (from prior reports, merged once here)

- `sa-web-flake` → root cause found and fixed as AI-01 / AI-02. Not a timing flake.
- `blocked-ci` (F-0006) → closed by `1e92bd1`/`ab69dd0`; CI green on Node 20.x + 22.x.
- The pasted bare-`F-00xx` remediation aliases → mapped to prefixed ids via `COUNT_RECONCILIATION.md`.
