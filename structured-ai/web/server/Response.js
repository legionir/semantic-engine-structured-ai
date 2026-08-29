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


function setConsoleCookie(res, name, value) {

    res.setHeader(
        "set-cookie",
        `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/`
    );
}


module.exports = {
    sendJson,
    sendError,
    sendSseHeaders,
    writeSse,
    setConsoleCookie
};
