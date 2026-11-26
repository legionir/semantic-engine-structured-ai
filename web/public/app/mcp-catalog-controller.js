/*
|--------------------------------------------------------------------------
| MCP catalogue and secrets (roadmap P4-01 … P4-03)
|--------------------------------------------------------------------------
|
| Loading the catalogue and the secret names, activating and
| deactivating an entry, following a one-click install and saving or
| deleting a secret. Each outcome lands in state.mcp and is drawn by
| mcp-catalog-view; a failure is shown where the action was taken.
*/

import { state, touch } from "./store.js";


export function createCatalogActions({ mcpRequest, refreshMcp }) {

    /* P4-02: the catalogue, with each entry's prerequisites and installs */
    async function loadCatalog() {

        const mcp = state.mcp;
        const result = await mcpRequest("/api/mcp/catalog");

        if (result.ok) {
            mcp.catalog = result.payload;
            mcp.catalogError = null;
        } else {
            mcp.catalogError = result.error;
        }

        touch("mcp");
    }


    /* P4-01: names and dates only */
    async function loadSecrets() {

        const mcp = state.mcp;
        const result = await mcpRequest("/api/secrets");

        if (result.ok) {
            mcp.secrets = Array.isArray(result.payload.secrets) ? result.payload.secrets : [];
            mcp.secretsError = null;
        } else {
            mcp.secretsError = result.error;
        }

        touch("mcp");
    }


    function jsonPost(body, method = "POST") {

        return {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body || {})
        };
    }


    function currentProject() {

        return (state.projects || []).find(project => project.id === state.currentProjectId) || null;
    }


    /* P4-03: poll a one-click install until it settles */
    async function followInstall(id) {

        const mcp = state.mcp;

        for (;;) {

            await new Promise(resolve => setTimeout(resolve, 1000));

            if (state.mcp !== mcp) return;

            const result = await mcpRequest(`/api/mcp/prerequisites/${encodeURIComponent(id)}/install`);

            if (!result.ok) {
                mcp.installs.set(id, { status: "failed", error: result.error, percent: 0 });
                touch("mcp");
                return;
            }

            if (result.payload.job) {
                mcp.installs.set(id, result.payload.job);
            }

            touch("mcp");

            if (!result.payload.job || result.payload.job.status !== "running") {
                await loadCatalog();
                return;
            }
        }
    }


    return {

        loadCatalog,
        loadSecrets,
        currentProject,

        filter(text) {
            state.mcp.catalogFilter = text;
            touch("mcp");
        },

        forgetSecrets(value) {
            state.mcp.forgetSecrets = Boolean(value);
            touch("mcp");
        },

        openEntry(entry) {
            const mcp = state.mcp;
            mcp.activeEntry = entry.id;
            mcp.activationKey++;
            mcp.activation = { busy: false, error: null, result: null, missing: null };
            mcp.entryErrors.delete(entry.id);
            touch("mcp");
        },

        closeEntry() {
            state.mcp.activeEntry = null;
            touch("mcp");
        },

        async activate(entry, form) {

            const mcp = state.mcp;
            const inputs = {};

            for (const input of entry.inputs) {
                const value = String(form.elements.namedItem(input.id)?.value ?? "");
                if (value.trim() !== "") inputs[input.id] = value.trim();
            }

            const scope = String(form.elements.namedItem("scope")?.value || "global");
            const project = currentProject();

            mcp.activation = { busy: true, error: null, result: null, missing: null };
            touch("mcp");

            const result = await mcpRequest(`/api/mcp/catalog/${encodeURIComponent(entry.id)}/activate`, jsonPost({
                inputs,
                scope,
                project_id: scope === "project" && project ? project.id : undefined
            }));

            if (!result.ok) {
                mcp.activation = { busy: false, error: result.error, result: null, missing: null };
                touch("mcp");
                return;
            }

            mcp.activation = { busy: false, error: null, result: result.payload, missing: null };
            mcp.activeEntry = null;
            touch("mcp");

            await Promise.all([loadCatalog(), refreshMcp(false)]);
        },

        async deactivate(entry, install) {

            const mcp = state.mcp;
            const project = currentProject();

            mcp.deactivating.add(install.name);
            mcp.entryErrors.delete(entry.id);
            touch("mcp");

            const result = await mcpRequest(`/api/mcp/catalog/${encodeURIComponent(install.name)}/deactivate`, jsonPost({
                forget_secrets: mcp.forgetSecrets,
                project_id: install.scope === "project" && project ? project.id : undefined
            }));

            mcp.deactivating.delete(install.name);

            if (!result.ok) {
                mcp.entryErrors.set(entry.id, result.error);
            } else if (mcp.activation.result?.server === install.name) {
                mcp.activation = { busy: false, error: null, result: null, missing: null };
            }

            touch("mcp");

            await Promise.all([loadCatalog(), refreshMcp(false)]);
        },

        async install(id) {

            const mcp = state.mcp;

            mcp.installs.set(id, { status: "running", percent: 0, phase: "starting" });
            touch("mcp");

            const result = await mcpRequest(`/api/mcp/prerequisites/${encodeURIComponent(id)}/install`, jsonPost({}));

            if (!result.ok) {
                mcp.installs.set(id, { status: "failed", percent: 0, error: result.error });
                touch("mcp");
                return;
            }

            mcp.installs.set(id, result.payload.job);
            touch("mcp");

            await followInstall(id);
        },

        async saveSecret(form) {

            const mcp = state.mcp;
            const name = String(form.elements.namedItem("name")?.value ?? "").trim();
            const value = String(form.elements.namedItem("value")?.value ?? "");

            if (!name || !value) {
                mcp.secretMessage = "a secret needs a name and a value";
                touch("mcp");
                return;
            }

            mcp.secretBusy = true;
            mcp.secretMessage = "saving…";
            touch("mcp");

            const result = await mcpRequest(`/api/secrets/${encodeURIComponent(name)}`, jsonPost({ value }, "PUT"));

            mcp.secretBusy = false;

            if (!result.ok) {
                mcp.secretMessage = result.error;
                touch("mcp");
                return;
            }

            /* a new form: the value is gone from the page */
            mcp.secretMessage = `${result.payload.name} saved`;
            mcp.secretKey++;
            touch("mcp");

            await loadSecrets();
        },

        async deleteSecret(secret) {

            const mcp = state.mcp;

            mcp.secretBusy = true;
            touch("mcp");

            const result = await mcpRequest(`/api/secrets/${encodeURIComponent(secret.name)}`, { method: "DELETE" });

            mcp.secretBusy = false;
            mcp.secretMessage = result.ok ? `${secret.name} deleted` : result.error;
            touch("mcp");

            await loadSecrets();
        }
    };
}
