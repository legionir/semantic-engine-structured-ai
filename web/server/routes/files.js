"use strict";

/*
|--------------------------------------------------------------------------
| File manager routes
|--------------------------------------------------------------------------
|
|   GET    /api/files?path=                 list a directory
|   POST   /api/files                       create {path, type, content?}
|   DELETE /api/files?path=&recursive=1     delete a file or directory
|   GET    /api/files/content?path=         read a text file
|   PUT    /api/files/content               save {path, content, expected_mtime_ms?}
|   POST   /api/files/rename                rename / move {from, to}
|   GET    /api/files/download?path=        the raw file as an attachment
|
| Every route takes an optional `projectId` (query or body) to work in a
| registered project's root instead of the workspace. Admin token only,
| and only while CONSOLE_FILE_MANAGER_ENABLED is on.
*/

const fs = require("fs");

const { readBody } = require("../RequestBody");
const { sendJson } = require("../Response");
const { FileManager } = require("../console/file-manager");


async function jsonBody(req, maxBytes) {
    try {
        const body = await readBody(req, { maxBytes });
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw Object.assign(new Error("request body must be a JSON object"), { status: 400 });
        }
        return body;
    } catch (error) {
        throw Object.assign(new Error(error.message), {
            status: error.status || (/too large/.test(error.message) ? 413 : 400)
        });
    }
}


function managerFor(shared, projectId) {

    const settings = shared.runtime.settings;
    const limits = {
        maxBytes: () => Number(settings.get("CONSOLE_FILE_MAX_BYTES")) || 2 * 1024 * 1024,
        listMax: () => Number(settings.get("CONSOLE_FILE_LIST_MAX")) || 5000,
        probeBytes: () => Number(settings.get("BINARY_PROBE_BYTES")) || 8192
    };

    if (projectId === undefined || projectId === null || projectId === "") {
        return new FileManager({ root: shared.workspaceRoot(), ...limits });
    }

    if (typeof projectId !== "string" || projectId.length > 200) {
        throw Object.assign(new Error("projectId must be a string"), { status: 400 });
    }

    let record;
    try {
        record = shared.runtime.projects.registry().get(projectId);
    } catch (error) {
        throw Object.assign(new Error(error.message), { status: 404 });
    }

    if (!record || typeof record.workspaceRoot !== "string") {
        throw Object.assign(new Error(`Project ${projectId} has no workspace root.`), { status: 404 });
    }

    return new FileManager({ root: record.workspaceRoot, ...limits });
}


function contentDisposition(name) {
    const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}


module.exports = async function FileRoutes(shared, request) {

    const { pathname, req, res, url } = request;

    if (pathname !== "/api/files" && !pathname.startsWith("/api/files/")) {
        return false;
    }

    if (request.requireAdmin()) return true;

    if (!shared.runtime.settings.get("CONSOLE_FILE_MANAGER_ENABLED")) {
        sendJson(res, 403, { error: "The file manager is disabled (CONSOLE_FILE_MANAGER_ENABLED=false)." });
        return true;
    }

    const query = url.searchParams;
    const maxBody = () => (Number(shared.runtime.settings.get("CONSOLE_FILE_MAX_BYTES")) || 2 * 1024 * 1024) * 6 + 65536;

    try {

        if (pathname === "/api/files") {

            if (req.method === "GET") {
                const files = managerFor(shared, query.get("projectId"));
                sendJson(res, 200, await files.list(query.get("path") || "."));
                return true;
            }

            if (req.method === "POST") {
                const body = await jsonBody(req, maxBody());
                const files = managerFor(shared, body.projectId);
                const entry = await files.create(body.path, body.type, body.content ?? "");
                sendJson(res, 201, { entry });
                return true;
            }

            if (req.method === "DELETE") {
                const files = managerFor(shared, query.get("projectId"));
                const removed = await files.remove(query.get("path"), query.get("recursive") === "1");
                sendJson(res, 200, { removed });
                return true;
            }

            sendJson(res, 405, { error: "method not allowed" });
            return true;
        }

        if (pathname === "/api/files/content") {

            if (req.method === "GET") {
                const files = managerFor(shared, query.get("projectId"));
                sendJson(res, 200, await files.read(query.get("path")));
                return true;
            }

            if (req.method === "PUT") {
                const body = await jsonBody(req, maxBody());
                const files = managerFor(shared, body.projectId);
                sendJson(res, 200, { entry: await files.write(body.path, body.content, body.expected_mtime_ms) });
                return true;
            }

            sendJson(res, 405, { error: "method not allowed" });
            return true;
        }

        if (pathname === "/api/files/rename") {

            if (req.method !== "POST") {
                sendJson(res, 405, { error: "method not allowed" });
                return true;
            }

            const body = await jsonBody(req, 16 * 1024);
            const files = managerFor(shared, body.projectId);
            sendJson(res, 200, { entry: await files.rename(body.from, body.to) });
            return true;
        }

        if (pathname === "/api/files/download") {

            if (req.method !== "GET") {
                sendJson(res, 405, { error: "method not allowed" });
                return true;
            }

            const files = managerFor(shared, query.get("projectId"));
            const file = await files.openForDownload(query.get("path"));
            res.writeHead(200, {
                "content-type": "application/octet-stream",
                "content-disposition": contentDisposition(file.name),
                "content-length": file.size,
                "cache-control": "no-store",
                "x-content-type-options": "nosniff"
            });
            await new Promise(resolve => {
                const stream = fs.createReadStream(file.target);
                stream.on("error", () => {
                    res.destroy();
                    resolve();
                });
                stream.on("end", resolve);
                stream.pipe(res);
            });
            return true;
        }

        sendJson(res, 404, { error: "unknown file manager route" });
        return true;

    } catch (error) {
        if (!error.status && shared.logs) {
            shared.logs.error("server", `file manager ${req.method} ${pathname} failed: ${error.message}`, { stack: String(error.stack || "").slice(0, 4000) });
        }
        sendJson(res, error.status || 500, {
            error: error.message,
            ...(error.current_mtime_ms !== undefined ? { current_mtime_ms: error.current_mtime_ms } : {})
        });
        return true;
    }
};
