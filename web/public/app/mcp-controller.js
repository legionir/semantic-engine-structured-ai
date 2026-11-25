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
import { notifyError } from "./console-core.js";


async function mcpRequest(url, options = {}) {

    let response;

    try {
        response = await fetch(url, options);
    } catch (error) {
        return { ok: false, error: error.message || "network error" };
    }

    const payload = await response.json().catch(() => ({}));

    return response.ok
        ? { ok: true, payload }
        : { ok: false, error: payload.error || `request failed (${response.status})` };
}


async function refreshMcp(force = false) {

    const result = await mcpRequest(`/api/mcp${force ? "?refresh=1" : ""}`);

    if (!result.ok || !result.payload || typeof result.payload !== "object") {
        return false;
    }

    state.mcp.payload = {
        ...result.payload,
        servers: Array.isArray(result.payload.servers) ? result.payload.servers : []
    };

    state.mcpModal?.setSubtitle(mcpSubtitle(state.mcp.payload));
    touch("mcp");

    return true;
}


async function loadMcpConfig() {

    const mcp = state.mcp;
    const result = await mcpRequest("/api/mcp/config");

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


const mcpActions = {

    tab(tab) {
        state.mcp.tab = tab;
        touch("mcp");
    },

    transport(value) {
        state.mcp.transport = value;
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

        const result = await mcpRequest("/api/mcp/config", {
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


export async function openMcp() {

    if (state.mcpModal && state.mcpModal.isOpen()) {
        return state.mcpModal;
    }

    if (state.mcpOpening) {
        return null;
    }

    state.mcpOpening = true;

    /* each opening starts from what the server says now */
    state.mcp = { ...createMcpState(), tab: state.mcp?.tab || "servers" };

    const loaded = await refreshMcp(false);

    if (!loaded) {
        state.mcpOpening = false;
        notifyError("The MCP servers could not be loaded.");
        return null;
    }

    await loadMcpConfig();

    let dispose = () => {};

    const handle = Modal.open({
        title: "MCP servers",
        subtitle: mcpSubtitle(state.mcp.payload),
        size: "medium",
        footer: Modal.row(
            Modal.button("Reconnect all", "ghost", () => refreshMcp(true)),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            dispose();
            state.mcpModal = null;
        }
    });

    state.mcpModal = handle;
    state.mcpOpening = false;

    dispose = mountInModal(handle, () => McpBody({ mcp: state.mcp, actions: mcpActions }), ["mcp"]);

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
