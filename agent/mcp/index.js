"use strict";

/*
| Canonical MCP boundary.
| Keep protocol, transport, configuration, connection, catalogue and
| generic server management discoverable from one explicit entrypoint.
*/

module.exports = {
    ...require("./McpManager"),
    ...require("./McpConfig"),
    ...require("./McpConnection"),
    ...require("./McpCatalogue"),
    ...require("./McpTrustPolicy"),
    protocol: require("./protocol"),
    transports: {
        StdioTransport: require("./transports/StdioTransport").StdioTransport,
        HttpTransport: require("./transports/HttpTransport").HttpTransport,
        SseTransport: require("./transports/SseTransport").SseTransport,
        WebSocketTransport: require("./transports/WebSocketTransport").WebSocketTransport
    }
};
