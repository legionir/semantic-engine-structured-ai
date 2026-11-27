"use strict";

/*
|--------------------------------------------------------------------------
| MCP platform routes (roadmap P4-01 … P4-04)
|--------------------------------------------------------------------------
|
|   GET    /api/secrets                           names and dates, never values
|   PUT    /api/secrets/:name                     {value} add or replace
|   DELETE /api/secrets/:name
|   GET    /api/mcp/catalog                       entries + prerequisites + installs
|   POST   /api/mcp/catalog/:id/activate          {inputs, scope, project_id, name}
|   POST   /api/mcp/catalog/:name/deactivate      {project_id, forget_secrets}
|   GET    /api/mcp/prerequisites?ids=npx,uvx     the checks, with install hints
|   POST   /api/mcp/prerequisites/:id/install     {with_deps} start a one-click install
|   GET    /api/mcp/prerequisites/:id/install     its progress
|   POST   /api/mcp/:name/reconnect               start a server over now
|
| Everything here changes what the runtime can reach or holds the names
| of credentials, so every route needs the admin token. Called in order by
| ServerImplementation, before the older MCP routes.
*/

const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");
const { maskDeep } = require("../../../agent/events/EventRedactor");

const store = require("../../../agent/secrets/SecretStore");
const catalog = require("../../../agent/mcp/McpCatalog");
const prerequisites = require("../../../agent/mcp/McpPrerequisites");


/*
| P4-01: every string in an answer is scanned for the values the runtime
| holds (the secret store, credential settings and environment), by
| value, so a token echoed in an error or an argument never reaches the
| browser. Field names are left alone: "secret_name" is not a secret.
*/
const maskValues = maskDeep;


function segment(pathname, prefix, suffix = "") {

    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
        return null;
    }

    const middle = pathname.slice(prefix.length, pathname.length - suffix.length);

    if (!middle || middle.includes("/")) {
        return null;
    }

    return decodeURIComponent(middle);
}


function fail(res, error) {

    sendJson(res, error.status || 400, maskValues({
        error: error.message || "request failed",
        ...(error.code ? { code: error.code } : {}),
        ...(error.missing ? { missing: error.missing } : {})
    }));
}


function runtimeAddAllowed(runtime, res) {

    if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
        sendJson(res, 403, { error: "runtime MCP server management is disabled" });
        return false;
    }

    return true;
}


function usedBy() {

    const map = new Map();

    try {
        for (const [server, definition] of require("../../../agent/mcp/McpConfigLoader").userServers()) {
            for (const name of store.referencesIn(definition)) {
                map.set(name, [...(map.get(name) || []), server]);
            }
        }
    } catch {
        /* an unreadable user file refers to nothing */
    }

    return map;
}


module.exports = async function McpPlatformRoutes(shared, request) {

    const { runtime, toolRuntime } = shared;
    const { pathname, req, requireAdmin, res, url } = request;
    const method = req.method;

    /* ----------------------------------------------------- secrets (P4-01) */

    if (pathname === "/api/secrets" && method === "GET") {

        if (requireAdmin()) return true;

        try {
            const users = usedBy();
            sendJson(res, 200, {
                file: store.storeFile(),
                secrets: store.list().map(item => ({ ...item, used_by: users.get(item.name) || [] }))
            });
        } catch (error) {
            fail(res, Object.assign(error, { status: 500 }));
        }

        return true;
    }

    const secretName = segment(pathname, "/api/secrets/");

    if (secretName !== null && (method === "PUT" || method === "DELETE")) {

        if (requireAdmin()) return true;

        try {

            if (method === "PUT") {
                const body = await readBody(req);
                const saved = store.set(secretName, typeof body.value === "string" ? body.value : "");
                emitChange(saved.name, saved.created ? "created" : "updated");
                /* the value is never echoed back */
                sendJson(res, 200, { ok: true, name: saved.name, created: saved.created });
            } else {
                const removed = store.remove(store.checkName(secretName));
                if (!removed) {
                    sendJson(res, 404, { error: `there is no secret "${secretName}"` });
                    return true;
                }
                emitChange(secretName, "deleted");
                sendJson(res, 200, { ok: true, name: secretName, removed: true });
            }

        } catch (error) {
            fail(res, error);
        }

        return true;
    }

    /* ---------------------------------------------------- catalogue (P4-02) */

    if (pathname === "/api/mcp/catalog" && method === "GET") {

        if (requireAdmin()) return true;

        sendJson(res, 200, maskValues(catalog.list(toolRuntime.mcp._manager)));

        return true;
    }

    const activateId = segment(pathname, "/api/mcp/catalog/", "/activate");

    if (activateId !== null && method === "POST") {

        if (requireAdmin()) return true;
        if (!runtimeAddAllowed(runtime, res)) return true;

        try {

            const body = await readBody(req);
            const item = catalog.entry(activateId);

            await runtime.policyEngine.enforce(
                "mcp_add",
                { name: body.name || activateId, catalog: activateId, transport: item ? item.transport : undefined },
                "web_console"
            );

            const result = await catalog.activate(toolRuntime.mcp._manager, activateId, {
                inputs: body.inputs,
                scope: body.scope,
                projectId: body.project_id,
                name: body.name
            });

            sendJson(res, 200, maskValues({ ok: true, ...result }));

        } catch (error) {
            fail(res, error);
        }

        return true;
    }

    const deactivateName = segment(pathname, "/api/mcp/catalog/", "/deactivate");

    if (deactivateName !== null && method === "POST") {

        if (requireAdmin()) return true;
        if (!runtimeAddAllowed(runtime, res)) return true;

        try {

            const body = await readBody(req);

            await runtime.policyEngine.enforce("mcp_remove", { name: deactivateName }, "web_console");

            const result = await catalog.deactivate(toolRuntime.mcp._manager, deactivateName, {
                projectId: body.project_id,
                forgetSecrets: body.forget_secrets === true
            });

            sendJson(res, 200, { ok: true, ...result });

        } catch (error) {
            fail(res, error);
        }

        return true;
    }

    /* ------------------------------------------------ prerequisites (P4-03) */

    if (pathname === "/api/mcp/prerequisites" && method === "GET") {

        if (requireAdmin()) return true;

        const ids = String(url.searchParams.get("ids") || "npx,uvx,python,chromium")
            .split(",")
            .map(item => item.trim())
            .filter(Boolean)
            .slice(0, 20);

        sendJson(res, 200, { prerequisites: prerequisites.check(ids) });

        return true;
    }

    const installId = segment(pathname, "/api/mcp/prerequisites/", "/install");

    if (installId !== null && (method === "POST" || method === "GET")) {

        if (requireAdmin()) return true;

        if (method === "GET") {
            sendJson(res, 200, {
                job: prerequisites.installStatus(installId),
                prerequisite: prerequisites.check([installId])[0]
            });
            return true;
        }

        if (!runtimeAddAllowed(runtime, res)) return true;

        try {

            const body = await readBody(req);
            const recipe = catalog.installer(installId);

            if (!recipe) {
                sendJson(res, 404, { error: `"${installId}" cannot be installed from the console` });
                return true;
            }

            const absent = prerequisites.missing(recipe.requires || []);

            if (absent.length > 0) {
                sendJson(res, 412, {
                    error: `installing ${recipe.label} needs ${absent.map(item => item.label).join(", ")}. ${absent.map(item => item.hint).join(" ")}`,
                    code: "missing_prerequisite",
                    missing: absent
                });
                return true;
            }

            await runtime.policyEngine.enforce("mcp_add", { name: `install:${installId}` }, "web_console");

            const job = prerequisites.install(installId, { recipe, withDeps: body.with_deps === true });

            sendJson(res, 202, { ok: true, job });

        } catch (error) {
            fail(res, error);
        }

        return true;
    }

    /* ------------------------------------------------- reconnect (P4-04) */

    const reconnectName = segment(pathname, "/api/mcp/", "/reconnect");

    if (reconnectName !== null && method === "POST") {

        if (requireAdmin()) return true;

        const manager = toolRuntime.mcp._manager;
        const client = manager.client(reconnectName);

        if (!client) {
            sendJson(res, 404, { error: `unknown MCP server: ${reconnectName}` });
            return true;
        }

        try {
            await client.reconnectNow();
            manager.lastDiscoveryAt = null;
            await manager.discover({ force: true }).catch(() => {});
            sendJson(res, 200, maskValues({ ok: true, server: client.describe() }));
        } catch (error) {
            sendJson(res, 502, maskValues({ error: error.message, server: client.describe() }));
        }

        return true;
    }

    return false;
};


function emitChange(name, action) {
    try {
        require("../../../agent/events").emit("secret:changed", { name, action });
    } catch {
        /* best effort */
    }
}
