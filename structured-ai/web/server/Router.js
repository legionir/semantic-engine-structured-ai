"use strict";

/*
|--------------------------------------------------------------------------
| Web console router (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Which URL is which handler, and nothing else.
|
| Every condition here is the original `if` from web/server.js, in the
| original order, verbatim. The order is the contract: the prefix routes
| (/api/mcp/, /api/sessions/, /api/calls/, /api/graph/) are tested after
| the exact paths that must win against them, and /api/projects owns its
| whole subtree — answering 404 itself. Moving a condition changes which
| handler a URL reaches, which is why the conditions did not travel into
| the controllers with their bodies.
|
| A branch that answers ends with `return`, exactly as it did inline, and
| an error thrown by any handler propagates to the single catch in
| WebServer: the status is whatever the handler attached, 500 otherwise.
|
| test/web/layer.test.js reads this file's conditions back out and
| compares them to the route inventory in test/web/routes.js, so a
| handler that is moved but never re-attached fails a test instead of
| failing an operator.
|--------------------------------------------------------------------------
*/

function createRouter(ctx) {

    async function dispatch(req, res, url, pathname, claims) {

        /* ---------------------------------------------- events */

        if (
            pathname === "/api/events" &&
            req.method === "GET"
        ) {

            await ctx.eventStreamController.openStream(req, res, url, pathname, claims);

            return;
        }

        /* ---------------------------------------------- state */

        if (
            pathname === "/api/state" &&
            req.method === "GET"
        ) {

            await ctx.stateController.readState(req, res, url, pathname, claims);

            return;
        }

        /* ----------------------------------------------- mcp */

        if (
            pathname === "/api/mcp" &&
            req.method === "GET"
        ) {

            await ctx.mcpController.status(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/mcp" &&
            req.method === "POST"
        ) {

            await ctx.mcpController.add(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname.startsWith("/api/mcp/") &&
            req.method === "DELETE"
        ) {

            await ctx.mcpController.remove(req, res, url, pathname, claims);

            return;
        }

        /*
        | Toggling a server is not the same as removing it: the
        | definition stays, so it can be switched back on
        | without being typed again.
        */

        if (
            pathname.startsWith("/api/mcp/") &&
            pathname.endsWith("/enabled") &&
            req.method === "POST"
        ) {

            await ctx.mcpController.setEnabled(req, res, url, pathname, claims);

            return;
        }

        /* ------------------------------------------- sessions */

        if (
            pathname === "/api/sessions" &&
            req.method === "GET"
        ) {

            await ctx.sessionController.list(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/sessions" &&
            req.method === "POST"
        ) {

            await ctx.sessionController.create(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname.startsWith("/api/sessions/") &&
            req.method === "GET"
        ) {

            await ctx.sessionController.read(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname.startsWith("/api/sessions/") &&
            req.method === "POST"
        ) {

            await ctx.sessionController.open(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname.startsWith("/api/sessions/") &&
            req.method === "DELETE"
        ) {

            await ctx.sessionController.remove(req, res, url, pathname, claims);

            return;
        }

        /* ---------------------------------------------- calls */

        if (
            pathname === "/api/calls" &&
            req.method === "GET"
        ) {

            await ctx.eventStreamController.listCalls(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname.startsWith("/api/calls/") &&
            req.method === "GET"
        ) {

            await ctx.eventStreamController.readCall(req, res, url, pathname, claims);

            return;
        }

        /* ---------------------------------------------- graph visualization */

        if (
            pathname.startsWith("/api/graph/") &&
            req.method === "GET"
        ) {

            await ctx.graphController.view(req, res, url, pathname, claims);

            return;
        }

        /* ---------------------------------------------- tasks */

        if (
            pathname === "/api/tasks" &&
            req.method === "POST"
        ) {

            await ctx.taskController.submit(req, res, url, pathname, claims);

            return;
        }

        /* ---------------------------------- projects (Phase 7+9) */

        if (pathname === "/api/projects" || pathname.startsWith("/api/projects/")) {

            await ctx.projectController.handle(req, res, url, pathname, claims);

            return;
        }

        /* ----------------------------------------- discussion */

        if (
            pathname === "/api/discussion/personas" &&
            req.method === "GET"
        ) {

            await ctx.discussionController.personas(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/discussion" &&
            req.method === "POST"
        ) {

            await ctx.discussionController.start(req, res, url, pathname, claims);

            return;
        }

        /* ------------------------------------------ approvals */

        if (
            pathname.startsWith("/api/approvals/") &&
            req.method === "POST"
        ) {

            await ctx.approvalController.resolve(req, res, url, pathname, claims);

            return;
        }

        /* --------------------------------------------- control */

        if (
            pathname === "/api/cancel" &&
            req.method === "POST"
        ) {

            await ctx.taskController.cancel(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/clear" &&
            req.method === "POST"
        ) {

            await ctx.taskController.clear(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/approval-mode" &&
            req.method === "POST"
        ) {

            await ctx.approvalController.setMode(req, res, url, pathname, claims);

            return;
        }

        /* --------------------------------------------- settings */

        if (
            pathname === "/api/settings" &&
            req.method === "GET"
        ) {

            await ctx.settingsController.read(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/settings" &&
            req.method === "POST"
        ) {

            await ctx.settingsController.write(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/stats" &&
            req.method === "GET"
        ) {

            await ctx.stateController.stats(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/metrics" &&
            req.method === "GET"
        ) {

            await ctx.stateController.metrics(req, res, url, pathname, claims);

            return;
        }

        if (
            pathname === "/api/health" &&
            req.method === "GET"
        ) {

            await ctx.stateController.health(req, res, url, pathname, claims);

            return;
        }

        /* ---------------------------------------------- static */

        if (
            req.method === "GET" &&
            (pathname === "/projects" || pathname.startsWith("/projects/"))
        ) {

            /* Phase 11: the console owns /projects/:id so a
               dashboard deep-link loads the same page. */

            ctx.serveStatic(req, res, "/");

            return;
        }

        if (req.method === "GET") {

            ctx.serveStatic(req, res, pathname);

            return;
        }

        ctx.sendJson(res, 405, { error: "method not allowed" });

    }

    return {
        dispatch
    };
}

module.exports = {
    createRouter
};
