"use strict";

/*
|--------------------------------------------------------------------------
| Static files
|--------------------------------------------------------------------------
|
| Serving web/public, with deep links falling back to index.html.
|
*/

const fs = require("fs");
const path = require("path");
const { sendJson } = require("../Response");

const WEB_ROOT =
    path.resolve(__dirname, "..", "..");

const PUBLIC_DIR =
    path.join(WEB_ROOT, "public");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};


function wellEncodedPath(pathname) {

    try {
        decodeURIComponent(pathname);
        return true;
    } catch {
        return false;
    }
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
    wellEncodedPath,
    serveStatic
};
