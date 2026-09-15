# Forensic audit reports

This directory contains the forensic, non-security review artifacts for the two projects in this repository:

- `semantic-engine/` — code-intelligence platform and semantic engine.
- `structured-ai/` — hierarchical-agent runtime platform.

## Audited revision

All reports target the same `main` snapshot:

`3a20f3192e43c5cf2723cd524e08e013f941a4ed`

The reports are static code-review artifacts. They do not claim that the complete test suite passed. Security was explicitly excluded from this audit at the request of the repository owner.

## Report map

| Report | Project / purpose | Coverage and status |
|---|---|---|
| `semantic-engine-audit.md` | Baseline forensic review of `semantic-engine/` | 74 of 524 blobs directly reviewed. Covers multi-project registration, selection/switch, management, persistence, Gateway/API, dashboard, indexing, and Semantic Engine ↔ Structured AI/MCP integration. |
| `semantic-engine-audit-supplement.md` | Follow-up review of `semantic-engine/` | Adds 58 deduplicated files; 132 of 524 blobs reviewed cumulatively. Extends coverage across runtime queue/worker, watch/embedding, visualization, context/search, SQLite graph export/query, provider/vector, history/provider/server support, scripts, public UI, and targeted tests. |
| `structured-ai-audit.md` | Baseline forensic review of `structured-ai/` | 47 of 357 blobs directly reviewed. Covers project registry/context/resolution, persistence, runtime/run lifecycle, cancellation, scheduling, delegation, tools, MCP, process tools, CI, and project/concurrency tests. |
| `structured-ai-audit-supplement.md` | Follow-up review of `structured-ai/` | Adds 73 targeted files; 120 of 357 blobs reviewed cumulatively. Extends coverage across web support/controllers/services/serializers, browser app, runtime/config/project migration, registry/tooling, filesystem/path/directory, planning/search/git/archive/memory/skills/code-index/LSP, context/persistence, MCP transport, deployment/config, and targeted tests. |
| `audit-progress-2026-09-15.md` | Chronological checkpoint log | Consolidates later verified findings and workflow checkpoints after the baseline reports, including lifecycle, API, dashboard, visualization, project scoping, cancellation, persistence, and policy/hook findings. |
| `forensic-lifecycle-findings-2026-09-15.md` | Focused lifecycle/policy/hooks supplement | Records later findings for run error events, cross-project delegation/MCP, signal cancellation, queued-run cancellation, hook dependency stop behavior, policy regex validation, approval cancellation, approval history, and hook registry project binding. |

## Coverage model

The audit inventory files are committed beside the reports:

- `tree-files.tsv` — complete `semantic-engine/` blob inventory at the audited revision.
- `structured-ai-tree.txt` — complete `structured-ai/` tree inventory at the audited revision.

A file being present in an inventory does not mean it was reviewed. The reports distinguish **directly reviewed**, **fetched but not directly reviewed**, **tree-only**, and **generated/binary** material. No source file was modified by the audit.

## Findings and certainty

Findings use the reports' evidence standard:

- Confirmed findings include quoted source evidence and a traced execution path.
- Potential/unverified findings remain separate and list missing evidence.
- Security findings are intentionally absent because security review was out of scope.
- The reports are cumulative by project; supplements do not repeat baseline finding IDs unless explicitly stated.

## Important limitation

This is an evidence-backed checkpoint package, not a claim that every blob in either subtree was directly inspected. At the latest recorded checkpoint, cumulative direct coverage is 132/524 for `semantic-engine/` and 120/357 for `structured-ai/`. The reports identify the remaining coverage explicitly.
