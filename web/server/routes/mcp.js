"use strict";

/*
|--------------------------------------------------------------------------
| MCP routes
|--------------------------------------------------------------------------
|
| Reading and saving the MCP config, listing, connecting, removing and
| enabling MCP servers.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const path = require("path");
const fs = require("fs");
const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");


module.exports = async function McpRoutes(shared, request) {

    const {
        runtime,
        toolRuntime
    } = shared;

    const {
        pathname,
        req,
        requireAdmin,
        requireUnscoped,
        res,
        url
    } = request;

    /* ----------------------------------------------- mcp */

    if (
        pathname === "/api/mcp/config" &&
        req.method === "GET"
    ) {
        if (requireAdmin()) return true;

        const manager = toolRuntime.mcp._manager;
        manager.load();
        const loader = require(path.join(__dirname, "..", "..", "..", "agent", "mcp", "McpConfigLoader"));
        const file = loader.workspaceFile(manager.workspaceRoot);
        const text = fs.existsSync(file)
            ? fs.readFileSync(file, "utf8")
            : `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;

        sendJson(res, 200, { text, path: file });
        return true;
    }

    if (
        pathname === "/api/mcp/config" &&
        req.method === "PUT"
    ) {
        if (requireAdmin()) return true;

        if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
            sendJson(res, 403, { error: "runtime MCP server management is disabled" });
            return true;
        }

        try {
            const body = await readBody(req);
            const text = typeof body.text === "string" ? body.text : "";
            const document = JSON.parse(text);
            if (!document || typeof document !== "object" || Array.isArray(document)) {
                throw new Error("MCP config must be a JSON object");
            }

            const loader = require(path.join(__dirname, "..", "..", "..", "agent", "mcp", "McpConfigLoader"));
            const validator = require(path.join(__dirname, "..", "..", "..", "agent", "mcp", "McpConfigValidator"));
            const manager = toolRuntime.mcp._manager;
            manager.load();
            const root = manager.workspaceRoot;
            const file = loader.workspaceFile(root);
            const container = document.mcpServers || document.mcp_servers || document.servers;
            if (!container || typeof container !== "object" || Array.isArray(container)) {
                throw new Error('MCP config must contain an object under "mcpServers"');
            }

            const entries = loader.entriesOf(document);
            const normalized = new Map();
            /* entriesOf() skips entries that are not objects; check what will be written */
            for (const [name, definition] of Object.entries(container)) {
                if (typeof name !== "string" || !definition || typeof definition !== "object" || Array.isArray(definition)) {
                    throw new Error("each MCP server must have a name and an object definition");
                }
                const checked = validator.normalizeOne(name, definition, root);
                normalized.set(name, checked);
            }

            const previousDocument = loader.readJsonFile(file) || { mcpServers: {} };
            const previousEntries = new Map(loader.entriesOf(previousDocument));
            for (const [name, definition] of entries) {
                const previous = previousEntries.get(name);
                if (!previous || JSON.stringify(previous) !== JSON.stringify(definition)) {
                    await runtime.policyEngine.enforce("mcp_add", { name, ...definition }, "web_console");
                }
            }
            for (const name of previousEntries.keys()) {
                if (!normalized.has(name)) {
                    await runtime.policyEngine.enforce("mcp_remove", { name }, "web_console");
                }
            }

            fs.mkdirSync(path.dirname(file), { recursive: true });
            loader.writePrivateFile(file, `${JSON.stringify(document, null, 2)}\n`);
            manager.invalidate();
            manager.load();
            await toolRuntime.discoverMcpTools({ force: true }).catch(() => {});

            sendJson(res, 200, { ok: true, path: file });
        } catch (error) {
            sendJson(res, error.status || 400, { error: error.message || "invalid MCP config" });
        }
        return true;
    }

    if (
        pathname === "/api/mcp" &&
        req.method === "GET"
    ) {

        if (requireUnscoped("project:read")) {
            return true;
        }

        if (url.searchParams.get("refresh") === "1") {

            await toolRuntime
                .discoverMcpTools({ force: true })
                .catch(() => {});
        }

        const manager =
            toolRuntime.mcp._manager;

        sendJson(res, 200, {
            ...manager.status(),

            tools:
                manager.catalogueEntries().map(entry => ({
                    name: entry.name,
                    server: entry.server,
                    tool: entry.tool,
                    description: entry.description
                }))
        });

        return true;
    }

    if (
        pathname === "/api/mcp" &&
        req.method === "POST"
    ) {

        if (requireAdmin()) {
            return true;
        }

        const body =
            await readBody(req);

        if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
            sendJson(res, 403, {
                error: "runtime MCP server management is disabled"
            });
            return true;
        }

        try {

            // Normalize UI payload to config shape
            // UI may send command_args (old) or args (new), and env as object
            const normalizedBody = {
                ...body,
                name: body.name,
                transport: body.transport,
                command: body.command,
                args: body.args || body.command_args,
                env: body.env,
                url: body.url,
                token: body.token,
                headers: body.headers,
                cwd: body.cwd,
                trust: body.trust,
                include: body.include,
                exclude: body.exclude
            };

            await runtime.policyEngine.enforce(
                "mcp_add",
                normalizedBody,
                "web_console"
            );

            const added =
                await toolRuntime.mcp._manager.add(
                    normalizedBody.name,
                    normalizedBody,
                    { persist: body.persist !== false }
                );

            sendJson(res, 200, {
                ok: true,
                server: added.config.name,
                transport: added.config.transport,
                persisted_to: added.persisted_to
            });

        } catch (error) {

            sendJson(res, 400, {
                error: error.message
            });
        }

        return true;
    }

    if (
        pathname.startsWith("/api/mcp/") &&
        req.method === "DELETE"
    ) {

        if (requireAdmin()) {
            return true;
        }

        const name =
            decodeURIComponent(
                pathname.slice("/api/mcp/".length)
            );

        if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
            sendJson(res, 403, {
                error: "runtime MCP server management is disabled"
            });
            return true;
        }

        try {
            await runtime.policyEngine.enforce(
                "mcp_remove",
                { name },
                "web_console"
            );
        } catch (error) {
            /* a refusal is the caller's answer, as for POST and PUT, not a server fault */
            sendJson(res, error.status || 400, { error: error.message });
            return true;
        }

        const removed =
            await toolRuntime.mcp._manager.remove(name);

        sendJson(res, 200, {
            ok: true,
            server: name,
            ...removed
        });

        return true;
    }

    /*
    | Toggling a server is not the same as removing it: the
    | definition stays, so it can be switched back on
    | without being typed again.
    */

    if (
        pathname.startsWith("/api/mcp/") &&
        pathname.endsWith("/enabled") &&
        req.method === "POST"
    ) {

        if (requireAdmin()) {
            return true;
        }

        const name =
            decodeURIComponent(
                pathname.slice(
                    "/api/mcp/".length,
                    pathname.length - "/enabled".length
                )
            );

        const body =
            await readBody(req);

        if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
            sendJson(res, 403, {
                error: "runtime MCP server management is disabled"
            });
            return true;
        }

        try {
            await runtime.policyEngine.enforce(
                "mcp_add",
                { name, enabled: body.enabled !== false },
                "web_console"
            );
        } catch (error) {
            sendJson(res, error.status || 400, { error: error.message });
            return true;
        }

        const changed =
            toolRuntime.mcp._manager.setEnabled(
                name,
                body.enabled !== false
            );

        if (!changed) {

            sendJson(res, 404, {
                error: `unknown MCP server: ${name}`
            });

            return true;
        }

        if (body.enabled !== false) {

            await toolRuntime
                .discoverMcpTools({ force: true })
                .catch(() => {});
        }

        sendJson(res, 200, {
            ok: true,
            server: name,
            enabled: body.enabled !== false
        });

        return true;
    }

    return false;
};
