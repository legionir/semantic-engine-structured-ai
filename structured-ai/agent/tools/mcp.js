const settings = require("../lib/storage");

const {
    manager,
    parseToolName
} = require("../mcp/manager");


/*
|--------------------------------------------------------------------------
| MCP Tools
|--------------------------------------------------------------------------
|
| Two ways to reach an MCP server, because neither one is right for
| every case:
|
|   mcp_servers / mcp_tools / mcp_call
|       the gateway. Three tools that reach every server, including one
|       added after the run started, at the cost of one extra hop for
|       the model.
|
|   mcp__<server>__<tool>
|       the discovered tools themselves, declared to the endpoint as
|       ordinary functions with the server's own schema. Cheaper for the
|       model and impossible before discovery has run.
|
| Both go through the same manager, so a policy decision applies whether
| a tool was called directly or through the gateway.
|--------------------------------------------------------------------------
*/

function truncate(text, limit) {

    const cap =
        limit || settings.get("MCP_EXCERPT_CHARS") || 300;

    if (typeof text !== "string") {
        return text;
    }

    return text.length <= cap
        ? text
        : `${text.slice(0, cap)}…`;
}


function unavailable(reason) {

    return {
        ok: false,
        error: reason,
        hint:
            "Use mcp_servers to see which servers are configured and why one is not connected."
    };
}


/*
|--------------------------------------------------------------------------
| Gateway
|--------------------------------------------------------------------------
*/

async function mcpServers(args = {}) {

    const status =
        manager.status();

    if (args.refresh) {

        await manager.discover({ force: true }).catch(() => {});
    }

    const servers =
        manager.status().servers.map(server => ({
            name: server.name,
            transport: server.transport,
            state: server.state,
            enabled: server.enabled,
            builtin: server.builtin,
            tool_count: server.tool_count,
            error: server.error ? truncate(server.error, 200) : null,
            server_name:
                server.server ? server.server.name : null,
            server_version:
                server.server ? server.server.version : null,
            protocol_version: server.protocol_version,
            capabilities: server.capabilities,
            calls: server.stats.calls,
            failures: server.stats.failures
        }));

    return {
        enabled: status.enabled,
        supported_transports: status.transports,
        total: servers.length,
        connected:
            servers.filter(server => server.state === "ready").length,
        servers,
        problems:
            status.problems.map(problem => truncate(problem, 300))
    };
}


async function mcpTools(args = {}) {

    if (!manager.enabled()) {
        return unavailable("MCP is disabled (MCP_ENABLED=false).");
    }

    await manager.discover({ force: Boolean(args.refresh) });

    const wanted =
        args.server ? String(args.server) : null;

    let projectId = null;

    try {

        const { runManager } = require("../runtime");

        const run =
            runManager && typeof runManager.current === "function"
                ? runManager.current()
                : null;

        projectId = run && run.projectId ? run.projectId : null;

    } catch {
        /* unscoped */
    }

    const entries =
        manager.catalogueEntries(projectId).filter(
            entry => !wanted || entry.server === wanted
        );

    const limit =
        Math.min(
            Number(args.limit) > 0 ? Number(args.limit) : 100,
            settings.get("MCP_MAX_TOOLS") || 200
        );

    return {
        server: wanted,

        total: entries.length,

        returned: Math.min(entries.length, limit),

        tools:
            entries.slice(0, limit).map(entry => ({
                name: entry.name,
                server: entry.server,
                tool: entry.tool,
                description: truncate(entry.description, 300),
                parameters:
                    entry.input_schema &&
                    entry.input_schema.properties
                        ? Object.keys(entry.input_schema.properties)
                        : [],
                required:
                    entry.input_schema &&
                    Array.isArray(entry.input_schema.required)
                        ? entry.input_schema.required
                        : []
            }))
    };
}


async function mcpCall(args = {}) {

    if (!manager.enabled()) {
        return unavailable("MCP is disabled (MCP_ENABLED=false).");
    }

    const serverName =
        args.server ? String(args.server) : null;

    const requested =
        args.tool ? String(args.tool) : null;

    if (!requested) {

        throw new Error(
            "mcp_call requires a tool name."
        );
    }

    /*
    | A namespaced name carries its own server, so both shapes work:
    | {tool: "mcp__github__search"} and {server: "github", tool: "search"}.
    */

    const parsed =
        parseToolName(requested);

    const target =
        parsed
            ? { server: parsed.server, tool: parsed.tool }
            : { server: serverName, tool: requested };

    if (!target.server) {

        throw new Error(
            "mcp_call requires a server, either as the server argument or as an mcp__<server>__<tool> name."
        );
    }

    const startedAt = Date.now();

    try {

        const result =
            await manager.call(
                target.server,
                target.tool,
                args.arguments || args.args || {},
                {
                    timeoutMs:
                        Number(args.timeout_ms) > 0
                            ? Number(args.timeout_ms)
                            : undefined
                }
            );

        return {
            ok: true,
            server: target.server,
            tool: target.tool,
            duration_ms: Date.now() - startedAt,
            result
        };

    } catch (error) {

        return {
            ok: false,
            server: target.server,
            tool: target.tool,
            duration_ms: Date.now() - startedAt,
            error: error.message
        };
    }
}


async function mcpAdd(args = {}) {

    if (!manager.enabled()) {
        return unavailable("MCP is disabled (MCP_ENABLED=false).");
    }

    if (settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {

        return {
            ok: false,
            error:
                "Adding an MCP server at runtime is disabled (MCP_ALLOW_RUNTIME_ADD=false)."
        };
    }

    const name =
        args.name ? String(args.name).trim() : "";

    if (!name) {

        throw new Error(
            "mcp_add requires a name for the server."
        );
    }

    try {

        const added =
            await manager.add(
                name,
                {
                    transport: args.transport,
                    command: args.command,
                    args: args.command_args,
                    url: args.url,
                    env: args.env,
                    headers: args.headers,
                    token: args.token,
                    description: args.description,
                    include: args.include,
                    exclude: args.exclude,
                    trust: args.trust
                },
                { persist: args.persist !== false }
            );

        const tools =
            manager.catalogueEntries().filter(
                entry => entry.server === added.config.name
            );

        return {
            ok: true,
            server: added.config.name,
            transport: added.config.transport,
            persisted_to: added.persisted_to,
            tool_count: tools.length,
            tools:
                tools.slice(0, 30).map(entry => entry.name)
        };

    } catch (error) {

        return {
            ok: false,
            server: name,
            error: error.message
        };
    }
}


async function mcpRemove(args = {}) {

    const name =
        args.name ? String(args.name).trim() : "";

    if (!name) {

        throw new Error(
            "mcp_remove requires the name of the server to remove."
        );
    }

    if (settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {

        return {
            ok: false,
            error:
                "Changing MCP servers at runtime is disabled (MCP_ALLOW_RUNTIME_ADD=false)."
        };
    }

    const removed =
        await manager.remove(name, { persist: args.persist !== false });

    return {
        ok: removed.removed || removed.forgotten,
        server: name,
        disconnected: removed.removed,
        forgotten: removed.forgotten
    };
}


/*
|--------------------------------------------------------------------------
| Discovered Tools
|--------------------------------------------------------------------------
|
| Every mcp__<server>__<tool> call lands here. The tool layer does not
| know these names at startup, so it asks this module whether a name is
| one of them.
|--------------------------------------------------------------------------
*/

function hasDiscoveredTool(name) {

    return manager.enabled() && manager.hasTool(name);
}


function discoveredToolNames() {

    return manager
        .catalogueEntries()
        .map(entry => entry.name)
        .sort();
}


async function executeDiscovered(name, args = {}) {

    const entry =
        manager.catalogueEntry(name);

    if (!entry) {

        throw new Error(
            `MCP tool "${name}" is not in the catalogue. Run mcp_tools to see what is available.`
        );
    }

    const payload = { ...args };

    delete payload._agent;

    const startedAt = Date.now();

    try {

        const result =
            await manager.call(entry.server, entry.tool, payload);

        return {
            ok: true,
            server: entry.server,
            tool: entry.tool,
            duration_ms: Date.now() - startedAt,
            result
        };

    } catch (error) {

        return {
            ok: false,
            server: entry.server,
            tool: entry.tool,
            duration_ms: Date.now() - startedAt,
            error: error.message
        };
    }
}


async function discover(options = {}) {

    if (!manager.enabled()) {
        return [];
    }

    return manager.discover(options);
}


function startRunScope() {

    return manager.startRunScope();
}


function shutdown() {

    return manager.shutdown();
}


module.exports = {
    mcp_servers: mcpServers,
    mcp_tools: mcpTools,
    mcp_call: mcpCall,
    mcp_add: mcpAdd,
    mcp_remove: mcpRemove,

    _hasDiscoveredTool: hasDiscoveredTool,
    _discoveredToolNames: discoveredToolNames,
    _executeDiscovered: executeDiscovered,
    _discover: discover,
    _startRunScope: startRunScope,
    _shutdown: shutdown,
    _manager: manager
};
