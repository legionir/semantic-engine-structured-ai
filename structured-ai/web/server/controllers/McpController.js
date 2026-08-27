"use strict";

/*
|--------------------------------------------------------------------------
| Web console MCP routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Status, refresh, add, remove and enable for the external MCP servers.
|
| Two things in this file are contracts rather than style:
|
| 1. The management gate is checked before the payload is looked at, so
|    turning the feature off is refused the same way for every verb — and
|    with the gate open, an add with no name still reaches the operator
|    before it is told the name is missing. The route contract records both.
| 2. `?refresh=1` swallows the failure of a rediscovery: a server that will
|    not start must not turn the status page into a 500, because the status
|    page is how an operator finds out why it will not start.
|
| Enabling a server is not re-adding it — the definition stays, so it can be
| switched back on without being typed again. An unknown server is a 404 from
| the manager, not from here.
|--------------------------------------------------------------------------
*/

function createMcpController(ctx) {

    const { runtime, toolRuntime } = ctx;

    /* ----------------------------------------------- mcp */

    async function status(req, res, url, pathname, claims) {

        if (url.searchParams.get("refresh") === "1") {

            await toolRuntime
                .discoverMcpTools({ force: true })
                .catch(() => {});
        }

        const manager =
            toolRuntime.mcp._manager;

        ctx.sendJson(res, 200, {
            ...manager.status(),

            tools:
                manager.catalogueEntries().map(entry => ({
                    name: entry.name,
                    server: entry.server,
                    tool: entry.tool,
                    description: entry.description
                }))
        });

    }

    async function add(req, res, url, pathname, claims) {

        const body =
            await ctx.readBody(req);

        if (!ctx.settings.allowMcpRuntimeAdd()) {
            ctx.sendJson(res, 403, {
                error: "runtime MCP server management is disabled"
            });
            return;
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

            ctx.sendJson(res, 200, {
                ok: true,
                server: added.config.name,
                transport: added.config.transport,
                persisted_to: added.persisted_to
            });

        } catch (error) {

            ctx.sendJson(res, 400, {
                error: error.message
            });
        }

    }

    async function remove(req, res, url, pathname, claims) {

        const name =
            decodeURIComponent(
                pathname.slice("/api/mcp/".length)
            );

        if (!ctx.settings.allowMcpRuntimeAdd()) {
            ctx.sendJson(res, 403, {
                error: "runtime MCP server management is disabled"
            });
            return;
        }

        await runtime.policyEngine.enforce(
            "mcp_remove",
            { name },
            "web_console"
        );

        const removed =
            await toolRuntime.mcp._manager.remove(name);

        ctx.sendJson(res, 200, {
            ok: true,
            server: name,
            ...removed
        });

    }

    /*
    | Toggling a server is not the same as removing it: the
    | definition stays, so it can be switched back on
    | without being typed again.
    */

    async function setEnabled(req, res, url, pathname, claims) {

        const name =
            decodeURIComponent(
                pathname.slice(
                    "/api/mcp/".length,
                    pathname.length - "/enabled".length
                )
            );

        const body =
            await ctx.readBody(req);

        if (!ctx.settings.allowMcpRuntimeAdd()) {
            ctx.sendJson(res, 403, {
                error: "runtime MCP server management is disabled"
            });
            return;
        }

        await runtime.policyEngine.enforce(
            "mcp_add",
            { name, enabled: body.enabled !== false },
            "web_console"
        );

        const changed =
            toolRuntime.mcp._manager.setEnabled(
                name,
                body.enabled !== false
            );

        if (!changed) {

            ctx.sendJson(res, 404, {
                error: `unknown MCP server: ${name}`
            });

            return;
        }

        if (body.enabled !== false) {

            await toolRuntime
                .discoverMcpTools({ force: true })
                .catch(() => {});
        }

        ctx.sendJson(res, 200, {
            ok: true,
            server: name,
            enabled: body.enabled !== false
        });

    }

    return {
        status,
        add,
        remove,
        setEnabled
    };
}

module.exports = { createMcpController };
