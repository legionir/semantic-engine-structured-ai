"use strict";

module.exports = [
    {
        "key": "ARCHIVE_WEIGHT_MUTATION",
        "group": "archive",
        "type": "number",
        "default": 0.8,
        "min": 0,
        "max": 1,
        "description": "Importance of a write, a move, a delete or a commit."
    },
    {
        "key": "ARCHIVE_WEIGHT_COMMAND",
        "group": "archive",
        "type": "number",
        "default": 0.55,
        "min": 0,
        "max": 1,
        "description": "Importance of a command that ran successfully."
    },
    {
        "key": "ARCHIVE_WEIGHT_INSPECTION",
        "group": "archive",
        "type": "number",
        "default": 0.25,
        "min": 0,
        "max": 1,
        "description": "Importance of a read, a listing or a search."
    },
    {
        "key": "ARCHIVE_WEIGHT_ROLLUP",
        "group": "archive",
        "type": "number",
        "default": 0.35,
        "min": 0,
        "max": 1,
        "description": "Importance of a merged group of old events."
    },
    {
        "key": "ARCHIVE_SCORE_MATCH",
        "group": "archive",
        "type": "number",
        "default": 1,
        "min": 0,
        "max": 10,
        "description": "Weight of keyword overlap when ranking archive results."
    },
    {
        "key": "ARCHIVE_SCORE_IMPORTANCE",
        "group": "archive",
        "type": "number",
        "default": 0.5,
        "min": 0,
        "max": 10,
        "description": "Weight of importance when ranking archive results."
    },
    {
        "key": "ARCHIVE_SCORE_RECENCY",
        "group": "archive",
        "type": "number",
        "default": 0.25,
        "min": 0,
        "max": 10,
        "description": "Weight of recency when ranking archive results."
    },
    {
        "key": "MAX_TOOL_RESULT_CHARS",
        "group": "context",
        "type": "number",
        "default": 20000,
        "min": 500,
        "description": "Cap on a single string inside a tool result."
    },
    {
        "key": "MAX_TOOL_RESULT_TOTAL_CHARS",
        "group": "context",
        "type": "number",
        "default": 40000,
        "min": 1000,
        "description": "Cap on a whole tool result; lists are shortened to fit."
    },
    {
        "key": "MAX_EMPTY_FINAL_NUDGES",
        "group": "persistence",
        "type": "number",
        "default": 1,
        "min": 0,
        "max": 10,
        "description": "Times a final answer with no work is handed back."
    },
    {
        "key": "DELEGATION_NUDGE_AFTER",
        "group": "delegation",
        "type": "number",
        "default": 8,
        "min": 0,
        "max": 100,
        "description": "Iterations the root may work alone, while the plan has open steps and the agent budget is untouched, before it is reminded that sub-agents exist. 0 disables the reminder."
    },
    {
        "key": "MAX_DELEGATION_NUDGES",
        "group": "delegation",
        "type": "number",
        "default": 2,
        "min": 0,
        "max": 10,
        "description": "How many times one run may be reminded. A reminder that is ignored twice is not worth a third request."
    },
    {
        "key": "MAX_PLAN_CONTINUATIONS",
        "group": "persistence",
        "type": "number",
        "default": 8,
        "min": 0,
        "max": 100,
        "description": "Times per run a final answer is refused while the plan has open steps."
    },
    {
        "key": "MAX_AUTO_CYCLES",
        "group": "persistence",
        "type": "number",
        "default": 20,
        "min": 1,
        "max": 500,
        "description": "Safety limit for automatic continuation in the console."
    },
    {
        "key": "MAX_MALFORMED_RESPONSES",
        "group": "persistence",
        "type": "number",
        "default": 2,
        "min": 0,
        "max": 20,
        "description": "Unreadable model answers handed back for another attempt before the run fails."
    },
    {
        "key": "MAX_REPEATED_FAILURES",
        "group": "persistence",
        "type": "number",
        "default": 3,
        "min": 1,
        "max": 20,
        "description": "Identical consecutive failures before the agent is stopped."
    },
    {
        "key": "AGENT_APPROVAL",
        "group": "policy",
        "type": "enum",
        "values": [
            "auto",
            "prompt",
            "deny"
        ],
        "default": "prompt",
        "description": "How a call that needs approval is answered. The safe default asks an operator."
    },
    {
        "key": "ALLOW_PRIVATE_NETWORK",
        "group": "policy",
        "type": "boolean",
        "default": false,
        "description": "Let net_fetch reach loopback and private addresses."
    },
    {
        "key": "NET_ALLOWED_HOSTS",
        "group": "policy",
        "type": "string",
        "default": "",
        "description": "Comma separated hosts exempt from the private network check."
    },
    {
        "key": "MAX_HTTP_RESPONSE_CHARS",
        "group": "tools",
        "type": "number",
        "default": 40000,
        "min": 1000,
        "description": "Characters kept from an HTTP response body."
    },
    {
        "key": "MAX_HTTP_REDIRECTS",
        "group": "tools",
        "type": "number",
        "default": 5,
        "min": 0,
        "max": 20,
        "description": "Redirects followed by net_fetch."
    },
    {
        "key": "MAX_PROCESS_BUFFER_CHARS",
        "group": "tools",
        "type": "number",
        "default": 200000,
        "min": 1000,
        "description": "Output buffered per background process."
    },
    {
        "key": "MAX_HASH_BYTES",
        "group": "tools",
        "type": "number",
        "default": 52428800,
        "min": 0,
        "description": "Largest file fs_info will hash."
    },
    {
        "key": "WRITE_SHRINK_WARNING",
        "group": "tools",
        "type": "number",
        "default": 0.4,
        "min": 0,
        "max": 1,
        "description": "Share of a file an overwrite may remove before the result carries a warning. 1 disables the warning."
    },
    {
        "key": "SKILL_RESOURCE_CHARS",
        "group": "tools",
        "type": "number",
        "default": 8000,
        "min": 500,
        "max": 200000,
        "description": "Cap on one slice of a skill resource, so a house style cannot flood the conversation."
    },
    {
        "key": "WRITE_EDIT_HINT_BYTES",
        "group": "tools",
        "type": "number",
        "default": 4000,
        "min": 0,
        "max": 1000000,
        "description": "Overwriting an existing file larger than this suggests fs_edit instead. 0 turns the suggestion off."
    },
    {
        "key": "PROCESS_SANDBOX_MODE",
        "group": "policy",
        "type": "enum",
        "values": [
            "deny",
            "bwrap",
            "docker",
            "podman",
            "test"
        ],
        "default": "deny",
        "description": "Process execution mode. deny is fail-closed; bwrap is Linux-only; docker and podman require a running container engine; test is only for the repository test harness."
    },
    {
        "key": "PROCESS_SANDBOX_IMAGE",
        "group": "policy",
        "type": "string",
        "default": "node:22-bookworm",
        "description": "Container image for Docker/Podman process sandboxes. Repository project files cannot override it."
    },
    {
        "key": "PROCESS_SANDBOX_NETWORK",
        "group": "policy",
        "type": "enum",
        "values": [
            "none",
            "bridge"
        ],
        "default": "none",
        "description": "Container network mode. none is isolated; bridge grants general egress and must be explicitly selected by the operator."
    },
    {
        "key": "PROCESS_SANDBOX_CPUS",
        "group": "policy",
        "type": "number",
        "default": 2,
        "min": 0.25,
        "max": 64,
        "description": "Maximum CPU quota for one Docker/Podman sandbox."
    },
    {
        "key": "PROCESS_SANDBOX_MEMORY_MB",
        "group": "policy",
        "type": "number",
        "default": 2048,
        "min": 128,
        "max": 65536,
        "description": "Memory limit in MiB for one Docker/Podman sandbox."
    },
    {
        "key": "PROCESS_SANDBOX_PIDS_LIMIT",
        "group": "policy",
        "type": "number",
        "default": 256,
        "min": 16,
        "max": 4096,
        "description": "Maximum process count for one Docker/Podman sandbox."
    },
    {
        "key": "PROCESS_SANDBOX_TMP_MB",
        "group": "policy",
        "type": "number",
        "default": 512,
        "min": 32,
        "max": 16384,
        "description": "Size of the writable /tmp tmpfs inside a Docker/Podman sandbox, in MiB."
    },
    {
        "key": "TERMINAL_TIMEOUT_MS",
        "group": "tools",
        "type": "number",
        "default": 30000,
        "min": 1000,
        "max": 3600000,
        "description": "Default timeout for terminal_exec when the call does not set one."
    },
    {
        "key": "TERMINAL_CANCEL_GRACE_MS",
        "group": "tools",
        "type": "number",
        "default": 2000,
        "min": 0,
        "max": 60000,
        "description": "When a run is stopped, a running terminal_exec command gets SIGTERM and, after this many milliseconds, SIGKILL."
    },
    {
        "key": "TOOL_CANCEL_WAIT_MS",
        "group": "tools",
        "type": "number",
        "default": 3000,
        "min": 0,
        "max": 60000,
        "description": "When a run is stopped, how long the runtime waits for a running tool to stop on its own before it abandons the call and ends the run."
    },
    {
        "key": "GIT_TIMEOUT_MS",
        "group": "tools",
        "type": "number",
        "default": 30000,
        "min": 1000,
        "description": "Timeout for a single git command."
    },
    {
        "key": "HOOKS_ENABLED",
        "group": "hooks",
        "type": "boolean",
        "default": false,
        "description": "Run declarative before_task and after_task hooks. Off by default; projects opt in through .agent/project.json."
    },
    {
        "key": "HOOK_TIMEOUT_MS",
        "group": "hooks",
        "type": "number",
        "default": 300000,
        "min": 1000,
        "max": 3600000,
        "description": "Independent wall-clock budget for each hook phase, including after_task when the main run deadline was spent."
    },
    {
        "key": "HOOKS_ON_FAILURE",
        "group": "hooks",
        "type": "enum",
        "values": [
            "report",
            "stop"
        ],
        "default": "report",
        "description": "Default failure policy for a hook that does not declare on_failure."
    },
    {
        "key": "PLAN_AUTOROUTE",
        "group": "planning",
        "type": "boolean",
        "default": false,
        "description": "Automatically delegate the next open plan step to its assigned agent profile. Experimental and off by default."
    },
    {
        "key": "REPO_DETECT_TIMEOUT_MS",
        "group": "tools",
        "type": "number",
        "default": 5000,
        "min": 500,
        "description": "Timeout for the repository detection that fills the runtime context."
    },
    {
        "key": "MAX_SEARCH_SESSIONS",
        "group": "tools",
        "type": "number",
        "default": 32,
        "min": 1,
        "max": 500,
        "description": "Search sessions kept before the finished ones are pruned."
    },
    {
        "key": "BINARY_PROBE_BYTES",
        "group": "tools",
        "type": "number",
        "default": 8192,
        "min": 256,
        "description": "Bytes inspected when deciding whether a file is binary."
    },
    {
        "key": "IGNORED_DIRECTORIES",
        "group": "tools",
        "type": "string",
        "default": "node_modules,.git,dist,build,coverage,.cache,.next,.venv,__pycache__",
        "description": "Directory names skipped by tree walks and searches."
    }
];
