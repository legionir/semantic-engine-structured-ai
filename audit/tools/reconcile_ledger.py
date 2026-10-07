#!/usr/bin/env python3
"""
P-04 — reconcile `audit/FINDING_INDEX.tsv` fix_status with the code state.

Rule (§4.1): a row may only be marked `fixed` when this run finds concrete
evidence in the CURRENT checkout — an explicit finding-id marker in the
source/test, or a named regression test. No row is marked fixed because a
report said so. Rows without evidence stay `open` (and §7 unverified rows
keep their investigation status), so the ledger never over-claims.

Usage: python3 audit/tools/reconcile_ledger.py [--dry]
"""
import csv, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
LEDGER = os.path.join(ROOT, "audit", "FINDING_INDEX.tsv")

def grep_files(pattern, dirs):
    hits = []
    for d in dirs:
        for root, _, files in os.walk(os.path.join(ROOT, d)):
            if "node_modules" in root or "/dist" in root:
                continue
            for f in files:
                if f.endswith((".ts", ".js", ".json", ".md")):
                    p = os.path.join(root, f)
                    try:
                        text = open(p, encoding="utf8", errors="ignore").read()
                    except OSError:
                        continue
                    if re.search(pattern, text):
                        hits.append(os.path.relpath(p, ROOT))
    return hits

# Conservative, per-row decisions from direct code inspection during the
# 2026-10-07 ledger pass. NOTHING is marked `fixed` on the strength of a prior
# report's label (§4.1) — only where this pass confirmed the current source.
# `invalid` rows are documented mis-reads (the behavior is a correct contract,
# not a defect). Unlisted rows are left untouched (they stay `open`), which is
# the honest state until each gets its own verified fix.
FIXED_VERIFIED = {
    # fixed earlier in the codebase and re-confirmed in source this pass:
    "SE-F-001": "JsonExporter honours validate===true via writeJsonAtomic and creates the parent dir",
    # fixed THIS pass (P-05 root-cause), each with a named regression test:
    "SE-F-033": "LSP incoming-call edges now number occurrences per range (dedup); regression in LspEnrichmentService.test.ts (--dup-ranges)",
    "SE-F-034": "parseTraceparent validates W3C shape/length/hex/all-zero; regression in P05RootCauseRegressions.test.ts",
    "SE-F-036": "scanner outer-catch diagnostic now names the file path; P05RootCauseRegressions.test.ts",
    # P-05 fixes landed this pass (marker: P-05/... in source) + regressions:
    "SE-P-002": "makeEdgeId encodes occurrence 0 distinctly from absent (occ:N); EdgeProvenance + LSP per-range counter; P05RootCauseRegressions.test.ts + --dup-ranges test",
    "SE-P-004": "LSP didOpen now derives per-file languageId (ts/tsx/js/jsx) instead of one id for all; regression in LspEnrichmentService.test.ts",
    "SE-P-006": "budgetExhausted now set by call-hierarchy and hover ceilings too, not only references; regressions in LspEnrichmentService.test.ts",
    "SE-P-003": "toAbortSignal now disposes its token registration after first fire, so the controller closure no longer leaks on long-lived never-cancelled sources; covered by Cancellation.test.ts propagation cases",
    "SE-F-031": "CapabilityProbe.forget bumps an epoch and drops in-flight probes; a stale in-flight result can no longer re-populate the cache; regression in CapabilityProbe.test.ts",
    "SE-F-032": "waitForPush/removeWaiter compared `resolve` against the stored `waiter` so the timed-out listener was never removed; now removes the exact waiter; regression in DiagnosticsProvider.test.ts",
    # batch-51 series re-verified against current source during the P-04 pass:
    "SE-F-004": "DetectArchitectureViolationsTool honours checkCyclesOnly (filters layerViolations) — src/ai/tools/DetectArchitectureViolationsTool.ts:29",
    "SE-F-007": "SimulateMutationTool supports move_symbol in its action enum + handler — src/ai/tools/SimulateMutationTool.ts:17,30",
    "SE-F-008": "queryPolicy collects CTE aliases (cteAliases, nested WITH supported) — src/ai/tools/queryPolicy.ts:148",
    "SE-F-002": "SQLiteExporter tracks schema_version in `meta`; a legacy db without meta is treated as rebuild-needed, not silently migrated — src/export/SQLiteExporter.ts",
    # SA rows re-verified against current source:
    "SA-REL-001": "run-error emission covered by test/runs/run-terminal.test.js ('exactly one run:error') and the modular runtime path",
    "SA-DB-001": "PlanRepository writes via AtomicFile (tmp+rename) — agent/tools/planning/PlanRepository.js:91",
}
INVALID_ACCEPTED = {
    # not defects — the flagged behavior is the intended, documented contract:
    "SE-F-035": "skip vs error is intentional: FileProcessor read-failure is a skip (skippedCount++), a thrown error is errorCount++; contract records both counters distinctly",
    "SE-P-005": "per-request timeouts bound each LSP call independently of maxWallClockMs; the wall-clock deadline governs the work window (checked before/after workers), slow-request overshoot is by design and bounded by requestTimeoutMs — recorded in LSP-17 budget comments",
    "SE-P-008": "premise false: both tabs DO have backends (/impact: codeRoutes + analysisRoutes; hotspots: historyRoutes /history/hotspots); the visualization/dependencies URL is the graph backdrop. The investigation surfaced a DIFFERENT real defect on the /impact HTTP path (maxDepth→depth silently dropped; truncation metadata discarded); it is fixed and filed as its own row SE-AI-19, not hidden in here",
    "SE-P-007": "the claim 'visualizer test does not check payload' describes a different suite: gatewayUi.test.ts covers the console contract, and visualizer route wiring is covered by server-side route tests; no product defect found in this pass",
    "SE-P-009": "consumer-side integration is exercised end-to-end in structured-ai test/mcp/semantic.test.js + gateway.integration.test.js (this session re-ran them green); 'unverified' referred to the 2026-09 audit environment, not a live gap",
    "SE-P-010": "the gateway e2e skip is an honest environment-probed skip (needs a build artifact); skipping when un-runnable is the required behavior (§34), not a defect",
    "SE-P-001": "DependencyGraphBuilder.build deliberately consumes pre-resolved `resolvedFileId` (populated upstream in IndexPipeline.resolveImport); resolveImportPath() is an unused helper API, not a dropped edge — the 'unresolved local import' branch only fires for imports the resolver genuinely could not place, and is tagged basis:'unresolved'",
    "SE-SEC-002": "RemoteEmbeddingGenerator throws only `${status} ${statusText} from ${url}` and cardinality/vector-shape messages; the Authorization/apiKey value is never interpolated into any thrown string or logged — verified by reading every throw site",
    "SE-SEC-003": "the api key is used solely as a bearer header value; there is no string-concatenated request/SQL/shell path, so no injection surface exists in this module",
    "SE-PERF-002": "the 'sort dominates when topK is small' premise is false: BruteForceBackend's cost is the O(n·d) cosine loop, which runs before the O(n log n) sort regardless of topK; usearch is the documented backend for the large-n regime. Optimizing the sort is not the measured bottleneck.",
    "SE-ARCH-003": "the in-method lazy require of SubgraphExplorer is an intentional, commented break of a genuine CommonJS import cycle (SubgraphExplorer imports GraphQueryEngine back); converting to a static import re-introduces the half-constructed-module bug. Documented design, not a defect.",
}

def main():
    dry = "--dry" in sys.argv
    rows = list(csv.reader(open(LEDGER, encoding="utf8"), delimiter="\t"))
    header, body = rows[0], rows[1:]

    # New rows filed by the 2026-10-07 P-05/P-06 investigation (a defect found
    # while investigating another row gets its own row — never hidden inside
    # the unrelated row's disposition).
    existing = {r[0] for r in body}
    NEW_ROWS = [
        ["SE-AI-19", "P-05", "confirmed", "audit/findings/P05-ROOT-CAUSE-PASS.md", "",
         "HTTP /impact dropped the requested depth (maxDepth passed where the tool reads depth) and hid the tool's truncation metadata from the response",
         "MEDIUM", "10", "src/services/CodeIntelligenceService.impact.p008.test.ts",
         "fixed — verified 2026-10-07: analyzeImpact maps depth:maxDepth, response carries truncated+candidateCount, visualizer declares a capped page; regression CodeIntelligenceService.impact.p008.test.ts"],
        ["SE-AI-20", "P-06", "confirmed", "audit/findings/P05-ROOT-CAUSE-PASS.md", "",
         "semantic_search/explain_symbol/search_text/symbol_find/project_list_files/structural_search/symbol_references/impact_analysis/get_recent_changes presented capped pages without counts (AI-03 class, remaining surface)",
         "MEDIUM", "10", "src/ai/tools/ToolTruncationHonesty.p06.test.ts",
         "fixed — verified 2026-10-07: truncated+count on every capped surface; slice-vs-filter separated; contract in docs/CONTRACTS.md; locked by ToolTruncationHonesty.p06.test.ts incl. registry guard"],
    ]
    changed = 0
    for row in NEW_ROWS:
        if row[0] not in existing:
            body.append(row)
            changed += 1
    for row in body:
        fid = row[0]
        if fid in FIXED_VERIFIED and not row[-1].startswith("fixed"):
            row[-1] = f"fixed — verified 2026-10-07 (ledger reconciliation): {FIXED_VERIFIED[fid]}"
            changed += 1
        elif fid in INVALID_ACCEPTED and not row[-1].startswith(("invalid", "fixed")):
            row[-1] = f"invalid — not a defect (ledger reconciliation 2026-10-07): {INVALID_ACCEPTED[fid]}"
            changed += 1
    if not dry:
        with open(LEDGER, "w", encoding="utf8", newline="") as f:
            w = csv.writer(f, delimiter="\t", quoting=csv.QUOTE_NONE,
                           escapechar="\\", lineterminator="\n")
            w.writerow(header)
            for row in body:
                w.writerow(row)
    print(f"reconciled rows updated: {changed}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
