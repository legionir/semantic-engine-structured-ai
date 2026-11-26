"use strict";

/*
|--------------------------------------------------------------------------
| System routes (roadmap P1-07)
|--------------------------------------------------------------------------
|
|   GET  /api/system                       CPU, memory, disk, runs, the
|                                          background processes, warnings
|   POST /api/system/processes/:id/stop    stop one background process
|
| A process command line can carry anything the agent typed, so both
| routes need the admin token and the answer is masked like every other
| operator view. Called in order by ServerImplementation.
*/

const { sendJson } = require("../Response");
const SystemResources = require("../../../agent/runtime/SystemResources");
const { maskDeep } = require("../../../agent/events/EventRedactor");


module.exports = async function SystemRoutes(shared, request) {

    const { pathname, req, res } = request;

    if (pathname !== "/api/system" && !pathname.startsWith("/api/system/")) {
        return false;
    }

    if (request.requireAdmin()) return true;

    if (pathname === "/api/system" && req.method === "GET") {

        sendJson(res, 200, maskDeep(SystemResources.snapshot()));
        return true;
    }

    const stop = /^\/api\/system\/processes\/([^/]+)\/stop$/.exec(pathname);

    if (stop && req.method === "POST") {

        const ProcessManager = require("../../../agent/tools/process/ProcessManager");
        const id = decodeURIComponent(stop[1]);
        const session = ProcessManager.SESSIONS.get(id);

        if (!session) {
            sendJson(res, 404, { error: `Unknown process: ${id}` });
            return true;
        }

        if (session.status !== "running") {
            sendJson(res, 200, { ok: true, id, status: session.status, already_stopped: true });
            return true;
        }

        ProcessManager.killTree(session.child, "SIGKILL");

        sendJson(res, 200, { ok: true, id, status: "stopping" });
        return true;
    }

    sendJson(res, 404, { error: "not found" });
    return true;
};
