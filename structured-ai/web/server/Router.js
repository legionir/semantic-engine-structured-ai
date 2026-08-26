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
                    (name, index) => [name, decodeURIComponent(match[index + 1])]
                )
            );

            return { route, params };
        }

        return null;
    }


    async handle(req, res, context = {}) {

        const url = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );
        const match = this.match(req.method, url.pathname);

        if (match) {
            return match.route.handler({
                req,
                res,
                url,
                params: match.params,
                context,
                route: match.route
            });
        }

        if (typeof this.fallback === "function") {
            return this.fallback(req, res, context, url);
        }

        res.writeHead(404);
        res.end();
        return undefined;
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
    compile
};
