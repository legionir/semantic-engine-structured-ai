# P-05 — §7 root-cause pass on the 17 `potential/unverified` ledger rows (2026-10-07)

Per `ACTIVE-ISSUES.md` AI-05 / `POST-AUDIT-PLAN.md` P-05: every row flagged
`potential/unverified` got the full chain
(Symptom → Observed Behavior → Root Cause → Affected Components → Required
Change → Validation) against the **current** source. No guess-patches; each
disposition carries file:line or test evidence. `FINDING_INDEX.tsv` was
reconciled by `audit/tools/reconcile_ledger.py` (rows updated only where this
pass produced evidence).

## CONFIRMED — real defects, fixed with regression tests

Of the 17 `potential/unverified` rows, **6 were confirmed real defects and
fixed**: SE-P-002, SE-P-003, SE-P-004, SE-P-006, SE-F-034, SE-F-036. Two
`confirmed`-status rows inspected alongside them were also fixed: SE-F-031
(probe forget) and SE-F-032 (push-waiter leak). The **11 remaining unverified
rows were invalidated with evidence**; where invalidation surfaced a *different*
real defect nearby (SE-P-008 → the `/impact` depth+truncation bug), that defect
was fixed and filed as its own ledger row (`SE-AI-19`) rather than hidden inside
the unrelated row's disposition.

| Row | Root cause (verified) | Fix + validation |
|---|---|---|
| SE-P-002 | `makeEdgeId` folded `occurrence: 0` into the same encoding as an absent occurrence (`identity.occurrence ? String(occ) : ''`); `CallGraphBuilder.occurrenceOf` counts from 0, so the first edge of every group collided with a no-occurrence identity — the exact collision the field exists to prevent. | `occ:N` explicit encoding (`EdgeProvenance.ts`), plus the LSP path (which hardcoded `occurrence: 0` for every `fromRanges`) now numbers occurrences per identity (`LspEnrichmentService.ts`). Golden snapshot regenerated (only call-edge ids changed — the intended rehash). Tests: `P05RootCauseRegressions.test.ts`, `LspEnrichmentService.test.ts` (`--dup-ranges` probe). |
| SE-P-003 | `toAbortSignal()` dropped the `Disposable`, so on a token that never cancels, the controller-closure listener stays registered on the long-lived source. | Listener disposes itself after first fire (`Cancellation.ts`). `Cancellation.test.ts` + full `src/host` suites green. |
| SE-P-004 | Real half-confirmed defect: `enrich` took ONE `input.languageId ?? 'typescript'` and used it for **every** `didOpen`. Opening `.js` as `typescript` changes tsgo's checking mode (checkJs semantics) — findings were mis-scoped. One server per family is fine; one languageId per *document* was not. | Per-document derivation `languageIdFor(file.path)` (ts/tsx/js/mjs/cjs/jsx). Test: `LspEnrichmentService.test.ts` — mixed ts/js fixture asserts each didOpen languageId via the fake server's `closedWithLanguage` probe. |
| SE-P-006 | `budgetExhausted` was set only by wall-clock and the *references* ceiling; hitting `maxCallHierarchyQueries`/`maxHoverQueries` exactly left the flag false — a partial result claimed completeness (§16). | Both ceilings now set the flag (hover: only when its budget is non-zero, preserving the deliberate default-off). Tests: two new cases in `LspEnrichmentService.test.ts`. |
| SE-F-031 | `CapabilityProbe.forget()` cleared only the cache; an in-flight probe kept its promise in `inFlight` and **re-populated the cache when it finished**, making forget a no-op for racing callers. | Global epoch bumped by every forget; stale in-flight results no longer write to cache and inFlight entries are dropped. Test: `CapabilityProbe.test.ts` (forget mid-probe). |
| SE-F-032 | `waitForPush` timeout called `removeWaiter(uri, resolve)` but the map stores the `waiter` closure — the comparison never matched, so timed-out listeners accumulated per uri forever and a later push fired all of them. | `removeWaiter` now receives and removes the exact `waiter`. Test: `DiagnosticsProvider.test.ts` — two timed-out waits leave `pushWaiters` empty. |
| SE-F-034 | `parseTraceparent` accepted any ≥4-dash string; a malformed header became a "valid" trace id propagated as real provenance (§15). | Full W3C validation (hex, lengths, version, all-zero rejection). Tests: `P05RootCauseRegressions.test.ts`. |
| SE-F-036 | The scanner's outer error branch emitted a path-less diagnostic ("Could not process file: …") while the skip branch named the file — unattributable warnings. | Message now includes the file path. `P05RootCauseRegressions.test.ts` + existing SE-SCAN-08 suite. |

## CONFIRMED-FALSE / NOT-A-DEFECT — documented invalidation

| Row | Why it is not a defect (evidence) |
|---|---|
| SE-P-001 | Upstream `IndexPipeline.resolveImport` populates `resolvedFileId` for every import it can place, and the builder's fallback branch is honestly tagged `basis:'unresolved'`; `resolveImportPath()` is simply an unused helper API. No real behavior loses an edge that resolution could have found. |
| SE-P-005 | Per-request timeouts (`requestTimeoutMs`) bound every LSP call independently; the wall-clock deadline governs the *work window*, not each in-flight round-trip. Bounded overshoot by design — and the budget is documented as such in the LSP-17 comments. |
| SE-P-007 | Premise mis-attributes the claim: `gatewayUi.test.ts` covers the console form/schema contract; visualizer endpoints are covered by server route tests. No untested payload hole found in this pass. |
| SE-P-008 | Both tabs have backends: `/impact` (codeRoutes + analysisRoutes) and `/history/hotspots` (historyRoutes). The `visualization/dependencies` base URL is the graph backdrop, not a missing backend. Additionally this pass found and fixed a **real** defect nearby (`maxDepth`→`depth` mapping + truncation transparency, `CodeIntelligenceService.impact.p008.test.ts`). |
| SE-P-009 | Consumer-side integration is exercised end-to-end (`structured-ai/test/mcp/semantic.test.js`, `gateway.integration.test.js`) — re-run green this session. "Unverified" described the September audit environment, not a live gap. |
| SE-P-010 | The gateway e2e skip is an honest, environment-probed skip (needs `dist/`). Skipping when un-runnable is the required behavior (§34) — and the CI chain now builds before running. |
| SE-SEC-002 | Every throw site in `RemoteEmbeddingGenerator` was read: messages interpolate status/statusText/url/cardinality only — never the Authorization value or apiKey. No leak path exists. |
| SE-SEC-003 | The key is used solely as a bearer header value; there is no concatenated request/SQL/shell path in the module. No injection surface. |
| SE-PERF-002 | Premise false: cost is dominated by the O(n·d) cosine scan which runs for every chunk regardless of `topK`; the sort tail is secondary, and `usearch` is the documented backend for the large-n regime. |
| SE-ARCH-003 | The lazy in-method `require` deliberately breaks a real CommonJS cycle (`SubgraphExplorer` imports `GraphQueryEngine` back); a static import re-introduces the half-constructed-module failure the comment records. |
| SE-F-035 | Skip-vs-error is the contract: a `FileProcessor` read failure is recorded as a skip (with a path-bearing diagnostic via `onSkip`) and stays out of `errorCount`, which counts thrown processing errors. Both counters are reported distinctly — conflating them would be the bug. |

## Final disposition (matches `FINDING_INDEX.tsv`)

Of the 17 `potential/unverified` rows: **6 fixed** (SE-P-002/003/004/006,
SE-F-034/036) and **11 invalidated with evidence** — none left in limbo. Two
`confirmed`-status rows inspected alongside (SE-F-031, SE-F-032) were also
root-caused and fixed. SE-P-008's premise was false (backends exist); the
genuinely defective `/impact` HTTP path it exposed is fixed and filed as a new
row `SE-AI-19`. The P-06 truncation-honesty rollout is filed as `SE-AI-20`.
Ledger total updated: 18 rows `fixed`, 11 `invalid`, 132 still `open` (these
were never claimed fixed — they await per-row verification in a future cycle).
