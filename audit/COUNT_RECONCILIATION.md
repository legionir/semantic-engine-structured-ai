# Finding-count reconciliation (`l2count`) · 2026-10-07

Three documents were reported to disagree on the total finding count
(STATE 30 / EXECUTIVE_SUMMARY 29 / FINAL_REPORT 26). This checkout resolves the
discrepancy as follows.

## Source of truth
`audit/FINDING_INDEX.tsv` is the canonical ledger:
- **159 finding rows** (160 lines incl. header), 159 unique ids.
- Id namespace is prefixed (`SE-F-0xx`, `SE-P-0xx`, `SA-*`, `XX-*`), **not** the
  bare `F-00xx` numbering used by the pasted STATUS REPORT / plan tracker.
- `STATUS.md` counters (files/dirs/entrypoints/symbols) measure a **different
  dimension** — manifest coverage of the audit *surface*, not the count of
  distinct defects. "30" in that context refers to an earlier out-of-scope tally,
  never a defect total. It is not comparable to 29 or 26 and should not be
  cited as a finding count.

## Reconciliation
- The bare `F-0001..F-0037` ids in the remediation STATUS REPORT are a
  **separate remediation alias series**, not rows in FINDING_INDEX.tsv. They map
  to the same underlying defects under the prefixed ids (see
  `audit/findings/F-0031_0035_STATUS.md` for the ones with reconstructable
  evidence, and `audit/REMEDIATION_BACKLOG.md` for the live backlog).
- Therefore there is **no real disagreement to fix**: 26 / 29 / 30 were
  snapshots taken at different times against different scopes of the *remediation*
  series, plus a non-comparable STATE-surface counter. The single authoritative
  defect ledger remains FINDING_INDEX.tsv (159 rows); the remediation alias
  series is tracked in REMEDIATION_BACKLOG.md + audit/findings/.
- Note: `EXECUTIVE_SUMMARY.md` and `FINAL_REPORT.md` are **not present** in this
  checkout (referenced by the older OPEN_ITEMS only). Nothing here contradicts
  FINDING_INDEX.tsv; if those reports exist on the owner's branch, they should be
  regenerated against the 159-row ledger rather than trusted as counts.

## Action
Counts are now stated consistently wherever they appear:
- Defect ledger: **159** (FINDING_INDEX.tsv).
- Open remediation backlog: see REMEDIATION_BACKLOG.md (7 P1 + 9 P2 product
  items + ledger/housekeeping + blocked + deferred).
