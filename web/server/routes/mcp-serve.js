"use strict";

/*
|--------------------------------------------------------------------------
| /mcp: this console as an MCP server (roadmap P4-11)
|--------------------------------------------------------------------------
|
|   POST   /mcp    one JSON-RPC message (or a batch); a JSON answer, or
|                  202 for a notification
|   GET    /mcp    405: no server-initiated stream is offered
|   DELETE /mcp    ends a session (always accepted)
|
| The caller authenticates with a console token in the Authorization
| header (never a cookie or a query string, so a browser cannot be made
| to call it): the master token reaches every project, a project token
| (CONSOLE_TOKENS) only its own, with its own read / write permissions.
| A request carrying a foreign Origin is refused (DNS rebinding).
|
| The tools themselves are agent/mcp/McpServerHost.js; this file is the
| adapter onto the console's projects, task runner and conversations.
*/

const crypto = require("crypto");

const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");
const { sameOrigin } = require("../Middleware");
const consoleAuth = require("../../../agent/config/ConsoleAuth");
const { createHandler } = require("../../../agent/mcp/McpServerHost");


function httpError(status, message) {

    return Object.assign(new Error(message), { status });
}


function createAdapter(shared, claims) {

    const {
        projectQueue,
        projectSlotBusy,
        runtime,
        slotView,
        startTask
    } = shared;

    const registry = () => runtime.projects.registry();
    const running = new Map();

    function allow(projectId, permission) {

        const decision = consoleAuth.authorize(claims, { projectId, permission });

        if (!decision.ok) {
            throw httpError(decision.status || 403, decision.error || "this token may not use that project");
        }
    }

    return {

        async listProjects() {

            const all = registry().list();

            return consoleAuth.visibleProjects(claims, all).map(project => ({
                id: project.id,
                name: project.name || project.id,
                running: Boolean(projectSlotBusy(project.id))
            }));
        },

        async resolveProject(idOrName) {

            const wanted = String(idOrName || "").trim();

            if (!wanted) throw httpError(400, "name the project (project)");

            let record = null;

            try {
                record = registry().get(wanted);
            } catch {
                record = consoleAuth.visibleProjects(claims, registry().list()).find(project => project.name === wanted) || null;
            }

            if (!record) throw httpError(404, `there is no project "${wanted}" for this token; list_projects shows the ones there are`);

            allow(record.id, "project:read");

            return record.id;
        },

        async runTask(projectId, task, { planFirst = false } = {}) {

            allow(projectId, "project:write");

            const runFlags = planFirst ? { planMode: true } : {};

            if (projectSlotBusy(projectId)) {

                if (!projectQueue.enabled()) {
                    throw httpError(409, `project ${projectId} already has a run in progress`);
                }

                const item = projectQueue.add(projectId, task, { runFlags });

                return { accepted: true, queued: true, queued_message: item.id || null, project_id: projectId };
            }

            const admission =
                runtime.runScheduler && typeof runtime.runScheduler.admit === "function"
                    ? runtime.runScheduler.admit(projectId)
                    : "start";

            if (admission === "reject") {
                throw httpError(429, "run queue is full");
            }

            const work = startTask(task, { projectId, runFlags }).catch(() => {});

            running.set(projectId, work);

            return { accepted: true, queued: admission === "queue", project_id: projectId };
        },

        async waitFor(projectId, ms) {

            const work = running.get(projectId);
            let timer;

            if (work) {
                await Promise.race([
                    work,
                    new Promise(resolve => { timer = setTimeout(resolve, ms); })
                ]);
                clearTimeout(timer);
            }

            const status = slotView(projectId);

            return status.status === "running"
                ? { ...status, note: "still running; follow it with task_status" }
                : status;
        },

        async status(projectId) {

            allow(projectId, "project:read");

            return slotView(projectId);
        }
    };
}


module.exports = async function McpServeRoutes(shared, request) {

    const { pathname, req, res, claims } = request;

    if (pathname !== "/mcp" && pathname !== "/mcp/") {
        return false;
    }

    const { runtime } = shared;

    if (runtime.settings.get("MCP_SERVE_ENABLED") === false) {
        sendJson(res, 404, { error: "this console does not serve MCP (MCP_SERVE_ENABLED=false)" });
        return true;
    }

    if (!sameOrigin(req.headers.origin, req.headers.host, req.headers["x-forwarded-host"])) {
        sendJson(res, 403, { error: "cross-origin MCP request refused" });
        return true;
    }

    const bearer =
        typeof req.headers.authorization === "string" &&
        /^Bearer\s+\S+/i.test(req.headers.authorization);

    if (!bearer || !claims) {
        res.setHeader("www-authenticate", "Bearer realm=\"structured-ai\"");
        sendJson(res, 401, { error: "an MCP client needs a console or project token: Authorization: Bearer <token>" });
        return true;
    }

    if (req.method === "GET") {
        res.setHeader("allow", "POST, DELETE");
        sendJson(res, 405, { error: "this server offers no event stream; POST JSON-RPC messages" });
        return true;
    }

    if (req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return true;
    }

    if (req.method !== "POST") {
        sendJson(res, 405, { error: "POST JSON-RPC messages to /mcp" });
        return true;
    }

    let message;

    try {
        message = await readBody(req);
    } catch (error) {
        sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } });
        return true;
    }

    const answer = await createHandler(createAdapter(shared, claims))(message);

    if (message && message.method === "initialize") {
        res.setHeader("mcp-session-id", crypto.randomBytes(16).toString("hex"));
    }

    if (answer === null) {
        res.writeHead(202);
        res.end();
        return true;
    }

    sendJson(res, 200, answer);
    return true;
};

module.exports.createAdapter = createAdapter;
