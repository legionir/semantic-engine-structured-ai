# Phase 2 implementation status

Revision target: branch `docs/audit-file-status` as pulled into the private drive.

## Implemented

- `Phase2Structural.ts`: deterministic structural-search adapter boundary, named metavariables, bounded results, rule-pack validation (JSON and constrained YAML), syntax-tree debug dump.
- `Phase2Transactions.ts`: source-independent edit model, UTF-16 ranges, expected-content hash checks, overlap rejection, dry-run unified diff, explicit approval token, atomic temp-file replacement, durable journal, rollback/undo, recovery listing, protected-path checks, and server-configured validators.
- `Phase2StructuralTools.ts`: `structural_search`, `structural_rule_test`, `syntax_tree_dump`, `edit_plan`, `edit_approve`, `edit_apply`, and `edit_rollback` registered through `AiToolRegistry`.
- Edit tools remain disabled unless `enablePhase2Edits` is explicitly enabled and a workspace root is supplied. Client input never supplies a command or validator.

## Tests written

- `src/core/codeintel/Phase2Structural.test.ts`
- `src/core/codeintel/Phase2Transactions.test.ts`

Coverage includes metavariable capture, deterministic ordering, result bounds, rule validation, line preservation, read-only preview, approval gating, stale snapshot rejection, overlap rejection, atomic apply, journal recovery, rollback, and protected paths.

## Not claimed

The structural adapter is intentionally dependency-free in this patch. It is an integration seam, not evidence of ast-grep runtime parity. MCP/Gateway execution, full/incremental producer parity, crash injection, validator process isolation, fuzz cycles, performance/RSS, build, lint, and tests require execution in a dependency-complete checkout and are not claimed here.

## Suggested focused execution

```bash
npx jest src/core/codeintel/Phase2Structural.test.ts --runInBand
npx jest src/core/codeintel/Phase2Transactions.test.ts --runInBand
npm run build
npm run lint
npm test -- --runInBand
npm run test:gate
```

Phase 2 status: `IMPLEMENTED / TESTS WRITTEN / NOT EXECUTED / GATE NOT ACCEPTED`.
