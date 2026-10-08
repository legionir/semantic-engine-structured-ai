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
    # ---- 2026-10-07 second reconciliation pass (per-row code verification) ----
    # HIGH rows re-confirmed fixed in current source:
    "SE-F-028": "content-equal rename now goes through store.renameFile (keeps symbols); regression 'SE-F-028' in IncrementalEngine.phase25.test.ts asserts symbol parity with a full rebuild",
    "SE-F-059": "GatewayServer.hydrateProjects restores enabled+autoStart workers on start(); regression GatewayHydration.test.ts",
    "SA-F-010": "per-project run slots + background runs (ServerImplementation projectSlots/startBackgroundRun); regression test/web/project-concurrency.test.js",
    "SA-F-011": "auto-continue inherits runOptions ({...runOptions} at the AUTO_CONTINUE setTimeout); regression test/projects/project-continue.test.js (every cycle must run for prj-a)",
    # rows fixed THIS pass with named regressions:
    "SA-REL-004": "compaction now refuses to drop an exchange whose archive copy failed (archiveFailed signal / throw → retained_unarchived + honest notice); regressions in test/context/archive.test.js (3 SA-REL-004 cases)",
    "SE-F-058": "gateway project list carries the worker's real health snapshot (available/observedAt; null+note when unmeasured) instead of hard-coded zeros; regression 'SE-F-058' in GatewayServer.test.ts",
    "SA-F-005": "RequestBody decodes via string_decoder.StringDecoder so multi-byte chars split across chunks survive; regression 'SA-F-005' in test/web/routes.test.js",
    "SE-SEC-001": "authRequired is three-state now: null = no evidence (was false = 'route is open', misleading an AI per §15); schema + type + regression 'SE-SEC-001' in BlueprintGenerator.phase46.test.ts",
    # rows re-confirmed fixed against current source this pass:
    "SE-F-029": "FileWatcher pending tables are Map<hash, PendingEvent[]> — same-content files queue instead of overwriting (hold/take push/shift)",
    "SE-F-030": "stringifyToStream installs an error listener for the whole write duration and surfaces the first failure to the caller (FileSystem.ts onStreamError)",
    "SE-F-044": "route reads body.depth ?? DEFAULT (nullish, not ||) after schema validation; explicit zero survives (visualizationRoutes.ts:140-141)",
    "SE-F-045": "ContextService forwards options.files as targetFiles and reports the tool's measured estimatedTokens, not the maxTokens budget",
    "SA-API-002": "search sessions carry project_id + run_id; ownedSession() hides foreign handles exactly like unknown ones (SearchTools.js)",
    "SA-REL-003": "RunManager.enqueue/abandon track queued runs by id and settle cancellation before start",
    "SA-REL-005": "spawn error keeps status 'failed'; the following close does not turn it into 'exited' (BackgroundSession.js comment + test 'a spawn error stays failed')",
    "SA-HOOK-001": "stopReason requires skipItem; executeDependencyGraph reads the stop flag before the next dispatch; regression test/hooks/hooks-stop-lifecycle.test.js (10 cases)",
    "SE-F-040": "config PATCH applies only genuinely runtime-readable keys (maxBodyBytes), rejects read-only keys with 409 'restart the server' and unknown keys with 400; response declares persisted:false — no fake success (configRoutes.ts)",
    "SA-UI-001": "visualizer sample data is opt-in only (?preview=1) and visibly labelled 'PREVIEW ONLY — this is not project data'; failures render a failed state, never fabricated graphs (public/visualizer.js loadView)",
    "SA-F-001": "fs_read_many passes the caller's project context into every item (ReadTools.js marker 'audit F-009' = this row's original_id F-009); regression 'fs_read_many reads every item inside the caller's project' in test/tools/project-tools.test.js",
    "SA-F-009": "telemetry provenance is per-run/per-project: each run bucket remembers its OWN root (project_root from the tool context), falling back to activeProjectRoot() not process WORKSPACE_ROOT (Telemetry.js marker 'audit F-017' = this row's original_id F-017)",
    "SA-F-013": "foreground stdout bounded exactly like stderr via capture() (ForegroundCommand.js 'audit F-004'); an unbounded += was the defect",
    "SA-F-012": "RunManager.enqueue tracks queued runs by id and abandon() settles bookkeeping exactly once, so a queued-cancel no longer leaves an untracked context",
    "SA-API-001": "normalizeProjectInput maps record-shape AND context-shape onto one contract; ProjectResolver validates explicit roots before execution (markers 'finding API-016 / F-008')",
    "SA-F-017": "explicit project no longer bypasses validation: root canonicalised + ownership checked (validateProjectOwnership); the residual 'registry-only membership' question is recorded in-source as an honest Unknown, not hidden",
    "SA-POL-001": "policyProblems now compiles every argument_matches regex at validation time (invalid → 'invalid regex' problem, non-array → 'must be an array'); malformed patterns can no longer crash evaluation; regression 'SA-POL-001/SA-POL-005' in test/policy/policy.test.js",
    "SA-POL-002": "createPendingHandler binds the owning run's AbortSignal: abort → pending removed + promise rejects RUN_CANCELLED; pre-aborted run never registers a pending ask; regression 'SA-POL-002/006' in test/policy/policy.test.js",
    "SA-POL-003": "ApprovalStore.record enforces the bounded history its header promised (historyLimit, default 500, shift on overflow)",
    "SA-POL-004": "PolicyEngine.enforce/enforceApproval emit the onDecision audit event with approved:false,denial:true when an approval is denied (the throw no longer swallows the security-relevant event); regression 'SA-POL-004' in test/policy/policy.test.js",
    "SE-F-027": "args-only server override now applies on every resolution path (applyArgsOverride after resolveCommand and PATH lookup), not only inside the command branch; 2 regressions 'SE-F-027' in src/lsp/registry.test.ts",
    # ---- 2026-10-08 cycle-4 per-row pass (code re-read this session) ----
    # fixed THIS cycle, each with a named regression:
    "SE-API-001": "job cancel is project-scoped: 404 for foreign/unknown job instead of cross-project cancel + 200/cancelled:false; regression jobCancelScope.test.ts",
    "SE-API-002": "SourceSyncService validation throws SourceValidationError(status 400) and every source route maps it — a rejected request is 400, not a fake 'server broke' 500; regression sourceValidation400.test.ts",
    "SE-F-049": "check-tests.js now bounds suite-level skips with test-skip-budget.json (budget 0 on the gated path) and reports the real skip count instead of printing 'all suites ran' while suites were skipped; jest globalSetup prints an honest dist-skip notice on a bare run",
    "SE-F-009": "core/types barrel exports blueprint.types (Blueprint + all shapes reachable from the declared public surface); regression barrelSurface.test.ts",
    "SE-UI-001": "project switch clears the previous selection before/after a failed POST (clearProjectSelection); visualizer link only for ready projects; structural regression openUiProjectSwitch.test.ts",
    "SE-PIPE-001": "run-pipeline finally now awaits the async extractors.dispose() inside its own try/catch — a disposal rejection can no longer float past the deliberate exit(1) path and mask the original pipeline error (SE-F-042 class: silent success/failure confusion); smoke-verified against the fixture and the missing-workspace path",
    "SA-F-004": "code_rename applies edits at their designated LSP range or 1-based line; falls back to whole-file oldText ONLY when unambiguous (exactly one occurrence); applied:true is earned (≥1 edit written), edits_applied/edits_skipped/note expose partial or zero-effect runs; 3 regressions in test/mcp/semantic.test.js",
    "SA-F-002": "compressToolMessage captures the pristine tool payload once as message.original_content (NON-ENUMERABLE — never serialized to the model body or persistence, so compaction is not undone on the wire); medium/heavy parse from the original so id/name/success and the true original_chars survive escalation; regression 'SA-F-002' in test/context/context.test.js",
    "SA-F-006": "the visualizer node inspector no longer fabricates a per-node coverage pass-mark: both renderers (node-details.js + legacy renderer.js) state 'Coverage not known to this view' via safe DOM (replaceChildren/textContent, no innerHTML); regression 'SA-F-006' in test/ui/visualizer.test.js",
    # fixed earlier in the codebase and re-confirmed in CURRENT source this pass (§4.1: verified by reading, not by label):
    "SE-F-037": "output directory is ignored by its FULL relative path (IgnoreMatcher.isOutput / scanner outputDir), not by its first segment — an output under src/ no longer drops the whole src tree; in-source marker SE-SCAN-17",
    "SE-F-038": "parseExportedDeclaration returns ExportEntry[] with one entry per declarator name (SE-DATA-02); multi-declarator exported variables no longer collapse",
    "SE-F-039": "snapshot normalizer passes the parent keep-context down (keepIds inherited by subtree), so stable ids under files/symbols/nodes survive; comment records the old defect",
    "SE-F-041": "project PATCH/DELETE call projectService.updateProject/removeProject (registry mutates + persists); in-source marker F-0011 (least-privilege) on the same handlers (SE-F-056 is the same defect reported twice — merged as duplicate)",
    "SE-F-042": "watch-command resolves the embedding generator via resolveVectorPlan (same rule/provider as `index`); --embedding-provider is no longer ignored on the watch path; in-source marker 'audit F-07'",
    "SE-F-046": "RemoteEmbeddingGenerator.validateBatch enforces cardinality (expected vs received) and vector shape on the OpenAI-compatible path, mirroring the Ollama branch",
    "SE-F-047": "SQLite and in-memory traversals share DEFAULT_GRAPH_* constants (maxNodes/path depth/direction) and validateTraversalBound; parity holds without explicit options",
    "SE-F-048": "shortestPath CTE carries LIMIT maxNodes+1 (options.maxNodes honoured, not ignored); neighbors returns an explicit truncated flag",
    "SE-F-050": "SearchService forwards mode and minScore into SemanticSearchTool exactly as declared",
    "SE-F-005": "GetDependenciesTool rejects depth>MAX_DEPTH with an explicit error instead of silent clamp (contract says 'rejected rather than silently reduced')",
    "SE-F-006": "FindTestsTool declares anyOf over path|fileId|symbolId and validates selectors at runtime — valid inputs are no longer rejected",
    "SE-DASH-001": "dashboard health/stats use unavailable(reason) + real measured sources instead of hard-coded 'healthy'/0",
    "SE-DASH-002": "history miner is keyed by projectId on getHotspots/getCoChurn/recordCommit — per-project isolation",
    "SE-VIZ-004": "confidentRatio computed from real edge confidences (confident/total), not hard-coded 1.0",
    "SE-VIZ-005": "the file-level fallback declares level:'file' — payload and declared level agree",
    "SA-REL-006": "chunk eviction decrements/clamps session.read_cursor (marker 'audit REL-024') so unread output is never skipped",
    "SA-REL-002": "SIGINT/SIGTERM route through cancelAllRuns (global current run + every active AND queued modular run), in both agent.js main() and lifecycle.installSignalHandlers",
    "SA-ARCH-001": "McpManager.currentProject() reads effectiveProject() (delegation override) instead of the parent run's projectId — comment records the old defect",
    "SA-F-008": "SessionRepository writes via AtomicFile.writeFile (tmp+rename); test/persistence/atomic-saves.test.js injects a rename crash and asserts the previous document survives — green in the live chain this session",
}
SUPERSEDED = {
    "SE-F-043": "superseded — the component the finding described (InMemoryQueueAdapter) was removed; the live path is honest: JobManager.cancelJob cancels the job's CancellationTokenSource and IndexPipeline calls throwIfCancelled at every phase boundary",
    "SA-DB-002": "superseded — ProjectMigration.js no longer exists; DataRoot SCAFFOLD_DIRS includes 'discussion' and durable roots are per-project, so there is no legacy flat migration step to miss it",
    "SE-SE-004": "invalid — not a defect: every project-id that reaches a path goes through assertPathSafeProjectId (no '..', no separators, lowercase-only); normalizeWorkspaceRoot is a local-path alias resolver, not a network-facing surface",
    "SE-SE-007": "invalid — not a defect: run-pipeline.js requires fixed paths under dist/ after existence checks (need()), no shell/exec/eval anywhere in the script",
    "SE-SE-003": "invalid — not a defect (accepted design): generated tokens go to stderr because stdout is the JSON-RPC channel on stdio transport; comparison is crypto.timingSafeEqual (SecurityPipeline.ts:162), non-loopback bind needs explicit --allow-remote, and the printed hint tells the operator to pass a strong --token",
    "SE-F-060": "invalid — documented contract: indexProject declares mode:'reload'/reindexed:false and says indexing belongs to IndexPipeline; an honest no-op beats a fake reindex",
}
DUPLICATES = {
    "SE-CONF-001": "SE-F-040",
    "SA-POL-007": "SA-POL-003",
    "SE-F-051": "SE-F-037", "SE-F-052": "SE-F-038", "SE-F-053": "SE-F-039",
    "SE-F-054": "SE-F-040", "SE-F-055": "SE-F-041",
    "SA-F-018": "SA-F-007", "SA-F-019": "SA-F-008", "SA-F-020": "SA-F-009",
    "SA-HOOK-002": "SA-HOOK-001", "SA-POL-005": "SA-POL-001",
    "SA-POL-006": "SA-POL-002", "SA-POL-008": "SA-POL-004",
    "SA-PRJ-002": "SA-PRJ-001",
    # cycle 4 (§5): one real defect = one ledger row
    "SE-F-056": "SE-F-041",   # same project PATCH/DELETE stub, second report
    "SA-F-014": "SA-F-008",   # same non-atomic session persistence, second report
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
        elif fid in SUPERSEDED and not row[-1].startswith(("invalid", "fixed", "superseded")):
            row[-1] = f"superseded — verified 2026-10-07 (ledger reconciliation): {SUPERSEDED[fid]}"
            changed += 1
        elif fid in DUPLICATES and not row[-1].startswith("duplicate"):
            primary = DUPLICATES[fid]
            row[4] = primary  # duplicate_of column
            row[-1] = f"duplicate — merged into {primary} (ledger reconciliation 2026-10-07; §5 one defect = one backlog item)"
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
