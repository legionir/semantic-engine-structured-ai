# Phase 0–4 Gates

**Revision:** `d1289aec99987065657c6ad824c900c7a7b36dc5` plan baseline
**Date locked:** 2026-09-21
**Owner:** Pouya Rahimi / project owner

Thresholds below are starting values from Appendix B. They are locked before measurement; changing one requires a dated entry in `DECISIONS.md` with reason, owner, scope and review date.

| Phase | Metric | Starting threshold | Blocking |
|---|---|---:|:---:|
| 1 | Fold L2 median token reduction for files >200 lines | ≥60% | Yes |
| 1 | Unfold correctness for all symbols | 100% | Yes |
| 1 | Determinism excluding stats | 100% | Yes |
| 1 | Read security tests | 100% | Yes |
| 1 | MCP text/structured parity | 100% | Yes |
| 1 | Warm vs cold outline | ≥5× | No |
| 2 | apply→undo fuzz | ≥1000 cycles, 100% byte equality | Yes |
| 2 | Crash-injection recovery | 100% | Yes |
| 2 | ast-grep Range conversion | 100% | Yes |
| 2 | Rejection of validator outside allowlist | 100% | Yes |
| 3 | Exact-class precision on gold fixture | ≥0.95 | Yes |
| 3 | Semantic incremental == full | 100% | Yes |
| 3 | Unresolved registration without silent deletion | 100% | Yes |
| 3 | Recall vs baseline | ≥B1 and >B0 | Yes |
| 4 | context_build recall@budget | ≥B1 and >B0 | Yes |
| 4 | No budget overrun | 100% | Yes |

## Gate semantics

- **🟢 ACCEPTED:** all blocking criteria have the required evidence level.
- **🟡 CONDITIONAL:** all blocking criteria pass; only explicitly owned, dated, non-blocking gaps remain.
- **🔴 BLOCKED:** any blocking criterion fails or lacks evidence.

Required evidence: data/functional metrics require `LOCALLY VERIFIED`; tool paths require `MCP VERIFIED`; lifecycle/worker paths require `GATEWAY VERIFIED`. A static type, schema, test file, README, or prompt is not evidence of completion.

## Current gate

**Phase 0: 🟡 CONDITIONAL** (updated 2026-09-21, continuation) — every executable check in
this repository now passes: `npm run test:gate` exits **0** with **222/222 suites and
3040/3040 tests**, `npm run build` and `npx eslint src` exit 0. The four pre-existing red
tests are root-caused and fixed (D-0010…D-0012); the artifact-integrity gate is wired on all
serve paths (D-0013). Thresholds above are untouched; nothing in this table was re-measured or
adjusted beyond what the cited suites execute.

What remains is, by the definitions above, **owned and dated, non-blocking**:

1. `check:audit` — unsatisfiable in-repo; its three input documents have never been committed
   here and must come from the owner (D-0015);
2. true set-atomic publication — a generation-directory layout migration deferred by decision
   (D-0014); the crash window is meanwhile fail-closed at every serve path, and that is
   executed, not claimed;
3. snapshot/handle runtime wiring — the reference `InMemorySnapshotStore` is LOCALLY tested;
   permanent-store + MCP exposure stays a named gap (matrix row 13);
4. apply→undo fuzz — NOT APPLICABLE until the feature exists (D-0015).

Evidence now exists (see `phase0-executed-evidence-2026-09-21.md`):

| Criterion | Evidence class | State |
|---|---|---|
| Determinism excluding stats | LOCALLY VERIFIED | 🟢 executed (`IncrementalParity.phase0.test.ts`) |
| Semantic incremental == full | LOCALLY VERIFIED | 🟢 executed (same suite; two defects found and fixed) |
| Read security tests | LOCALLY VERIFIED | 🟢 executed (`ReadBoundary.phase0.test.ts`, `fileProvider.test.ts`); port not yet wired into MCP/HTTP |
| MCP text/structured parity | MCP VERIFIED | 🟢 executed (`mcpIndexGeneration.test.ts`, `McpReadOnlyLifecycle.phase0.test.ts`) |
| Artifact consumption integrity | LOCALLY VERIFIED + MCP VERIFIED | 🟢 fail-closed on HTTP, MCP and CLI (`artifactManifest.test.ts`, `McpArtifactIntegrity.phase0.test.ts`); pair-level layout atomicity deferred (D-0014) |
| Build + full suite | LOCALLY VERIFIED | 🟢 `npm run build` exit 0; **`npm run test:gate` exit 0 — 222/222 suites, 3040/3040 tests** |
| Audit coverage gate (`npm run check:audit`) | — | 🔴 cannot run in-repo: the three input documents were never committed here; script now names the gap instead of ENOENT (D-0015); owner input required |
| apply→undo fuzz (Phase 2) | — | ⛔ no implementation exists in this revision |
| Gateway/worker lifecycle | GATEWAY VERIFIED | 🟢 existing suites (worker supervisor, worker CLI, project lock, protocol matrix) |

Named non-blocking gaps: the ten 🟡 rows of `phase0-test-coverage-matrix.md` (3, 4, 5, 7,
10, 13, 17, 18, 23, 24) each carry their missing half explicitly. The blocking items listed
earlier on this page (SE-P0-PUB-01 consumption, the four pre-existing red tests, the
0.8–0.10 documents) are closed. **Phase 1 may begin** under the precondition that the four
owner-level items in the verdict stay tracked and that the 🟡 rows' missing halves join the
Phase 1 backlog rather than being forgotten.
