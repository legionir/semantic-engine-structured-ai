"use strict";

/*
|--------------------------------------------------------------------------
| Web console server (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The composition root: build the console's state, wire the concerns
| together, open the socket, and hand back the same handle
| web/server.js always returned — `{ server, state, token, listen, close }`.
|
| A thin layer over the same runtime the CLI uses. It streams runtime
| events to the browser and turns approval requests into buttons, which
| is exactly the seam setApprovalHandler was designed for.
|
|     runtime events ──► /api/events (SSE) ──► live delegation tree
|     Approve / Deny ──► /api/approvals/:id ──► setApprovalHandler
|
| The order below is the order the monolith had its parts in. The two
| installs at the bottom are why that matters: the console must be
| subscribed to the bus and be the runtime's approval handler before it
| can accept a request, and the listeners are attached before the
| approval handler because that is the order the original used.
|
| `ctx` is the one object every concern reaches its neighbours through.
| No module under web/server/ imports another concern, and nothing
| imports the agent runtime except through the `runtime` the caller
| passed in — which is what keeps a stubbed runtime constructible and
| keeps requiring this directory from booting agent.js.
|--------------------------------------------------------------------------
*/

const http = require("http");
const path = require("path");

const consoleAuth = require("../../agent/lib/consoleAuth");

const response = require("./Response");
const { readBody } = require("./RequestBody");
const { sendError } = require("./serializers/ErrorSerializer");
const { newConsoleToken, createMiddleware } = require("./Middleware");
const { createSettingsService } = require("./services/SettingsService");
const { createSessionService } = require("./services/SessionService");
const { createGitReportService } = require("./services/GitReportService");
const { createEventStreamService } = require("./services/EventStreamService");
const { createSseHub } = require("./SseHub");
const { createApprovalService } = require("./services/ApprovalService");
const { createStateSerializer } = require("./serializers/StateSerializer");
const { createTaskService } = require("./services/TaskService");
const { createDiscussionService } = require("./services/DiscussionService");
const { createRouter } = require("./Router");
const { webServerMode } = require("./ServerMode");

const { createEventStreamController } = require("./controllers/EventStreamController");
const { createStateController } = require("./controllers/StateController");
const { createMcpController } = require("./controllers/McpController");
const { createSessionController } = require("./controllers/SessionController");
const { createTaskController } = require("./controllers/TaskController");
const { createApprovalController } = require("./controllers/ApprovalController");
const { createSettingsController } = require("./controllers/SettingsController");
const { createDiscussionController } = require("./controllers/DiscussionController");
const { createGraphController } = require("./controllers/GraphController");
const { createProjectController } = require("./controllers/ProjectController");

function createServer(runtime, options = {}, composition = {}) {

    /*
    | The console is a control plane, not a public static site. A token is
    | generated even when the caller did not configure one, so forgetting
    | AGENT_CONSOLE_TOKEN can never silently disable authentication.
    */
    const configuredToken =
        runtime.settings &&
        typeof runtime.settings.get === "function"
            ? runtime.settings.get("AGENT_CONSOLE_TOKEN")
            : "";

    const consoleToken =
        String(options.token || configuredToken || newConsoleToken());

    const toolRuntime =
        require(
            path.join(
                path.resolve(__dirname, "..", ".."),
                "agent",
                "tools"
            )
        );

    const state = {
        status: "idle",

        cycles: 0,

        lastPlanSignature: null,

        stopRequested: false,

        task: null,

        history: [],

        events: [],

        turnCounter: 0,

        currentTurnId: null,

        /*
        | The pending list is the engine's own store, not a mirror of it —
        | see agent/policy/ApprovalStore. A local fallback keeps the server
        | constructible with a stubbed runtime in tests.
        */
        approvals: runtime.policyStore || new (require("../../agent/policy").ApprovalStore)(),

        answer: null,

        error: null,

        startedAt: null,

        finishedAt: null,

        discussion: null,

        projectId: null
    };

    const clients = new Set();

    /*
    | A tool result can be tens of thousands of characters, and the
    | console needs all of it only when an operator opens one call. The
    | full record therefore stays here, keyed by agent, graph and call
    | id, while the stream carries a preview.
    */
    const calls = new Map();

    const sessions = runtime.sessions;

    state.session =
        sessions.emptySession();

    const ctx = {
        runtime,
        options,
        state,
        clients,
        calls,
        sessions,
        toolRuntime,
        consoleToken,
        consoleAuth,
        mode: composition.mode || webServerMode(runtime),

        ...response,
        readBody,
        sendError
    };

    /*
    | Every concern is built against the same object and then attached to
    | it, so a service never imports another service: the wiring in this
    | file is the whole dependency graph of the console.
    */

    /*
    | The settings service is a namespace rather than a bag of names on
    | ctx: `ctx.settings.autoContinue()` says which knob it is, and the
    | service has no callers that want its eight names inlined.
    */

    ctx.settings = createSettingsService(ctx);

    Object.assign(
        ctx,
        createMiddleware(ctx),
        createSessionService(ctx),
        createGitReportService(ctx),
        createEventStreamService(ctx),
        createSseHub(ctx),
        createApprovalService(ctx),
        createStateSerializer(ctx),
        createTaskService(ctx),
        createDiscussionService(ctx),
        {
            eventStreamController: createEventStreamController(ctx),
            stateController: createStateController(ctx),
            mcpController: createMcpController(ctx),
            sessionController: createSessionController(ctx),
            taskController: createTaskController(ctx),
            approvalController: createApprovalController(ctx),
            settingsController: createSettingsController(ctx),
            discussionController: createDiscussionController(ctx),
            graphController: createGraphController(ctx),
            projectController: createProjectController(ctx)
        },
        createRouter(ctx)
    );

    ctx.installConsoleListeners();
    ctx.installApprovalHandler();

    const server =
        http.createServer(async (req, res) => {

            const url =
                new URL(
                    req.url,
                    `http://${req.headers.host || "localhost"}`
                );

            const { pathname } = url;

            const gate = ctx.guard(req, res, url);

            if (gate.handled) {
                return;
            }

            try {

                await ctx.dispatch(req, res, url, pathname, gate.claims);

            } catch (error) {

                ctx.sendError(res, error);
            }
        });

    return {
        server,

        state,

        /* Exposed to the launcher/test harness, never sent by an API route. */
        token: consoleToken,

        listen(port, host) {

            return new Promise(resolve => {

                server.listen(
                    port,
                    host,
                    () => resolve(server.address())
                );
            });
        },

        close() {

            /* Do not leave MCP children/background processes behind. */
            toolRuntime.shutdown();

            for (const client of clients) {
                client.res.end();
            }

            return new Promise(resolve => server.close(resolve));
        }
    };

}

module.exports = {
    createServer
};
