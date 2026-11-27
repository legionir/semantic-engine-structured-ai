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
        "key": "LOG_LEVEL",
        "group": "logging",
        "type": "enum",
        "values": [
            "debug",
            "info",
            "warn",
            "error"
        ],
        "default": "info",
        "description": "Lowest level kept in the application log (Logs in the console): failed AI requests and retries, run, tool, hook and MCP failures, server errors and crashes."
    },
    {
        "key": "LOG_BUFFER_ENTRIES",
        "group": "logging",
        "type": "number",
        "default": 2000,
        "min": 100,
        "max": 50000,
        "description": "Application log entries kept in memory for the console."
    },
    {
        "key": "LOG_FILE_ENABLED",
        "group": "logging",
        "type": "boolean",
        "default": true,
        "description": "When the console is served, also append the application log to <data home>/logs/structured-ai.jsonl."
    },
    {
        "key": "LOG_FILE_MAX_MB",
        "group": "logging",
        "type": "number",
        "default": 10,
        "min": 1,
        "max": 1024,
        "description": "Size at which the application log file is rotated."
    },
    {
        "key": "LOG_FILE_KEEP",
        "group": "logging",
        "type": "number",
        "default": 3,
        "min": 1,
        "max": 20,
        "description": "Rotated application log files kept next to the current one (.1 is the newest)."
    },
    {
        "key": "LOG_MAX_FIELD_CHARS",
        "group": "logging",
        "type": "number",
        "default": 8000,
        "min": 500,
        "max": 200000,
        "description": "Longest message or detail text (such as a model's error response) kept in one log entry before it is clipped."
    },
    {
        "key": "TRUSTED_PROXIES",
        "group": "console",
        "type": "string",
        "default": "",
        "fixed": true,
        "description": "Comma-separated list of trusted reverse proxy IP addresses (for example 127.0.0.1,::1). Empty ignores X-Forwarded-Host and X-Forwarded-Proto headers."
    },
    {
        "key": "CONSOLE_PASSWORD_SESSION_TTL_MS",
        "group": "console",
        "type": "number",
        "default": 86400000,
        "min": 60000,
        "max": 2592000000,
        "description": "How long one password sign-in stays valid when AGENT_CONSOLE_PASSWORD_REQUIRED is on, in milliseconds. Each sign-in gets its own session; a restart ends all of them."
    },
    {
        "key": "CONSOLE_PASSWORD_SESSIONS_MAX",
        "group": "console",
        "type": "number",
        "default": 500,
        "min": 1,
        "max": 100000,
        "description": "Most password sign-in sessions kept at once. Expired sessions go first, then the oldest is dropped to make room for a new sign-in."
    },
    {
        "key": "CONSOLE_TERMINAL_ENABLED",
        "group": "console",
        "type": "boolean",
        "default": true,
        "fixed": true,
        "description": "Allow the admin console token to open system terminals (an unsandboxed shell in the workspace, running as the server's user). Set through the environment and restart to change it."
    },
    {
        "key": "CONSOLE_TERMINAL_MAX_SESSIONS",
        "group": "console",
        "type": "number",
        "default": 4,
        "min": 1,
        "max": 32,
        "description": "Terminals that may be open at the same time."
    },
    {
        "key": "CONSOLE_TERMINAL_SCROLLBACK_CHARS",
        "group": "console",
        "type": "number",
        "default": 262144,
        "min": 4096,
        "max": 16777216,
        "description": "Terminal output the server keeps per terminal, replayed when the console reconnects or reopens it."
    },
    {
        "key": "CONSOLE_FILE_MANAGER_ENABLED",
        "group": "console",
        "type": "boolean",
        "default": true,
        "fixed": true,
        "description": "Allow the admin console token to browse, create, edit, rename and delete files inside the workspace. Set through the environment and restart to change it."
    },
    {
        "key": "CONSOLE_FILE_MAX_BYTES",
        "group": "console",
        "type": "number",
        "default": 2097152,
        "min": 1024,
        "max": 52428800,
        "description": "Largest file the console file manager opens or saves as text."
    },
    {
        "key": "CONSOLE_FILE_UPLOAD_MAX_BYTES",
        "group": "console",
        "type": "number",
        "default": 52428800,
        "min": 1024,
        "max": 2147483648,
        "description": "Largest file the console file manager accepts as an upload (any file type). The body is streamed to disk, so this is not held in memory."
    },
    {
        "key": "CONSOLE_FILE_LIST_MAX",
        "group": "console",
        "type": "number",
        "default": 5000,
        "min": 100,
        "max": 100000,
        "description": "Entries the console file manager lists in one folder; a larger folder is shown truncated."
    },
    {
        "key": "PROJECT_INSTRUCTIONS_ENABLED",
        "group": "context",
        "type": "boolean",
        "default": true,
        "description": "Put the workspace's AGENTS.md / CLAUDE.md (AGENTS.override.md wins) into every prompt, and list the instruction files of sub-directories for the agent to read (roadmap P1-01)."
    },
    {
        "key": "PROJECT_INSTRUCTIONS_MAX_CHARS",
        "group": "context",
        "type": "number",
        "default": 32768,
        "min": 1024,
        "max": 262144,
        "description": "How many characters of the root instruction files reach the model; the rest is cut and the cut is reported once to the application log."
    },
    {
        "key": "PROJECT_INSTRUCTIONS_SCAN_DEPTH",
        "group": "context",
        "type": "number",
        "default": 3,
        "min": 0,
        "max": 8,
        "description": "How many directory levels below the workspace root are searched for AGENTS.md / CLAUDE.md files to list. 0 lists none."
    },
    {
        "key": "CHILD_ENV_PASSTHROUGH",
        "group": "policy",
        "type": "string",
        "default": "",
        "description": "Extra environment variable names (comma or space separated) passed to processes started for the model: terminal, background processes, git, stdio MCP servers. A name that looks like a credential (KEY, TOKEN, SECRET, PASSWORD, AUTH...) is never passed, even when listed (roadmap P2-02)."
    },
    {
        "key": "MODEL_IMAGE_INPUT",
        "group": "endpoint",
        "type": "enum",
        "values": ["on", "off"],
        "default": "on",
        "description": "Whether pictures reach the model: screenshots and other images returned by MCP tools, and images attached to a message. off keeps a text placeholder, for a model that cannot read images (roadmap P3-01, P1-09)."
    },
    {
        "key": "MODEL_IMAGE_MAX_BYTES",
        "group": "endpoint",
        "type": "number",
        "default": 3932160,
        "min": 1024,
        "max": 20971520,
        "description": "Largest picture (decoded bytes) sent to the model; a larger one is replaced by a note saying why."
    },
    {
        "key": "IMAGE_CONTEXT_CHARS",
        "group": "context",
        "type": "number",
        "default": 3000,
        "min": 0,
        "max": 100000,
        "description": "How many characters one image part counts as when the conversation size is measured for compaction; its base64 text is not counted."
    },
    {
        "key": "SKILLS_MARKDOWN_ENABLED",
        "group": "tools",
        "type": "boolean",
        "default": true,
        "description": "Load SKILL.md skills from .agent/skills and .claude/skills of the project, <data home>/skills and agent/skills, next to the registry skills (roadmap P3-02)."
    },
    {
        "key": "TASK_MENTION_MAX_CHARS",
        "group": "context",
        "type": "number",
        "default": 40000,
        "min": 0,
        "max": 400000,
        "description": "How many characters of the files named with @path in a message are read into it, for all mentions together; the rest is named but not inlined (roadmap P1-09)."
    },
    {
        "key": "SKILL_COMMANDS",
        "group": "tools",
        "type": "enum",
        "values": ["off", "read-only"],
        "default": "read-only",
        "description": "Whether !`command` in a SKILL.md body is replaced by its output when the skill is loaded: read-only runs commands CommandRisk rates low, from shipped or operator skills and trusted workspaces only; off runs none."
    },
    {
        "key": "PROJECT_QUEUE_MAX",
        "group": "console",
        "type": "number",
        "default": 20,
        "min": 0,
        "max": 200,
        "description": "Messages a project's conversation keeps queued while its run is busy; each starts as the next turn when the run ends. 0 turns the queue off and a busy project answers 409 as before (roadmap P1-04)."
    },
    {
        "key": "RESOURCE_MONITOR_INTERVAL_MS",
        "group": "runtime",
        "type": "number",
        "default": 30000,
        "min": 0,
        "max": 3600000,
        "description": "How often the console samples CPU, memory and disk and checks the low-memory and low-disk limits (roadmap P1-07). 0 turns the warnings off; the System view still samples on demand."
    },
    {
        "key": "RESOURCE_MIN_FREE_MEMORY_MB",
        "group": "runtime",
        "type": "number",
        "default": 200,
        "min": 0,
        "description": "Available memory in MB below which a warning goes to the global log and the System view. 0 disables the memory warning."
    },
    {
        "key": "RESOURCE_MIN_FREE_DISK_MB",
        "group": "runtime",
        "type": "number",
        "default": 1024,
        "min": 0,
        "description": "Free disk space in MB (where the data home and the workspace live) below which a warning goes to the global log and the System view. 0 disables the disk warning."
    },
    {
        "key": "PROCESS_ORPHAN_SWEEP",
        "group": "tools",
        "type": "boolean",
        "default": true,
        "description": "When the console starts, stop the background processes a previous runtime started and could not stop because it was killed (recorded in <data home>/processes.json; on Linux a process is stopped only when its start time still matches)."
    },
    {
        "key": "PROJECTS_ROOT",
        "group": "workspace",
        "type": "string",
        "default": "",
        "description": "Folder that projects cloned from a git URL are created in (roadmap P1-02). Empty: <data home>/projects. A clone can never be placed outside it."
    },
    {
        "key": "GIT_CLONE_TOKEN",
        "group": "workspace",
        "type": "string",
        "default": "",
        "secret": true,
        "description": "Access token for cloning private repositories over https when no secret is named in the clone form. Read from the environment; prefer a secret in the secret store (GITHUB_PAT for github.com, GITLAB_TOKEN for gitlab.com are used automatically)."
    },
    {
        "key": "GIT_CLONE_TIMEOUT_MS",
        "group": "workspace",
        "type": "number",
        "default": 900000,
        "min": 10000,
        "description": "Longest a clone may run before it is stopped and its half-written folder removed."
    },
    {
        "key": "SESSION_CHECKPOINT_MS",
        "group": "persistence",
        "type": "number",
        "default": 3000,
        "min": 0,
        "max": 600000,
        "description": "While a turn runs, its conversation (with the agent's progress so far) is saved at most this often, so a server restart loses at most this much and the turn can be continued (roadmap P1-06). 0 saves only when a turn ends."
    }
];
