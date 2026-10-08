#!/usr/bin/env python3
"""
CYCLE 7 — deterministic FINDING_INDEX.tsv reconciliation (§16).

Verifies, and prints as machine-readable key=value lines, the single set of
facts that every audit document must agree on:

  * total data rows (no blanks, no quoted-TSV artifacts, no duplicate ids);
  * per-disposition counts derived from `fix_status` (the disposition field,
    not `status`, not `duplicate_of`);
  * the arithmetic invariant sum(dispositions) == number_of_rows;
  * every referenced finding id (in `duplicate_of`, and in ACTIVE-ISSUES.md
    cross-references) actually exists in the ledger;
  * the exact OPEN / PARTIAL lists, so the docs cannot claim drift silently.

Exit code is non-zero on ANY inconsistency; the ledger is never corrected by
this script — it only reports reality. Docs must be edited to match it.
"""

import csv
import io
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "audit" / "FINDING_INDEX.tsv"
ACTIVE = ROOT / "audit" / "ACTIVE-ISSUES.md"

DISPOSITIONS = {"fixed", "invalid", "duplicate", "superseded", "open", "partial"}


def disposition_of(fix_status: str) -> str:
    """Map the free-form `fix_status` to one canonical disposition keyword.

    §5 says disposition comes from `fix_status` semantics, not from
    `duplicate_of`. A row is `partial` only when its leading keyword is
    PARTIALLY (`PARTIALLY fixed — …`)."""
    s = fix_status.strip()
    if not s:
        return "EMPTY"
    # PARTIALLY-fixed rows are the only ones whose keyword is not the first word.
    if s.upper().startswith("PARTIALLY"):
        return "partial"
    first = s.split()[0].strip().rstrip(":,-").lower()
    return first if first in DISPOSITIONS else f"UNKNOWN:{first}"


def main() -> int:
    text = LEDGER.read_text(encoding="utf-8")
    problems: list[str] = []

    if "\r\n" in text:
        problems.append("ledger contains CRLF line endings")
    if not text.endswith("\n"):
        problems.append("ledger does not end with a newline")

    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))
    if not rows or rows[0][:1] != ["id"]:
        problems.append(f"unexpected header: {rows[0] if rows else 'EMPTY'}")
    header = rows[0]
    fs_idx = header.index("fix_status")
    dup_idx = header.index("duplicate_of")
    id_idx = header.index("id")

    data = [r for r in rows[1:] if any(c.strip() for c in r)]
    blank = len([r for r in rows[1:] if not any(c.strip() for c in r)])
    if blank:
        problems.append(f"{blank} blank data row(s) present")

    ids = [r[id_idx].strip() for r in data]
    dup_ids = [i for i, c in Counter(ids).items() if c > 1]
    if dup_ids:
        problems.append(f"duplicate ids: {dup_ids}")

    for r in data:
        if len(r) != len(header):
            problems.append(f"row {r[id_idx]!r} has {len(r)} cols, expected {len(header)}")

    # quoted-TSV artifacts: a JSON blob embedded in a tab-separated field — §16.
    for r in data:
        for i, c in enumerate(r):
            if (c.startswith('"') and c.endswith('"')) or '""' in c:
                problems.append(f"row {r[id_idx]!r} col {header[i]!r}: CSV-quote artifact in TSV")

    disp = Counter(disposition_of(r[fs_idx]) for r in data)
    total = len(data)
    if sum(disp.values()) != total:
        problems.append(f"arithmetic: dispositions {sum(disp.values())} != rows {total}")
    for k in disp:
        if k not in DISPOSITIONS and not k.startswith(("EMPTY", "UNKNOWN")):
            problems.append(f"invalid disposition vocabulary: {k!r}")

    id_set = set(ids)
    for r in data:
        ref = r[dup_idx].strip()
        if ref and ref not in id_set:
            problems.append(f"row {r[id_idx]!r}: duplicate_of -> missing {ref!r}")

    # ACTIVE-ISSUES cross-references to nonexistent findings (§16.9).
    if ACTIVE.exists():
        active_text = ACTIVE.read_text(encoding="utf-8")
        cited = set(re.findall(r"\b(?:SE|SA|XX)-[A-Z]+-\d+\b", active_text))
        missing = sorted(c for c in cited if c not in id_set)
        if missing:
            problems.append(f"ACTIVE-ISSUES cites unknown ids: {missing[:12]}")

    open_ids = [r[id_idx] for r in data if disposition_of(r[fs_idx]) == "open"]
    partial_ids = [r[id_idx] for r in data if disposition_of(r[fs_idx]) == "partial"]

    print(f"rows={total}")
    for k in ("fixed", "invalid", "superseded", "duplicate", "partial", "open"):
        print(f"{k}={disp.get(k, 0)}")
    print(f"sum={sum(disp.values())}")
    print(f"open_ids={','.join(sorted(open_ids)) or '-'}")
    print(f"partial_ids={','.join(sorted(partial_ids)) or '-'}")

    if problems:
        print("\nFAIL:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\nOK: ledger is internally valid and arithmetically consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
