const path = require("path");
const { pathToFileURL } = require("url");

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
    /* P4-04: lost, waiting for the next automatic attempt */
    RECONNECTING: "reconnecting",
    FAILED: "failed",
    CLOSED: "closed"
};


function setting(key, fallback) {
    try {
        const value = require("../config").get(key);
        return value === undefined || value === null ? fallback : value;
    } catch {
        return fallback;
    }
}


function emit(type, payload) {
    try {
        require("../events").emit(type, payload);
    } catch {
        /* events are best effort: a client works without the bus */
    }
}


/*
| P4-04: the wait before reconnect attempt n (1-based): the base doubled
| per attempt, capped, with ±20% jitter so servers that died together do
| not all come back in the same millisecond.
*/
function reconnectDelay(attempt, random = Math.random) {

    const base = Math.max(1, Number(setting("MCP_RECONNECT_BASE_MS", 1000)) || 1000);
    const cap = Math.max(base, Number(setting("MCP_RECONNECT_MAX_MS", 60000)) || 60000);
    const raw = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));

    return Math.round(raw * (0.8 + 0.4 * random()));
}


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

        /* P4-04: automatic reconnects after the server went away */
        this.reconnect = {
            attempt: 0,
            timer: null,
            next_at: null,
            count: 0,
            last_error: null,
            last_error_at: null,
            disconnected_at: null
        };

        this.transport.onDiagnostic(text => this.record(text));

        this.transport.onNotification(
            message => this.handleNotification(message)
        );

        /*
        | P0-6: a transport that can carry requests from the server
        | (stdio today) hands them here, so ping and roots/list are
        | answered as the MCP specification requires.
        */

        if (typeof this.transport.onRequest === "function") {

            this.transport.onRequest(
                message => this.handleRequest(message)
            );
        }

        this.transport.onClose(info => {

            /*
            | A server that goes away invalidates the handshake, not the
            | configuration: the next call starts it again, and (P4-04) so
            | does a reconnect scheduled here, so a crashed sidecar is back
            | before anyone needs it.
            */

            const wasReady = this.state === STATE.READY;

            if (wasReady) {
                this.state = STATE.IDLE;
            }

            this.readyPromise = null;

            if (this.state === STATE.CLOSED || !wasReady) {
                return;
            }

            const reason =
                info && info.error
                    ? `the connection failed (${info.error})`
                    : `the process exited (code: ${info?.code ?? null}, signal: ${info?.signal ?? null})`;

            this.noteError(`MCP server "${this.name}" disconnected: ${reason}`);
            this.reconnect.disconnected_at = Date.now();

            const retrying = this.scheduleReconnect();

            emit("mcp:disconnected", {
                server: this.name,
                transport: this.config.transport,
                code: info?.code ?? null,
                signal: info?.signal ?? null,
                error: this.error,
                retrying,
                attempt: this.reconnect.attempt,
                retry_in_ms: retrying ? Math.max(0, this.reconnect.next_at - Date.now()) : null
            });
        });
    }


    noteError(message) {

        this.error = message;
        this.reconnect.last_error = message;
        this.reconnect.last_error_at = Date.now();
    }


    reconnectEnabled() {

        return setting("MCP_RECONNECT_ENABLED", true) !== false &&
            this.config.enabled !== false &&
            this.state !== STATE.CLOSED;
    }


    /*
    | Schedules the next attempt; false when reconnecting is off or the
    | attempts are used up, in which case the server is left FAILED and the
    | next tool call (or Reconnect in the console) starts over.
    */
    scheduleReconnect() {

        if (!this.reconnectEnabled()) {
            return false;
        }

        if (this.reconnect.timer) {
            return true;
        }

        const limit = Math.max(1, Number(setting("MCP_RECONNECT_MAX_ATTEMPTS", 10)) || 10);

        if (this.reconnect.attempt >= limit) {

            this.state = STATE.FAILED;
            this.reconnect.next_at = null;
            this.noteError(
                `MCP server "${this.name}" did not come back after ${this.reconnect.attempt} reconnect attempt(s): ${this.reconnect.last_error || "unknown error"}`
            );

            emit("mcp:unavailable", {
                server: this.name,
                transport: this.config.transport,
                error: this.error
            });

            return false;
        }

        this.reconnect.attempt += 1;

        const delay = reconnectDelay(this.reconnect.attempt);

        this.state = STATE.RECONNECTING;
        this.reconnect.next_at = Date.now() + delay;

        const timer = setTimeout(() => {
            this.reconnect.timer = null;
            void this.attemptReconnect();
        }, delay);

        if (typeof timer.unref === "function") {
            timer.unref();
        }

        this.reconnect.timer = timer;

        return true;
    }


    async attemptReconnect() {

        if (this.state === STATE.CLOSED) {
            return false;
        }

        this.reconnect.next_at = null;

        try {

            await this.ensureReady();
            await this.listTools({ force: true });

        } catch (error) {

            if (this.state === STATE.CLOSED) {
                return false;
            }

            this.noteError(`MCP server "${this.name}" reconnect attempt ${this.reconnect.attempt} failed: ${error.message}`);

            const retrying = this.scheduleReconnect();

            if (retrying) {
                emit("mcp:disconnected", {
                    server: this.name,
                    transport: this.config.transport,
                    error: this.error,
                    retrying,
                    attempt: this.reconnect.attempt,
                    retry_in_ms: Math.max(0, this.reconnect.next_at - Date.now())
                });
            }

            return false;
        }

        const attempts = this.reconnect.attempt;

        this.reconnect.attempt = 0;
        this.reconnect.count += 1;

        emit("mcp:reconnected", {
            server: this.name,
            transport: this.config.transport,
            attempts,
            tools: this.tools.length,
            down_ms: this.reconnect.disconnected_at ? Date.now() - this.reconnect.disconnected_at : null
        });

        return true;
    }


    /* the console's Reconnect: start over now, with a fresh attempt budget */
    async reconnectNow() {

        this.cancelReconnect();
        this.reconnect.attempt = 0;

        if (this.state === STATE.FAILED || this.state === STATE.RECONNECTING) {
            this.state = STATE.IDLE;
        }

        this.readyPromise = null;

        await this.ensureReady();
        await this.listTools({ force: true });

        return this;
    }


    cancelReconnect() {

        if (this.reconnect.timer) {
            clearTimeout(this.reconnect.timer);
        }

        this.reconnect.timer = null;
        this.reconnect.next_at = null;
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


    handleRequest(message) {

        if (message.method === "ping") {
            return {};
        }

        if (message.method === "roots/list") {
            return { roots: this.roots() };
        }

        this.record(
            `server asked for "${message.method}", which this client does not support`
        );

        const error =
            new Error(`method "${message.method}" is not supported by this client`);

        error.code = -32601;

        throw error;
    }


    /*
    | The roots a server may work in: the ones configured for it, or the
    | directory it was started in. Nothing outside is ever advertised.
    */

    roots() {

        if (Array.isArray(this.config.roots)) {

            return this.config.roots
                .filter(root => typeof root === "string" || (root && root.uri))
                .map(root =>
                    typeof root === "string"
                        ? { uri: pathToFileURL(path.resolve(root)).href, name: path.basename(root) || root }
                        : { uri: String(root.uri), ...(root.name ? { name: String(root.name) } : {}) }
                );
        }

        if (typeof this.config.cwd !== "string" || this.config.cwd === "") {
            return [];
        }

        const root =
            path.resolve(this.config.cwd);

        return [
            {
                uri: pathToFileURL(root).href,
                name: path.basename(root) || root
            }
        ];
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

                    /*
                    | Only what is implemented is advertised: roots/list
                    | is answered (handleRequest); sampling is not.
                    */

                    capabilities: {
                        roots: { listChanged: false }
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

                    if (this.state !== STATE.CLOSED) {
                        this.state = STATE.FAILED;
                    }

                    this.noteError(error.message);

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

            catalog:
                this.config.catalog || null,

            scope:
                this.config.scope || "global",

            projects:
                this.config.projects || null,

            source:
                this.config.source || null,

            /* P4-04: what the status indicator shows */
            reconnect: {
                attempt: this.reconnect.attempt,
                next_at: this.reconnect.next_at,
                count: this.reconnect.count,
                last_error: this.reconnect.last_error,
                last_error_at: this.reconnect.last_error_at,
                disconnected_at: this.reconnect.disconnected_at
            },

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

        this.cancelReconnect();

        this.readyPromise = null;

        this.toolsLoadedAt = null;

        await this.transport.close();
    }
}


module.exports = {
    reconnectDelay,
    McpClient,
    McpConnection: McpClient,
    STATE,
    TRANSPORTS,
    TRANSPORT_KINDS,
    createTransport
};
