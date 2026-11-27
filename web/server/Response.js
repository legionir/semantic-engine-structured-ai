"use strict";

/*
| HTTP response serializers — EXECUTION_PLAN Phase 23
*/

function sendJson(res, status, value) {

    const payload = JSON.stringify(value);

    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(payload)
    });

    res.end(payload);
}


function sendError(res, status, message, extra = {}) {
    sendJson(res, status, { error: message, ...extra });
}


function sendSseHeaders(res) {

    res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
    });
}


function writeSse(res, value) {
    res.write(`data: ${JSON.stringify(value)}\n\n`);
}


function isHttpsRequest(req, options = {}) {

    if (!req) {
        return false;
    }

    if (req.socket && req.socket.encrypted) {
        return true;
    }

    if (options.trustForwarded === false) {
        return false;
    }

    const proto = String(req.headers && req.headers["x-forwarded-proto"] || "");

    return proto.split(",").some(part => part.trim().toLowerCase() === "https");
}


function setConsoleCookie(res, name, value, req = null, options = {}) {

    const attributes = isHttpsRequest(req, options)
        ? "HttpOnly; Secure; SameSite=None; Partitioned; Path=/"
        : "HttpOnly; SameSite=Strict; Path=/";

    res.setHeader(
        "set-cookie",
        `${name}=${encodeURIComponent(value)}; ${attributes}`
    );
}


/* expire the named cookies with the same attributes they were set with */
function clearConsoleCookies(res, names, req = null, options = {}) {

    const attributes = isHttpsRequest(req, options)
        ? "HttpOnly; Secure; SameSite=None; Partitioned; Path=/"
        : "HttpOnly; SameSite=Strict; Path=/";

    res.setHeader(
        "set-cookie",
        names.map(name => `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attributes}`)
    );
}


module.exports = {
    sendJson,
    sendError,
    sendSseHeaders,
    writeSse,
    isHttpsRequest,
    setConsoleCookie,
    clearConsoleCookies
};
