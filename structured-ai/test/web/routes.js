"use strict";

/*
|--------------------------------------------------------------------------
| Web console route inventory — EXECUTION_PLAN Phase 23, step 1
|--------------------------------------------------------------------------
|
| Every route the console answers today, including the project-scoped routes
| phase 9 added and the discussion endpoints. This list is the inventory the
| phase asks for; the recorder turns it into a snapshot and the contract test
| holds that snapshot against the code.
|
| Two rules for adding to it:
|   • a route appears with the request that actually reaches its body — a
|     probe that returns 401 or 404 without entering the handler proves
|     nothing about the handler;
|   • probes are sequential and shared state is deliberate: creating a project
|     is how its sub-routes get an id the registry accepts, so do not reorder
|     without checking the `${...}` uses.
|--------------------------------------------------------------------------
*/

const PROBE_ORDER = [

    /* ------------------------------------------------------------ static */

    { name: "console page", method: "GET", path: "/" },
    { name: "console script", method: "GET", path: "/app.js" },
    { name: "console styles", method: "GET", path: "/app.css" },
    { name: "modal module", method: "GET", path: "/modal.js" },
    { name: "visualizer page", method: "GET", path: "/visualizer.html" },
    { name: "worker asset", method: "GET", path: "/workers/layout.worker.js" },
    { name: "project dashboard root", method: "GET", path: "/projects" },
    { name: "project dashboard deep link", method: "GET", path: "/projects/prj-demo" },
    { name: "unknown asset is not swallowed", method: "GET", path: "/no-such-file.map" },

    /* ------------------------------------------------------- auth gate */

    { name: "state without a token", method: "GET", path: "/api/state", auth: false },

    /* ----------------------------------------------------------- state */

    { name: "state", method: "GET", path: "/api/state" },
    { name: "health", method: "GET", path: "/api/health" },
    { name: "gateway metrics", method: "GET", path: "/api/metrics" },
    { name: "runtime stats", method: "GET", path: "/api/stats" },

    /* ---------------------------------------------------------- events */

    { name: "event stream", method: "GET", path: "/api/events", stream: true },

    /* -------------------------------------------------------- sessions */

    { name: "sessions list", method: "GET", path: "/api/sessions" },
    {
        name: "new session",
        method: "POST",
        path: "/api/sessions",
        body: {},
        /* the id is saved so the four single-session routes are probed on a
           conversation that actually exists — a 404 proves nothing about a
           handler's body */
        save: "created",
        savePath: "session.id"
    },
    { name: "unknown session", method: "GET", path: "/api/sessions/does-not-exist" },
    { name: "delete unknown session", method: "DELETE", path: "/api/sessions/does-not-exist" },
    { name: "read the open conversation", method: "GET", path: "/api/sessions/${created}" },
    { name: "reopen a stored conversation", method: "POST", path: "/api/sessions/${created}", body: {} },
    { name: "delete the open conversation", method: "DELETE", path: "/api/sessions/${created}" },

    /* ----------------------------------------------------------- calls */

    { name: "calls list", method: "GET", path: "/api/calls" },
    { name: "unknown call", method: "GET", path: "/api/calls/does-not-exist" },

    /* ----------------------------------------------------------- graph */

    { name: "graph view without the engine", method: "GET", path: "/api/graph/lod" },
    { name: "architecture view", method: "GET", path: "/api/graph/architecture" },
    { name: "module view", method: "GET", path: "/api/graph/module" },
    { name: "graph for the current project", method: "GET", path: "/api/graph/lod?projectId=current" },
    { name: "graph for an unregistered project", method: "GET", path: "/api/graph/lod?projectId=prj-nope" },

    /* ------------------------------------------------------- approvals */

    { name: "approve an unknown request", method: "POST", path: "/api/approvals/nope", body: { approved: true } },
    { name: "approval mode", method: "POST", path: "/api/approval-mode", body: { mode: "prompt" } },
    { name: "approval mode rejected", method: "POST", path: "/api/approval-mode", body: { mode: "yolo" } },

    /* ----------------------------------------------------------- tasks */

    { name: "task without a prompt", method: "POST", path: "/api/tasks", body: {} },
    { name: "cancel with nothing running", method: "POST", path: "/api/cancel", body: {} },
    { name: "clear conversation", method: "POST", path: "/api/clear", body: {} },

    /* -------------------------------------------------------- settings */

    { name: "settings", method: "GET", path: "/api/settings" },
    { name: "settings write", method: "POST", path: "/api/settings", body: { settings: { AGENT_MAX_CYCLES: 4 } } },
    { name: "settings write rejected", method: "POST", path: "/api/settings", body: {} },

    /* ------------------------------------------------------------- mcp */

    { name: "mcp status", method: "GET", path: "/api/mcp" },
    { name: "mcp refresh", method: "GET", path: "/api/mcp?refresh=1" },
    {
        name: "mcp add without a name",
        method: "POST",
        path: "/api/mcp",
        body: {},
        /*
        | Worth pinning: an add with no name still goes to the operator first —
        | the policy escalates before the payload is validated, so a typo costs a
        | prompt. Denying it is what the console then does with it.
        */
        approval: "deny",
        timeoutMs: 12000
    },
    {
        name: "mcp add refused by the operator",
        method: "POST",
        path: "/api/mcp",
        body: { name: "probe-server", command: "true" },
        approval: "deny",
        timeoutMs: 12000
    },
    /*
    | The approved-add case is deliberately NOT probed here, and that is a
    | finding rather than a gap in coverage: approving an add spawns the child,
    | and a child that exits at once (like `true`) makes StdioTransport.write
    | hit EPIPE on a stdin nobody handles — an uncaught 'error' that takes the
    | whole process down, which is exactly what a route test must not do to the
    | suite. Registered in the plan as open work for the MCP layer; the deny
    | path above still proves the approval round-trip end to end.
    */
    { name: "mcp remove unknown", method: "DELETE", path: "/api/mcp/no-such-server", approval: "deny", timeoutMs: 12000 },
    { name: "mcp toggle unknown", method: "POST", path: "/api/mcp/no-such-server/enabled", body: { enabled: false }, approval: "deny", timeoutMs: 12000 },
    /*
    | The management switch is the one setting three routes consult *before*
    | they look at a payload, so it gets probed on all three. It comes after the
    | prompts above on purpose: with the switch off no approval is raised, and a
    | probe waiting for one that never arrives hangs the suite.
    */

    {
        name: "settings write a real key",
        method: "POST",
        path: "/api/settings",
        body: { key: "MCP_ALLOW_RUNTIME_ADD", value: false }
    },
    { name: "mcp add while management is off", method: "POST", path: "/api/mcp", body: { name: "blocked", command: "true" } },
    { name: "mcp remove while management is off", method: "DELETE", path: "/api/mcp/blocked" },
    { name: "mcp toggle while management is off", method: "POST", path: "/api/mcp/blocked/enabled", body: { enabled: true } },
    {
        name: "settings reset restores the default",
        method: "POST",
        path: "/api/settings",
        body: { key: "MCP_ALLOW_RUNTIME_ADD", reset: true }
    },

    /* ------------------------------------------------------ discussion */

    { name: "discussion personas", method: "GET", path: "/api/discussion/personas" },
    { name: "discussion without personas", method: "POST", path: "/api/discussion", body: { task: "x" } },
    { name: "discussion with an unknown persona", method: "POST", path: "/api/discussion", body: { task: "x", personas: ["nope"] } },
    { name: "discussion with too many rounds", method: "POST", path: "/api/discussion", body: { task: "x", personas: ["advocate"], max_rounds: 99 } },

    /* -------------------------------------------------------- projects */

    { name: "projects list", method: "GET", path: "/api/projects" },
    { name: "projects register without a root", method: "POST", path: "/api/projects", body: {} },
    {
        name: "projects register",
        method: "POST",
        path: "/api/projects",
        body: { rootPath: "<WORKSPACE>" },
        save: "project",
        savePath: "project.id"
    },
    { name: "project read", method: "GET", path: "/api/projects/${project}" },
    { name: "project update", method: "PATCH", path: "/api/projects/${project}", body: { name: "renamed" } },
    { name: "project state", method: "GET", path: "/api/projects/${project}/state" },
    { name: "project sessions", method: "GET", path: "/api/projects/${project}/sessions" },
    { name: "project event stream", method: "GET", path: "/api/projects/${project}/events", stream: true },
    { name: "project metrics", method: "GET", path: "/api/projects/${project}/metrics" },
    { name: "project health", method: "GET", path: "/api/projects/${project}/health" },
    { name: "project cancel when idle", method: "POST", path: "/api/projects/${project}/cancel", body: {} },
    { name: "project task without a prompt", method: "POST", path: "/api/projects/${project}/tasks", body: {} },
    { name: "project chat without a prompt", method: "POST", path: "/api/projects/${project}/chat", body: {} },
    /*
    | A prompt *with* a body reaches the mode gate, which is the branch a
    | 400-for-empty-task probe never enters. The harness does not set the
    | context modes, so this answers 409/PROJECT_MODE_REQUIRED and starts no run.
    */

    { name: "project task while modes are legacy", method: "POST", path: "/api/projects/${project}/tasks", body: { task: "ping" } },
    { name: "project chat while modes are legacy", method: "POST", path: "/api/projects/${project}/chat", body: { message: "ping" } },
    { name: "unknown project sub-route", method: "GET", path: "/api/projects/${project}/nope" },
    { name: "project route with an empty id", method: "GET", path: "/api/projects/" },
    { name: "state of an unregistered project", method: "GET", path: "/api/projects/prj-nope/state" },
    { name: "patch an unregistered project", method: "PATCH", path: "/api/projects/prj-nope", body: { name: "x" } },
    { name: "delete an unregistered project", method: "DELETE", path: "/api/projects/prj-nope" },
    { name: "unknown project", method: "GET", path: "/api/projects/prj-not-registered" },
    { name: "project unregister", method: "DELETE", path: "/api/projects/${project}" },

    /* --------------------------------------------------------- 404 API */

    { name: "method not allowed on an api route", method: "PUT", path: "/api/state", body: {} },
    { name: "unknown api route", method: "GET", path: "/api/no-such-endpoint" }
];


/*
| `<WORKSPACE>` is replaced with the throwaway workspace the server runs
| against: registering a project needs a real directory, and pointing it at a
| fixture inside the repo would make the suite depend on the checkout.
*/

function probesFor(workspace) {

    return PROBE_ORDER.map(probe => {

        if (probe.body && probe.body.rootPath === "<WORKSPACE>") {
            return { ...probe, body: { ...probe.body, rootPath: workspace } };
        }

        return probe;
    });
}


module.exports = { probesFor, PROBE_ORDER };
