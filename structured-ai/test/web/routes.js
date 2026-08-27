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
    { name: "new session", method: "POST", path: "/api/sessions", body: {} },
    { name: "unknown session", method: "GET", path: "/api/sessions/does-not-exist" },
    { name: "delete unknown session", method: "DELETE", path: "/api/sessions/does-not-exist" },

    /* ----------------------------------------------------------- calls */

    { name: "calls list", method: "GET", path: "/api/calls" },
    { name: "unknown call", method: "GET", path: "/api/calls/does-not-exist" },

    /* ----------------------------------------------------------- graph */

    { name: "graph view without the engine", method: "GET", path: "/api/graph/lod" },

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

    /* ------------------------------------------------------ discussion */

    { name: "discussion personas", method: "GET", path: "/api/discussion/personas" },
    { name: "discussion without personas", method: "POST", path: "/api/discussion", body: { task: "x" } },

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
    { name: "unknown project", method: "GET", path: "/api/projects/prj-not-registered" },
    { name: "project unregister", method: "DELETE", path: "/api/projects/${project}" },

    /* --------------------------------------------------------- 404 API */

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
