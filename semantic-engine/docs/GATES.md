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

**Phase 0: 🔴 BLOCKED** — executable checkout/dependencies and required runtime evidence are unavailable. No Phase 1–4 work is authorized.
