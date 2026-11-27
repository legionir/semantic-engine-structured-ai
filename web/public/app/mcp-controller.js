/*
|--------------------------------------------------------------------------
| MCP servers
|--------------------------------------------------------------------------
|
| Every MCP action reports its outcome: a refused toggle or removal is
| shown on its row, a failed connect in the form, a failed save under the
| editor. The list only changes when the server says it did.
*/

import { state, touch } from "./store.js";
import { mountInModal } from "./dom.js";
import { connectBody, createMcpState, McpBody, mcpSubtitle } from "./mcp-view.js";
import { createCatalogActions } from "./mcp-catalog-controller.js";
import { createExtrasActions } from "./mcp-extras.js";
import { handleMcpEvent } from "./mcp-commands.js";
import { apiFetch } from "./auth-transport.js";


async function mcpRequest(url, options = {}) {

    let response;

    try {
        response = await apiFetch(url, options);
    } catch (error) {
        return { ok: false, error: error.message || "network error" };
    }

    const payload = await response.json().catch(() => ({}));

    return response.ok
        ? { ok: true, payload }
        : { ok: false, error: payload.error || `request failed (${response.status})` };
}


async function refreshMcp(force = false) {

    const mcp = state.mcp;
    if (mcp && !mcp.payload) {
        mcp.loading = true;
        mcp.error = null;
        touch("mcp");
    }

    const result = await mcpRequest(`/api/mcp${force ? "?refresh=1" : ""}`);

    if (state.mcp !== mcp) return false;

    mcp.loading = false;

    if (!result.ok || !result.payload || typeof result.payload !== "object") {
        mcp.error = result.error || "The MCP servers could not be loaded.";
        state.mcpModal?.setSubtitle(mcp.payload ? mcpSubtitle(mcp.payload) : "unavailable");
        touch("mcp");
        return false;
    }

    mcp.error = null;
    mcp.payload = {
        ...result.payload,
        servers: Array.isArray(result.payload.servers) ? result.payload.servers : []
    };

    state.mcpModal?.setSubtitle(mcpSubtitle(mcp.payload));
    touch("mcp");

    return true;
}


async function loadMcpConfig() {

    const mcp = state.mcp;
    if (mcp) {
        mcp.configLoading = true;
        touch("mcp");
    }

    const result = await mcpRequest(mcp.configTarget === "user" ? "/api/mcp/config?target=user" : "/api/mcp/config");

    if (state.mcp !== mcp) return;

    mcp.configLoading = false;
    mcp.configNotice = "";

    if (result.ok) {
        mcp.configText = result.payload.text || '{\n  "mcpServers": {}\n}\n';
        mcp.configPath = result.payload.path || "";
        mcp.configError = null;
        mcp.configKey++;
    } else {
        mcp.configError = result.error;
    }

    touch("mcp");
}


async function mcpServerAction(server, url, options) {

    const mcp = state.mcp;

    mcp.pending.add(server.name);
    mcp.rowErrors.delete(server.name);
    touch("mcp");

    const result = await mcpRequest(url, options);

    mcp.pending.delete(server.name);

    if (!result.ok) {
        mcp.rowErrors.set(server.name, result.error);
    }

    touch("mcp");

    if (result.ok) {
        await refreshMcp(false);
    }
}


/* P4-04: while a server is waiting to reconnect, its countdown moves */
let reconnectTicker = null;

function watchReconnects() {

    clearInterval(reconnectTicker);

    reconnectTicker = setInterval(() => {

        if (!state.mcpModal || !state.mcp?.payload) {
            clearInterval(reconnectTicker);
            reconnectTicker = null;
            return;
        }

        const waiting = (state.mcp.payload.servers || []).some(server => server.state === "reconnecting" || server.state === "connecting");

        if (waiting && state.mcp.tab === "servers") {
            void refreshMcp(false);
        }
    }, 2000);
}


const { loadCatalog, loadSecrets, currentProject, ...catalogActions } =
    createCatalogActions({ mcpRequest, refreshMcp });


const extrasActions = createExtrasActions({ state, touch, refreshMcp });


/* the stream's mcp:* events (stream-controller): progress, questions, sign-ins */
export function onMcpEvent(event) {

    if (!state.mcp) state.mcp = createMcpState();

    return handleMcpEvent(event, { state, touch, refreshMcp });
}


const mcpActions = {

    tab(tab) {
        state.mcp.tab = tab;
        touch("mcp");
        if (tab === "catalog" && !state.mcp.catalog) void loadCatalog();
        if (tab === "secrets") void loadSecrets();
    },

    retry() {
        return Promise.all([refreshMcp(false), loadMcpConfig()]);
    },

    reconnect(server) {
        return mcpServerAction(server, `/api/mcp/${encodeURIComponent(server.name)}/reconnect`, { method: "POST" });
    },

    ...catalogActions,

    ...extrasActions,

    async configTarget(target) {
        state.mcp.configTarget = target === "user" ? "user" : "workspace";
        state.mcp.configNotice = "";
        await loadMcpConfig();
    },

    transport(value) {
        state.mcp.transport = value;
        touch("mcp");
    },

    addHeaderRow() {
        const rows = Array.isArray(state.mcp.customHeaders) ? state.mcp.customHeaders : [];
        const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
        state.mcp.customHeaders = [...rows, { id: nextId, name: "", value: "" }];
        touch("mcp");
    },

    updateHeaderRow(index, field, value) {
        const rows = Array.isArray(state.mcp.customHeaders) ? state.mcp.customHeaders : [];
        if (!rows[index]) return;
        rows[index] = { ...rows[index], [field]: value };
    },

    removeHeaderRow(index) {
        const rows = Array.isArray(state.mcp.customHeaders) ? state.mcp.customHeaders : [];
        state.mcp.customHeaders = rows.filter((_, i) => i !== index);
        touch("mcp");
    },

    toggle(server) {
        return mcpServerAction(server, `/api/mcp/${encodeURIComponent(server.name)}/enabled`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: !server.enabled })
        });
    },

    remove(server) {
        return mcpServerAction(server, `/api/mcp/${encodeURIComponent(server.name)}`, { method: "DELETE" });
    },

    async connect(form) {

        const mcp = state.mcp;
        const body = connectBody(form);

        if (!body.name) {
            mcp.formMessage = "a server needs a name";
            touch("mcp");
            return;
        }

        mcp.connecting = true;
        mcp.formMessage = "connecting…";
        touch("mcp");

        const result = await mcpRequest("/api/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        });

        mcp.connecting = false;

        if (!result.ok) {
            mcp.formMessage = result.error;
            touch("mcp");
            return;
        }

        /* a new form: the fields are empty again, the transport stays */
        mcp.formMessage = "";
        mcp.customHeaders = [{ id: 1, name: "", value: "" }];
        mcp.formKey++;
        touch("mcp");

        await refreshMcp(false);
    },

    async save(text) {

        const mcp = state.mcp;
        let parsed;

        try {
            parsed = JSON.parse(text);
        } catch (error) {
            mcp.configError = `Invalid JSON: ${error.message}`;
            touch("mcp");
            return;
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            mcp.configError = "MCP config must be a JSON object.";
            touch("mcp");
            return;
        }

        mcp.saving = true;
        mcp.configError = null;
        mcp.configNotice = "Saving…";
        touch("mcp");

        const result = await mcpRequest(mcp.configTarget === "user" ? "/api/mcp/config?target=user" : "/api/mcp/config", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text })
        });

        mcp.saving = false;

        if (!result.ok) {
            mcp.configError = result.error;
            mcp.configNotice = "";
            touch("mcp");
            return;
        }

        /* the buffer already holds this text; it is not remounted */
        mcp.configText = text;
        mcp.configPath = result.payload.path || mcp.configPath;
        mcp.configNotice = "Saved. MCP servers are reloading.";
        touch("mcp");

        await refreshMcp(false);
    }
};


export function openMcp() {

    if (state.mcpModal && state.mcpModal.isOpen()) {
        return state.mcpModal;
    }

    /* each opening starts from what the server says now, but the modal opens immediately */
    state.mcp = {
        ...createMcpState(),
        loading: true,
        configLoading: true,
        tab: state.mcp?.tab || "servers",
        progress: state.mcp?.progress || new Map()
    };

    let dispose = () => {};

    const handle = Modal.open({
        title: "MCP servers",
        subtitle: "Loading…",
        size: "medium",
        footer: Modal.row(
            Modal.button("Reconnect all", "ghost", () => refreshMcp(true)),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            dispose();
            state.mcpModal = null;
            clearInterval(reconnectTicker);
            reconnectTicker = null;
        }
    });

    state.mcpModal = handle;

    dispose = mountInModal(handle, () => McpBody({ mcp: state.mcp, actions: mcpActions, project: currentProject() }), ["mcp"]);

    watchReconnects();

    void Promise.all([refreshMcp(false), loadMcpConfig()]);
    if (state.mcp.tab === "catalog") void loadCatalog();
    if (state.mcp.tab === "secrets") void loadSecrets();

    return handle;
}


/*
| Discussion
| ----------
| The form starts a discussion; while it runs, the same event stream
| the delegation tree uses paints the rounds into the modal as they
| happen. The final report is the only part the observer guarantees,
| so it gets its own section once discussion:finish lands.
*/
