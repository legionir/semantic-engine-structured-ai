"use strict";

/*
|--------------------------------------------------------------------------
| Web console gate (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Everything that decides *whether* a request reaches a route, and to
| whom the answer may be spoken: the four places a token may come from,
| the constant-time comparison, the per-socket rate limit, the
| same-origin rule, and the HttpOnly cookie a launch link is exchanged
| for so EventSource needs no custom header.
|
| The bodies moved verbatim. `guard()` differs from the original in one
| way: where a bare `return;` meant "I have already answered", it now
| returns `{ handled: true }`. A router cannot tell that apart any other
| way, and a guard that silently fell through would let a request that
| was already refused run a route with no claims.
|
| tokenMatches is unreachable from the guard on purpose: the live
| comparison is made inside consoleAuth.resolve, which carries its own
| timing-safe match. The duplicate moved with everything else instead of
| being quietly deleted; test/web/layer.test.js pins its behaviour to
| consoleAuth's so phase 30 can drop it with a proof rather than a hunch.
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");
const consoleAuth = require("../../agent/lib/consoleAuth");

const CONSOLE_COOKIE = "structured_ai_console";

function newConsoleToken() {

    return crypto.randomBytes(24).toString("base64url");
}

function parseCookies(header) {

    return String(header || "")
        .split(";")
        .map(part => part.trim().split("="))
        .filter(parts => parts.length >= 2)
        .reduce((cookies, [key, ...value]) => {
            cookies[key] = decodeURIComponent(value.join("="));
            return cookies;
        }, {});
}

function tokenMatches(candidate, expected) {

    if (typeof candidate !== "string" || candidate.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(candidate),
        Buffer.from(expected)
    );
}

function requestToken(req, url) {

    const authorization =
        typeof req.headers.authorization === "string"
            ? /^Bearer\s+(.+)$/i.exec(req.headers.authorization)?.[1]
            : null;

    return (
        authorization ||
        (typeof req.headers["x-console-token"] === "string"
            ? req.headers["x-console-token"]
            : null) ||
        url.searchParams.get("token") ||
        parseCookies(req.headers.cookie)[CONSOLE_COOKIE] ||
        null
    );
}

function createMiddleware(ctx) {
    const { consoleToken } = ctx;

    const requestWindows = new Map();
    const API_RATE_LIMIT = 120;
    const API_RATE_WINDOW_MS = 60_000;

    function allowApiRequest(req) {
        const key = req.socket.remoteAddress || "unknown";
        const now = Date.now();
        const current = requestWindows.get(key);

        if (!current || now >= current.resetAt) {
            requestWindows.set(key, { count: 1, resetAt: now + API_RATE_WINDOW_MS });
            if (requestWindows.size > 10_000) requestWindows.clear();
            return true;
        }

        current.count++;
        return current.count <= API_RATE_LIMIT;
    }

    function guard(req, res, url) {

        const { pathname } = url;
        const isApiRequest = pathname.startsWith("/api/");

        if (isApiRequest && !allowApiRequest(req)) {
            ctx.sendJson(res, 429, { error: "console API rate limit exceeded" });
            return { handled: true };
        }

        if (isApiRequest && req.headers.origin) {
            let sameOrigin = false;
            try {
                sameOrigin = new URL(req.headers.origin).host === req.headers.host;
            } catch {
                sameOrigin = false;
            }
            if (!sameOrigin) {
                ctx.sendJson(res, 403, { error: "cross-origin console request refused" });
                return { handled: true };
            }
        }

        const suppliedToken = requestToken(req, url);
        const claims = consoleAuth.resolve(suppliedToken, consoleToken);
        const authenticated = Boolean(claims);

        /*
        | Static assets remain public so the browser can load the UI.
        | Every API, SSE and control-plane endpoint requires the token.
        | A token in the launch URL is exchanged for an HttpOnly cookie
        | so normal browser fetch/EventSource calls do not need custom
        | headers.
        */
        if (authenticated && url.searchParams.has("token")) {
            res.setHeader(
                "set-cookie",
                `${CONSOLE_COOKIE}=${encodeURIComponent(consoleToken)}; HttpOnly; SameSite=Strict; Path=/`
            );
        }

        if (pathname.startsWith("/api/") && !authenticated) {
            ctx.sendJson(res, 401, { error: "console authentication required" });
            return { handled: true };
        }

        return { handled: false, claims };
    }

    return {
        allowApiRequest,
        guard
    };
}

module.exports = {
    createMiddleware,
    CONSOLE_COOKIE,
    newConsoleToken,
    parseCookies,
    requestToken,
    tokenMatches
};
