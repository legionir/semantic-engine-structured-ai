"use strict";

/*
|--------------------------------------------------------------------------
| Application log routes
|--------------------------------------------------------------------------
|
|   GET    /api/logs           entries {level, source, q, after, limit} + summary
|   POST   /api/logs           the console reports its own browser errors
|   DELETE /api/logs           clear (the file is rotated, not deleted)
|   GET    /api/logs/stream    SSE: summary snapshot, then each new entry
|   GET    /api/logs/download  the persisted JSONL log
|
| Entries carry model responses and error details, so every route needs
| the admin token. Called in order by ServerImplementation.
*/

const { readBody } = require("../RequestBody");
const { sendJson } = require("../Response");
const { LEVEL_RANK } = require("../../../agent/runtime/LogStore");


function filterFrom(url) {
    const params = url.searchParams;
    const level = params.get("level") || "";
    return {
        level: LEVEL_RANK[level] === undefined ? undefined : level,
        source: (params.get("source") || "").slice(0, 40),
        q: (params.get("q") || "").slice(0, 200),
        after: Number.parseInt(params.get("after") || "0", 10) || 0,
        limit: Number.parseInt(params.get("limit") || "500", 10) || 500
    };
}


module.exports = async function LogRoutes(shared, request) {

    const { pathname, req, res, url } = request;

    if (pathname !== "/api/logs" && !pathname.startsWith("/api/logs/")) {
        return false;
    }

    if (request.requireAdmin()) return true;

    const { logs, logHub } = shared;

    if (pathname === "/api/logs") {

        if (req.method === "GET") {
            sendJson(res, 200, { entries: logs.list(filterFrom(url)), summary: logs.summary() });
            return true;
        }

        if (req.method === "POST") {
            let body;
            try {
                body = await readBody(req, { maxBytes: 32 * 1024 });
            } catch (error) {
                sendJson(res, /too large/.test(error.message) ? 413 : 400, { error: error.message });
                return true;
            }
            if (!body || typeof body.message !== "string" || body.message.trim() === "") {
                sendJson(res, 400, { error: "message must be a non-empty string" });
                return true;
            }
            const level = ["info", "warn", "error"].includes(body.level) ? body.level : "error";
            const details = body.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details : undefined;
            const entry = logs.record(level, "panel", body.message.slice(0, 2000), {
                ...details,
                user_agent: String(req.headers["user-agent"] || "").slice(0, 200)
            });
            sendJson(res, 201, { id: entry ? entry.id : null });
            return true;
        }

        if (req.method === "DELETE") {
            await logs.clear();
            sendJson(res, 200, { ok: true, summary: logs.summary() });
            return true;
        }

        sendJson(res, 405, { error: "method not allowed" });
        return true;
    }

    if (pathname === "/api/logs/stream" && req.method === "GET") {
        logHub.attach(req, res, { res }, { type: "snapshot", summary: logs.summary() });
        return true;
    }

    if (pathname === "/api/logs/download" && req.method === "GET") {
        const text = await logs.exportText();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        res.writeHead(200, {
            "content-type": "application/x-ndjson; charset=utf-8",
            "content-disposition": `attachment; filename="structured-ai-log-${stamp}.jsonl"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "content-length": Buffer.byteLength(text)
        });
        res.end(text);
        return true;
    }

    sendJson(res, pathname === "/api/logs/stream" || pathname === "/api/logs/download" ? 405 : 404, {
        error: pathname === "/api/logs/stream" || pathname === "/api/logs/download" ? "method not allowed" : "unknown log route"
    });
    return true;
};
