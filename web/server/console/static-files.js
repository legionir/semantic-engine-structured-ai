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
    ".ico": "image/x-icon"
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

    const headers = {
        "content-type":
            MIME[path.extname(target)] ||
            "application/octet-stream",

        "cache-control": "no-store",

        "x-content-type-options": "nosniff",

        "content-length": body.length
    };

    if (path.extname(target) === ".html") {
        headers["content-security-policy"] = contentSecurityPolicy(body.toString("utf8"));
    }

    res.writeHead(200, headers);

    res.end(body);
}


module.exports = {
    wellEncodedPath,
    serveStatic
};
