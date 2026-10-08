# Finding-count reconciliation (`l2count`) — regenerated 2026-10-08 (cycle 7)

This file used to carry a hand-counted snapshot (2026-10-07: "159 rows"). It
is now the **generated** view of the deterministic tool, so it can never drift
from the ledger again:

```
$ python3 audit/tools/verify_ledger.py
rows=161
fixed=99
invalid=35
superseded=7
duplicate=17
partial=1
open=2
sum=161
open_ids=SE-ARCH-001,SE-ARCH-002
partial_ids=SA-F-016

OK: ledger is internally valid and arithmetically consistent.
```

## Source of truth

`audit/FINDING_INDEX.tsv` is the canonical ledger:
- **161 finding rows** (162 lines incl. header), 161 unique ids, every row
  exactly 10 tab-separated columns. Verified by
  `audit/tools/verify_ledger.py`, not by hand.
- The tool enforces: disposition vocabulary ⊆ {fixed, invalid, duplicate,
  superseded, open, partial}; `sum(dispositions) == number_of_rows`; no blank
  rows; no duplicate ids; no dangling `duplicate_of` references; no ACTIVE-
  ISSUES citations of nonexistent ids; and no CSV-quote artifacts inside the
  TSV. Any violation exits non-zero with a named problem.

## Why the old documents said 159 (and why that number was never "wrong to
conclude from" — it was simply stale)

- The 2026-10-07 snapshot measured 159 rows. The same day's P-04 ledger
  reconciliation **appended two verified rows** (`SE-AI-19`, `SE-AI-20` — the
  /impact depth fix and the truncation-honesty rollout, both with named
  regression tests), bringing the ledger to 161. The appended rows are real
  findings filed from evidence; nothing was invented to reach 161 and nothing
  was deleted to reach 159.
- A separate, subtler artifact had made the `invalid` disposition read as 33
  while two rows (`SE-F-011`, `SE-DEBT-001`) were in fact `invalid`: their
  `fix_status` had been written as a CSV-quoted JSON blob (leading `"` and
  doubled `""`) inside a plain TSV, so naive readers dropped them. Cycle 7
  cleaned the artifacts (content preserved verbatim) and the verification tool
  now fails loudly if such a quoting artifact reappears.
- The bare `F-0001..F-0037` remediation aliases in the old STATUS REPORT
  remain a **separate alias series**, not ledger rows (see
  `audit/findings/F-0031_0035_STATUS.md`); `STATUS.md`'s "30" measures manifest
  coverage, a different dimension. Neither is comparable to the defect count.

## Current action

- Defect ledger: **161** rows, disposition sum = 161 exactly (see the tool
  output above).
- Canonical current status of every row: `audit/ACTIVE-ISSUES.md` (Counters
  section) — the sole current source of truth.
- Cycle-7 evidence trail (what moved each disposition and why):
  `audit/findings/CYCLE7-REMEDIATION.md`.
- If this file is ever regenerated with different numbers, the ledger changed
  through justified disposition; the tool output above — not this prose — is
  authoritative, and `verify_ledger.py` must stay exit-0.
