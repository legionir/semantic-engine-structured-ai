"use strict";

/*
|--------------------------------------------------------------------------
| MCP completion routes (roadmap P4-05 … P4-12)
|--------------------------------------------------------------------------
|
|   POST  /api/mcp/import/preview              {text, name?} what a merge would do
|   POST  /api/mcp/import                      {text, name?, target, resolutions, only?}
|   PATCH /api/mcp/:name/controls              {tool, enabled} | {disabled_tools} |
|                                              {approval} | {agents} | {projects}
|   POST  /api/mcp/:name/oauth/start           the provider's sign-in URL
|   GET   /api/mcp/oauth/callback              the provider's redirect (state-bound)
|   POST  /api/mcp/:name/oauth/signout
|   GET   /api/mcp/elicitations                questions servers are waiting on
|   POST  /api/mcp/elicitations/:id            {action, content}
|   GET   /api/mcp/:name/resources[?uri=]      list, or read one
|   GET   /api/mcp/:name/prompts               list
|   POST  /api/mcp/:name/prompts/:prompt       {arguments} the rendered text
|   GET   /api/mcp/registry?q=&cursor=         search the MCP registry
|   GET   /api/mcp/registry/server?name=       one registry record
|   POST  /api/mcp/registry/add                {name, version?, choice?, inputs?,
|                                               server_name?, acknowledge_untrusted}
|
| Configuration changes need the admin token, like the older MCP routes;
| answering a server's question and reading resources and prompts need a
| token allowed on every project. Every answer is masked by value.
*/

const { isTrustedProxy } = require("../Middleware");
const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");
const { maskDeep } = require("../../../agent/events/EventRedactor");

const importer = require("../../../agent/mcp/McpConfigImport");
const overrides = require("../../../agent/mcp/McpOverrides");
const oauth = require("../../../agent/mcp/McpOAuth");
const interactions = require("../../../agent/mcp/McpInteractions");
const registryClient = require("../../../agent/mcp/McpRegistryClient");


function serverSegment(pathname, suffix) {

    const prefix = "/api/mcp/";

    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;

    const middle = pathname.slice(prefix.length, pathname.length - suffix.length);

    if (!middle || middle.includes("/")) return null;

    return decodeURIComponent(middle);
}


function requestBase(req, trustedProxies = "") {

    const trusted = isTrustedProxy(req, trustedProxies);
    const forwardedProto = trusted
        ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase()
        : "";
    const proto =
        forwardedProto === "http" || forwardedProto === "https"
            ? forwardedProto
            : (req.socket && req.socket.encrypted ? "https" : "http");
    const forwardedHost = trusted
        ? String(req.headers["x-forwarded-host"] || "").split(",")[0].trim()
        : "";
    const rawHost = forwardedHost || req.headers.host;
    const host = rawHost && /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i.test(String(rawHost).trim())
        ? String(rawHost).trim()
        : null;

    return host ? `${proto}://${host}` : null;
}


function escapeHtml(text) {

    return String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}


function callbackPage(res, ok, message, server) {

    const payload = JSON.stringify({ type: "mcp-oauth", ok, server: server || null, message });

    res.writeHead(ok ? 200 : 400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
    });

    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>MCP sign-in</title>
<style>body{font:15px system-ui,sans-serif;margin:3rem auto;max-width:32rem;color:#222}</style></head>
<body><h1>${ok ? "Signed in" : "Sign-in failed"}</h1><p>${escapeHtml(message)}</p><p>You can close this window.</p>
<script>try{window.opener&&window.opener.postMessage(${payload.replace(/</g, "\\u003c")},location.origin)}catch(e){}${ok ? "setTimeout(function(){window.close()},1500)" : ""}</script>
</body></html>`);
}


module.exports = async function McpCompletionRoutes(shared, request) {

    const { runtime, toolRuntime } = shared;
    const { pathname, req, res, url, requireAdmin, requireUnscoped } = request;

    if (!pathname.startsWith("/api/mcp")) {
        return false;
    }

    const manager = () => toolRuntime.mcp._manager;
    const method = req.method;

    const fail = (error, fallback = 400) =>
        sendJson(res, error.status || fallback, maskDeep({ error: error.message, ...(error.details || {}) }));

    const managementAllowed = () => {
        if (runtime.settings.get("MCP_ALLOW_RUNTIME_ADD") === false) {
            sendJson(res, 403, { error: "runtime MCP server management is disabled" });
            return false;
        }
        return true;
    };

    const reload = async () => {
        manager().invalidate();
        manager().load();
        await toolRuntime.discoverMcpTools({ force: true }).catch(() => {});
    };

    /* ------------------------------------------------------- P4-05 import */

    if (pathname === "/api/mcp/import/preview" && method === "POST") {

        if (requireAdmin()) return true;

        try {
            const body = await readBody(req, { maxBytes: 1024 * 1024 });
            const previewed = importer.preview(body.text, { manager: manager(), name: body.name || null });
            sendJson(res, 200, maskDeep({ ...previewed, taken: undefined }));
        } catch (error) {
            fail(error);
        }

        return true;
    }

    if (pathname === "/api/mcp/import" && method === "POST") {

        if (requireAdmin()) return true;
        if (!managementAllowed()) return true;

        try {

            const body = await readBody(req, { maxBytes: 1024 * 1024 });
            const target = body.target === "workspace" ? "workspace" : "user";
            const previewed = importer.preview(body.text, { manager: manager(), name: body.name || null });
            const planned = importer.plan(previewed, body.resolutions || {}, { only: Array.isArray(body.only) ? body.only : null });

            if (planned.unresolved.length > 0) {
                sendJson(res, 409, maskDeep({
                    error: `${planned.unresolved.length} server name(s) are already configured; choose skip, replace or a new name for each`,
                    conflicts: planned.unresolved
                }));
                return true;
            }

            if (planned.invalid.length > 0) {
                sendJson(res, 400, maskDeep({
                    error: planned.invalid.map(item => item.error).join("; "),
                    invalid: planned.invalid
                }));
                return true;
            }

            for (const item of planned.writes) {
                await runtime.policyEngine.enforce("mcp_add", { name: item.name, ...item.definition }, "web_console");
            }

            const file =
                planned.writes.length > 0
                    ? importer.write(target, manager().workspaceRoot || manager().boundRoot, planned.writes)
                    : null;

            if (file) await reload();

            sendJson(res, 200, maskDeep({
                ok: true,
                target,
                path: file,
                added: planned.writes.filter(item => !item.replaced).map(item => item.name),
                replaced: planned.writes.filter(item => item.replaced).map(item => item.name),
                skipped: planned.skipped
            }));

        } catch (error) {
            fail(error);
        }

        return true;
    }

    /* ---------------------------------------------- P4-07 per-tool control */

    const controlled = serverSegment(pathname, "/controls");

    if (controlled && (method === "PATCH" || method === "POST")) {

        if (requireAdmin()) return true;
        if (!managementAllowed()) return true;

        try {

            const body = await readBody(req);

            if (!manager().client(controlled)) {
                throw Object.assign(new Error(`unknown MCP server: ${controlled}`), { status: 404 });
            }

            const patch = {};

            for (const field of ["disabled_tools", "approval", "agents", "projects"]) {
                if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = body[field];
            }

            if (typeof body.tool === "string") {
                patch.tool = body.tool;
                patch.enabled = body.enabled !== false;
            }

            if (Object.keys(patch).length === 0) {
                throw new Error("nothing to change: send {tool, enabled}, disabled_tools, approval, agents or projects");
            }

            await runtime.policyEngine.enforce("mcp_add", { name: controlled, controls: patch }, "web_console");

            const saved = overrides.set(controlled, patch);

            await reload();

            const client = manager().client(controlled);

            sendJson(res, 200, maskDeep({ ok: true, server: controlled, overrides: saved, status: client ? client.describe() : null }));

        } catch (error) {
            fail(error);
        }

        return true;
    }

    /* ------------------------------------------------------- P4-08 OAuth */

    if (pathname === "/api/mcp/oauth/callback" && method === "GET") {

        const params = Object.fromEntries(url.searchParams.entries());

        try {

            const done = await oauth.complete(params);

            /* the next call uses the new token: reconnect now */
            const client = manager().client(done.server);

            if (client && typeof client.reconnectNow === "function") {
                await client.reconnectNow().catch(() => {});
                await toolRuntime.discoverMcpTools({ force: true }).catch(() => {});
            } else {
                await reload();
            }

            callbackPage(res, true, `"${done.server}" is connected. Its token refreshes by itself from now on.`, done.server);

        } catch (error) {
            callbackPage(res, false, error.message, error.server);
        }

        return true;
    }

    const signingIn = serverSegment(pathname, "/oauth/start");

    if (signingIn && method === "POST") {

        if (requireAdmin()) return true;

        try {

            const client = manager().client(signingIn);

            if (!client) throw Object.assign(new Error(`unknown MCP server: ${signingIn}`), { status: 404 });

            const config = client.config.oauth ? client.config : { ...client.config, oauth: {} };
            const started = await oauth.start(config, {
                requestBase: requestBase(
                    req,
                    runtime.settings && typeof runtime.settings.get === "function"
                        ? runtime.settings.get("TRUSTED_PROXIES")
                        : ""
                )
            });

            sendJson(res, 200, { ok: true, ...started, state: undefined });

        } catch (error) {
            fail(error);
        }

        return true;
    }

    const signingOut = serverSegment(pathname, "/oauth/signout");

    if (signingOut && method === "POST") {

        if (requireAdmin()) return true;

        const body = await readBody(req).catch(() => ({}));

        sendJson(res, 200, { ok: true, ...oauth.signOut(signingOut, { forgetClient: body.forget_client === true }) });
        return true;
    }

    /* -------------------------------------------------- P4-10 elicitation */

    if (pathname === "/api/mcp/elicitations" && method === "GET") {

        if (requireUnscoped("project:write")) return true;

        sendJson(res, 200, { elicitations: interactions.pending() });
        return true;
    }

    if (pathname.startsWith("/api/mcp/elicitations/") && method === "POST") {

        if (requireUnscoped("project:write")) return true;

        try {
            const id = decodeURIComponent(pathname.slice("/api/mcp/elicitations/".length));
            const body = await readBody(req);
            sendJson(res, 200, { ok: true, ...interactions.answer(id, body) });
        } catch (error) {
            fail(error);
        }

        return true;
    }

    /* ------------------------------------------- P4-10 resources, prompts */

    const withResources = serverSegment(pathname, "/resources");

    if (withResources && method === "GET") {

        if (requireUnscoped("project:read")) return true;

        try {
            const client = manager().usableClient(withResources, { agent: "web_console" });
            const uri = url.searchParams.get("uri");

            if (uri) {
                sendJson(res, 200, maskDeep({ server: withResources, uri, contents: await client.readResource(uri) }));
            } else {
                const [resources, templates] = await Promise.all([client.listResources(), client.listResourceTemplates()]);
                sendJson(res, 200, maskDeep({ server: withResources, resources, templates }));
            }
        } catch (error) {
            fail(error);
        }

        return true;
    }

    /* every ready server's prompts at once: the composer's / commands */
    if (pathname === "/api/mcp/prompts" && method === "GET") {

        if (requireUnscoped("project:read")) return true;

        const clients = manager().activeClients().filter(client =>
            client.config.enabled !== false &&
            client.state === "ready" &&
            client.capabilities && client.capabilities.prompts &&
            (!Array.isArray(client.config.agents) || client.config.agents.length === 0)
        );

        const lists = await Promise.all(clients.map(async client => {
            try {
                return (await client.listPrompts()).map(prompt => ({
                    server: client.name,
                    name: prompt.name,
                    description: prompt.description || "",
                    arguments: Array.isArray(prompt.arguments) ? prompt.arguments : []
                }));
            } catch {
                return [];
            }
        }));

        sendJson(res, 200, maskDeep({ prompts: lists.flat() }));
        return true;
    }

    const withPrompts = serverSegment(pathname, "/prompts");

    if (withPrompts && method === "GET") {

        if (requireUnscoped("project:read")) return true;

        try {
            const client = manager().usableClient(withPrompts, { agent: "web_console" });
            sendJson(res, 200, maskDeep({ server: withPrompts, prompts: await client.listPrompts() }));
        } catch (error) {
            fail(error);
        }

        return true;
    }

    const promptMatch = /^\/api\/mcp\/([^/]+)\/prompts\/([^/]+)$/.exec(pathname);

    if (promptMatch && method === "POST") {

        if (requireUnscoped("project:read")) return true;

        try {
            const server = decodeURIComponent(promptMatch[1]);
            const name = decodeURIComponent(promptMatch[2]);
            const body = await readBody(req);
            const client = manager().usableClient(server, { agent: "web_console" });
            const values = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
            const result = await client.getPrompt(name, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])));
            const messages = require("../../../agent/tools/mcp/McpProtocolTools").renderPrompt(result);

            sendJson(res, 200, maskDeep({
                server,
                prompt: name,
                description: result && result.description,
                messages,
                /* what the composer receives when a prompt is used as a command */
                text: messages.filter(message => typeof message.text === "string").map(message => message.text).join("\n\n")
            }));
        } catch (error) {
            fail(error);
        }

        return true;
    }

    /* ---------------------------------------------------- P4-12 registry */

    if (pathname === "/api/mcp/registry" && method === "GET") {

        if (requireAdmin()) return true;

        try {
            sendJson(res, 200, await registryClient.search(url.searchParams.get("q") || "", {
                cursor: url.searchParams.get("cursor"),
                limit: Number(url.searchParams.get("limit")) || 20
            }));
        } catch (error) {
            fail(error, 502);
        }

        return true;
    }

    if (pathname === "/api/mcp/registry/server" && method === "GET") {

        if (requireAdmin()) return true;

        try {
            const server = await registryClient.get(url.searchParams.get("name") || "", url.searchParams.get("version") || "latest");
            sendJson(res, 200, { server, warning: registryClient.TRUST_WARNING });
        } catch (error) {
            fail(error, 502);
        }

        return true;
    }

    if (pathname === "/api/mcp/registry/add" && method === "POST") {

        if (requireAdmin()) return true;
        if (!managementAllowed()) return true;

        try {

            const body = await readBody(req);

            if (body.acknowledge_untrusted !== true) {
                sendJson(res, 428, {
                    error: "confirm that you trust this server's publisher (acknowledge_untrusted: true)",
                    warning: registryClient.TRUST_WARNING
                });
                return true;
            }

            const server = await registryClient.get(String(body.name || ""), body.version || "latest");
            const localName = String(body.server_name || registryClient.localName(server.name));
            const validator = require("../../../agent/mcp/McpConfigValidator");

            if (!validator.NAME_PATTERN.test(localName)) {
                throw new Error(`"${localName}" is not a usable server name`);
            }

            if (manager().client(localName)) {
                sendJson(res, 409, { error: `a server called "${localName}" is already configured; give this one another name (server_name)`, conflict: localName });
                return true;
            }

            /* secret inputs go to the secret store; the file keeps a reference */
            const secretStore = require("../../../agent/secrets/SecretStore");
            const inputs = { ...(body.inputs || {}) };
            const secretInputs = [
                ...server.packages.flatMap(item => item.env),
                ...server.remotes.flatMap(item => item.headers)
            ].filter(input => input.secret);

            for (const input of secretInputs) {
                const value = inputs[input.name];
                if (typeof value === "string" && value !== "" && !/^\$\{secret:/.test(value)) {
                    const secret = `${localName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${input.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`.slice(0, 64);
                    secretStore.set(secret, value);
                    inputs[input.name] = `\${secret:${secret}}`;
                }
            }

            const { definition, missing } = registryClient.definitionFor(server, { choice: body.choice || null, inputs });

            if (missing.length > 0) {
                sendJson(res, 400, {
                    error: `this server needs: ${missing.map(input => input.name).join(", ")}`,
                    missing
                });
                return true;
            }

            const stored = {
                ...definition,
                trust: body.trust === "default" ? undefined : "restricted",
                ...(body.scope === "project" && body.project_id ? { scope: "project", projects: [String(body.project_id)] } : {})
            };

            delete stored.registry;
            stored.description = `${definition.description} (MCP registry: ${server.name}@${server.version})`.slice(0, 400);

            /* checked as it will be loaded */
            validator.normalizeOne(localName, stored, manager().workspaceRoot || process.cwd(), { secrets: true, expandSecrets: false });

            await runtime.policyEngine.enforce("mcp_add", { name: localName, ...stored }, "web_console");

            const file = require("../../../agent/mcp/McpConfigLoader").writeUserServer(localName, JSON.parse(JSON.stringify(stored)));

            await reload();

            sendJson(res, 200, maskDeep({ ok: true, server: localName, registry_name: server.name, version: server.version, path: file, definition: stored }));

        } catch (error) {
            fail(error);
        }

        return true;
    }

    return false;
};
