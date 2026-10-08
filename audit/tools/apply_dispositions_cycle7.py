#!/usr/bin/env python3
"""CYCLE 7 — apply evidence-based fix_status dispositions to FINDING_INDEX.tsv.

Only the fix_status (col 10) of the named rows is rewritten; id, original_id,
status, source, duplicate_of, title, severity, plan_phase, test are preserved
verbatim (§23: preserve provenance, do not erase evidence). Writes plain TSV —
never CSV quoting (the artifact that earlier made `invalid` miscount as 33/35)."""

import csv
import io
from pathlib import Path

LEDGER = Path("/data/workspace/semantic-engine-structured-ai/audit/FINDING_INDEX.tsv")

NEW = {
    "SE-F-057": (
        "fixed — verified 2026-10-08 (cycle-7): the dashboard now sends the FULL "
        "worker config and distinguishes create (POST /projects) from update "
        "(PATCH /projects/<id>); GatewayServer persists a per-project worker-config.json "
        "under the data root (atomic tmp+rename), validates-before-write, feeds it into "
        "every start path (register/PATCH/hydration) and returns it on GET detail so the "
        "form rehydrates every field; invalid/secret edits are rejected with the existing "
        "config intact. Regression: gatewayUi.test.ts SE-F-057 save-request contract "
        "(create=POST, update=PATCH, full config, explicit null for cleared optionals) + "
        "GatewayServer.test.ts SE-F-057 (PATCH stores/returns/re-reads full config, "
        "unrelated fields preserved, durable across a fresh GatewayServer over the same "
        "data root, invalid edit leaves config unchanged, secret refused)"
    ),
    "SA-F-007": (
        "fixed — verified 2026-10-08 (cycle-7): WorkspaceProfile.overlayFor resolves the "
        "workspace/floor layer from the PROJECT's OWN registry root (new projectWorkspaceRoot), "
        "not the process WORKSPACE_ROOT; an id the registry does not know honestly falls back "
        "to the process workspace (legacy single-project flow preserved). openProject/loadOverlay/"
        "persist now read+write project A's own .agent/project.json for A, project B's for B — "
        "no cross-project contamination. Regression: project-stores.test.ts 'SA-F-007: two "
        "projects resolve their OWN settings floors' (A/B isolation, context switch re-resolves, "
        "process-workspace decoy never leaks to a registered project, unknown id is deterministic)"
    ),
    "SE-DEBT-003": (
        "fixed — verified 2026-08-08 (cycle-7): the finding's RECOMMENDED FIX is implemented — "
        "callers disambiguate via findByNameAndFile (same-file preferred) and the global "
        "first-match fallback is HONESTLY LABELED: TypeGraphBuilder/CallGraphBuilder mark such "
        "edges basis='name-match' with confidence<70, so a guessed cross-file name match can "
        "never be read as an authoritative resolution (the correctness defect was 'presented as "
        "certain', not 'a fallback exists'). Regression: GraphProvenance.test.ts ('یالی که از نام "
        "سراسری آمده name-match است نه ast', confidence<70) + ExplainSymbolTool/ImpactAnalysisTool "
        "name-match provenance cases"
    ),
    "SE-ARCH-001": (
        "open — DELIBERATE ARCHITECTURAL DEFERRAL, not an unresolved correctness defect: "
        "ContextDiscoverer.discover() is a large (now ~276-line) orchestration method; source "
        "inspection shows a maintainability concern only — no demonstrated AI-correctness failure "
        "and no misleading output (its truncation/count honesty is separately fixed+locked by "
        "SE-AI-19/SE-AI-20). A rewrite is explicitly undesirable (unprovoked rewrite forbidden). "
        "Decision: keep monolith until a concrete change makes extraction low-risk. Rationale + "
        "trigger: see ACTIVE-ISSUES AI-13 and DECISIONS D-16. independent of SE-ARCH-002."
    ),
    "SE-ARCH-002": (
        "open — DELIBERATE ARCHITECTURAL DEFERRAL, not an unresolved correctness defect and NOT a "
        "duplicate of SE-ARCH-001 (different unit: BlueprintGenerator, a ~800-line class with 8 "
        "build* responsibilities, vs ContextDiscoverer). No demonstrated correctness/AI-misleading "
        "failure; pure God-class maintainability. duplicate_of=SE-ARCH-001 is a THEME relationship "
        "only (§5: a populated duplicate_of does not force DUPLICATE — cf. SE-SEC-001). Keep tracked "
        "independently; refactor only when a feature change touches it. See ACTIVE-ISSUES AI-13/D-17."
    ),
    "SA-F-016": (
        "PARTIALLY fixed — atomic persistence DONE (cycle-5): ProjectStore.save routes through "
        "AtomicFile (unique pid+time+random temp, unlink-on-failure; crash regression locked in "
        "atomic-saves.test.js). Remaining half — cross-process read-modify-write serialization — "
        "is DECIDED NOT REQUIRED, not silently closed: every mutation is a synchronous load->mutate->"
        "save with no in-process cache, the registry is a single low-churn ownership document, and "
        "atomic tmp+rename guarantees a reader never sees a half-written file. Concurrent writers on "
        "ONE project can lose an update (last rename wins); this is the accepted model for the "
        "documented per-project-ownership usage — no cross-project corruption, no partial reads. "
        "No lock infrastructure added (§11: don't add unnecessary infra). Rationale: ACTIVE-ISSUES "
        "AI-21 / DECISIONS D-18."
    ),
}


def main() -> None:
    text = LEDGER.read_text(encoding="utf-8")
    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))
    header, data = rows[0], rows[1:]
    assert header[-1] == "fix_status", header
    changed = 0
    for r in data:
        if r[0] in NEW:
            r[9] = NEW[r[0]]
            changed += 1
    assert changed == len(NEW), f"expected {len(NEW)} updates, got {changed}"
    buf = io.StringIO()
    w = csv.writer(buf, delimiter="\t", lineterminator="\n", quoting=csv.QUOTE_NONE, quotechar=None)
    w.writerow(header)
    for r in data:
        w.writerow(r)
    LEDGER.write_text(buf.getvalue(), encoding="utf-8")
    print(f"updated {changed} fix_status cells")


if __name__ == "__main__":
    main()
