"use strict";

/*
|--------------------------------------------------------------------------
| Settings Schema — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Canonical definitions for every runtime setting: type, default, min/max,
| group, secret/fixed flags and description. Callers never read env vars
| directly; they go through SettingsStore/SettingsResolver so a change is
| visible on the next get().
|--------------------------------------------------------------------------
*/

const NUMBER = "number";
const STRING = "string";
const BOOLEAN = "boolean";
const ENUM = "enum";


/*
| group        where the value belongs in the console
| fixed        read once at startup, changing it later would be a lie
| secret       never echoed back in full
*/

const DEFINITIONS = [
    {
        key: "AGENT_BASE_URL",
        group: "endpoint",
        type: STRING,
        default: "http://localhost:4414/p/smart_routing/v1",
        description: "Base URL of the OpenAI compatible endpoint."
    },
    {
        key: "AGENT_API_KEY",
        group: "endpoint",
        type: STRING,
        default: "your-api-key",
        secret: true,
        description: "Bearer token sent with every request."
    },
    {
        key: "AGENT_MODEL",
        group: "endpoint",
        type: STRING,
        default: "auto-switch",
        description: "Model requested when a profile does not name one."
    },
    {
        key: "AGENT_CONSOLE_TOKEN",
        group: "endpoint",
        type: STRING,
        default: "",
        secret: true,
        description: "Bearer token for the web console control plane. Empty generates a token at startup."
    },
    {
        key: "AGENT_CONSOLE_TOKENS",
        group: "endpoint",
        type: STRING,
        default: "",
        secret: true,
        description: "JSON map of extra console tokens to { allowedProjects, permissions } (Phase 9). The AGENT_CONSOLE_TOKEN itself remains a master token."
    },
    {
        key: "AGENT_TEMPERATURE",
        group: "endpoint",
        type: NUMBER,
        default: 0.2,
        min: 0,
        max: 2,
        description: "Sampling temperature used when a profile does not set one."
    },
    {
        key: "RESPONSE_FORMAT_MODE",
        group: "endpoint",
        type: ENUM,
        values: ["auto", "always", "never"],
        default: "auto",
        description: "Whether to send response_format. auto stops sending it to an endpoint that rejected it, always keeps sending it, never leaves it out from the start."
    },
    {
        key: "AGENT_SCHEMA",
        group: "endpoint",
        type: ENUM,
        values: ["default", "strict"],
        default: "default",
        fixed: true,
        description: "Which response schema file to send. Read once at startup."
    },

    {
        key: "ENDPOINT_MAIN_BASE_URL",
        group: "endpoint.main",
        type: STRING,
        default: "",
        description: "Base URL for the root orchestrator. Empty inherits AGENT_BASE_URL."
    },
    {
        key: "ENDPOINT_MAIN_API_KEY",
        group: "endpoint.main",
        type: STRING,
        default: "",
        secret: true,
        description: "API key for the root orchestrator. Empty inherits AGENT_API_KEY."
    },
    {
        key: "ENDPOINT_MAIN_MODEL",
        group: "endpoint.main",
        type: STRING,
        default: "",
        description: "Model for the root orchestrator. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        key: "ENDPOINT_MAIN_TEMPERATURE",
        group: "endpoint.main",
        type: NUMBER,
        default: -1,
        min: -1,
        max: 2,
        description: "Temperature for the root orchestrator. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        key: "ENDPOINT_L1_BASE_URL",
        group: "endpoint.l1",
        type: STRING,
        default: "",
        description: "Base URL for sub-agents at depth 1. Empty inherits AGENT_BASE_URL."
    },
    {
        key: "ENDPOINT_L1_API_KEY",
        group: "endpoint.l1",
        type: STRING,
        default: "",
        secret: true,
        description: "API key for sub-agents at depth 1. Empty inherits AGENT_API_KEY."
    },
    {
        key: "ENDPOINT_L1_MODEL",
        group: "endpoint.l1",
        type: STRING,
        default: "",
        description: "Model for sub-agents at depth 1. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        key: "ENDPOINT_L1_TEMPERATURE",
        group: "endpoint.l1",
        type: NUMBER,
        default: -1,
        min: -1,
        max: 2,
        description: "Temperature for sub-agents at depth 1. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        key: "ENDPOINT_L2_BASE_URL",
        group: "endpoint.l2",
        type: STRING,
        default: "",
        description: "Base URL for sub-agents at depth 2. Empty inherits AGENT_BASE_URL."
    },
    {
        key: "ENDPOINT_L2_API_KEY",
        group: "endpoint.l2",
        type: STRING,
        default: "",
        secret: true,
        description: "API key for sub-agents at depth 2. Empty inherits AGENT_API_KEY."
    },
    {
        key: "ENDPOINT_L2_MODEL",
        group: "endpoint.l2",
        type: STRING,
        default: "",
        description: "Model for sub-agents at depth 2. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        key: "ENDPOINT_L2_TEMPERATURE",
        group: "endpoint.l2",
        type: NUMBER,
        default: -1,
        min: -1,
        max: 2,
        description: "Temperature for sub-agents at depth 2. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        key: "ENDPOINT_L3_BASE_URL",
        group: "endpoint.l3",
        type: STRING,
        default: "",
        description: "Base URL for sub-agents at depth 3 and deeper. Empty inherits AGENT_BASE_URL."
    },
    {
        key: "ENDPOINT_L3_API_KEY",
        group: "endpoint.l3",
        type: STRING,
        default: "",
        secret: true,
        description: "API key for sub-agents at depth 3 and deeper. Empty inherits AGENT_API_KEY."
    },
    {
        key: "ENDPOINT_L3_MODEL",
        group: "endpoint.l3",
        type: STRING,
        default: "",
        description: "Model for sub-agents at depth 3 and deeper. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        key: "ENDPOINT_L3_TEMPERATURE",
        group: "endpoint.l3",
        type: NUMBER,
        default: -1,
        min: -1,
        max: 2,
        description: "Temperature for sub-agents at depth 3 and deeper. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        key: "ENDPOINT_SUMMARY_BASE_URL",
        group: "endpoint.summary",
        type: STRING,
        default: "",
        description: "Base URL for the context summariser. Empty inherits AGENT_BASE_URL."
    },
    {
        key: "ENDPOINT_SUMMARY_API_KEY",
        group: "endpoint.summary",
        type: STRING,
        default: "",
        secret: true,
        description: "API key for the context summariser. Empty inherits AGENT_API_KEY."
    },
    {
        key: "ENDPOINT_SUMMARY_MODEL",
        group: "endpoint.summary",
        type: STRING,
        default: "",
        description: "Model for the context summariser. Empty inherits the profile's model, then AGENT_MODEL."
    },
    {
        key: "ENDPOINT_SUMMARY_TEMPERATURE",
        group: "endpoint.summary",
        type: NUMBER,
        default: -1,
        min: -1,
        max: 2,
        description: "Temperature for the context summariser. Minus one inherits the profile's value, then AGENT_TEMPERATURE."
    },
    {
        key: "MAX_ITERATIONS",
        group: "budget",
        type: NUMBER,
        default: 50,
        min: 1,
        max: 1000,
        description: "Iterations one agent may spend."
    },
    {
        key: "MAX_RUN_MS",
        group: "budget",
        type: NUMBER,
        default: 600000,
        min: 1000,
        description: "Wall clock budget for a whole run."
    },
    {
        key: "MAX_REQUEST_MS",
        group: "budget",
        type: NUMBER,
        default: 120000,
        min: 1000,
        description: "Timeout for a single model request."
    },
    {
        key: "MAX_REQUEST_RETRIES",
        group: "budget",
        type: NUMBER,
        default: 3,
        min: 0,
        max: 10,
        description: "Retries after a transient endpoint failure."
    },
    {
        key: "RETRY_BASE_MS",
        group: "budget",
        type: NUMBER,
        default: 500,
        min: 10,
        description: "Base delay for the retry backoff."
    },

    {
        key: "SKILLS_INLINE_FOR_SUBAGENTS",
        group: "delegation",
        type: BOOLEAN,
        default: true,
        description: "Put a sub-agent's own skills in its prompt in full. Off, it receives the same index the root gets and reads them with skill_get, which is cheaper and one call away from being ignored."
    },
    {
        key: "MAX_AGENT_DEPTH",
        group: "delegation",
        type: NUMBER,
        default: 3,
        min: 0,
        max: 10,
        description: "Hard cap on delegation depth."
    },
    {
        key: "MAX_TOTAL_AGENTS",
        group: "delegation",
        type: NUMBER,
        default: 15,
        min: 0,
        max: 200,
        description: "Sub-agents a single run may spawn."
    },
    {
        key: "MAX_PARALLEL_AGENTS",
        group: "delegation",
        type: NUMBER,
        default: 4,
        min: 1,
        max: 32,
        description: "Sub-agents executed at the same time."
    },
    {
        key: "MAX_PARALLEL_TOOLS",
        group: "delegation",
        type: NUMBER,
        default: 8,
        min: 1,
        max: 64,
        description: "Tools executed at the same time."
    },

    {
        key: "RUN_WRAPUP_MS",
        group: "budget",
        type: NUMBER,
        default: 60000,
        min: 0,
        max: 600000,
        description: "Slice of the run budget reserved for finishing. When this much time is left the agent is told to stop exploring and answer with what it has. 0 disables it, and the run simply hits the deadline."
    },
    {
        key: "RUN_WRAPUP_FRACTION",
        group: "budget",
        type: NUMBER,
        default: 0.15,
        min: 0,
        max: 0.5,
        description: "Ceiling on the wrap-up slice as a share of the run budget, so a short run is not asked to finish before it starts."
    },
    {
        key: "MAX_RESPONSE_TOKENS",
        group: "budget",
        type: NUMBER,
        default: 0,
        min: 0,
        max: 200000,
        description: "Ceiling sent as max_tokens on every agent request. 0 leaves it out, which lets the endpoint decide. Raise it when the agent writes large files and the answer is cut off."
    },
    {
        key: "MAX_CONTEXT_CHARS",
        group: "context",
        type: NUMBER,
        default: 300000,
        min: 10000,
        description: "Size budget for the whole conversation."
    },
    {
        key: "KEEP_RECENT_EXCHANGES",
        group: "context",
        type: NUMBER,
        default: 3,
        min: 1,
        max: 50,
        description: "Most recent tool exchanges that are never compressed."
    },
    {
        key: "CONTEXT_LIGHT_FRACTION",
        group: "context",
        type: NUMBER,
        default: 0.4,
        min: 0,
        max: 1,
        description: "Share of the transcript, counted from the newest end, compressed only lightly."
    },
    {
        key: "CONTEXT_MEDIUM_FRACTION",
        group: "context",
        type: NUMBER,
        default: 0.6,
        min: 0,
        max: 1,
        description: "Share of the transcript compressed moderately. Everything older is compressed hard."
    },
    {
        key: "CONTEXT_LIGHT_CHARS",
        group: "context",
        type: NUMBER,
        default: 2000,
        min: 100,
        description: "Characters kept from a lightly compressed result."
    },
    {
        key: "CONTEXT_MEDIUM_CHARS",
        group: "context",
        type: NUMBER,
        default: 500,
        min: 50,
        description: "Characters kept from a moderately compressed result."
    },
    {
        key: "CONTEXT_COMPACT_AT",
        group: "context",
        type: NUMBER,
        default: 0.7,
        min: 0.1,
        max: 1,
        description: "Share of the context budget that triggers compaction at the start of an iteration."
    },
    {
        key: "AUTO_CONTINUE",
        group: "persistence",
        type: BOOLEAN,
        default: false,
        description: "In the console, start the next cycle automatically while the plan still has open steps."
    },
    {
        key: "CONTEXT_SUMMARY",
        group: "context",
        type: BOOLEAN,
        default: true,
        description: "Ask the model to summarise the oldest exchanges instead of reducing them to one line."
    },
    {
        key: "CONTEXT_SUMMARY_MAX_TOKENS",
        group: "context",
        type: NUMBER,
        default: 700,
        min: 100,
        max: 8000,
        description: "Upper bound on the digest the summariser may write."
    },
    {
        key: "CONTEXT_SUMMARY_MS",
        group: "context",
        type: NUMBER,
        default: 30000,
        min: 1000,
        description: "Timeout for a summariser request, so a slow digest cannot eat the run budget."
    },
    {
        key: "CONTEXT_SUMMARY_CHARS",
        group: "context",
        type: NUMBER,
        default: 1500,
        min: 200,
        max: 20000,
        description: "Size budget for a generated digest of old exchanges."
    },
    {
        key: "MEMORY_ENABLED",
        group: "memory",
        type: BOOLEAN,
        default: true,
        description: "Fold old exchanges into a structured working memory instead of only trimming them."
    },
    {
        key: "MEMORY_CHUNK_CHARS",
        group: "memory",
        type: NUMBER,
        default: 6000,
        min: 500,
        max: 200000,
        description: "Largest slice of history handed to the summariser at once. Keep it inside the summariser's context window."
    },
    {
        key: "MEMORY_MAX_SUMMARY_CALLS",
        group: "memory",
        type: NUMBER,
        default: 4,
        min: 1,
        max: 100,
        description: "Maximum model summariser calls in one memory fold. Extra chunks remain retrievable from the archive instead of causing an unbounded request loop."
    },
    {
        key: "MEMORY_SUMMARY_PARALLELISM",
        group: "memory",
        type: NUMBER,
        default: 4,
        min: 1,
        max: 20,
        description: "Memory chunks summarised concurrently within the per-fold call cap."
    },
    {
        key: "MEMORY_MAX_ITEMS",
        group: "memory",
        type: NUMBER,
        default: 12,
        min: 3,
        max: 100,
        description: "Entries kept per memory list before the oldest are dropped."
    },
    {
        key: "MEMORY_MAX_CHARS",
        group: "memory",
        type: NUMBER,
        default: 4000,
        min: 500,
        description: "Size at which memory is folded back into itself."
    },
    {
        key: "ARCHIVE_ENABLED",
        group: "archive",
        type: BOOLEAN,
        default: true,
        description: "Keep every folded exchange as a retrievable record on disk instead of only in working memory."
    },
    {
        key: "ARCHIVE_BODY_CHARS",
        group: "archive",
        type: NUMBER,
        default: 4000,
        min: 200,
        max: 100000,
        description: "Largest body stored for one archived event."
    },
    {
        key: "ARCHIVE_SUMMARY_CHARS",
        group: "archive",
        type: NUMBER,
        default: 240,
        min: 40,
        max: 4000,
        description: "Preview kept in the index, so a search can rank without opening a segment."
    },
    {
        key: "ARCHIVE_TITLE_CHARS",
        group: "archive",
        type: NUMBER,
        default: 160,
        min: 20,
        max: 2000,
        description: "Cap on the title and error text of an archived event."
    },
    {
        key: "ARCHIVE_MAX_TAGS",
        group: "archive",
        type: NUMBER,
        default: 8,
        min: 1,
        max: 64,
        description: "Tags kept per record for keyword retrieval."
    },
    {
        key: "ARCHIVE_SEGMENT_RECORDS",
        group: "archive",
        type: NUMBER,
        default: 500,
        min: 10,
        max: 100000,
        description: "Records per segment file before a new one is started."
    },
    {
        key: "ARCHIVE_MAX_RECORDS",
        group: "archive",
        type: NUMBER,
        default: 2000,
        min: 10,
        description: "Index size at which old low value records are rolled up."
    },
    {
        key: "ARCHIVE_KEEP_IMPORTANCE",
        group: "archive",
        type: NUMBER,
        default: 0.7,
        min: 0,
        max: 1,
        description: "Records at or above this importance are never rolled up."
    },
    {
        key: "ARCHIVE_ROLLUP_BATCH",
        group: "archive",
        type: NUMBER,
        default: 100,
        min: 1,
        description: "Extra records merged beyond the overflow, so a roll up buys room for a while."
    },
    {
        key: "ARCHIVE_ROLLUP_BODY_CHARS",
        group: "archive",
        type: NUMBER,
        default: 20000,
        min: 500,
        max: 500000,
        description: "Size of a rolled up body, which summarises many events and so needs more room than a single one."
    },
    {
        key: "ARCHIVE_KEEP_MERGED_BODIES",
        group: "archive",
        type: BOOLEAN,
        default: false,
        description: "Keep the bodies of records a roll up merged, so they can still be opened by id. Off, because reclaiming them is the point of rolling up."
    },
    {
        key: "ARCHIVE_ROLLUP_IDS",
        group: "archive",
        type: NUMBER,
        default: 200,
        min: 0,
        max: 5000,
        description: "Original record ids a roll up remembers when their bodies are kept."
    },
    {
        key: "ARCHIVE_ROLLUP_SAMPLES",
        group: "archive",
        type: NUMBER,
        default: 5,
        min: 1,
        max: 100,
        description: "Titles quoted in the summary of a rolled up group."
    },
    {
        key: "ARCHIVE_COMPACT_AT",
        group: "archive",
        type: NUMBER,
        default: 0.5,
        min: 0,
        max: 1,
        description: "Share of a segment that must still be live before it is left alone; below it, the file is rewritten."
    },
    {
        key: "ARCHIVE_SEARCH_LIMIT",
        group: "archive",
        type: NUMBER,
        default: 8,
        min: 1,
        max: 100,
        description: "Records returned by one archive search when the caller does not say."
    },
    {
        key: "ARCHIVE_WEIGHT_FAILURE",
        group: "archive",
        type: NUMBER,
        default: 0.95,
        min: 0,
        max: 1,
        description: "Importance of an event that failed."
    },
    {
        key: "ARCHIVE_WEIGHT_DECISION",
        group: "archive",
        type: NUMBER,
        default: 0.9,
        min: 0,
        max: 1,
        description: "Importance of a plan change."
    },
    {
        key: "ARCHIVE_WEIGHT_MUTATION",
        group: "archive",
        type: NUMBER,
        default: 0.8,
        min: 0,
        max: 1,
        description: "Importance of a write, a move, a delete or a commit."
    },
    {
        key: "ARCHIVE_WEIGHT_COMMAND",
        group: "archive",
        type: NUMBER,
        default: 0.55,
        min: 0,
        max: 1,
        description: "Importance of a command that ran successfully."
    },
    {
        key: "ARCHIVE_WEIGHT_INSPECTION",
        group: "archive",
        type: NUMBER,
        default: 0.25,
        min: 0,
        max: 1,
        description: "Importance of a read, a listing or a search."
    },
    {
        key: "ARCHIVE_WEIGHT_ROLLUP",
        group: "archive",
        type: NUMBER,
        default: 0.35,
        min: 0,
        max: 1,
        description: "Importance of a merged group of old events."
    },
    {
        key: "ARCHIVE_SCORE_MATCH",
        group: "archive",
        type: NUMBER,
        default: 1,
        min: 0,
        max: 10,
        description: "Weight of keyword overlap when ranking archive results."
    },
    {
        key: "ARCHIVE_SCORE_IMPORTANCE",
        group: "archive",
        type: NUMBER,
        default: 0.5,
        min: 0,
        max: 10,
        description: "Weight of importance when ranking archive results."
    },
    {
        key: "ARCHIVE_SCORE_RECENCY",
        group: "archive",
        type: NUMBER,
        default: 0.25,
        min: 0,
        max: 10,
        description: "Weight of recency when ranking archive results."
    },
    {
        key: "MAX_TOOL_RESULT_CHARS",
        group: "context",
        type: NUMBER,
        default: 20000,
        min: 500,
        description: "Cap on a single string inside a tool result."
    },
    {
        key: "MAX_TOOL_RESULT_TOTAL_CHARS",
        group: "context",
        type: NUMBER,
        default: 40000,
        min: 1000,
        description: "Cap on a whole tool result; lists are shortened to fit."
    },

    {
        key: "MAX_EMPTY_FINAL_NUDGES",
        group: "persistence",
        type: NUMBER,
        default: 1,
        min: 0,
        max: 10,
        description: "Times a final answer with no work is handed back."
    },
    {
        key: "DELEGATION_NUDGE_AFTER",
        group: "delegation",
        type: NUMBER,
        default: 8,
        min: 0,
        max: 100,
        description: "Iterations the root may work alone, while the plan has open steps and the agent budget is untouched, before it is reminded that sub-agents exist. 0 disables the reminder."
    },
    {
        key: "MAX_DELEGATION_NUDGES",
        group: "delegation",
        type: NUMBER,
        default: 2,
        min: 0,
        max: 10,
        description: "How many times one run may be reminded. A reminder that is ignored twice is not worth a third request."
    },
    {
        key: "MAX_PLAN_CONTINUATIONS",
        group: "persistence",
        type: NUMBER,
        default: 8,
        min: 0,
        max: 100,
        description: "Times per run a final answer is refused while the plan has open steps."
    },
    {
        key: "MAX_AUTO_CYCLES",
        group: "persistence",
        type: NUMBER,
        default: 20,
        min: 1,
        max: 500,
        description: "Safety limit for automatic continuation in the console."
    },
    {
        key: "MAX_MALFORMED_RESPONSES",
        group: "persistence",
        type: NUMBER,
        default: 2,
        min: 0,
        max: 20,
        description: "Unreadable model answers handed back for another attempt before the run fails."
    },
    {
        key: "MAX_REPEATED_FAILURES",
        group: "persistence",
        type: NUMBER,
        default: 3,
        min: 1,
        max: 20,
        description: "Identical consecutive failures before the agent is stopped."
    },

    {
        key: "AGENT_APPROVAL",
        group: "policy",
        type: ENUM,
        values: ["auto", "prompt", "deny"],
        default: "prompt",
        description: "How a call that needs approval is answered. The safe default asks an operator."
    },
    {
        key: "ALLOW_PRIVATE_NETWORK",
        group: "policy",
        type: BOOLEAN,
        default: false,
        description: "Let net_fetch reach loopback and private addresses."
    },
    {
        key: "NET_ALLOWED_HOSTS",
        group: "policy",
        type: STRING,
        default: "",
        description: "Comma separated hosts exempt from the private network check."
    },

    {
        key: "MAX_HTTP_RESPONSE_CHARS",
        group: "tools",
        type: NUMBER,
        default: 40000,
        min: 1000,
        description: "Characters kept from an HTTP response body."
    },
    {
        key: "MAX_HTTP_REDIRECTS",
        group: "tools",
        type: NUMBER,
        default: 5,
        min: 0,
        max: 20,
        description: "Redirects followed by net_fetch."
    },
    {
        key: "MAX_PROCESS_BUFFER_CHARS",
        group: "tools",
        type: NUMBER,
        default: 200000,
        min: 1000,
        description: "Output buffered per background process."
    },
    {
        key: "MAX_HASH_BYTES",
        group: "tools",
        type: NUMBER,
        default: 50 * 1024 * 1024,
        min: 0,
        description: "Largest file fs_info will hash."
    },

    {
        key: "WRITE_SHRINK_WARNING",
        group: "tools",
        type: NUMBER,
        default: 0.4,
        min: 0,
        max: 1,
        description: "Share of a file an overwrite may remove before the result carries a warning. 1 disables the warning."
    },
    {
        key: "SKILL_RESOURCE_CHARS",
        group: "tools",
        type: NUMBER,
        default: 8000,
        min: 500,
        max: 200000,
        description: "Cap on one slice of a skill resource, so a house style cannot flood the conversation."
    },
    {
        key: "WRITE_EDIT_HINT_BYTES",
        group: "tools",
        type: NUMBER,
        default: 4000,
        min: 0,
        max: 1000000,
        description: "Overwriting an existing file larger than this suggests fs_edit instead. 0 turns the suggestion off."
    },
    {
        key: "PROCESS_SANDBOX_MODE",
        group: "policy",
        type: ENUM,
        values: ["deny", "bwrap", "test"],
        default: "deny",
        description: "Process execution mode. deny is production-safe; bwrap requires an OS sandbox; test is only for the repository test harness."
    },
    {
        key: "TERMINAL_TIMEOUT_MS",
        group: "tools",
        type: NUMBER,
        default: 30000,
        min: 1000,
        max: 3600000,
        description: "Default timeout for terminal_exec when the call does not set one."
    },
    {
        key: "GIT_TIMEOUT_MS",
        group: "tools",
        type: NUMBER,
        default: 30000,
        min: 1000,
        description: "Timeout for a single git command."
    },
    {
        key: "HOOKS_ENABLED",
        group: "hooks",
        type: BOOLEAN,
        default: false,
        description: "Run declarative before_task and after_task hooks. Off by default; projects opt in through .agent/project.json."
    },
    {
        key: "HOOK_TIMEOUT_MS",
        group: "hooks",
        type: NUMBER,
        default: 300000,
        min: 1000,
        max: 3600000,
        description: "Independent wall-clock budget for each hook phase, including after_task when the main run deadline was spent."
    },
    {
        key: "HOOKS_ON_FAILURE",
        group: "hooks",
        type: ENUM,
        values: ["report", "stop"],
        default: "report",
        description: "Default failure policy for a hook that does not declare on_failure."
    },
    {
        key: "PLAN_AUTOROUTE",
        group: "planning",
        type: BOOLEAN,
        default: false,
        description: "Automatically delegate the next open plan step to its assigned agent profile. Experimental and off by default."
    },
    {
        key: "REPO_DETECT_TIMEOUT_MS",
        group: "tools",
        type: NUMBER,
        default: 5000,
        min: 500,
        description: "Timeout for the repository detection that fills the runtime context."
    },
    {
        key: "MAX_SEARCH_SESSIONS",
        group: "tools",
        type: NUMBER,
        default: 32,
        min: 1,
        max: 500,
        description: "Search sessions kept before the finished ones are pruned."
    },
    {
        key: "BINARY_PROBE_BYTES",
        group: "tools",
        type: NUMBER,
        default: 8192,
        min: 256,
        description: "Bytes inspected when deciding whether a file is binary."
    },
    {
        key: "IGNORED_DIRECTORIES",
        group: "tools",
        type: STRING,
        default: "node_modules,.git,dist,build,coverage,.cache,.next,.venv,__pycache__",
        description: "Directory names skipped by tree walks and searches."
    },
    {
        key: "JOURNAL_ENABLED",
        group: "journal",
        type: BOOLEAN,
        default: true,
        description: "Append structured JSONL records for runs, agent thinking, and completed tool calls under .agent/journal."
    },
    {
        key: "EVENTSTORE_ENABLED",
        group: "journal",
        type: BOOLEAN,
        default: true,
        description: "Persist the full event stream once, keyed by run/turn/scope, under .agent/eventstore. The journal and sessions are derived from this single source of truth."
    },
    {
        key: "JOURNAL_MAX_FIELD_CHARS",
        group: "journal",
        type: NUMBER,
        default: 12000,
        min: 500,
        max: 1000000,
        description: "Maximum serialized size of journal thinking, arguments, and result fields before they become a bounded preview."
    },
    {
        key: "MAX_RECENT_TOOL_CALLS",
        group: "output",
        type: NUMBER,
        default: 50,
        min: 5,
        max: 1000,
        description: "Tool calls kept in the telemetry ring buffer."
    },
    {
        key: "MAX_CONSOLE_EVENTS",
        group: "output",
        type: NUMBER,
        default: 500,
        min: 50,
        max: 5000,
        description: "Events buffered for a console that connects late."
    },
    {
        key: "THINKING_MAX_CHARS",
        group: "output",
        type: NUMBER,
        default: 4000,
        min: 100,
        max: 100000,
        description: "How much of a model's reasoning text is reported to the console when the endpoint returns one."
    },
    {
        key: "CONSOLE_RESULT_CHARS",
        group: "output",
        type: NUMBER,
        default: 2000,
        min: 200,
        max: 100000,
        description: "How much of a tool result is streamed to the console; the full result stays available on demand."
    },
    {
        key: "CONSOLE_CALL_HISTORY",
        group: "output",
        type: NUMBER,
        default: 200,
        min: 10,
        max: 5000,
        description: "Tool calls whose full arguments and results the console keeps for inspection."
    },
    {
        key: "PROJECT_FILE_ENABLED",
        group: "workspace",
        type: BOOLEAN,
        default: true,
        description: "Remember this project's settings in .agent/project.json and apply them the next time it is opened."
    },
    {
        key: "PROJECT_SAVE_SECRETS",
        group: "workspace",
        type: BOOLEAN,
        default: false,
        description: "Write secrets such as API keys into the project file. Off, because a workspace is usually a repository."
    },
    {
        key: "SESSIONS_ENABLED",
        group: "workspace",
        type: BOOLEAN,
        default: true,
        description: "Keep each conversation, with its events and tool calls, in .agent/sessions so it can be reopened."
    },
    {
        key: "SESSION_MAX_KEPT",
        group: "workspace",
        type: NUMBER,
        default: 50,
        min: 1,
        max: 1000,
        description: "Conversations kept on disk before the oldest is removed."
    },
    {
        key: "SESSION_MAX_MESSAGES",
        group: "workspace",
        type: NUMBER,
        default: 400,
        min: 10,
        max: 10000,
        description: "Chat entries kept per conversation."
    },
    {
        key: "SESSION_MAX_EVENTS",
        group: "workspace",
        type: NUMBER,
        default: 2000,
        min: 50,
        max: 50000,
        description: "Runtime events kept per conversation, so a reopened session redraws the same cards."
    },
    {
        key: "SESSION_MAX_CALLS",
        group: "workspace",
        type: NUMBER,
        default: 300,
        min: 10,
        max: 5000,
        description: "Tool calls kept per conversation with their full arguments and results."
    },
    {
        key: "SESSION_HISTORY_SIZE",
        group: "output",
        type: NUMBER,
        default: 200,
        min: 10,
        max: 5000,
        description: "Lines of input history kept by the interactive session."
    },
    {
        key: "AGENT_VERBOSE",
        group: "output",
        type: BOOLEAN,
        default: true,
        description: "Print progress while a run is in flight."
    },
    {
        key: "SEMANTIC_ENABLED",
        group: "tools",
        type: BOOLEAN,
        default: true,
        description: "Enable semantic code index and LSP features through the sidecar process."
    },
    {
        key: "SEMANTIC_ENGINE_BIN",
        group: "tools",
        type: STRING,
        default: "",
        description: "Path to semantic-engine binary or script. Empty autodetects."
    },
    {
        key: "SEMANTIC_ENGINE_URL",
        group: "tools",
        type: STRING,
        default: "",
        description: "Base URL of a remote or background Semantic Engine server. If set, it is reached over the network instead of being started as a local stdio sidecar."
    },
    {
        key: "SEMANTIC_TRANSPORT",
        group: "mcp",
        type: ENUM,
        values: ["auto", "stdio", "http", "sse", "websocket"],
        default: "auto",
        description: "Which MCP transport reaches the semantic engine. auto starts a stdio sidecar, or infers the transport from SEMANTIC_ENGINE_URL when one is set."
    },
    {
        key: "SEMANTIC_INDEX_MODE",
        group: "tools",
        type: ENUM,
        values: ["off", "lazy", "auto"],
        default: "lazy",
        description: "Semantic index lifecycle mode: off disables indexing, lazy indexes on first query, auto keeps index fresh."
    },
    {
        key: "SEMANTIC_CALL_TIMEOUT_MS",
        group: "budget",
        type: NUMBER,
        default: 15000,
        min: 50,
        max: 300000,
        description: "Timeout for a single semantic-engine sidecar request in milliseconds."
    },
    {
        key: "SEMANTIC_INDEX_TIMEOUT_MS",
        group: "budget",
        type: NUMBER,
        default: 600000,
        min: 5000,
        max: 3600000,
        description: "Timeout for full repository index generation in milliseconds."
    },
    {
        key: "SEMANTIC_MAX_ITEMS",
        group: "output",
        type: NUMBER,
        default: 50,
        min: 1,
        max: 500,
        description: "Maximum number of items returned by a semantic code tool."
    },
    {
        key: "SEMANTIC_EXCERPT_CHARS",
        group: "output",
        type: NUMBER,
        default: 200,
        min: 50,
        max: 5000,
        description: "Maximum character length of code excerpts and signatures in semantic tool outputs."
    },
    {
        key: "MCP_ENABLED",
        group: "mcp",
        type: BOOLEAN,
        default: true,
        description: "Connect to the configured MCP servers. Off, no external server is started or contacted and only the built-in tools exist."
    },
    {
        key: "MCP_SERVERS",
        group: "mcp",
        type: STRING,
        default: "",
        description: "MCP servers declared as JSON in the environment, in the same shape as .mcp.json. Applied after the files, so it wins."
    },
    {
        key: "MCP_EXPOSE_TOOLS",
        group: "mcp",
        type: ENUM,
        values: ["namespaced", "gateway", "both"],
        default: "both",
        description: "How an MCP server's tools reach the model. namespaced declares each one as mcp__<server>__<tool>, gateway offers only mcp_call, both does each."
    },
    {
        key: "MCP_AUTO_DISCOVER",
        group: "mcp",
        type: BOOLEAN,
        default: false,
        description: "List configured server tools when a run starts. Disabled by default so workspace configuration cannot execute before explicit review."
    },
    {
        key: "MCP_TRUST_PROJECT_CONFIG",
        group: "mcp",
        type: BOOLEAN,
        default: false,
        description: "Allow stdio MCP commands from project/workspace config. Keep false for untrusted repositories."
    },
    {
        key: "MCP_DISCOVERY_TTL_MS",
        group: "mcp",
        type: NUMBER,
        default: 300000,
        min: 0,
        max: 3600000,
        description: "How long a discovered tool catalogue is reused before the servers are asked again."
    },
    {
        key: "MCP_CALL_TIMEOUT_MS",
        group: "mcp",
        type: NUMBER,
        default: 60000,
        min: 100,
        max: 600000,
        description: "Timeout for one tool call to an MCP server."
    },
    {
        key: "MCP_CONNECT_TIMEOUT_MS",
        group: "mcp",
        type: NUMBER,
        default: 20000,
        min: 100,
        max: 300000,
        description: "Timeout for the handshake with an MCP server, and for reading its tool list."
    },
    {
        key: "MCP_MAX_TOOLS",
        group: "mcp",
        type: NUMBER,
        default: 200,
        min: 1,
        max: 2000,
        description: "Ceiling on the MCP tools declared to the model, so a large server cannot flood the request."
    },
    {
        key: "MCP_EXCERPT_CHARS",
        group: "mcp",
        type: NUMBER,
        default: 300,
        min: 50,
        max: 5000,
        description: "Maximum length of a description or error text in an MCP tool result."
    },
    {
        key: "MCP_MAX_MESSAGE_BYTES",
        group: "mcp",
        type: NUMBER,
        default: 16777216,
        min: 65536,
        max: 268435456,
        description: "Largest single message accepted from an MCP server, so a server cannot exhaust memory with one frame."
    },
    {
        key: "MCP_ALLOW_RUNTIME_ADD",
        group: "mcp",
        type: BOOLEAN,
        default: true,
        description: "Allow a server to be added or removed while the runtime is running, with mcp_add, mcp_remove or the console."
    },
    {
        key: "MCP_APPROVAL",
        group: "mcp",
        type: ENUM,
        values: ["inherit", "always", "never"],
        default: "inherit",
        description: "Whether calling an MCP tool needs approval. inherit follows the policy rules and each server's trust setting, always asks every time, never asks at all."
    },
    {
        key: "WORKSPACE_ROOT",
        group: "workspace",
        type: STRING,
        default: null,
        fixed: true,
        description: "Directory the agent may act in. Fixed at startup because every path check depends on it."
    },
    {
        key: "STRUCTURED_AI_DATA_HOME",
        group: "persistence",
        type: STRING,
        default: null,
        description: "Data home for the project registry and per-project state (Phase 2+). Empty means ~/.local/share/structured-ai."
    },
    {
        key: "PROJECT_CONTEXT_MODE",
        group: "workspace",
        type: STRING,
        default: "legacy",
        description: "Project scoping mode: 'legacy' keeps single-workspace behavior; 'modular' resolves a ProjectContext per run (EXECUTION_PLAN feature flag)."
    },
    {
        key: "RUN_CONTEXT_MODE",
        group: "runtime",
        type: STRING,
        default: "legacy",
        description: "Run state mode: 'legacy' keeps the process-global RUN/AGENT_BUDGET; 'modular' gives every run its own AgentRunContext via the RunManager so runs may execute concurrently (EXECUTION_PLAN phase 3 flag)."
    },
    {
        key: "RUN_HISTORY_LIMIT",
        group: "runtime",
        type: NUMBER,
        default: 100,
        min: 1,
        description: "How many settled runs the RunManager keeps queryable after they finish."
    },
    {
        key: "MAX_CONCURRENT_PROJECT_RUNS",
        group: "runtime",
        type: NUMBER,
        default: 4,
        min: 1,
        max: 64,
        description: "How many distinct projects may have an active run at once (Phase 10). Extra projects wait on their own queue."
    },
    {
        key: "MAX_RUNS_PER_PROJECT",
        group: "runtime",
        type: NUMBER,
        default: 1,
        min: 1,
        max: 32,
        description: "Active runs allowed inside one project (Phase 10). Default 1 serializes a project's runs."
    },
    {
        key: "MAX_CONCURRENT_INDEX_RUNS",
        group: "runtime",
        type: NUMBER,
        default: 2,
        min: 1,
        max: 16,
        description: "How many semantic index jobs may run at once across all projects (Phase 10)."
    },
    {
        key: "MAX_WORKERS_PER_USER",
        group: "runtime",
        type: NUMBER,
        default: 8,
        min: 1,
        max: 128,
        description: "Hard cap on total inflight runs for this process (Phase 10)."
    },
    {
        key: "RUN_QUEUE_LIMIT",
        group: "runtime",
        type: NUMBER,
        default: 16,
        min: 0,
        max: 1000,
        description: "Per-project waiting-run depth (Phase 10). Overflow is rejected with RUN_QUEUE_FULL rather than hanging."
    },
    {
        key: "PROJECT_MEMORY_LIMIT",
        group: "runtime",
        type: NUMBER,
        default: 0,
        min: 0,
        description: "Bytes of recorded per-project memory after which new runs are refused (Phase 10). 0 disables the cap; the value is always exposed on /api/metrics."
    },
    {
        key: "PROJECT_CPU_LIMIT",
        group: "runtime",
        type: NUMBER,
        default: 0,
        min: 0,
        max: 100,
        description: "Observational CPU percent ceiling per project (Phase 10). 0 means unlimited; the live percent is reported on /api/metrics."
    },
    {
        key: "SEMANTIC_POOL_CACHE_LIMIT",
        group: "runtime",
        type: NUMBER,
        default: 200,
        min: 0,
        description: "How many memoized query results one SemanticClient pool entry keeps per project (0 disables memoization). Entries are additionally invalidated on an index-generation change reported by the worker."
    },
    {
        key: "PROMPT_BUILDER_MODE",
        group: "runtime",
        type: STRING,
        default: "legacy",
        description: "Prompt assembly mode: 'legacy' uses the inline builders in agent.js; 'modular' uses the injected agent/prompt builders with project_context support (EXECUTION_PLAN phase 5 flag)."
    },
    {
        key: "SEMANTIC_POOL_MODE",
        group: "runtime",
        type: STRING,
        default: "legacy",
        description: "Semantic engine routing mode: 'legacy' uses the single process-wide engine client; 'modular' routes code tools through the per-project SemanticClientPool keyed by projectId (EXECUTION_PLAN phase 6 flag)."
    },
    {
        key: "RUNTIME_ENGINE_MODE",
        group: "runtime",
        type: STRING,
        default: "legacy",
        description: "Runtime loop mode: 'legacy' and 'modular' both run the extracted agent/runtime engine (Phase 16). The flag is declared so Phase 30 can drop it after equality is proven; a misspelled value behaves as legacy."
    }
];


const BY_KEY =
    new Map(
        DEFINITIONS.map(
            definition => [definition.key, definition]
        )
    );

function coerce(definition, raw) {

    if (
        raw === undefined ||
        raw === null ||
        raw === ""
    ) {
        return definition.default;
    }

    if (definition.type === NUMBER) {

        const value = Number(raw);

        if (!Number.isFinite(value)) {

            throw new Error(
                `${definition.key} expects a number, received "${raw}".`
            );
        }

        if (
            definition.min !== undefined &&
            value < definition.min
        ) {

            throw new Error(
                `${definition.key} must be at least ${definition.min}.`
            );
        }

        if (
            definition.max !== undefined &&
            value > definition.max
        ) {

            throw new Error(
                `${definition.key} must be at most ${definition.max}.`
            );
        }

        return value;
    }

    if (definition.type === BOOLEAN) {

        if (typeof raw === "boolean") {
            return raw;
        }

        const text = String(raw).toLowerCase();

        if (["1", "true", "yes", "on"].includes(text)) {
            return true;
        }

        if (["0", "false", "no", "off"].includes(text)) {
            return false;
        }

        throw new Error(
            `${definition.key} expects a boolean, received "${raw}".`
        );
    }

    if (definition.type === ENUM) {

        const text = String(raw);

        if (!definition.values.includes(text)) {

            throw new Error(
                `${definition.key} must be one of: ${
                    definition.values.join(", ")
                }`
            );
        }

        return text;
    }

    return String(raw);
}


function definitionOf(key) {

    const definition = BY_KEY.get(key);

    if (!definition) {

        throw new Error(
            `Unknown setting: ${key}`
        );
    }

    return definition;
}


module.exports = {
    NUMBER,
    STRING,
    BOOLEAN,
    ENUM,
    DEFINITIONS,
    BY_KEY,
    coerce,
    definitionOf
};
