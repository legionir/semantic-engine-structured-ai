# Cycle 4 — Per-row verification of the open ledger (started 2026-10-08)

§4.1 discipline: every disposition below was re-derived from the CURRENT
checkout (code read this session) or a live run — never from a prior label.

## Baseline (live, this session)

- fresh install; `npm test` (pretest fixture, NO build): 257 suites pass,
  **10 suites silently skipped** (dist-gated), 0 fail.
- after `npm run build`: **267/267 suites, 3386 pass / 0 fail / 2 skipped** —
  reproduces the cycle-3 claim only with the build step.
- structured-ai `npm test` (60-suite `&&` chain): exit 0.

## Verified RESOLVED in current code (back-propagated to ledger)

Rows found fixed (code re-read this session; several carry in-source markers):

- SE-F-037 (nested-output ignore → full-path `IgnoreMatcher.isOutput`)
- SE-F-038 (per-name `ExportEntry[]`, multi-declarator exports)
- SE-F-039 (snapshot normalizer keeps stable ids under keep-containers)
- SE-F-041/SE-F-056 (project PATCH/DELETE mutate + persist the registry)
- SE-F-042 (watch: `resolveVectorPlan` honours `--embedding-provider`)
- SE-F-046 (`validateBatch` cardinality on OpenAI-compatible batches)
- SE-F-047/048 (shared `DEFAULT_GRAPH_*` constants; path CTE carries
  `LIMIT maxNodes+1`; neighbors exposes `truncated`)
- SE-F-050 (SearchService forwards `mode`/`minScore`)
- SE-F-005 (depth>MAX rejected, not clamped)
- SE-F-006 (FindTestsTool `anyOf` selectors)
- SE-F-003 (engines + honest SQLite fallback — verified by cycle-1/2 runs)
- SE-DASH-001 (`unavailable()` honesty instead of healthy/0)
- SE-DASH-002 (history miner keyed by projectId on every call)
- SE-VIZ-004 (`confidentRatio` computed from real edge confidence)
- SE-VIZ-005 (file-level fallback declares `level: 'file'`)
- SE-VIZ-007 / SE-API-003 / SE-F-049-class CI coverage (route registry +
  OpenAPI sync tests green; gate — fixed THIS cycle)
- SE-API-001 (**fixed this cycle** — cancel 404s foreign/unknown jobs; regression `jobCancelScope.test.ts`)
- SE-API-002 (**fixed this cycle** — `SourceValidationError` → 400 at the route; regression `sourceValidation400.test.ts`)
- SE-F-049 (**fixed this cycle** — gate bounds+reports suite skips; `test-skip-budget.json`)
- SE-F-009 (**fixed this cycle** — barrel exports blueprint types; regression `barrelSurface.test.ts`)
- SA-F-004 (**fixed this cycle** — rename applies at designated range/line;
  unambiguous-only fallback; `applied` earned, never asserted; 3 regressions)
- SA-F-002 (**fixed this cycle** — immutable pristine original captured as a
  NON-ENUMERABLE property (never reaches the wire — §17 token hygiene), and
  medium/heavy summaries parse from it, keeping id/name/true original_chars;
  regression in context.test.js)
- SA-REL-006 (read_cursor clamp on chunk eviction — marker "audit REL-024")
- SA-REL-002 (signals cancel every modular run via `cancelAllRuns`; both
  lifecycle.js and agent.js main() wire the full sweep)
- SA-ARCH-001 (McpManager.currentProject() reads effectiveProject — marker)
- SA-F-014/008 (atomic-saves.test.js green in the chain — verified live)

## Still OPEN (honest state) after per-row verification

Remaining MEDIUM/LOW/Unknown rows keep `open — not verified fixed` with their
source pointers; they are quality/hygiene items (barrel utilities, binary
preview window, encoding validate, heuristic docs drift, line-index cache
single-key, KIND_ORDER unknown kinds, manager Result wrapping…) whose
per-row disposition continues below as time allows. None is HIGH/P0.
