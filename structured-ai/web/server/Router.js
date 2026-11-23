"use strict";

/*
|--------------------------------------------------------------------------
| Web router — EXECUTION_PLAN Phase 23
|--------------------------------------------------------------------------
|
| Controllers register method/path pairs here. Matching is intentionally
| small and deterministic: exact paths, named `:parameters`, and a trailing
| `*` wildcard cover the existing HTTP surface without introducing a
| framework dependency.
|--------------------------------------------------------------------------
*/

function compile(pattern) {

    const names = [];
    const parts = String(pattern)
        .split("/")
        .filter(Boolean);

    const source =
        parts.length === 0
            ? "^/$"
            : "^/" + parts.map(part => {
                if (part === "*") {
                    names.push("wildcard");
                    return "(.*)";
                }

                if (part.startsWith(":")) {
                    names.push(part.slice(1));
                    return "([^/]+)";
                }

                return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            }).join("/") + "$";

    return {
        expression: new RegExp(source),
        names
    };
}


class BadRequestError extends Error {

    constructor(message) {
        super(message);
        this.name = "BadRequestError";
        this.status = 400;
    }
}


function decodeParam(value) {

    try {
        return decodeURIComponent(value);
    } catch {
        throw new BadRequestError("malformed percent-encoding in request path");
    }
}


function requestUrl(req) {

    try {
        return new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );
    } catch {
        throw new BadRequestError("malformed request URL or Host header");
    }
}


function errorStatus(error) {

    if (error instanceof URIError) {
        return 400;
    }

    const status = Number(error && error.status);

    return Number.isInteger(status) && status >= 400 && status < 600
        ? status
        : 500;
}


function sendError(res, error) {

    if (res.headersSent || res.writableEnded) {

        try {
            res.end();
        } catch {
            /* the socket is already gone */
        }

        return;
    }

    const status = errorStatus(error);
    const body = JSON.stringify({
        error: status >= 500
            ? "internal server error"
            : String((error && error.message) || "bad request")
    });

    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store"
    });
    res.end(body);
}


class Router {

    constructor({ fallback } = {}) {
        this.routes = [];
        this.fallback = fallback || null;
    }


    register(method, pattern, handler, name = `${method} ${pattern}`) {

        const compiled = compile(pattern);
        const route = {
            method: String(method).toUpperCase(),
            pattern,
            name,
            handler,
            ...compiled
        };

        this.routes.push(route);
        return route;
    }


    get(pattern, handler, name) {
        return this.register("GET", pattern, handler, name);
    }


    post(pattern, handler, name) {
        return this.register("POST", pattern, handler, name);
    }


    patch(pattern, handler, name) {
        return this.register("PATCH", pattern, handler, name);
    }


    delete(pattern, handler, name) {
        return this.register("DELETE", pattern, handler, name);
    }


    match(method, pathname) {

        const upper = String(method).toUpperCase();

        for (const route of this.routes) {

            if (route.method !== upper) {
                continue;
            }

            const match = route.expression.exec(pathname);

            if (!match) {
                continue;
            }

            const params = Object.fromEntries(
                route.names.map(
                    (name, index) => [name, decodeParam(match[index + 1])]
                )
            );

            return { route, params };
        }

        return null;
    }


    async handle(req, res, context = {}) {

        /*
        | P0-4: nothing a client sends may escape as an unhandled
        | rejection (http.createServer does not await this promise). A
        | malformed Host header, request URL or percent-escape is answered
        | with 400; any other unexpected error with a generic 500.
        */
        try {

            const url = requestUrl(req);
            const match = this.match(req.method, url.pathname);

            if (match) {
                return await match.route.handler({
                    req,
                    res,
                    url,
                    params: match.params,
                    context,
                    route: match.route
                });
            }

            if (typeof this.fallback === "function") {
                return await this.fallback(req, res, context, url);
            }

            res.writeHead(404);
            res.end();
            return undefined;

        } catch (error) {

            sendError(res, error);
            return undefined;
        }
    }


    inventory() {
        return this.routes.map(route => ({
            method: route.method,
            path: route.pattern,
            name: route.name
        }));
    }
}


module.exports = {
    Router,
    compile,
    BadRequestError,
    decodeParam,
    requestUrl,
    sendError
};
