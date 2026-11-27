"use strict";

const crypto = require("crypto");

const CONSOLE_COOKIE = "structured_ai_console";


function newConsoleToken() {
    return crypto.randomBytes(24).toString("base64url");
}


/* P0-4: a malformed %-escape in a cookie must not throw out of auth. */
function decodeCookie(value) {

    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}


function parseCookies(header) {

    return String(header || "")
        .split(";")
        .map(part => part.trim().split("="))
        .filter(parts => parts.length >= 2)
        .reduce((cookies, [key, ...value]) => {
            cookies[key] = decodeCookie(value.join("="));
            return cookies;
        }, {});
}


function tokenMatches(candidate, expected) {

    if (
        typeof candidate !== "string" ||
        typeof expected !== "string" ||
        candidate.length !== expected.length
    ) {
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


function requestPasswordSession(req, url) {

    const cookie = parseCookies(req?.headers?.cookie).structured_ai_console_password;

    if (typeof cookie === "string" && cookie.length > 0) {
        return cookie;
    }

    const header =
        typeof req?.headers?.["x-console-session"] === "string"
            ? req.headers["x-console-session"].trim()
            : "";

    if (header) {
        return header;
    }

    const query = url?.searchParams?.get?.("session");

    return typeof query === "string" && query.length > 0 ? query : null;
}


function normalizeIp(value) {

    const trimmed = String(value || "").trim().toLowerCase();

    if (!trimmed) {
        return "";
    }

    return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}


function parseTrustedProxies(setting) {

    return new Set(
        String(setting || "")
            .split(/[\s,]+/)
            .map(normalizeIp)
            .filter(Boolean)
    );
}


function isTrustedProxy(req, trustedProxiesSetting) {

    const trusted = parseTrustedProxies(trustedProxiesSetting);

    if (trusted.size === 0) {
        return false;
    }

    const remote = normalizeIp(req?.socket?.remoteAddress);

    return remote !== "" && trusted.has(remote);
}


function isValidHostHeader(value) {

    const trimmed = String(value || "").trim();

    if (!trimmed) {
        return false;
    }

    return /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i.test(trimmed);
}


function sameOrigin(origin, host, forwardedHost = null) {

    if (!origin) {
        return true;
    }

    try {
        const parsed = new URL(origin);

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return false;
        }

        const candidates = [];

        if (isValidHostHeader(host)) {
            candidates.push(String(host).trim().toLowerCase());
        }

        for (const part of String(forwardedHost || "").split(",")) {
            const candidate = part.trim().toLowerCase();
            if (isValidHostHeader(candidate)) {
                candidates.push(candidate);
            }
        }

        return candidates.includes(parsed.host.toLowerCase());
    } catch {
        return false;
    }
}


class RateLimiter {

    constructor({ limit = 120, windowMs = 60_000, maxKeys = 10_000 } = {}) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.maxKeys = maxKeys;
        this.windows = new Map();
    }


    allow(req) {

        const key = req.socket?.remoteAddress || "unknown";
        const now = Date.now();
        const current = this.windows.get(key);

        if (!current || now >= current.resetAt) {

            this.windows.set(key, {
                count: 1,
                resetAt: now + this.windowMs
            });

            if (this.windows.size > this.maxKeys) {
                this.windows.clear();
            }

            return true;
        }

        current.count++;
        return current.count <= this.limit;
    }
}


function authenticate({ req, url, consoleToken, consoleAuth }) {

    const suppliedToken = requestToken(req, url);
    const claims = consoleAuth.resolve(suppliedToken, consoleToken);

    return {
        suppliedToken,
        claims,
        authenticated: Boolean(claims)
    };
}


module.exports = {
    CONSOLE_COOKIE,
    newConsoleToken,
    parseCookies,
    tokenMatches,
    requestToken,
    requestPasswordSession,
    parseTrustedProxies,
    isTrustedProxy,
    sameOrigin,
    RateLimiter,
    authenticate
};
