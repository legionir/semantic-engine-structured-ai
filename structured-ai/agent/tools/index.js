const filesystem = require("./filesystem");
const fileinfo = require("./fileinfo");
const plan = require("./plan");
const memory = require("./memory");
const skills = require("./skills");
const search = require("./search");
const processTools = require("./process");
const git = require("./git");
const net = require("./net");
const telemetry = require("./telemetry");
const code = require("./code");
const mcp = require("./mcp");

const {
    capResult,
    capTotalSize
} = require("../lib/workspace");


/*
|--------------------------------------------------------------------------
| Tool Implementations
|--------------------------------------------------------------------------
|
| The single place where a tool name maps to executable behaviour. The
| registry in registry/tools.json declares the same names to the model;
| the runtime validates that the two sides agree at startup.
|--------------------------------------------------------------------------
*/

/*
| Modules may export helpers for testing. Only public tool functions,
| which never start with an underscore, become callable tools.
*/

function publicTools(moduleExports) {

    return Object.fromEntries(
        Object.entries(moduleExports).filter(
            ([name, value]) =>
                !name.startsWith("_") &&
                typeof value === "function"
        )
    );
}


const IMPLEMENTATIONS = {
    ...publicTools(filesystem),
    ...publicTools(fileinfo),
    ...publicTools(plan),
    ...publicTools(memory),
    ...publicTools(skills),
    ...publicTools(git),
    ...publicTools(net),
    ...publicTools(code),
    ...publicTools(mcp),

    search_start: search.search_start,
    search_get: search.search_get,
    search_list: search.search_list,
    search_stop: search.search_stop,

    terminal_exec: processTools.terminal_exec,
    process_start: processTools.process_start,
    process_read: processTools.process_read,
    process_write: processTools.process_write,
    process_terminate: processTools.process_terminate,
    process_list: processTools.process_list,

    runtime_stats: telemetry.runtime_stats
};


function executedToolNames() {

    return telemetry.executedToolNames();
}


/*
| A tool is either one this repository implements or one an MCP server
| offered at discovery time. The second kind does not exist until a
| server has answered, which is why the check is a function call rather
| than a lookup in a table built at startup.
*/

function hasTool(name) {

    if (
        Object.prototype.hasOwnProperty.call(
            IMPLEMENTATIONS,
            name
        )
    ) {
        return true;
    }

    return mcp._hasDiscoveredTool(name);
}


function implementedToolNames() {

    return Object.keys(IMPLEMENTATIONS).sort();
}


/*
| The names an agent may actually call right now, which is the static
| catalogue plus whatever the connected MCP servers are offering.
*/

function callableToolNames() {

    return [
        ...Object.keys(IMPLEMENTATIONS),
        ...mcp._discoveredToolNames()
    ].sort();
}


function mcpToolDeclarations() {

    return mcp._manager.toolDeclarations();
}


async function discoverMcpTools(options) {

    return mcp._discover(options);
}


async function executeTool(
    name,
    args,
    context = {}
) {

    if (!hasTool(name)) {

        throw new Error(
            `Tool is not implemented: ${name}`
        );
    }

    const startedAt = Date.now();

    try {

        /*
        | A tool receives only its declared arguments. The agent that
        | called it is context, passed under a name no schema uses, for
        | the two tools that report which agent acted.
        */

        const implementation =
            IMPLEMENTATIONS[name];

        const result =
            implementation
                ? await implementation(
                    {
                        ...(args || {}),

                        _agent: context.agent
                    }
                )
                : await mcp._executeDiscovered(
                    name,
                    args || {}
                );

        telemetry.record({
            name,
            success: true,
            durationMs: Date.now() - startedAt,
            agent: context.agent,
            arguments: args || {}
        });

        return capTotalSize(
            capResult(result)
        );

    } catch (error) {

        telemetry.record({
            name,
            success: false,
            durationMs: Date.now() - startedAt,
            agent: context.agent,
            error: error.message,
            arguments: args || {}
        });

        throw error;
    }
}


function shutdown() {

    processTools.shutdownAll();
    code._shutdown();

    void mcp._shutdown();
}


/*
| State that belongs to one run must not leak into the next: a stale
| search session could be fetched by id, and telemetry from a previous
| run would misreport what this one did. Background processes are the
| exception, they are deliberately long lived, so they are reported
| instead of killed.
*/

function startRunScope() {

    search.resetSessions();

    telemetry.reset();

    const semanticScope = code._startRunScope();

    const mcpScope = mcp._startRunScope();

    const running =
        [...processTools._sessions.values()].filter(
            session => session.status === "running"
        );

    return {
        background_processes:
            running.map(
                session => ({
                    process_id: session.id,
                    command: session.command
                })
            ),
        semantic: semanticScope,
        mcp: mcpScope
    };
}


module.exports = {
    executedToolNames,
    executeTool,
    startRunScope,
    hasTool,
    implementedToolNames,
    callableToolNames,
    mcpToolDeclarations,
    discoverMcpTools,
    shutdown,
    telemetry,
    mcp
};
