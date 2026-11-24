"use strict";

/*
| Canonical MCP boundary — EXECUTION_PLAN Phase 30.
| Keep protocol, transport, configuration, connection, catalogue and
| project-aware semantic routing discoverable from one explicit entrypoint.
*/

module.exports = {
    ...require("./McpManager"),
    ...require("./McpConfig"),
    ...require("./McpConnection"),
    ...require("./McpCatalogue"),
    ...require("./McpTrustPolicy"),
    ...require("./ProjectSemanticResolver"),
    ...require("./SemanticClientPool"),
    protocol: require("./protocol"),
    transports: {
        StdioTransport: require("./transports/StdioTransport").StdioTransport,
        HttpTransport: require("./transports/HttpTransport").HttpTransport,
        SseTransport: require("./transports/SseTransport").SseTransport,
        WebSocketTransport: require("./transports/WebSocketTransport").WebSocketTransport
    }
};
