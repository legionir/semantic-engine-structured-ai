# Audit Issues Overview (snapshot)
Date: 2026-09-20

This document summarizes critical, high, medium and low priority problems discovered during P0–P1 discovery and initial scanning. Use this as the canonical starting point for triage and remediation planning.

## Critical
- Entrypoints unresolved: 71 `EP-` rows remain `TODO` (blocking workflow mapping and P4/P5). See `audit/manifest/entrypoints.tsv` for the full list. Owner: audit team. Action: resolve in batches (≤20). Priority: P0→P1 blocker.

## High
- P2 baseline not executed (build/test results missing) for `semantic-engine` and `structured-ai`; cannot verify passing baseline. Action: run `npm ci` + `npm test` in both projects and record failures in `audit/test-failures/`.
- Search noise from `node_modules` and `dist` produced many false positives (301 entrypoints and 2481 symbols marked `OUT_OF_SCOPE`). Action: add persistent ignore rules to scanning scripts and update manifests after re-run.

## Medium
- Findings from audit batches (examples):
  - `GetDependenciesTool` lacks depth validation (evidence: `audit/audit-batch-continuation-2.md`). Action: add explicit validation and tests.
  - Run-lifecycle invariant (some code paths do not emit `run:error`) (evidence: `docs/contracts/shared-invariants.md`, `audit/audit-progress-2026-09-15.md`). Action: add contract tests and fix emitters.
- ~871 TODO/FIXME/HACK tags found across ~148 files (grep sample). Action: extract full list, triage to owners/severity.

## Low
- Some repo scripts assume POSIX tools; Python replacements exist under `audit/tmp/` but need consolidation.

## Recommended next actions (short term)
1. Run P2 baseline: install + test `semantic-engine` then `structured-ai`. Capture outputs to `audit/test-failures/`.
2. Resolve first batch of 20 KEEP entrypoints (EP-00107..EP-00116, EP-00197..EP-00206). Update `audit/manifest/entrypoints.tsv` with `handler`, `trigger`, `source:line`, and `workflow` fields.
3. Export all TODO/FIXME matches to `audit/todo-triage.csv` and perform owner/severity triage.

## Evidence / references
- `audit/manifest/entrypoints.tsv`
- `audit/manifest/symbols.tsv`
- `audit/phase_reports/P1.md`
- `audit/searches/raw/` (raw search outputs)

---
If you want, I will now (A) run P2 baseline or (B) export full TODO/FIXME list and produce `audit/todo-triage.csv`. Which should I run first? If you prefer, I can run both sequentially.
