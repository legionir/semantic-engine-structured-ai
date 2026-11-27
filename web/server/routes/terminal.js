"use strict";

/*
|--------------------------------------------------------------------------
| System terminal routes
|--------------------------------------------------------------------------
|
|   GET    /api/terminal               the open terminals and the PTY mode
|   POST   /api/terminal               open one {cols, rows}
|   GET    /api/terminal/:id/stream    SSE: scrollback snapshot, output, exit
|   POST   /api/terminal/:id/input     {data} keystrokes / paste
|   POST   /api/terminal/:id/resize    {cols, rows}
|   DELETE /api/terminal/:id           end the shell
|
| Admin token only, and only while CONSOLE_TERMINAL_ENABLED is on.
| Called in order by ServerImplementation; returns true once answered.
*/

const { readBody } = require("../RequestBody");
const { sendJson } = require("../Response");

const SESSION_ID = /^[a-f0-9]{16}$/;


async function jsonBody(req, maxBytes) {
    try {
        const body = await readBody(req, { maxBytes });
        return body && typeof body === "object" && !Array.isArray(body) ? body : {};
    } catch (error) {
        throw Object.assign(new Error(error.message), {
            status: /too large/.test(error.message) ? 413 : 400
        });
    }
}


module.exports = async function TerminalRoutes(shared, request) {

    const { pathname, req, res } = request;

    if (pathname !== "/api/terminal" && !pathname.startsWith("/api/terminal/")) {
        return false;
    }

    if (request.requireAdmin()) return true;

    const { runtime, terminals } = shared;

    if (!runtime.settings.get("CONSOLE_TERMINAL_ENABLED")) {
        sendJson(res, 403, { error: "The system terminal is disabled (CONSOLE_TERMINAL_ENABLED=false)." });
        return true;
    }

    try {

        if (pathname === "/api/terminal") {

            if (req.method === "GET") {
                sendJson(res, 200, {
                    mode: terminals.mode(),
                    shell: terminals.shell,
                    cwd: terminals.cwd,
                    max_sessions: terminals.maxSessions(),
                    sessions: terminals.list()
                });
                return true;
            }

            if (req.method === "POST") {
                const body = await jsonBody(req, 4096);
                sendJson(res, 201, { session: terminals.create(body) });
                return true;
            }

            sendJson(res, 405, { error: "method not allowed" });
            return true;
        }

        const [, , , id, action, extra] = pathname.split("/");

        if (!SESSION_ID.test(id || "") || extra !== undefined) {
            sendJson(res, 404, { error: "unknown terminal" });
            return true;
        }

        if (!terminals.get(id)) {
            sendJson(res, 404, { error: "unknown terminal" });
            return true;
        }

        if (action === undefined && req.method === "DELETE") {
            terminals.kill(id);
            sendJson(res, 200, { ok: true });
            return true;
        }

        if (action === "stream" && req.method === "GET") {
            terminals.attach(id, req, res);
            return true;
        }

        if (action === "input" && req.method === "POST") {
            const body = await jsonBody(req, 512 * 1024);
            terminals.write(id, body.data);
            sendJson(res, 200, { ok: true });
            return true;
        }

        if (action === "resize" && req.method === "POST") {
            const body = await jsonBody(req, 4096);
            sendJson(res, 200, terminals.resize(id, body.cols, body.rows));
            return true;
        }

        sendJson(res, action === undefined || ["stream", "input", "resize"].includes(action) ? 405 : 404, {
            error: action === undefined || ["stream", "input", "resize"].includes(action) ? "method not allowed" : "unknown terminal route"
        });
        return true;

    } catch (error) {
        if (!error.status && shared.logs) {
            shared.logs.error("server", `terminal ${req.method} ${pathname} failed: ${error.message}`, { stack: String(error.stack || "").slice(0, 4000) });
        }
        sendJson(res, error.status || 500, { error: error.message });
        return true;
    }
};
