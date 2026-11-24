"use strict";

module.exports = [
    {
        "key": "MCP_GATEWAY_APPROVAL_TTL_MS",
        "group": "mcp",
        "type": "number",
        "default": 900000,
        "min": 0,
        "max": 86400000,
        "description": "How long an approval answer for a global MCP server is reused before the next call asks again (P0-2). 0 asks every time."
    },
    {
        "key": "WORKSPACE_ROOT",
        "group": "workspace",
        "type": "string",
        "default": null,
        "fixed": true,
        "description": "Directory the agent may act in. Fixed at startup because every path check depends on it."
    },
    {
        "key": "STRUCTURED_AI_DATA_HOME",
        "group": "persistence",
        "type": "string",
        "default": null,
        "description": "Data home for the project registry and per-project state (Phase 2+). Empty means ~/.local/share/structured-ai."
    },
    {
        "key": "STRUCTURED_AI_TRUST_FILE",
        "group": "workspace",
        "type": "string",
        "default": null,
        "description": "File that records which workspaces the operator trusted (roadmap P0-1). Empty means ~/.config/structured-ai/trusted-workspaces.json (~\\AppData\\Roaming\\structured-ai on Windows). Never taken from a project file."
    },
    {
        "key": "RUN_HISTORY_LIMIT",
        "group": "runtime",
        "type": "number",
        "default": 100,
        "min": 1,
        "description": "How many settled runs the RunManager keeps queryable after they finish."
    },
    {
        "key": "APPROVAL_HISTORY_LIMIT",
        "group": "runtime",
        "type": "number",
        "default": 500,
        "min": 1,
        "description": "How many settled approval decisions the ApprovalStore keeps in its bounded in-process history (POL-045)."
    },
    {
        "key": "MAX_CONCURRENT_PROJECT_RUNS",
        "group": "runtime",
        "type": "number",
        "default": 4,
        "min": 1,
        "max": 64,
        "description": "How many distinct projects may have an active run at once (Phase 10). Extra projects wait on their own queue."
    },
    {
        "key": "MAX_RUNS_PER_PROJECT",
        "group": "runtime",
        "type": "number",
        "default": 1,
        "min": 1,
        "max": 32,
        "description": "Active runs allowed inside one project (Phase 10). Default 1 serializes a project's runs."
    },
    {
        "key": "MAX_CONCURRENT_INDEX_RUNS",
        "group": "runtime",
        "type": "number",
        "default": 2,
        "min": 1,
        "max": 16,
        "description": "How many semantic index jobs may run at once across all projects (Phase 10)."
    },
    {
        "key": "MAX_WORKERS_PER_USER",
        "group": "runtime",
        "type": "number",
        "default": 8,
        "min": 1,
        "max": 128,
        "description": "Hard cap on total inflight runs for this process (Phase 10)."
    },
    {
        "key": "RUN_QUEUE_LIMIT",
        "group": "runtime",
        "type": "number",
        "default": 16,
        "min": 0,
        "max": 1000,
        "description": "Per-project waiting-run depth (Phase 10). Overflow is rejected with RUN_QUEUE_FULL rather than hanging."
    },
    {
        "key": "PROJECT_MEMORY_LIMIT",
        "group": "runtime",
        "type": "number",
        "default": 0,
        "min": 0,
        "description": "Bytes of recorded per-project memory after which new runs are refused (Phase 10). 0 disables the cap; the value is always exposed on /api/metrics."
    },
    {
        "key": "PROJECT_CPU_LIMIT",
        "group": "runtime",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 100,
        "description": "Observational CPU percent ceiling per project (Phase 10). 0 means unlimited; the live percent is reported on /api/metrics."
    },
    {
        "key": "SEMANTIC_POOL_CACHE_LIMIT",
        "group": "runtime",
        "type": "number",
        "default": 200,
        "min": 0,
        "description": "How many memoized query results one SemanticClient pool entry keeps per project (0 disables memoization). Entries are additionally invalidated on an index-generation change reported by the worker."
    }
];
