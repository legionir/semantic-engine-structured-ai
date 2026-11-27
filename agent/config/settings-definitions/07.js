"use strict";

/* MCP completion settings (roadmap group 6: P4-05 .. P4-12). */

module.exports = [
    {
        "key": "MCP_TOOL_LOADING",
        "group": "mcp",
        "type": "enum",
        "values": [
            "auto",
            "eager",
            "lazy"
        ],
        "default": "auto",
        "description": "How MCP tool definitions reach the model (roadmap P4-06). eager declares tools until MCP_TOOL_DEFINITIONS_BUDGET is spent; lazy declares none and lists each by name and one line, loaded on demand with mcp_search_tools and called with mcp_call; auto is eager while everything fits the budget and lazy once it does not."
    },
    {
        "key": "MCP_TOOL_DEFINITIONS_BUDGET",
        "group": "mcp",
        "type": "number",
        "default": 24000,
        "min": 1000,
        "max": 400000,
        "description": "Ceiling, in characters of JSON, on the MCP tool definitions declared in one model request (roadmap P4-06). The rest are listed by name and loaded with mcp_search_tools."
    },
    {
        "key": "MCP_OAUTH_REDIRECT_BASE",
        "group": "mcp",
        "type": "string",
        "default": "",
        "description": "The console's public address (https://host:port) an OAuth provider redirects back to after an MCP sign-in, ending in /api/mcp/oauth/callback (roadmap P4-08). Empty: the address the panel was opened at."
    },
    {
        "key": "MCP_SAMPLING_ENABLED",
        "group": "mcp",
        "type": "boolean",
        "default": false,
        "description": "Whether an MCP server whose definition says sampling: true may ask this runtime's model for a completion (sampling/createMessage, roadmap P4-10). Off: the capability is not advertised and every request is refused."
    },
    {
        "key": "MCP_SAMPLING_MAX_TOKENS",
        "group": "mcp",
        "type": "number",
        "default": 1024,
        "min": 16,
        "max": 32000,
        "description": "Largest completion one sampling request may produce; a server asking for more gets this many (roadmap P4-10)."
    },
    {
        "key": "MCP_SAMPLING_BUDGET_TOKENS",
        "group": "mcp",
        "type": "number",
        "default": 20000,
        "min": 0,
        "max": 10000000,
        "description": "Tokens (prompt plus completion) each MCP server may spend on sampling while this process runs; a request beyond it is refused (roadmap P4-10). 0 refuses every request."
    },
    {
        "key": "MCP_ELICITATION_TIMEOUT_MS",
        "group": "mcp",
        "type": "number",
        "default": 300000,
        "min": 1000,
        "max": 3600000,
        "description": "How long a server's question to the user (elicitation/create) waits in the panel before it is answered with cancel (roadmap P4-10)."
    },
    {
        "key": "MCP_SERVE_ENABLED",
        "group": "mcp",
        "type": "boolean",
        "default": true,
        "description": "Whether this console answers MCP clients at /mcp (and agent mcp-serve over stdio), offering list_projects, run_task and task_status to a caller holding a console or project token (roadmap P4-11)."
    },
    {
        "key": "MCP_REGISTRY_URL",
        "group": "mcp",
        "type": "string",
        "default": "https://registry.modelcontextprotocol.io",
        "description": "The MCP registry the console searches for servers that are not in the bundled catalogue (roadmap P4-12). Empty: registry search is off."
    },
    {
        "key": "MCP_OAUTH_REFRESH_MARGIN_MS",
        "group": "mcp",
        "type": "number",
        "default": 60000,
        "min": 0,
        "max": 3600000,
        "description": "How long before an MCP server's OAuth access token expires it is refreshed (roadmap P4-08); a refused call also refreshes it once."
    },
    {
        "key": "MCP_OAUTH_FLOW_TTL_MS",
        "group": "mcp",
        "type": "number",
        "default": 600000,
        "min": 60000,
        "max": 3600000,
        "description": "How long an MCP OAuth sign-in started from the console may take before its one-time state expires (roadmap P4-08)."
    },
    {
        "key": "MCP_OPENAPI_MAX_OPERATIONS",
        "group": "mcp",
        "type": "number",
        "default": 64,
        "min": 1,
        "max": 500,
        "description": "Most operations of an OpenAPI document mcp_build turns into tools of one generated MCP server (roadmap P4-09); the rest are left out."
    },
    {
        "key": "MCP_DEFERRED_LINE_CHARS",
        "group": "mcp",
        "type": "number",
        "default": 120,
        "min": 40,
        "max": 400,
        "description": "Length of the one-line description each deferred MCP tool gets in the model's index when tool definitions are loaded lazily (roadmap P4-06)."
    },
    {
        "key": "MCP_OAUTH_TIMEOUT_MS",
        "group": "mcp",
        "type": "number",
        "default": 15000,
        "min": 1000,
        "max": 120000,
        "description": "Time limit for one OAuth request to an MCP authorization server (metadata discovery, client registration, token exchange and refresh), in milliseconds. MAX_REQUEST_MS caps it when smaller."
    },
    {
        "key": "MCP_OAUTH_MAX_RESPONSE_BYTES",
        "group": "mcp",
        "type": "number",
        "default": 262144,
        "min": 4096,
        "max": 10485760,
        "description": "Largest OAuth metadata or token response, in bytes, read from an MCP authorization server; a bigger one is refused."
    }
];
