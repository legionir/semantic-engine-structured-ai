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

**Phase 0: 🔴 BLOCKED** — but the blocker has moved from *missing environment* to *named,
measured gaps*. Thresholds above are untouched; nothing in this table was re-measured or
adjusted.

Evidence now exists (see `phase0-executed-evidence-2026-09-21.md`):

| Criterion | Evidence class | State |
|---|---|---|
| Determinism excluding stats | LOCALLY VERIFIED | 🟢 executed (`IncrementalParity.phase0.test.ts`) |
| Semantic incremental == full | LOCALLY VERIFIED | 🟢 executed (same suite; two defects found and fixed) |
| Read security tests | LOCALLY VERIFIED | 🟢 executed (`ReadBoundary.phase0.test.ts`, `fileProvider.test.ts`); port not yet wired into MCP/HTTP |
| MCP text/structured parity | MCP VERIFIED | 🟢 executed (`mcpIndexGeneration.test.ts`, `McpReadOnlyLifecycle.phase0.test.ts`) |
| Atomic publication | LOCALLY VERIFIED | 🟡 **SE-P0-PUB-01**: the index/manifest pair is not atomic |
| Build + full suite | LOCALLY VERIFIED | 🟢 `npm run build` exit 0; `npm test` 3013 passed / 5 failed / 3018 |
| Audit coverage gate (`npm run check:audit`) | — | 🔴 cannot run: `AUDIT-2026-08.md`, `EXECUTION-PLAN.md`, `GRAPH-INTELLIGENCE-GAPS.md` are absent from this snapshot |
| apply→undo fuzz (Phase 2) | — | ⛔ no implementation exists in this revision |
| Gateway/worker lifecycle | GATEWAY VERIFIED | 🟢 existing suites (worker supervisor, worker CLI, project lock, protocol matrix) |

Remaining blockers: SE-P0-PUB-01, the four pre-existing red tests (SE-P0-GRAPH-01 ×3,
SE-P0-API-01 ×1), the compatibility/traceability/adopt-vs-build documents, and the ten 🟡 rows
of `phase0-test-coverage-matrix.md`. No Phase 1–4 work is authorized.
