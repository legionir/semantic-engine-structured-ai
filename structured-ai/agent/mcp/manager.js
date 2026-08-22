const settings = require("../lib/storage");
const events = require("../lib/events");

const config = require("./config");

const { McpClient, TRANSPORT_KINDS } = require("./client");


/*
|--------------------------------------------------------------------------
| MCP Manager
|--------------------------------------------------------------------------
|
| The runtime has one manager. It owns every configured server, the
| client that talks to it, and the catalogue of tools those servers
| offer, and it is the only thing the tool layer above it needs to know
| about.
|
|   configuration ──► clients ──► catalogue ──► mcp_call / mcp__server__tool
|
| A server that is unreachable is a degraded capability, not a failed
| run: its tools disappear from the catalogue, the reason is kept, and
| everything else carries on. That rule is why almost nothing in here
| throws.
|
| Tool names are namespaced as mcp__<server>__<tool>, so two servers can
| both offer "search" without one shadowing the other.
|--------------------------------------------------------------------------
*/

const NAMESPACE_PREFIX = "mcp__";

const NAMESPACE_SEPARATOR = "__";


function toolName(serverName, tool) {

    return `${NAMESPACE_PREFIX}${serverName}${NAMESPACE_SEPARATOR}${tool}`;
}


function parseToolName(name) {

    if (
        typeof name !== "string" ||
        !name.startsWith(NAMESPACE_PREFIX)
    ) {
        return null;
    }

    const rest =
        name.slice(NAMESPACE_PREFIX.length);

    const separator =
        rest.indexOf(NAMESPACE_SEPARATOR);

    if (separator <= 0) {
        return null;
    }

    return {
        server:
            rest.slice(0, separator),

        tool:
            rest.slice(separator + NAMESPACE_SEPARATOR.length)
    };
}


function matchesFilter(name, include, exclude) {

    if (exclude && exclude.includes(name)) {
        return false;
    }

    if (include && include.length > 0) {
        return include.includes(name);
    }

    return true;
}


class McpManager {

    constructor() {

        this.clients = new Map();

        this.problems = [];

        this.catalogue = new Map();

        this.loadedAt = null;

        this.workspaceRoot = null;

        this.discovering = null;

        this.lastDiscoveryAt = null;

        settings.bus.on("change", event => {

            if (
                event.key === "MCP_ENABLED" ||
                event.key === "MCP_SERVERS"
            ) {
                this.invalidate();
            }
        });
    }


    enabled() {

        return settings.get("MCP_ENABLED") !== false;
    }


    /*
    | The configuration is read once and kept, because it is read from
    | disk and a run asks for it constantly. Anything that could change
    | it calls invalidate().
    */

    load(workspaceRoot) {

        const root =
            workspaceRoot ||
            this.workspaceRoot ||
            settings.get("WORKSPACE_ROOT") ||
            process.cwd();

        if (
            this.loadedAt &&
            this.workspaceRoot === root
        ) {
            return this;
        }

        const loaded =
            config.load(root);

        this.workspaceRoot = root;

        this.problems = loaded.problems;

        const seen = new Set();

        for (const definition of loaded.servers) {

            seen.add(definition.name);

            const existing =
                this.clients.get(definition.name);

            /*
            | A client whose definition did not change keeps its
            | connection; the alternative is restarting every sidecar
            | whenever anything is reloaded.
            */

            if (
                existing &&
                JSON.stringify(existing.config) === JSON.stringify(definition)
            ) {
                continue;
            }

            if (existing) {

                void existing.close().catch(() => {});
            }

            this.clients.set(
                definition.name,
                new McpClient(definition)
            );
        }

        for (const [name, client] of [...this.clients.entries()]) {

            if (seen.has(name)) {
                continue;
            }

            void client.close().catch(() => {});

            this.clients.delete(name);
        }

        this.loadedAt = Date.now();

        this.catalogue.clear();

        for (const problem of this.problems) {

            events.emit("mcp:problem", { message: problem });
        }

        return this;
    }


    invalidate() {

        this.loadedAt = null;

        this.lastDiscoveryAt = null;

        this.discovering = null;

        this.catalogue.clear();
    }


    activeClients() {

        this.load();

        if (!this.enabled()) {
            return [];
        }

        const trustProjectConfig =
            settings.get("MCP_TRUST_PROJECT_CONFIG") === true;

        return [...this.clients.values()].filter(client => {

            if (client.config.enabled === false) {
                return false;
            }

            const untrustedStdio =
                client.config.transport === "stdio" &&
                ["project", "workspace"].includes(client.config.source) &&
                !trustProjectConfig;

            return !untrustedStdio;
        });
    }


    client(name) {

        this.load();

        return this.clients.get(name) || null;
    }


    /*
    | Connecting to every configured server on the first call would make
    | the first tool call of a run pay for all of them, so discovery is
    | one bounded parallel pass whose result is cached.
    */

    async discover(options = {}) {

        if (!this.enabled()) {
            return [];
        }

        this.load();

        if (
            !options.force &&
            this.lastDiscoveryAt &&
            this.catalogue.size >= 0 &&
            Date.now() - this.lastDiscoveryAt <
                (settings.get("MCP_DISCOVERY_TTL_MS") || 300000)
        ) {
            return [...this.catalogue.values()];
        }

        if (this.discovering && !options.force) {
            return this.discovering;
        }

        this.discovering =
            this.runDiscovery(options)
                .then(result => {

                    this.discovering = null;

                    return result;
                })
                .catch(error => {

                    this.discovering = null;

                    throw error;
                });

        return this.discovering;
    }


    async runDiscovery(options) {

        const clients =
            this.activeClients();

        const catalogue = new Map();

        await Promise.all(
            clients.map(async client => {

                try {

                    const tools =
                        await client.listTools({ force: Boolean(options.force) });

                    for (const tool of tools) {

                        if (
                            !matchesFilter(
                                tool.name,
                                client.config.include,
                                client.config.exclude
                            )
                        ) {
                            continue;
                        }

                        const namespaced =
                            toolName(client.name, tool.name);

                        catalogue.set(namespaced, {
                            name: namespaced,
                            server: client.name,
                            tool: tool.name,
                            description: tool.description || "",
                            input_schema:
                                tool.inputSchema || tool.input_schema || null,
                            annotations: tool.annotations || null,
                            trust: client.config.trust,
                            builtin: Boolean(client.config.builtin)
                        });
                    }

                    events.emit("mcp:connected", {
                        server: client.name,
                        transport: client.config.transport,
                        tools: tools.length
                    });

                } catch (error) {

                    events.emit("mcp:unavailable", {
                        server: client.name,
                        transport: client.config.transport,
                        error: error.message
                    });
                }
            })
        );

        this.catalogue = catalogue;

        this.lastDiscoveryAt = Date.now();

        return [...catalogue.values()];
    }


    /*
    | What the model is allowed to see. Discovery has to have happened
    | for this to be populated, and it deliberately does not trigger it:
    | building a prompt must not wait on a network round trip.
    */

    catalogueEntries() {

        return [...this.catalogue.values()];
    }


    catalogueEntry(name) {

        return this.catalogue.get(name) || null;
    }


    hasTool(name) {

        return this.catalogue.has(name);
    }


    /*
    | The JSON schema a server publishes is not always one the endpoint
    | will accept, so it is reduced to the subset every OpenAI
    | compatible endpoint understands, and an absent one becomes an open
    | object rather than a missing field.
    */

    toolDeclaration(entry) {

        const schema =
            entry.input_schema && typeof entry.input_schema === "object"
                ? entry.input_schema
                : null;

        const parameters =
            schema && schema.type === "object"
                ? {
                    type: "object",
                    properties: schema.properties || {},
                    required:
                        Array.isArray(schema.required) ? schema.required : []
                }
                : {
                    type: "object",
                    properties: {},
                    required: []
                };

        const description =
            `[MCP ${entry.server}] ${
                entry.description || `Call "${entry.tool}" on the ${entry.server} MCP server.`
            }`;

        return {
            type: "function",
            function: {
                name: entry.name,
                description: description.slice(0, 1024),
                parameters
            }
        };
    }


    toolDeclarations() {

        return this.catalogueEntries().map(
            entry => this.toolDeclaration(entry)
        );
    }


    async callTool(name, args, options = {}) {

        const parsed =
            parseToolName(name);

        if (!parsed) {

            throw new Error(
                `"${name}" is not an MCP tool name; they look like mcp__<server>__<tool>.`
            );
        }

        return this.call(parsed.server, parsed.tool, args, options);
    }


    async call(serverName, tool, args, options = {}) {

        if (!this.enabled()) {

            throw new Error(
                "MCP is disabled (MCP_ENABLED=false)."
            );
        }

        const client =
            this.client(serverName);

        if (!client) {

            const known =
                this.activeClients().map(item => item.name);

            throw new Error(
                `There is no MCP server called "${serverName}".${
                    known.length
                        ? ` Configured servers: ${known.sort().join(", ")}.`
                        : " No MCP servers are configured."
                }`
            );
        }

        if (client.config.enabled === false) {

            throw new Error(
                `MCP server "${serverName}" is disabled.`
            );
        }

        if (
            !matchesFilter(
                tool,
                client.config.include,
                client.config.exclude
            )
        ) {

            throw new Error(
                `Tool "${tool}" is filtered out of MCP server "${serverName}" by its configuration.`
            );
        }

        const startedAt = Date.now();

        events.emit("mcp:call", {
            server: serverName,
            tool
        });

        try {

            const result =
                await client.callTool(tool, args, {
                    timeoutMs:
                        options.timeoutMs ||
                        settings.get("MCP_CALL_TIMEOUT_MS") ||
                        undefined
                });

            events.emit("mcp:result", {
                server: serverName,
                tool,
                duration_ms: Date.now() - startedAt,
                ok: true
            });

            return result;

        } catch (error) {

            events.emit("mcp:result", {
                server: serverName,
                tool,
                duration_ms: Date.now() - startedAt,
                ok: false,
                error: error.message
            });

            throw error;
        }
    }


    /*
    | Adding a server at runtime is how the console and mcp_add work.
    | The connection is proved before the server is kept, because a
    | server that was never reachable is a typo, not a capability.
    */

    async add(name, definition, options = {}) {

        this.load();

        const normalized =
            config.normalizeOne(
                name,
                definition,
                this.workspaceRoot
            );

        const previous =
            this.clients.get(normalized.name);

        const client =
            new McpClient(normalized);

        try {

            await client.ensureReady();

            await client.listTools({ force: true });

        } catch (error) {

            await client.close().catch(() => {});

            throw new Error(
                `MCP server "${normalized.name}" could not be reached: ${error.message}`
            );
        }

        if (previous) {

            await previous.close().catch(() => {});
        }

        this.clients.set(normalized.name, client);

        let persistedTo = null;

        if (options.persist !== false) {

            try {

                persistedTo =
                    config.persist(this.workspaceRoot, normalized);

            } catch (error) {

                this.problems.push(
                    `"${normalized.name}" was connected but not saved: ${error.message}`
                );
            }
        }

        this.lastDiscoveryAt = null;

        await this.discover({ force: true });

        events.emit("mcp:added", {
            server: normalized.name,
            transport: normalized.transport,
            persisted: Boolean(persistedTo)
        });

        return {
            config: normalized,
            client,
            persisted_to: persistedTo
        };
    }


    async remove(name, options = {}) {

        this.load();

        const client =
            this.clients.get(name);

        if (client) {

            await client.close().catch(() => {});

            this.clients.delete(name);
        }

        let forgotten = false;

        if (options.persist !== false) {

            try {

                forgotten =
                    config.forget(this.workspaceRoot, name);

            } catch {
                /* the file is not writable; the server is still gone for this run */
            }
        }

        for (const key of [...this.catalogue.keys()]) {

            const parsed = parseToolName(key);

            if (parsed && parsed.server === name) {
                this.catalogue.delete(key);
            }
        }

        events.emit("mcp:removed", {
            server: name,
            persisted: forgotten
        });

        return {
            removed: Boolean(client),
            forgotten
        };
    }


    setEnabled(name, enabled) {

        const client =
            this.client(name);

        if (!client) {
            return false;
        }

        client.config.enabled = enabled;

        if (!enabled) {

            void client.close().catch(() => {});

            for (const key of [...this.catalogue.keys()]) {

                const parsed = parseToolName(key);

                if (parsed && parsed.server === name) {
                    this.catalogue.delete(key);
                }
            }
        }

        this.lastDiscoveryAt = null;

        return true;
    }


    status() {

        this.load();

        return {
            enabled:
                this.enabled(),

            workspace_root:
                this.workspaceRoot,

            transports:
                TRANSPORT_KINDS,

            discovered_at:
                this.lastDiscoveryAt,

            tool_count:
                this.catalogue.size,

            servers:
                [...this.clients.values()].map(
                    client => client.describe()
                ),

            problems:
                [...this.problems]
        };
    }


    /*
    | Nothing from one run may leak into the next, but a stdio sidecar
    | that is already warm should survive: only the catalogue is aged
    | out, and the servers stay where they are.
    */

    startRunScope() {

        this.load();

        this.lastDiscoveryAt = null;

        return {
            enabled:
                this.enabled(),

            servers:
                this.activeClients().map(client => ({
                    name: client.name,
                    transport: client.config.transport,
                    state: client.state
                })),

            problems:
                this.problems.length
        };
    }


    async shutdown() {

        const closing =
            [...this.clients.values()].map(
                client => client.close().catch(() => {})
            );

        this.clients.clear();

        this.catalogue.clear();

        this.loadedAt = null;

        this.lastDiscoveryAt = null;

        await Promise.all(closing);
    }
}


const manager = new McpManager();


module.exports = {
    manager,
    McpManager,
    toolName,
    parseToolName,
    NAMESPACE_PREFIX,
    NAMESPACE_SEPARATOR
};
