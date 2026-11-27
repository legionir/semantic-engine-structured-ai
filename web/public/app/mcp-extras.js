/*
|--------------------------------------------------------------------------
| MCP panel, roadmap group 6 (P4-05 … P4-12): state and actions
|--------------------------------------------------------------------------
|
| What the MCP modal gained with the MCP completion work: per-tool
| switches, read / write approval and OAuth sign-in (P4-07, P4-08), the
| resources and prompts of a server (P4-10), importing another client's
| config (P4-05) and the MCP registry (P4-12). The views are in
| mcp-extras-view.js; prompts as commands and a server's questions to the
| operator (elicitation) in mcp-commands.js.
|
| Pure helpers (importSummary, approvalLabel, progressLabel,
| registryInputs) are exported for the UI tests.
|--------------------------------------------------------------------------
*/

import { request, runPromptCommand } from "./mcp-commands.js";


/* ----------------------------------------------------------- helpers */

export function approvalLabel(value) {

    return { always: "ask every time", never: "never ask", inherit: "like other tools" }[value] || "like other tools";
}


export function progressLabel(progress) {

    if (!progress) return "";

    const amount = Number.isFinite(progress.total) && progress.total > 0
        ? `${Math.round((progress.progress / progress.total) * 100)}%`
        : `${progress.progress}`;

    return progress.message ? `${amount} · ${progress.message}` : amount;
}


export function importSummary(preview) {

    const entries = (preview && preview.entries) || [];
    const count = status => entries.filter(entry => entry.status === status).length;

    return {
        total: entries.length,
        fresh: count("new"),
        identical: count("identical"),
        conflicts: count("conflict"),
        invalid: count("invalid"),
        client: (preview && preview.client) || null
    };
}


/* what a registry server needs before it can be added */
export function registryInputs(server, choice = null) {

    if (!server) return [];

    const pick =
        (choice && [...(server.packages || []), ...(server.remotes || [])].find(item => item.choice === choice)) ||
        (server.packages || []).find(item => ["npm", "pypi", "oci"].includes(item.registryType) && item.transport === "stdio") ||
        (server.remotes || [])[0];

    if (!pick) return [];

    return pick.env || pick.headers || [];
}


/* ------------------------------------------------------------- state */

export function createMcpExtrasState() {

    return {
        expanded: new Set(),
        browsing: null,            /* {server, kind, items, templates, error, reading} */
        imports: { text: "", target: "user", preview: null, error: null, notice: "", busy: false, resolutions: {} },
        registry: { query: "", results: null, error: null, busy: false, picked: null, acknowledged: false, inputs: {}, notice: "", cursor: null }
    };
}


/* ------------------------------------------------------------- actions */

export function createExtrasActions({ state, touch, refreshMcp }) {

    const extras = () => {
        if (!state.mcp.extras) state.mcp.extras = createMcpExtrasState();
        return state.mcp.extras;
    };

    const rowError = (server, message) => {
        if (message) state.mcp.rowErrors.set(server, message);
        else state.mcp.rowErrors.delete(server);
        touch("mcp");
    };

    const controls = async (server, body) => {
        state.mcp.pending.add(server);
        touch("mcp");
        const result = await request(`/api/mcp/${encodeURIComponent(server)}/controls`, { method: "PATCH", body: JSON.stringify(body) });
        state.mcp.pending.delete(server);
        rowError(server, result.ok ? null : result.error);
        if (result.ok) await refreshMcp(false);
    };

    return {

        expand(server) {
            const open = extras().expanded;
            if (open.has(server)) open.delete(server);
            else open.add(server);
            touch("mcp");
        },

        toolEnabled(server, tool, enabled) {
            return controls(server, { tool, enabled });
        },

        approval(server, kind, value, current) {
            return controls(server, { approval: { ...(current || { read: "inherit", write: "inherit" }), [kind]: value } });
        },

        async signIn(server) {

            rowError(server, null);

            /* opened first, so the browser does not treat it as a pop-up */
            const popup = window.open("about:blank", "mcp-oauth", "width=520,height=720");
            const result = await request(`/api/mcp/${encodeURIComponent(server)}/oauth/start`, { method: "POST", body: "{}" });

            if (!result.ok) {
                if (popup) popup.close();
                rowError(server, result.error);
                return;
            }

            if (popup) popup.location.href = result.payload.authorization_url;
            else window.location.assign(result.payload.authorization_url);
        },

        async signOut(server) {
            const result = await request(`/api/mcp/${encodeURIComponent(server)}/oauth/signout`, { method: "POST", body: "{}" });
            rowError(server, result.ok ? null : result.error);
            await refreshMcp(false);
        },

        async browse(server, kind) {

            const box = extras();

            if (box.browsing && box.browsing.server === server && box.browsing.kind === kind) {
                box.browsing = null;
                touch("mcp");
                return;
            }

            box.browsing = { server, kind, items: null, templates: [], error: null, reading: null };
            touch("mcp");

            const result = await request(`/api/mcp/${encodeURIComponent(server)}/${kind}`);

            if (!box.browsing || box.browsing.server !== server) return;

            if (!result.ok) box.browsing.error = result.error;
            else if (kind === "resources") {
                box.browsing.items = result.payload.resources || [];
                box.browsing.templates = result.payload.templates || [];
            } else box.browsing.items = result.payload.prompts || [];

            touch("mcp");
        },

        async readResource(server, uri) {

            const box = extras();
            const result = await request(`/api/mcp/${encodeURIComponent(server)}/resources?uri=${encodeURIComponent(uri)}`);

            if (!box.browsing) return;

            box.browsing.reading = result.ok
                ? { uri, text: (result.payload.contents || []).map(item => item.text || `[${item.mimeType || "binary"} content]`).join("\n\n") }
                : { uri, text: result.error };

            touch("mcp");
        },

        usePrompt(server, prompt) {
            return runPromptCommand({ server, name: prompt.name, description: prompt.description, arguments: prompt.arguments || [] });
        },

        /* P4-05 */

        importText(text) {
            extras().imports.text = text;
        },

        importTarget(target) {
            extras().imports.target = target === "workspace" ? "workspace" : "user";
            touch("mcp");
        },

        resolution(name, value) {
            extras().imports.resolutions[name] = value;
            touch("mcp");
        },

        async previewImport() {

            const box = extras().imports;

            box.busy = true;
            box.error = null;
            box.notice = "";
            touch("mcp");

            const result = await request("/api/mcp/import/preview", { method: "POST", body: JSON.stringify({ text: box.text }) });

            box.busy = false;
            box.preview = result.ok ? result.payload : null;
            box.error = result.ok ? null : result.error;
            box.resolutions = {};
            touch("mcp");
        },

        async runImport() {

            const box = extras().imports;

            box.busy = true;
            box.error = null;
            touch("mcp");

            const result = await request("/api/mcp/import", {
                method: "POST",
                body: JSON.stringify({ text: box.text, target: box.target, resolutions: box.resolutions })
            });

            box.busy = false;

            if (!result.ok) {
                box.error = result.status === 409
                    ? "Some servers already exist: choose what to do with each one above."
                    : result.error;
                touch("mcp");
                return;
            }

            const added = [...(result.payload.added || []), ...(result.payload.replaced || [])];
            box.notice = added.length ? `Imported: ${added.join(", ")}.` : "Nothing to import.";
            box.preview = null;
            box.text = "";
            touch("mcp");

            await refreshMcp(false);
        },

        /* P4-12 */

        registryQuery(query) {
            extras().registry.query = query;
        },

        async searchRegistry(more = false) {

            const box = extras().registry;
            const params = new URLSearchParams({ q: box.query.trim() });

            if (more && box.cursor) params.set("cursor", box.cursor);

            box.busy = true;
            box.error = null;
            touch("mcp");

            const result = await request(`/api/mcp/registry?${params}`);

            box.busy = false;

            if (!result.ok) {
                box.error = result.error;
            } else {
                box.results = more && box.results ? [...box.results, ...result.payload.servers] : result.payload.servers;
                box.cursor = result.payload.next_cursor || null;
            }

            touch("mcp");
        },

        pickRegistry(server) {
            const box = extras().registry;
            box.picked = box.picked && box.picked.name === server.name ? null : server;
            box.inputs = {};
            box.acknowledged = false;
            box.notice = "";
            box.error = null;
            touch("mcp");
        },

        registryInput(name, value) {
            extras().registry.inputs[name] = value;
        },

        acknowledge(value) {
            extras().registry.acknowledged = value === true;
            touch("mcp");
        },

        async addFromRegistry() {

            const box = extras().registry;

            if (!box.picked) return;

            box.busy = true;
            box.error = null;
            touch("mcp");

            const result = await request("/api/mcp/registry/add", {
                method: "POST",
                body: JSON.stringify({ name: box.picked.name, inputs: box.inputs, acknowledge_untrusted: box.acknowledged })
            });

            box.busy = false;

            if (!result.ok) {
                box.error = result.error;
                touch("mcp");
                return;
            }

            box.notice = `Added "${result.payload.server}". It starts restricted: every call asks for approval.`;
            box.picked = null;
            box.inputs = {};
            touch("mcp");

            await refreshMcp(false);
        }
    };
}
