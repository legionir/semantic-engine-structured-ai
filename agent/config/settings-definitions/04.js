"use strict";

module.exports = [
    {
        "key": "JOURNAL_ENABLED",
        "group": "journal",
        "type": "boolean",
        "default": true,
        "description": "Append structured JSONL records for runs, agent thinking, and completed tool calls under .agent/journal."
    },
    {
        "key": "EVENTSTORE_ENABLED",
        "group": "journal",
        "type": "boolean",
        "default": true,
        "description": "Persist the full event stream once, keyed by run/turn/scope, under .agent/eventstore. The journal and sessions are derived from this single source of truth."
    },
    {
        "key": "JOURNAL_MAX_FIELD_CHARS",
        "group": "journal",
        "type": "number",
        "default": 12000,
        "min": 500,
        "max": 1000000,
        "description": "Maximum serialized size of journal thinking, arguments, and result fields before they become a bounded preview."
    },
    {
        "key": "MAX_RECENT_TOOL_CALLS",
        "group": "output",
        "type": "number",
        "default": 50,
        "min": 5,
        "max": 1000,
        "description": "Tool calls kept in the telemetry ring buffer."
    },
    {
        "key": "MAX_CONSOLE_EVENTS",
        "group": "output",
        "type": "number",
        "default": 500,
        "min": 50,
        "max": 5000,
        "description": "Events buffered for a console that connects late."
    },
    {
        "key": "THINKING_MAX_CHARS",
        "group": "output",
        "type": "number",
        "default": 4000,
        "min": 100,
        "max": 100000,
        "description": "How much of a model's reasoning text is reported to the console when the endpoint returns one."
    },
    {
        "key": "CONSOLE_RESULT_CHARS",
        "group": "output",
        "type": "number",
        "default": 2000,
        "min": 200,
        "max": 100000,
        "description": "How much of a tool result is streamed to the console; the full result stays available on demand."
    },
    {
        "key": "CONSOLE_CALL_HISTORY",
        "group": "output",
        "type": "number",
        "default": 200,
        "min": 10,
        "max": 5000,
        "description": "Tool calls whose full arguments and results the console keeps for inspection."
    },
    {
        "key": "PROJECT_FILE_ENABLED",
        "group": "workspace",
        "type": "boolean",
        "default": true,
        "description": "Remember this project's settings in .agent/project.json and apply them the next time it is opened."
    },
    {
        "key": "PROJECT_SAVE_SECRETS",
        "group": "workspace",
        "type": "boolean",
        "default": false,
        "description": "Write secrets such as API keys into the project file. Off, because a workspace is usually a repository."
    },
    {
        "key": "SESSIONS_ENABLED",
        "group": "workspace",
        "type": "boolean",
        "default": true,
        "description": "Keep each conversation, with its events and tool calls, in .agent/sessions so it can be reopened."
    },
    {
        "key": "SESSION_MAX_KEPT",
        "group": "workspace",
        "type": "number",
        "default": 50,
        "min": 1,
        "max": 1000,
        "description": "Conversations kept on disk before the oldest is removed."
    },
    {
        "key": "SESSION_MAX_MESSAGES",
        "group": "workspace",
        "type": "number",
        "default": 400,
        "min": 10,
        "max": 10000,
        "description": "Chat entries kept per conversation."
    },
    {
        "key": "SESSION_MAX_EVENTS",
        "group": "workspace",
        "type": "number",
        "default": 2000,
        "min": 50,
        "max": 50000,
        "description": "Runtime events kept per conversation, so a reopened session redraws the same cards."
    },
    {
        "key": "SESSION_MAX_CALLS",
        "group": "workspace",
        "type": "number",
        "default": 300,
        "min": 10,
        "max": 5000,
        "description": "Tool calls kept per conversation with their full arguments and results."
    },
    {
        "key": "SESSION_HISTORY_SIZE",
        "group": "output",
        "type": "number",
        "default": 200,
        "min": 10,
        "max": 5000,
        "description": "Lines of input history kept by the interactive session."
    },
    {
        "key": "AGENT_VERBOSE",
        "group": "output",
        "type": "boolean",
        "default": true,
        "description": "Print progress while a run is in flight."
    },
    {
        "key": "MCP_ENABLED",
        "group": "mcp",
        "type": "boolean",
        "default": true,
        "description": "Connect to the configured MCP servers. Off, no external server is started or contacted and only the built-in tools exist."
    },
    {
        "key": "MCP_SERVERS",
        "group": "mcp",
        "type": "string",
        "default": "",
        "description": "MCP servers declared as JSON in the environment, in the same shape as .mcp.json. Applied after the files, so it wins."
    },
    {
        "key": "MCP_EXPOSE_TOOLS",
        "group": "mcp",
        "type": "enum",
        "values": [
            "namespaced",
            "gateway",
            "both"
        ],
        "default": "both",
        "description": "How an MCP server's tools reach the model. namespaced declares each one as mcp__<server>__<tool>, gateway offers only mcp_call, both does each."
    },
    {
        "key": "MCP_AUTO_DISCOVER",
        "group": "mcp",
        "type": "boolean",
        "default": false,
        "description": "List configured server tools when a run starts. Disabled by default so workspace configuration cannot execute before explicit review."
    },
    {
        "key": "MCP_TRUST_PROJECT_CONFIG",
        "group": "mcp",
        "type": "boolean",
        "default": false,
        "description": "Allow stdio MCP commands from project/workspace config. Keep false for untrusted repositories."
    },
    {
        "key": "MCP_DISCOVERY_TTL_MS",
        "group": "mcp",
        "type": "number",
        "default": 300000,
        "min": 0,
        "max": 3600000,
        "description": "How long a discovered tool catalogue is reused before the servers are asked again."
    },
    {
        "key": "MCP_CALL_TIMEOUT_MS",
        "group": "mcp",
        "type": "number",
        "default": 60000,
        "min": 100,
        "max": 600000,
        "description": "Timeout for one tool call to an MCP server."
    },
    {
        "key": "MCP_CONNECT_TIMEOUT_MS",
        "group": "mcp",
        "type": "number",
        "default": 20000,
        "min": 100,
        "max": 300000,
        "description": "Timeout for the handshake with an MCP server, and for reading its tool list."
    },
    {
        "key": "MCP_MAX_TOOLS",
        "group": "mcp",
        "type": "number",
        "default": 200,
        "min": 1,
        "max": 2000,
        "description": "Ceiling on the MCP tools declared to the model, so a large server cannot flood the request."
    },
    {
        "key": "MCP_EXCERPT_CHARS",
        "group": "mcp",
        "type": "number",
        "default": 300,
        "min": 50,
        "max": 5000,
        "description": "Maximum length of a description or error text in an MCP tool result."
    },
    {
        "key": "MCP_MAX_MESSAGE_BYTES",
        "group": "mcp",
        "type": "number",
        "default": 16777216,
        "min": 65536,
        "max": 268435456,
        "description": "Largest single message accepted from an MCP server, so a server cannot exhaust memory with one frame."
    },
    {
        "key": "MCP_ALLOW_RUNTIME_ADD",
        "group": "mcp",
        "type": "boolean",
        "default": true,
        "description": "Allow a server to be added or removed while the runtime is running, with mcp_add, mcp_remove or the console."
    },
    {
        "key": "MCP_APPROVAL",
        "group": "mcp",
        "type": "enum",
        "values": [
            "inherit",
            "always",
            "never"
        ],
        "default": "inherit",
        "description": "Whether calling an MCP tool needs approval. inherit follows the policy rules and each server's trust setting, always asks every time, never asks at all."
    }
];
