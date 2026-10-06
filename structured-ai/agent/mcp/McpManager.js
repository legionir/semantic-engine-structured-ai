"use strict";

const settings = require("../config");
const events = require("../events");

const loader = require("./McpConfigLoader");
const validator = require("./McpConfigValidator");
const trust = require("./McpTrustPolicy");
const catalogue = require("./McpCatalogue");

const { McpClient, TRANSPORT_KINDS } = require("./McpConnection");


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
|--------------------------------------------------------------------------
*/

/*
| The project a call acts for: the delegation frame's project when a
| Sub-Agent runs for another project, otherwise the run's own. Reading only
| the run's projectId (the previous behaviour) made a child delegated to
| project B use project A's servers and trust scope.
*/
function currentProject() {

    try {

        const { effectiveProject } = require("../runtime/ProjectOverride");

        return effectiveProject() || null;

    } catch {

        return null;
    }
}


function currentProjectId() {

    const project = currentProject();

    if (project) {
        return project.projectId ?? project.id ?? null;
    }

    try {

        const { runManager } = require("../runtime");

        const run =
            runManager && typeof runManager.current === "function"
                ? runManager.current()
                : null;

        return run && run.projectId ? run.projectId : null;

    } catch {

        return null;
    }
}


class McpManager {

    /*
    | `boundRoot`: the workspace this manager belongs to. A manager created
    | for a project never reads another workspace's .mcp.json or caches its
    | catalogue; McpManagerRegistry keeps one instance per root.
    */
    constructor(boundRoot = null) {

        this.boundRoot = boundRoot;

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
            this.boundRoot ||
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
            loader.load(root);

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

        return [...this.clients.values()].filter(client =>
            trust.isActive(client.config)
        );
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

        const next = new Map();

        await Promise.all(
            clients.map(async client => {

                try {

                    const tools =
                        await client.listTools({ force: Boolean(options.force) });

                    for (const tool of tools) {

                        if (
                            !catalogue.matchesFilter(
                                tool.name,
                                client.config.include,
                                client.config.exclude
                            )
                        ) {
                            continue;
                        }

                        const entry =
                            catalogue.entryFromTool(client, tool);

                        next.set(entry.name, entry);
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

        this.catalogue = next;

        this.lastDiscoveryAt = Date.now();

        return [...next.values()];
    }


    /*
    | What the model is allowed to see. Discovery has to have happened
    | for this to be populated, and it deliberately does not trigger it:
    | building a prompt must not wait on a network round trip.
    */

    catalogueEntries(projectId) {

        const entries = [...this.catalogue.values()];

        if (!projectId) {
            return entries;
        }

        return entries.filter(entry => {

            const client = this.clients.get(entry.server);

            return trust.serverVisibleTo(
                client ? client.config : { scope: "global" },
                projectId
            );
        });
    }


    catalogueEntry(name) {

        return this.catalogue.get(name) || null;
    }


    hasTool(name) {

        return this.catalogue.has(name);
    }


    toolDeclaration(entry) {

        return catalogue.toolDeclaration(entry);
    }


    toolDeclarations(projectId) {

        return this.catalogueEntries(projectId).map(
            entry => this.toolDeclaration(entry)
        );
    }


    async callTool(name, args, options = {}) {

        const parsed =
            catalogue.parseToolName(name);

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

        const projectId =
            options.projectId || currentProjectId();

        if (
            projectId &&
            !trust.serverVisibleTo(client.config, projectId)
        ) {

            throw new Error(
                `MCP server "${serverName}" is not in scope for project ${projectId}.`
            );
        }

        if (
            !catalogue.matchesFilter(
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
            validator.normalizeOne(
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
                    loader.persist(this.workspaceRoot || this.boundRoot, normalized);

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
                    loader.forget(this.workspaceRoot || this.boundRoot, name);

            } catch {
                /* the file is not writable; the server is still gone for this run */
            }
        }

        for (const key of [...this.catalogue.keys()]) {

            const parsed = catalogue.parseToolName(key);

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

                const parsed = catalogue.parseToolName(key);

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

        /*
        | Not every entry in this map is guaranteed to be an McpClient:
        | tests inject doubles (`manager.clients.set(name, { config })`) and
        | callers may register a server whose definition never produced a
        | connection. Calling `client.close()` on such an entry throws a
        | TypeError *synchronously* inside this async function, which turns a
        | shutdown into an unhandled rejection — fatal on Node 18, silently
        | swallowed on Node 22, so the same teardown crashed CI only on some
        | runtimes (project-api teardown). Skip entries that cannot close.
        */
        const closing =
            [...this.clients.values()].map(
                client =>
                    client && typeof client.close === "function"
                        ? client.close().catch(() => {})
                        : Promise.resolve()
            );

        this.clients.clear();

        this.catalogue.clear();

        this.loadedAt = null;

        this.lastDiscoveryAt = null;

        await Promise.all(closing);
    }
}


/*
|--------------------------------------------------------------------------
| Project-scoped managers
|--------------------------------------------------------------------------
|
| One McpManager per workspace root. `manager` (exported below) is a facade
| that forwards every call to the manager of the ACTIVE project - the
| delegation frame's project if there is one, otherwise the run's project,
| otherwise the process workspace (the synthetic default project's root, the
| one documented fallback). A project without a workspace root is a loud
| error: guessing "the first workspace" is what mixed two projects' servers.
|--------------------------------------------------------------------------
*/

function canonicalRoot(root) {

    const path = require("path");

    return path.resolve(String(root));
}


class McpManagerRegistry {

    constructor() {

        this.instances = new Map();
    }


    rootForActiveProject() {

        const project = currentProject();

        if (!project) {

            return settings.get("WORKSPACE_ROOT") || process.cwd();
        }

        const root = project.workspaceRoot || project.rootPath;

        if (!root) {

            throw new Error(
                `MCP: project ${project.projectId ?? project.id ?? "(unknown)"} has no workspaceRoot; refusing to fall back to another workspace.`
            );
        }

        return root;
    }


    forRoot(root) {

        const key = canonicalRoot(root);

        let instance = this.instances.get(key);

        if (!instance) {

            instance = new McpManager(key);

            this.instances.set(key, instance);
        }

        return instance;
    }


    current() {

        return this.forRoot(this.rootForActiveProject());
    }


    /* All projects' servers are closed together on process shutdown. */
    async shutdown() {

        await Promise.all(
            [...this.instances.values()].map(instance => instance.shutdown())
        );

        this.instances.clear();
    }
}


const registry = new McpManagerRegistry();


const manager = new Proxy(registry, {

    get(target, property) {

        if (property in target) {

            const own = target[property];

            return typeof own === "function" ? own.bind(target) : own;
        }

        const instance = target.current();

        const value = instance[property];

        return typeof value === "function" ? value.bind(instance) : value;
    },

    set(target, property, value) {

        if (property in target) {

            target[property] = value;

            return true;
        }

        target.current()[property] = value;

        return true;
    }
});


module.exports = {
    manager,
    McpManagerRegistry,
    managerRegistry: registry,
    McpManager,
    toolName: catalogue.toolName,
    parseToolName: catalogue.parseToolName,
    NAMESPACE_PREFIX: catalogue.NAMESPACE_PREFIX,
    NAMESPACE_SEPARATOR: catalogue.NAMESPACE_SEPARATOR
};
