"use strict";

module.exports = [
    {
        "key": "SKILLS_INLINE_FOR_SUBAGENTS",
        "group": "delegation",
        "type": "boolean",
        "default": true,
        "description": "Put a sub-agent's own skills in its prompt in full. Off, it receives the same index the root gets and reads them with skill_get, which is cheaper and one call away from being ignored."
    },
    {
        "key": "MAX_AGENT_DEPTH",
        "group": "delegation",
        "type": "number",
        "default": 3,
        "min": 0,
        "max": 10,
        "description": "Hard cap on delegation depth."
    },
    {
        "key": "MAX_TOTAL_AGENTS",
        "group": "delegation",
        "type": "number",
        "default": 15,
        "min": 0,
        "max": 200,
        "description": "Sub-agents a single run may spawn."
    },
    {
        "key": "MAX_PARALLEL_AGENTS",
        "group": "delegation",
        "type": "number",
        "default": 4,
        "min": 1,
        "max": 32,
        "description": "Sub-agents executed at the same time."
    },
    {
        "key": "MAX_PARALLEL_TOOLS",
        "group": "delegation",
        "type": "number",
        "default": 8,
        "min": 1,
        "max": 64,
        "description": "Tools executed at the same time."
    },
    {
        "key": "RUN_WRAPUP_MS",
        "group": "budget",
        "type": "number",
        "default": 60000,
        "min": 0,
        "max": 600000,
        "description": "Slice of the run budget reserved for finishing. When this much time is left the agent is told to stop exploring and answer with what it has. 0 disables it, and the run simply hits the deadline."
    },
    {
        "key": "RUN_WRAPUP_FRACTION",
        "group": "budget",
        "type": "number",
        "default": 0.15,
        "min": 0,
        "max": 0.5,
        "description": "Ceiling on the wrap-up slice as a share of the run budget, so a short run is not asked to finish before it starts."
    },
    {
        "key": "MAX_RESPONSE_TOKENS",
        "group": "budget",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 200000,
        "description": "Ceiling sent as max_tokens on every agent request. 0 leaves it out, which lets the endpoint decide. Raise it when the agent writes large files and the answer is cut off."
    },
    {
        "key": "MAX_CONTEXT_CHARS",
        "group": "context",
        "type": "number",
        "default": 300000,
        "min": 10000,
        "description": "Size budget for the whole conversation."
    },
    {
        "key": "CONTEXT_WINDOW_TOKENS",
        "group": "context",
        "type": "number",
        "default": 0,
        "min": 0,
        "max": 2000000,
        "description": "Configured context-window size of the active model in tokens. 0 disables token-based context compaction; the runtime uses its character budget instead. Token measurement uses the provider-independent estimator and keeps the safety margin below."
    },
    {
        "key": "CONTEXT_WINDOW_SAFETY_FRACTION",
        "group": "context",
        "type": "number",
        "default": 0.8,
        "min": 0.5,
        "max": 0.95,
        "description": "Fraction of CONTEXT_WINDOW_TOKENS available to the conversation, reserving the remainder for response and estimator variance."
    },
    {
        "key": "KEEP_RECENT_EXCHANGES",
        "group": "context",
        "type": "number",
        "default": 3,
        "min": 1,
        "max": 50,
        "description": "Most recent tool exchanges that are never compressed."
    },
    {
        "key": "CONTEXT_LIGHT_FRACTION",
        "group": "context",
        "type": "number",
        "default": 0.4,
        "min": 0,
        "max": 1,
        "description": "Share of the transcript, counted from the newest end, compressed only lightly."
    },
    {
        "key": "CONTEXT_MEDIUM_FRACTION",
        "group": "context",
        "type": "number",
        "default": 0.6,
        "min": 0,
        "max": 1,
        "description": "Share of the transcript compressed moderately. Everything older is compressed hard."
    },
    {
        "key": "CONTEXT_LIGHT_CHARS",
        "group": "context",
        "type": "number",
        "default": 2000,
        "min": 100,
        "description": "Characters kept from a lightly compressed result."
    },
    {
        "key": "CONTEXT_MEDIUM_CHARS",
        "group": "context",
        "type": "number",
        "default": 500,
        "min": 50,
        "description": "Characters kept from a moderately compressed result."
    },
    {
        "key": "CONTEXT_COMPACT_AT",
        "group": "context",
        "type": "number",
        "default": 0.7,
        "min": 0.1,
        "max": 1,
        "description": "Share of the context budget that triggers compaction at the start of an iteration."
    },
    {
        "key": "AUTO_CONTINUE",
        "group": "persistence",
        "type": "boolean",
        "default": false,
        "description": "In the console, start the next cycle automatically while the plan still has open steps."
    },
    {
        "key": "CONTEXT_SUMMARY",
        "group": "context",
        "type": "boolean",
        "default": true,
        "description": "Ask the model to summarise the oldest exchanges instead of reducing them to one line."
    },
    {
        "key": "CONTEXT_SUMMARY_MAX_TOKENS",
        "group": "context",
        "type": "number",
        "default": 700,
        "min": 100,
        "max": 8000,
        "description": "Upper bound on the digest the summariser may write."
    },
    {
        "key": "CONTEXT_SUMMARY_MS",
        "group": "context",
        "type": "number",
        "default": 30000,
        "min": 1000,
        "description": "Timeout for a summariser request, so a slow digest cannot eat the run budget."
    },
    {
        "key": "CONTEXT_SUMMARY_CHARS",
        "group": "context",
        "type": "number",
        "default": 1500,
        "min": 200,
        "max": 20000,
        "description": "Size budget for a generated digest of old exchanges."
    },
    {
        "key": "MEMORY_ENABLED",
        "group": "memory",
        "type": "boolean",
        "default": true,
        "description": "Fold old exchanges into a structured working memory instead of only trimming them."
    },
    {
        "key": "FILE_CHECKPOINT_MAX_FILE_BYTES",
        "group": "persistence",
        "type": "number",
        "default": 5242880,
        "min": 1024,
        "max": 52428800,
        "description": "Maximum existing file size that automatic file checkpoints may capture before a mutation. Larger writes are refused rather than made irreversible."
    },
    {
        "key": "FILE_CHECKPOINT_MAX_TOTAL_BYTES",
        "group": "persistence",
        "type": "number",
        "default": 20971520,
        "min": 1048576,
        "max": 209715200,
        "description": "Maximum aggregate original-file bytes in a single checkpoint. Mutations exceeding it are refused before any file is changed."
    },
    {
        "key": "FILE_CHECKPOINT_MAX_FILES",
        "group": "persistence",
        "type": "number",
        "default": 64,
        "min": 1,
        "max": 512,
        "description": "Maximum files captured in one atomic patch/checkpoint operation."
    },
    {
        "key": "FILE_CHECKPOINT_RETENTION",
        "group": "persistence",
        "type": "number",
        "default": 100,
        "min": 10,
        "max": 2000,
        "description": "Maximum automatically retained workspace checkpoint records."
    },
    {
        "key": "MEMORY_PROVENANCE_MAX_ITEMS",
        "group": "memory",
        "type": "number",
        "default": 2000,
        "min": 0,
        "max": 20000,
        "description": "Maximum per-item memory provenance records retained in the project memory file."
    },
    {
        "key": "MEMORY_PROVENANCE_MAX_SOURCE_REFS",
        "group": "memory",
        "type": "number",
        "default": 100,
        "min": 1,
        "max": 1000,
        "description": "Maximum archive/tool-call source references recorded for each newly folded memory item."
    },
    {
        "key": "MEMORY_CHUNK_CHARS",
        "group": "memory",
        "type": "number",
        "default": 6000,
        "min": 500,
        "max": 200000,
        "description": "Largest slice of history handed to the summariser at once. Keep it inside the summariser's context window."
    },
    {
        "key": "MEMORY_MAX_SUMMARY_CALLS",
        "group": "memory",
        "type": "number",
        "default": 4,
        "min": 1,
        "max": 100,
        "description": "Maximum model summariser calls in one memory fold. Extra chunks remain retrievable from the archive instead of causing an unbounded request loop."
    },
    {
        "key": "MEMORY_SUMMARY_PARALLELISM",
        "group": "memory",
        "type": "number",
        "default": 4,
        "min": 1,
        "max": 20,
        "description": "Memory chunks summarised concurrently within the per-fold call cap."
    },
    {
        "key": "MEMORY_MAX_ITEMS",
        "group": "memory",
        "type": "number",
        "default": 12,
        "min": 3,
        "max": 100,
        "description": "Entries kept per memory list before the oldest are dropped."
    },
    {
        "key": "MEMORY_MAX_CHARS",
        "group": "memory",
        "type": "number",
        "default": 4000,
        "min": 500,
        "description": "Size at which memory is folded back into itself."
    },
    {
        "key": "ARCHIVE_ENABLED",
        "group": "archive",
        "type": "boolean",
        "default": true,
        "description": "Keep every folded exchange as a retrievable record on disk instead of only in working memory."
    },
    {
        "key": "ARCHIVE_BODY_CHARS",
        "group": "archive",
        "type": "number",
        "default": 4000,
        "min": 200,
        "max": 100000,
        "description": "Largest body stored for one archived event."
    },
    {
        "key": "ARCHIVE_SUMMARY_CHARS",
        "group": "archive",
        "type": "number",
        "default": 240,
        "min": 40,
        "max": 4000,
        "description": "Preview kept in the index, so a search can rank without opening a segment."
    },
    {
        "key": "ARCHIVE_TITLE_CHARS",
        "group": "archive",
        "type": "number",
        "default": 160,
        "min": 20,
        "max": 2000,
        "description": "Cap on the title and error text of an archived event."
    },
    {
        "key": "ARCHIVE_MAX_TAGS",
        "group": "archive",
        "type": "number",
        "default": 8,
        "min": 1,
        "max": 64,
        "description": "Tags kept per record for keyword retrieval."
    },
    {
        "key": "ARCHIVE_SEGMENT_RECORDS",
        "group": "archive",
        "type": "number",
        "default": 500,
        "min": 10,
        "max": 100000,
        "description": "Records per segment file before a new one is started."
    },
    {
        "key": "ARCHIVE_MAX_RECORDS",
        "group": "archive",
        "type": "number",
        "default": 2000,
        "min": 10,
        "description": "Index size at which old low value records are rolled up."
    },
    {
        "key": "ARCHIVE_KEEP_IMPORTANCE",
        "group": "archive",
        "type": "number",
        "default": 0.7,
        "min": 0,
        "max": 1,
        "description": "Records at or above this importance are never rolled up."
    },
    {
        "key": "ARCHIVE_ROLLUP_BATCH",
        "group": "archive",
        "type": "number",
        "default": 100,
        "min": 1,
        "description": "Extra records merged beyond the overflow, so a roll up buys room for a while."
    },
    {
        "key": "ARCHIVE_ROLLUP_BODY_CHARS",
        "group": "archive",
        "type": "number",
        "default": 20000,
        "min": 500,
        "max": 500000,
        "description": "Size of a rolled up body, which summarises many events and so needs more room than a single one."
    },
    {
        "key": "ARCHIVE_KEEP_MERGED_BODIES",
        "group": "archive",
        "type": "boolean",
        "default": false,
        "description": "Keep the bodies of records a roll up merged, so they can still be opened by id. Off, because reclaiming them is the point of rolling up."
    },
    {
        "key": "ARCHIVE_ROLLUP_IDS",
        "group": "archive",
        "type": "number",
        "default": 200,
        "min": 0,
        "max": 5000,
        "description": "Original record ids a roll up remembers when their bodies are kept."
    },
    {
        "key": "ARCHIVE_ROLLUP_SAMPLES",
        "group": "archive",
        "type": "number",
        "default": 5,
        "min": 1,
        "max": 100,
        "description": "Titles quoted in the summary of a rolled up group."
    },
    {
        "key": "ARCHIVE_COMPACT_AT",
        "group": "archive",
        "type": "number",
        "default": 0.5,
        "min": 0,
        "max": 1,
        "description": "Share of a segment that must still be live before it is left alone; below it, the file is rewritten."
    },
    {
        "key": "ARCHIVE_SEARCH_LIMIT",
        "group": "archive",
        "type": "number",
        "default": 8,
        "min": 1,
        "max": 100,
        "description": "Records returned by one archive search when the caller does not say."
    },
    {
        "key": "ARCHIVE_WEIGHT_FAILURE",
        "group": "archive",
        "type": "number",
        "default": 0.95,
        "min": 0,
        "max": 1,
        "description": "Importance of an event that failed."
    },
    {
        "key": "ARCHIVE_WEIGHT_DECISION",
        "group": "archive",
        "type": "number",
        "default": 0.9,
        "min": 0,
        "max": 1,
        "description": "Importance of a plan change."
    }
];
