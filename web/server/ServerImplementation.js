"use strict";

const crypto = require("crypto");
const http = require("http");
const path = require("path");


/*
|--------------------------------------------------------------------------
| Web Console
|--------------------------------------------------------------------------
|
| A thin layer over the same runtime the CLI uses. It streams runtime
| events to the browser and turns approval requests into buttons, which
| is exactly the seam setApprovalHandler was designed for.
|
|   runtime events ──► /api/events (SSE) ──► live delegation tree
|   Approve / Deny ──► /api/approvals/:id ──► setApprovalHandler
|--------------------------------------------------------------------------
*/

const {
    CONSOLE_COOKIE,
    newConsoleToken,
    parseCookies,
    requestToken,
    sameOrigin,
    RateLimiter
} = require("./Middleware");
const {
    sendJson,
    setConsoleCookie
} = require("./Response");
const { SseHub } = require("./SseHub");

const consoleAuth = require("../../agent/config/ConsoleAuth");
const { ApprovalStore } = require("../../agent/policy");
const ProcessOutputBus = require("../../agent/tools/process/ProcessOutputBus");

const createCallLog = require("./console/call-log");
const createConversations = require("./console/conversations");
const createProjectQueue = require("./console/project-queue");
const createSessionLog = require("./console/session-log");
const createSnapshot = require("./console/snapshot");
const createLiveEvents = require("./console/live-events");
const createTaskRunner = require("./console/task-runner");
const createDiscussionRunner = require("./console/discussion-runner");
const createOperatorTools = require("./console/operator-tools");
const createInterruptedRuns = require("./console/interrupted-runs");
const { wellEncodedPath, serveStatic } = require("./console/static-files");

const ROUTE_GROUPS = [
    require("./routes/auth-and-state"),
    require("./routes/mcp-serve"),
    require("./routes/mcp-completion"),
    require("./routes/mcp-platform"),
    require("./routes/mcp"),
    require("./routes/sessions"),
    require("./routes/interrupted"),
    require("./routes/tasks"),
    require("./routes/projects"),
    require("./routes/discussion"),
    require("./routes/control"),
    require("./routes/logs"),
    require("./routes/system"),
    require("./routes/terminal"),
    require("./routes/files"),
    require("./routes/agent-quality")
];

/* keystrokes and resizes of an open terminal come in bursts */
const TERMINAL_IO = /^\/api\/terminal\/[a-f0-9]{16}\/(input|resize)$/;


function createServer(runtime, options = {}) {

    /* P4-10: a server's questions (elicitation) now have someone to answer them */
    require("../../agent/mcp/McpInteractions").setInteractive(true);

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
    const consolePasswordRequired =
        Boolean(runtime.settings && runtime.settings.get("AGENT_CONSOLE_PASSWORD_REQUIRED"));
    const consolePassword =
        String(runtime.settings && runtime.settings.get("AGENT_CONSOLE_PASSWORD") || "");
    const passwordSessionToken =
        consolePasswordRequired ? newConsoleToken() : null;

    if (consolePasswordRequired && consolePassword.length === 0) {
        throw new Error("AGENT_CONSOLE_PASSWORD_REQUIRED is enabled, but AGENT_CONSOLE_PASSWORD is empty.");
    }

    const toolRuntime =
        require(
            path.join(
                path.resolve(__dirname, "..", ".."),
                "agent",
                "tools"
            )
        );

    const { requestRunFlags } = require("./console/run-flags");

    const requestReasoningEffort = body => {
        const value = body && body.reasoning_effort;
        if (value === undefined || value === null || value === "" || value === "inherit") return null;
        if (["low", "medium", "high", "xhigh"].includes(value)) return value;
        throw Object.assign(new Error("reasoning_effort must be inherit, low, medium, high, or xhigh"), { status: 400 });
    };

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
        approvals: new Map(),
        answer: null,
        error: null,
        startedAt: null,
        finishedAt: null,
        discussion: null,
        projectId: null
    };

    /* ApprovalStore owns pending approval lifecycle; state.approvals remains
       the historical Map exposed by the test/launcher state surface. */
    const approvalStore =
        new ApprovalStore({ pending: state.approvals });

    const clients = new Set();
    const sseHub = new SseHub({ clients });
    /*
    | The limiter is a control-plane guard, so the production default (120
    | requests/minute) is kept. Callers that legitimately exceed it in one
    | window — the web suite drives ~125 API calls over a single shared
    | server — can raise it explicitly via options.apiRateLimit.
    */
    const apiRateLimiter =
        new RateLimiter({
            limit: Number.isInteger(options.apiRateLimit) && options.apiRateLimit > 0
                ? options.apiRateLimit
                : 120,
            windowMs: 60_000
        });
    const loginRateLimiter = new RateLimiter({ limit: 5, windowMs: 60_000 });
    const terminalRateLimiter = new RateLimiter({ limit: 6000, windowMs: 60_000 });

    function allowApiRequest(req, pathname) {
        return req.method === "POST" && TERMINAL_IO.test(pathname)
            ? terminalRateLimiter.allow(req)
            : apiRateLimiter.allow(req);
    }

    function passwordSessionMatches(req) {
        const supplied = parseCookies(req.headers.cookie).structured_ai_console_password;
        if (typeof supplied !== "string" || supplied.length !== passwordSessionToken?.length) return false;
        return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(passwordSessionToken));
    }

    function passwordMatches(candidate) {
        if (typeof candidate !== "string") return false;
        const supplied = Buffer.from(candidate);
        const expected = Buffer.from(consolePassword);
        return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    }


    /*
    | The closure's state and helpers live in ./console: each factory reads
    | what it needs from `shared` and adds what it returns, so the order
    | below is the dependency order (and keeps the bus listeners in place).
    */
    const shared = {
        approvalStore,
        runtime,
        sseHub,
        state
    };

    Object.assign(shared, createCallLog(shared));
    Object.assign(shared, createConversations(shared));
    Object.assign(shared, createProjectQueue(shared));
    Object.assign(shared, createSessionLog(shared));
    Object.assign(shared, createSnapshot(shared));
    Object.assign(shared, createLiveEvents(shared));
    Object.assign(shared, createTaskRunner(shared));
    Object.assign(shared, createDiscussionRunner(shared));
    Object.assign(shared, createInterruptedRuns(shared));
    Object.assign(shared, createOperatorTools(shared, options.terminal));

    const {
        DISCUSSION_MODULE,
        activateSession,
        broadcastProcessOutput,
        calls,
        closeOperatorTools,
        discussionService,
        eventForClient,
        projectSlotBusy,
        resolveApproval,
        saveSession,
        sessions,
        slotView,
        snapshot,
        snapshotFor,
        startDiscussion,
        startTask
    } = shared;


    /*
    | What the route groups (routes/*.js) share with this closure. Built once
    | the closure is complete; the groups read it per request.
    */
    const ctx = {
        DISCUSSION_MODULE,
        activateSession,
        addMessage: shared.addMessage,
        approvalStore,
        calls,
        clearForeground: shared.clearForeground,
        conversations: shared.conversations,
        conversationsFor: shared.conversationsFor,
        consolePasswordRequired,
        discussionService,
        eventForClient,
        interrupted: shared.interrupted,
        loginRateLimiter,
        logHub: shared.logHub,
        logs: shared.logs,
        passwordMatches,
        passwordSessionToken,
        projectQueue: shared.projectQueue,
        projectSlotBusy,
        projectSnapshot: shared.projectSnapshot,
        requestReasoningEffort,
        requestRunFlags,
        resolveApproval,
        runtime,
        saveSession,
        sessions,
        slotView,
        snapshot,
        snapshotFor,
        sseHub,
        startDiscussion,
        startTask,
        state,
        terminals: shared.terminals,
        toolRuntime,
        workspaceRoot: shared.workspaceRoot
    };


    const handle =
        async (req, res) => {

            let url;

            try {

                url =
                    new URL(
                        req.url,
                        `http://${req.headers.host || "localhost"}`
                    );

            } catch {

                /* P0-4: a malformed Host header or request URL is a client error. */
                sendJson(res, 400, { error: "malformed request URL or Host header" });
                return;
            }

            const { pathname } = url;
            const isApiRequest = pathname.startsWith("/api/");

            if (isApiRequest && !allowApiRequest(req, pathname)) {
                sendJson(res, 429, { error: "console API rate limit exceeded" });
                return;
            }

            const authStatusRoute = pathname === "/auth/status" && req.method === "GET";
            const authLoginRoute = pathname === "/auth/login" && req.method === "POST";

            if (
                (isApiRequest || authLoginRoute) &&
                !sameOrigin(req.headers.origin, req.headers.host)
            ) {
                sendJson(res, 403, { error: "cross-origin console request refused" });
                return;
            }

            const passwordSessionAuthenticated =
                consolePasswordRequired && passwordSessionMatches(req);
            let suppliedToken;
            let claims;

            if (consolePasswordRequired) {
                const headerToken =
                    typeof req.headers.authorization === "string"
                        ? /^Bearer\s+(.+)$/i.exec(req.headers.authorization)?.[1]
                        : req.headers["x-console-token"];
                suppliedToken = headerToken || null;
                claims = passwordSessionAuthenticated
                    ? consoleAuth.masterClaims()
                    : consoleAuth.resolve(suppliedToken, consoleToken);
            } else {
                suppliedToken = requestToken(req, url);
                claims = consoleAuth.resolve(suppliedToken, consoleToken);
            }
            const authenticated = Boolean(claims);

            /*
            | When password login is enabled, browser access uses a distinct,
            | HttpOnly session cookie. Token query parameters and old console
            | cookies cannot silently skip the password screen.
            */
            if (!consolePasswordRequired && authenticated && url.searchParams.has("token")) {
                setConsoleCookie(res, CONSOLE_COOKIE, consoleToken);
            }

            /*
            | P4-08: an OAuth provider redirects the browser back here; the
            | one-time state of a sign-in the operator started is the
            | credential, because the console cookie may not travel on a
            | cross-site redirect.
            */
            const oauthCallback =
                pathname === "/api/mcp/oauth/callback" && req.method === "GET";

            if (
                pathname.startsWith("/api/") &&
                !authenticated &&
                !oauthCallback &&
                pathname !== "/auth/status" &&
                pathname !== "/auth/login"
            ) {
                sendJson(res, 401, { error: "console authentication required" });
                return;
            }

            /*
            | P0-4: scoped tokens. Console-wide changes need the admin
            | (master) token; legacy endpoints that are not tied to a
            | project need a token allowed on every project.
            */
            const refuse = decision => {

                if (decision.ok) {
                    return false;
                }

                sendJson(res, decision.status, { error: decision.error });
                return true;
            };

            const requireAdmin = () =>
                refuse(consoleAuth.authorizeAdmin(claims));

            const requireUnscoped = permission =>
                refuse(consoleAuth.authorizeUnscoped(claims, permission));

            /* what the route groups read about this request */
            const request = {
                authLoginRoute,
                authStatusRoute,
                claims,
                passwordSessionAuthenticated,
                pathname,
                refuse,
                req,
                requireAdmin,
                requireUnscoped,
                res,
                url
            };

            try {

                /* the API routes, group by group, in a fixed order */
                for (const routes of ROUTE_GROUPS) {
                    if (await routes(ctx, request)) {
                        return;
                    }
                }

                /* ---------------------------------------------- static */

                /* P0-4: static and deep-link paths are not decoded by the
                   router, so a malformed escape must still be a 400. */
                if (req.method === "GET" && !wellEncodedPath(pathname)) {

                    sendJson(res, 400, { error: "malformed percent-encoding in request path" });
                    return;
                }

                if (
                    req.method === "GET" &&
                    (pathname === "/projects" || pathname.startsWith("/projects/"))
                ) {

                    /* Phase 11: the console owns /projects/:id so a
                       dashboard deep-link loads the same page. */
                    serveStatic(req, res, "/");
                    return;
                }

                if (req.method === "GET") {

                    serveStatic(req, res, pathname);

                    return;
                }

                sendJson(res, 405, { error: "method not allowed" });

            } catch (error) {

                const status = error instanceof URIError ? 400 : error.status || 500;

                if (status >= 500) {
                    shared.logs.error("server", `${req.method} ${pathname} failed: ${error.message}`, {
                        status,
                        stack: String(error.stack || "").slice(0, 4000)
                    });
                }

                sendJson(
                    res,
                    status,
                    {
                        error: error instanceof URIError
                            ? "malformed percent-encoding in request path"
                            : error.message
                    }
                );
            }
        };

    const server =
        http.createServer(handle);


    return {
        server,
        handle,

        state,
        startTask,
        snapshot,
        eventForClient,
        approvalStore,
        resolveApproval,
        sseHub,

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

            ProcessOutputBus.removeListener(ProcessOutputBus.outputEvent, broadcastProcessOutput);

            closeOperatorTools();

            /* Do not leave MCP children/background processes behind. */
            toolRuntime.shutdown();

            sseHub.close();

            if (!server.listening) {
                return Promise.resolve();
            }

            return new Promise(resolve => server.close(resolve));
        }
    };
}


module.exports = {
    createServer
};
