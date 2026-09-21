# Phase 3 — Semantic Graph Pilot

## Scope

This patch implements one bounded TypeScript pilot, additively over `ProjectIndexReader`:

- relative TypeScript import extraction;
- deterministic module resolution for indexed `.ts/.tsx/.js` files;
- `exact`, `ambiguous`, and `unresolved` resolution states;
- provenance via `import-graph` and candidate lists;
- `symbol_references` query;
- bounded semantic dependency inspection;
- snapshot identity inherited from the existing Phase 1 platform;
- explicit `buildIncremental(previous, changedPaths)` contract with safe full-rebuild fallback (no stale partial graph);
- experimental registry gating (`experimental['semantic-graph'] === true`).

## Files

- `src/core/codeintel/Phase3SemanticGraph.ts`
- `src/ai/tools/Phase3SemanticTools.ts`
- `src/core/codeintel/Phase3SemanticGraph.test.ts`
- `src/ai/tools/Phase3SemanticTools.test.ts`
- `src/ai/AiToolRegistry.ts` (conditional additive registration)

## Safety and boundaries

- Default registry behavior does not expose Phase 3 tools.
- A configured `workspaceRoot` is required.
- Source content remains `untrusted-source-content`.
- No files are written and no mutation path is introduced.
- Unresolved imports are retained in graph output; they are not silently dropped.
- Name-only matching is not labeled `exact`; the pilot only labels a unique import-to-export mapping `exact`.

## Evidence status

- Code: `IMPLEMENTED`
- Focused tests: `WRITTEN / NOT EXECUTED`
- Build/typecheck/lint: `NOT VERIFIED`
- MCP/Gateway: `NOT VERIFIED`
- Full/incremental producer parity: `NOT VERIFIED` (incremental method is a conservative full-rebuild fallback, not dirty-propagation optimization)
- LSP provider: `NOT IMPLEMENTED` (optional and degraded by design)
- Precision/recall/calibration: `NOT MEASURED`
- Persistence migration/rollback: `NOT IMPLEMENTED IN THIS PILOT`

This document is not a Phase 3 gate approval. The implementation remains experimental until the gold fixture, incremental/full equality, MCP execution, and precision threshold are executed and evidenced.

## Gate closure 2026-09-21 — 🔴 BLOCKED / REMAINS EXPERIMENTAL

Validation on `c2c7396` (+ gate-closure fixes): exact precision 1.0 ≥ 0.95 on
the gold micro-fixture, incremental==full, ambiguity/unresolved retention, MCP
e2e, experimental gating, and real-index execution all evidenced. Blocking
gaps: G-3.1/G-3.5 (no persisted graph store or migration — stateless by
design, owner decision required), G-3.7 (recall vs B0/B1, calibration, and
adopted-tool comparison unmeasured; no Spike-S), G-3.9 (adopt-vs-build
decision missing). Per the plan the pilot stays experimental-gated.
Full report: `docs/validation/gate-closure-2026-09-21.md`.
