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
const discussion = require("./discussion");
const ToolContext = require("./ToolContext");

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
    ...publicTools(discussion),

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

    let projectId = null;

    try {

        const { runManager } = require("../runtime");

        const run =
            runManager && typeof runManager.current === "function"
                ? runManager.current()
                : null;

        projectId = run && run.projectId ? run.projectId : null;

    } catch {
        /* outside a run the catalogue is unfiltered (legacy) */
    }

    return mcp._manager.toolDeclarations(projectId);
}


async function discoverMcpTools(options) {

    return mcp._discover(options);
}


/*
| Tools that still act on the process-wide workspace rather than the calling
| run's project context. They are exactly as safe as before Phase 4 as long
| as the run's project shares the workspace root (then the two roots are
| the same directory); on a project rooted ELSEWHERE, executing one would
| silently mis-scope it, so the gate below makes that a loud error with the
| phase where each family becomes project-aware (plan/memory in 8).
|
| The code family left this list in Phase 6: code tools now route through
| the semantic pool resolver, which carries the same loud-failure rule
| internally (a scoped foreign root without SEMANTIC_POOL_MODE=modular is
| refused instead of answered from the wrong index).
|
| Phase 8 took the plan, memory and search families out too: their
| stores now resolve through lib/dataRoot.js to the active project's
| data root (central for registered projects, the historical .agent
| root otherwise), and search resolves its tree against the
| ToolContext's project root. runtime_stats STAYS gated: process-wide
| telemetry has no project data root it could honestly claim.
|
| Derived from the modules themselves so a converted tool can never stay
| listed by accident.
*/

const PENDING_PROJECT_AWARENESS =
    new Set([
        "runtime_stats"
    ]);

const CONTEXT_AWARE_OVERRIDE = new Set(["code_simulate_mutation"]);


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

    /* Identity never travels as a tool argument (rule 9); the run
       context the runtime attaches is the only channel. */
    ToolContext.assertNoIdentityArguments(args);

    const toolContext =
        ToolContext.from(context);

    if (
        toolContext &&
        toolContext.scoped &&
        !toolContext.sharesWorkspaceRoot() &&
        PENDING_PROJECT_AWARENESS.has(name)
    ) {

        throw new Error(
            `Tool "${name}" is not yet project-aware and cannot run on ` +
            `project "${toolContext.projectId}" rooted outside this process ` +
            "workspace. Its conversion lands in a later EXECUTION_PLAN phase; " +
            "run on a workspace-rooted project or use PROJECT_CONTEXT_MODE=legacy."
        );

    }

    const startedAt = Date.now();

    const telemetryFields =

        toolContext
            ? {
                  ...(toolContext.runId
                      ? { run_id: toolContext.runId }
                      : {}),
                  ...(toolContext.projectId
                      ? { project_id: toolContext.projectId }
                      : {})
              }
            : {};

    try {

        /*
        | A tool receives only its declared arguments. The agent that
        | called it is context, passed under a name no schema uses, for
        | the two tools that report which agent acted. The normalized
        | ToolContext rides as the second positional parameter; tools
        | that predate it simply ignore it, which keeps every
        | non-converted tool bit-identical.
        */

        const implementation =
            IMPLEMENTATIONS[name];

        const result =
            implementation
                ? await implementation(
                    {
                        ...(args || {}),

                        _agent: context.agent
                    },
                    toolContext
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
            ...telemetryFields,
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
            ...telemetryFields,
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

function startRunScope(runId) {

    /* With a run id (modular mode) only that run's bucket is cleared;
       the legacy call without one resets the process-wide state exactly
       as before, so sequential CLI behavior is unchanged and two
       concurrent modular runs can never wipe each other's sessions or
       counters mid-flight. */

    search.resetSessions(runId);

    telemetry.reset(runId);

    const semanticScope = code._startRunScope(runId);

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
