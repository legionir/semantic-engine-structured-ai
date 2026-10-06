# AUDIT STATE
Phase: P1 (IN_PROGRESS)          Session: 3          Updated: 2026-09-20
## Counters (from counts.py / latest manifests)
files:      total 1650 | DONE 0 | TODO 1650 | BLOCKED 0 | OUT_OF_SCOPE 0 | NA 0
dirs:       total 445 | DONE 0 | TODO 445 | BLOCKED 0 | OUT_OF_SCOPE 0 | NA 0
entrypoints total 389 | DONE 0 | TODO 71 | BLOCKED 0 | OUT_OF_SCOPE 301 | NA 17
workflows:  total 0 | DONE 0 | TODO 0 | BLOCKED 0 | OUT_OF_SCOPE 0 | NA 0
symbols:    total 3649 | DONE 0 | TODO 1168 | BLOCKED 0 | OUT_OF_SCOPE 2481 | NA 0
entities:   total 0 | DONE 0 | TODO 0 | BLOCKED 0 | OUT_OF_SCOPE 0 | NA 0
boundaries: total 0 | DONE 0 | TODO 0 | BLOCKED 0 | OUT_OF_SCOPE 0 | NA 0
dynamic_edges: total 0 | DONE 0 | TODO 0 | BLOCKED 0 | OUT_OF_SCOPE 0 | NA 0
## Batches
files batch 001-050: TODO ; batch 051-100: TODO ; batch 101-150: TODO ; batch 151-200: TODO ; batch 201-250: TODO ; batch 251-300: TODO ; batch 301-350: TODO ; batch 351-400: TODO ; batch 401-450: TODO ; batch 451-500: TODO ; batch 501-550: TODO ; batch 551-600: TODO ; batch 601-650: TODO ; batch 651-700: TODO ; batch 701-750: TODO ; batch 751-800: TODO ; batch 801-850: TODO ; batch 851-900: TODO ; batch 901-950: TODO ; batch 951-1000: TODO ; batch 1001-1050: TODO ; batch 1051-1100: TODO ; batch 1101-1150: TODO ; batch 1151-1200: TODO ; batch 1201-1250: TODO ; batch 1251-1300: TODO ; batch 1301-1350: TODO ; batch 1351-1400: TODO ; batch 1401-1450: TODO ; batch 1451-1500: TODO ; batch 1501-1550: TODO ; batch 1551-1600: TODO ; batch 1601-1650: TODO
## Carried-over TODOs (by ID range)
None yet.
## New items discovered since last session
- P1 discovery complete: raw searches ingested and filtered; manifests updated.
- entrypoints filtered: 389 discovered → 71 KEEP (TODO), 301 OUT_OF_SCOPE, 17 flagged TODO(review).
## NEXT ACTION
Begin P3: resolve `EP-` rows marked `TODO` (71 KEEP) by locating handler functions, triggers, and mapping to workflows; produce `workflows.tsv` and per-workflow cards. Prioritize EPs in `semantic-engine/src/` and `structured-ai/`.
## Session log
S1: completed P0 setup and phase report; created manifests (`files.tsv` 1650, `dirs.tsv` 445), recorded tool availability and baseline references; noted Windows/no-bash constraints affecting verification ceiling.
S2: executed bounded P1 discovery; populated `symbols.tsv` with 385 hits and `entrypoints.tsv` with 210 candidates; updated STATE counters.
S3: completed P1 discovery: ran searches, ingested symbols/entrypoints, applied filtering to mark node_modules/dist as OUT_OF_SCOPE. Next: begin P3 entrypoint resolution.
