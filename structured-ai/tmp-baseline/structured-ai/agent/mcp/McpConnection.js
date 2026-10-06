const protocol = require("./protocol");

const { StdioTransport } = require("./transports/StdioTransport");
const { HttpTransport } = require("./transports/HttpTransport");
const { SseTransport } = require("./transports/SseTransport");
const { WebSocketTransport } = require("./transports/WebSocketTransport");


/*
|--------------------------------------------------------------------------
| MCP Client
|--------------------------------------------------------------------------
|
| One server, one client, one transport underneath it. Everything above
| this line, the tool catalogue and the runtime tools, talks to a client
| and never to a transport, which is what makes the four protocols
| interchangeable rather than four code paths.
|
|   configure ──► transport ──► initialize ──► tools/list ──► tools/call
|
| The handshake happens once and lazily, on the first call, because a
| configured server that is never used should not be started.
|--------------------------------------------------------------------------
*/

const TRANSPORTS = {
    [StdioTransport.kind]: StdioTransport,
    [HttpTransport.kind]: HttpTransport,
    [SseTransport.kind]: SseTransport,
    [WebSocketTransport.kind]: WebSocketTransport
};

const TRANSPORT_KINDS =
    Object.keys(TRANSPORTS);


const STATE = {
    IDLE: "idle",
    CONNECTING: "connecting",
    READY: "ready",
    FAILED: "failed",
    CLOSED: "closed"
};


function createTransport(config) {

    const Transport =
        TRANSPORTS[config.transport];

    if (!Transport) {

        throw new Error(
            `MCP server "${config.name}" asks for transport "${
                config.transport
            }", which is not one of: ${TRANSPORT_KINDS.join(", ")}.`
        );
    }

    return new Transport(config);
}


class McpClient {

    constructor(config) {

        this.config = config;

        this.name = config.name;

        this.transport = createTransport(config);

        this.state = STATE.IDLE;

        this.error = null;

        this.serverInfo = null;

        this.capabilities = {};

        this.protocolVersion = null;

        this.instructions = null;

        this.tools = [];

        this.toolsLoadedAt = null;

        this.diagnostics = [];

        this.stats = {
            calls: 0,
            failures: 0,
            last_call_at: null
        };

        this.readyPromise = null;

        this.transport.onDiagnostic(text => this.record(text));

        this.transport.onNotification(
            message => this.handleNotification(message)
        );

        this.transport.onClose(() => {

            /*
            | A server that goes away invalidates the handshake, not the
            | configuration: the next call starts it again.
            */

            if (this.state === STATE.READY) {
                this.state = STATE.IDLE;
            }

            this.readyPromise = null;
        });
    }


    record(text) {

        this.diagnostics.push({
            at: Date.now(),
            text: String(text).slice(0, 1000)
        });

        if (this.diagnostics.length > 50) {
            this.diagnostics.shift();
        }
    }


    handleNotification(message) {

        /*
        | A server that adds or removes tools says so, and the catalogue
        | is refreshed on the next read rather than immediately, because
        | nothing is waiting for it right now.
        */

        if (message.method === "notifications/tools/list_changed") {

            this.toolsLoadedAt = null;

            this.record("server reported that its tool list changed");

            return;
        }

        if (message.method === "notifications/message") {

            const data = message.params || {};

            this.record(
                `[${data.level || "info"}] ${
                    typeof data.data === "string"
                        ? data.data
                        : JSON.stringify(data.data || {})
                }`
            );
        }
    }


    timeout(kind) {

        const configured =
            this.config.timeouts || {};

        return (
            configured[kind] ||
            configured.default ||
            this.config.timeoutMs ||
            30000
        );
    }


    /*
    | initialize is the only request that may travel before the
    | handshake, so it is sent directly rather than through ensureReady.
    */

    async handshake() {

        await this.transport.connect();

        const result =
            await this.transport.request(
                protocol.request("initialize", {

                    protocolVersion:
                        protocol.PROTOCOL_VERSION,

                    capabilities: {
                        roots: { listChanged: false },
                        sampling: {}
                    },

                    clientInfo:
                        protocol.CLIENT_INFO
                }),
                { timeoutMs: this.timeout("connect") }
            );

        this.protocolVersion =
            (result && result.protocolVersion) ||
            protocol.PROTOCOL_VERSION;

        this.serverInfo =
            (result && result.serverInfo) || null;

        this.capabilities =
            (result && result.capabilities) || {};

        this.instructions =
            (result && result.instructions) || null;

        if (typeof this.transport.setProtocolVersion === "function") {
            this.transport.setProtocolVersion(this.protocolVersion);
        }

        /*
        | The server may not act until it is told the handshake is
        | complete. A transport that fails this notification has already
        | failed the connection, but there is nothing to wait for.
        */

        try {

            await this.transport.send(
                protocol.notification("notifications/initialized"),
                { timeoutMs: this.timeout("connect") }
            );

        } catch (error) {

            this.record(
                `initialized notification was not accepted: ${error.message}`
            );
        }

        return result;
    }


    async ensureReady() {

        if (this.state === STATE.READY && this.transport.isConnected()) {
            return this;
        }

        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.state = STATE.CONNECTING;

        this.readyPromise =
            this.handshake()
                .then(() => {

                    this.state = STATE.READY;

                    this.error = null;

                    return this;
                })
                .catch(error => {

                    this.state = STATE.FAILED;

                    this.error = error.message;

                    this.readyPromise = null;

                    throw error;
                });

        return this.readyPromise;
    }


    async listTools(options = {}) {

        if (
            !options.force &&
            this.toolsLoadedAt &&
            this.state === STATE.READY
        ) {
            return this.tools;
        }

        await this.ensureReady();

        const collected = [];

        let cursor;

        /*
        | A large catalogue arrives in pages, and a server that never
        | stops paging must not spin here forever.
        */

        for (let page = 0; page < 50; page += 1) {

            const result =
                await this.transport.request(
                    protocol.request(
                        "tools/list",
                        cursor ? { cursor } : {}
                    ),
                    { timeoutMs: this.timeout("list") }
                );

            for (const tool of (result && result.tools) || []) {
                collected.push(tool);
            }

            cursor = result && result.nextCursor;

            if (!cursor) {
                break;
            }
        }

        this.tools = collected;

        this.toolsLoadedAt = Date.now();

        return this.tools;
    }


    async callTool(toolName, args, options = {}) {

        await this.ensureReady();

        this.stats.calls += 1;

        this.stats.last_call_at = Date.now();

        try {

            const result =
                await this.transport.request(
                    protocol.request("tools/call", {
                        name: toolName,
                        arguments: args || {}
                    }),
                    { timeoutMs: options.timeoutMs || this.timeout("call") }
                );

            /*
            | A tool that fails answers with isError rather than a
            | JSON-RPC error, and the runtime treats both the same way.
            */

            if (result && result.isError) {

                const payload =
                    protocol.unpackToolResult(result);

                const error =
                    new Error(
                        typeof payload === "object" && payload
                            ? payload.error || payload.message || payload.text ||
                                JSON.stringify(payload).slice(0, 300)
                            : String(payload)
                    );

                error.tool_error = true;

                throw error;
            }

            return protocol.unpackToolResult(result);

        } catch (error) {

            this.stats.failures += 1;

            throw error;
        }
    }


    /*
    | Resources and prompts are optional halves of the protocol. They
    | are read only, so they are offered whenever a server advertises
    | them and quietly absent when it does not.
    */

    async listResources() {

        await this.ensureReady();

        if (!this.capabilities.resources) {
            return [];
        }

        const result =
            await this.transport.request(
                protocol.request("resources/list", {}),
                { timeoutMs: this.timeout("list") }
            );

        return (result && result.resources) || [];
    }


    async readResource(uri) {

        await this.ensureReady();

        const result =
            await this.transport.request(
                protocol.request("resources/read", { uri }),
                { timeoutMs: this.timeout("call") }
            );

        return (result && result.contents) || [];
    }


    async listPrompts() {

        await this.ensureReady();

        if (!this.capabilities.prompts) {
            return [];
        }

        const result =
            await this.transport.request(
                protocol.request("prompts/list", {}),
                { timeoutMs: this.timeout("list") }
            );

        return (result && result.prompts) || [];
    }


    async getPrompt(name, args) {

        await this.ensureReady();

        return this.transport.request(
            protocol.request("prompts/get", {
                name,
                arguments: args || {}
            }),
            { timeoutMs: this.timeout("call") }
        );
    }


    async ping() {

        await this.ensureReady();

        await this.transport.request(
            protocol.request("ping", {}),
            { timeoutMs: this.timeout("connect") }
        );

        return true;
    }


    describe() {

        return {
            name: this.name,

            transport:
                this.config.transport,

            state: this.state,

            error: this.error,

            enabled:
                this.config.enabled !== false,

            builtin:
                Boolean(this.config.builtin),

            server:
                this.serverInfo,

            protocol_version:
                this.protocolVersion,

            capabilities:
                Object.keys(this.capabilities || {}),

            tool_count:
                this.tools.length,

            connection:
                this.transport.describe(),

            stats:
                { ...this.stats }
        };
    }


    diagnosticsTail(limit = 10) {

        return this.diagnostics.slice(-limit);
    }


    async close() {

        this.state = STATE.CLOSED;

        this.readyPromise = null;

        this.toolsLoadedAt = null;

        await this.transport.close();
    }
}


module.exports = {
    McpClient,
    McpConnection: McpClient,
    STATE,
    TRANSPORTS,
    TRANSPORT_KINDS,
    createTransport
};
