"use strict";

/*
|--------------------------------------------------------------------------
| Web console responses (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| JSON answers and the static file fallback — the two ways the console
| answers anything at all.
|
| PUBLIC_DIR is the single line this move had to rewrite: the folder is
| still web/public, but it now sits one level above this file. A wrong join
| here does not throw — it serves 404 for the entire UI — so
| test/web/layer.test.js pins the resolved path instead of trusting it.
|
| An unknown asset is answered with JSON rather than html, which is what
| keeps the static fallback from swallowing an API 404. The route contract
| records that fact for exactly that reason.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR =
    path.join(__dirname, "..", "public");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

function sendJson(res, status, value) {

    const payload =
        JSON.stringify(value);

    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(payload)
    });

    res.end(payload);
}

function serveStatic(req, res, pathname) {

    const relative =
        pathname === "/"
            ? "index.html"
            : pathname.replace(/^\/+/, "");

    const target =
        path.join(PUBLIC_DIR, relative);

    if (
        !target.startsWith(PUBLIC_DIR + path.sep) ||
        !fs.existsSync(target) ||
        !fs.statSync(target).isFile()
    ) {

        sendJson(res, 404, { error: "not found" });

        return;
    }

    const body =
        fs.readFileSync(target);

    res.writeHead(200, {
        "content-type":
            MIME[path.extname(target)] ||
            "application/octet-stream",

        "cache-control": "no-store",

        "content-length": body.length
    });

    res.end(body);
}

module.exports = {
    PUBLIC_DIR,
    MIME,
    sendJson,
    serveStatic
};
