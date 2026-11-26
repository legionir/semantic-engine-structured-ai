"use strict";

/*
|--------------------------------------------------------------------------
| Interrupted conversations (roadmap P1-06)
|--------------------------------------------------------------------------
|
|   GET    /api/interrupted              conversations a restart cut off
|   POST   /api/interrupted/:id/resume   continue one {message?}
|   DELETE /api/interrupted/:id          dismiss it (marked as stopped)
|
| Continuing is starting a turn, so it needs the right to write to the
| conversation's project; listing needs the right to read it. Called in
| order by ServerImplementation.
*/

const consoleAuth = require("../../../agent/config/ConsoleAuth");
const { readBody } = require("../RequestBody");
const { sendJson } = require("../Response");


module.exports = async function InterruptedRoutes(shared, request) {

    const { claims, pathname, refuse, req, res } = request;

    if (pathname !== "/api/interrupted" && !pathname.startsWith("/api/interrupted/")) {
        return false;
    }

    const { interrupted } = shared;

    const permissionFor = (projectId, permission) =>
        projectId
            ? consoleAuth.authorize(claims, { projectId, permission })
            : consoleAuth.authorizeUnscoped(claims, permission);

    if (pathname === "/api/interrupted" && req.method === "GET") {

        sendJson(res, 200, {
            sessions: interrupted.list(projectId => permissionFor(projectId, "project:read").ok)
        });
        return true;
    }

    const match = /^\/api\/interrupted\/([^/]+)(\/resume)?$/.exec(pathname);

    if (!match) {
        sendJson(res, 404, { error: "not found" });
        return true;
    }

    const id = decodeURIComponent(match[1]);
    const entry = interrupted.get(id);

    if (!entry || !permissionFor(entry.project_id, "project:read").ok) {
        sendJson(res, 404, { error: `no interrupted conversation ${id}` });
        return true;
    }

    if (refuse(permissionFor(entry.project_id, "project:write"))) return true;

    try {

        if (match[2] && req.method === "POST") {

            const body = await readBody(req);

            sendJson(res, 202, await interrupted.resume(id, { message: body.message }));
            return true;
        }

        if (!match[2] && req.method === "DELETE") {

            sendJson(res, 200, interrupted.dismiss(id));
            return true;
        }

    } catch (error) {

        sendJson(res, error.status || 400, { error: error.message });
        return true;
    }

    sendJson(res, 405, { error: "method not allowed" });
    return true;
};
