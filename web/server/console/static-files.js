"use strict";

/*
|--------------------------------------------------------------------------
| Static files
|--------------------------------------------------------------------------
|
| Serving web/public, with deep links falling back to index.html.
|
| Every file is sent with nosniff; the page itself also carries a strict
| Content-Security-Policy. The console loads nothing from another origin
| and never evaluates strings, so scripts, styles and connections are
| limited to this origin (CSS icons are data: images). The page's own
| inline scripts are allowed by their sha256, computed from the file as
| it is served, so editing one can never leave a stale hash behind.
|
*/

const crypto = require("crypto");
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
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8"
};


function inlineScriptHashes(html) {

    const hashes = [];

    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        hashes.push(`'sha256-${crypto.createHash("sha256").update(match[1], "utf8").digest("base64")}'`);
    }

    return hashes;
}


function contentSecurityPolicy(html) {

    return [
        "default-src 'self'",
        ["script-src 'self'", ...inlineScriptHashes(html)].join(" "),
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'"
    ].join("; ");
}


function wellEncodedPath(pathname) {

    try {
        decodeURIComponent(pathname);
        return true;
    } catch {
        return false;
    }
}

async function serveStatic(req, res, pathname) {

    let decoded;

    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        sendJson(res, 400, { error: "malformed percent-encoding in request path" });
        return;
    }

    const relative =
        decoded === "/"
            ? "index.html"
            : decoded.replace(/^\/+/, "");

    const target =
        path.resolve(PUBLIC_DIR, relative);

    if (!target.startsWith(PUBLIC_DIR + path.sep)) {
        sendJson(res, 404, { error: "not found" });
        return;
    }

    let stats;

    try {
        stats = await fs.promises.stat(target);
    } catch {
        sendJson(res, 404, { error: "not found" });
        return;
    }

    if (!stats.isFile()) {
        sendJson(res, 404, { error: "not found" });
        return;
    }

    const ext = path.extname(target).toLowerCase();
    const body =
        ext === ".html" || req.method !== "HEAD"
            ? await fs.promises.readFile(target)
            : null;

    const headers = {
        "content-type":
            MIME[ext] ||
            "application/octet-stream",

        "cache-control": "no-store",

        "x-content-type-options": "nosniff",

        "content-length": body ? body.length : stats.size
    };

    if (ext === ".html") {
        headers["content-security-policy"] = contentSecurityPolicy(body.toString("utf8"));
    }

    res.writeHead(200, headers);

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    res.end(body);
}


module.exports = {
    wellEncodedPath,
    serveStatic
};
