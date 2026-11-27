/*
|--------------------------------------------------------------------------
| Settings
|--------------------------------------------------------------------------
|
| The Settings and LLM settings modals, saving and resetting one setting,
| the model catalog, and the two runtime policy controls (approval mode and
| auto-continue) that the header and Settings both draw.
*/

import { state, touch } from "./store.js";
import { mountInModal } from "./dom.js";
import { APPROVAL_MODES, isLlmSetting, isModelSetting, modelCatalogConfigChanged, SettingsBody } from "./settings-view.js";
import { failureText, notifyError } from "./console-core.js";
import { apiFetch } from "./auth-transport.js";


/* one aggregate request per catalog; a failure is kept for 10 s so a
   redraw does not repeat the same upstream fan-out */
function loadModelCatalog() {

    if (state.modelCatalog && state.modelCatalog.expiresAt > Date.now()) {
        return state.modelCatalog.promise;
    }

    const entry = { expiresAt: Infinity, promise: null };
    state.modelCatalogLoading = true;
    touch("settings");

    entry.promise = apiFetch("/api/models")
        .then(async response => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Model endpoint returned HTTP ${response.status}.`);
            }
            if (!Array.isArray(payload.models) || !payload.byRole) {
                throw new Error(payload.error || "Model endpoint returned an invalid catalog.");
            }
            return payload;
        })
        .then(catalog => {
            if (state.modelCatalog === entry) {
                state.modelCatalogLoading = false;
                state.modelCatalogResult = { catalog };
                touch("settings");
            }
            return catalog;
        })
        .catch(error => {
            entry.expiresAt = Date.now() + 10_000;
            if (state.modelCatalog === entry) {
                state.modelCatalogLoading = false;
                state.modelCatalogResult = { error: error.message };
                touch("settings");
            }
            throw error;
        });

    entry.promise.catch(() => {});
    state.modelCatalog = entry;

    return entry.promise;
}


function forgetModelCatalog() {

    state.modelCatalog = null;
    state.modelCatalogResult = null;
}


function markSetting(key, kind, message = null) {

    if (kind) {
        state.settingsStatus.set(key, { kind, message });
    } else {
        state.settingsStatus.delete(key);
    }

    touch("settings");
}


async function saveSetting(setting, control) {

    const value = control.value;
    let failure = null;

    try {
        const response = await apiFetch("/api/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: setting.key, value })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            failure = payload.error || `request failed (${response.status})`;
        }
    } catch (error) {
        failure = `not saved: ${error.message || "network error"}`;
    }

    if (failure) {
        /* the field shows the value that is actually in effect again */
        control.value = setting.secret ? "" : String(setting.value ?? "");
        markSetting(setting.key, "rejected", failure);
        return;
    }

    if (setting.secret) control.value = "";
    if (modelCatalogConfigChanged(setting.key)) forgetModelCatalog();

    markSetting(setting.key, "saved");
    setTimeout(() => {
        if (state.settingsStatus.get(setting.key)?.kind === "saved") markSetting(setting.key, null);
    }, 800);

    loadSettings();
}


async function resetSetting(setting) {

    try {
        const response = await apiFetch("/api/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: setting.key, reset: true })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            markSetting(setting.key, "rejected", payload.error || `request failed (${response.status})`);
            return;
        }
    } catch (error) {
        markSetting(setting.key, "rejected", `not restored: ${error.message || "network error"}`);
        return;
    }

    if (modelCatalogConfigChanged(setting.key)) forgetModelCatalog();

    markSetting(setting.key, null);
    loadSettings();
}


export async function loadSettings() {

    if (state.settings.length === 0) {
        state.settingsLoading = true;
        touch("settings");
    }

    try {
        const response = await apiFetch("/api/settings");
        if (!response.ok) return;
        const payload = await response.json();
        if (!Array.isArray(payload.settings)) return;
        state.settings = payload.settings;
    } catch {
        /* the modal keeps the list it has; Reload tries again */
        return;
    } finally {
        state.settingsLoading = false;
    }

    touch("settings");
}


/* the body of one settings modal, drawn from the store */
function mountSettings(handle, kind) {

    const ui = { filter: "" };
    const llm = kind === "llm";

    const dispose = mountInModal(
        handle,
        () => SettingsBody({
            list: state.settings.filter(setting => isLlmSetting(setting) === llm),
            ui,
            status: state.settingsStatus,
            catalog: state.modelCatalogResult,
            loading: state.settingsLoading,
            catalogLoading: state.modelCatalogLoading,
            policy: llm ? null : {
                approvalMode: state.approvalMode,
                autoContinue: state.autoContinue,
                onApprovalMode: changeApprovalMode,
                onAutoContinue: changeAutoContinue
            },
            onFilter: value => { ui.filter = value; touch("settings"); },
            onSave: saveSetting,
            onReset: resetSetting
        }),
        ["settings", "header"],
        {},
        "settings"
    );

    if (state.settings.some(setting => isLlmSetting(setting) === llm && isModelSetting(setting))) {
        loadModelCatalog().catch(() => {});
    }

    return { dispose, ui };
}


export function openSettings() {

    if (state.settingsModal && state.settingsModal.isOpen()) {
        return;
    }

    let view = null;

    const handle = Modal.open({
        title: "Settings",
        subtitle: "applied on next use, no restart",
        size: "large",
        className: "settings-modal",
        footer: Modal.row(
            Modal.button("Reload", "ghost", () => loadSettings()),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            view?.dispose();
            state.settingsModal = null;
        }
    });

    state.settingsModal = handle;
    view = mountSettings(handle, "general");

    loadSettings();
}


export function openLlmSettings() {

    if (state.llmSettingsModal && state.llmSettingsModal.isOpen()) return;

    let view = null;

    const handle = Modal.open({
        title: "LLM settings",
        subtitle: "Providers, model layers, and proxy",
        size: "large",
        className: "settings-modal",
        footer: Modal.row(
            Modal.button("Reload", "ghost", () => loadSettings()),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            view?.dispose();
            state.llmSettingsModal = null;
        }
    });

    state.llmSettingsModal = handle;
    view = mountSettings(handle, "llm");

    loadSettings();
}


/*
| The two runtime policy controls take effect on the server. The control
| shows the new value at once and goes back to the previous one, with a
| message, if the server does not accept it.
*/
async function saveRuntimePolicy({ url, body, apply, revert, label }) {

    apply();
    touch("header");

    try {
        const response = await apiFetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            revert();
            touch("header");
            notifyError(await failureText(response, `${label} was not changed`));
        }
    } catch (error) {
        revert();
        touch("header");
        notifyError(`${label} was not changed: ${error.message || "network error"}`);
    }
}


export function changeAutoContinue(value) {

    const previous = Boolean(state.autoContinue);
    const next = Boolean(value);

    if (next === previous) return;

    saveRuntimePolicy({
        url: "/api/settings",
        body: { key: "AUTO_CONTINUE", value: next },
        apply: () => { state.autoContinue = next; },
        revert: () => { state.autoContinue = previous; },
        label: "Auto-continue"
    });
}


export function changeApprovalMode(value) {

    const previous = state.approvalMode;
    const next = String(value ?? "");

    if (next === previous || !APPROVAL_MODES.includes(next)) return;

    saveRuntimePolicy({
        url: "/api/approval-mode",
        body: { mode: next },
        apply: () => { state.approvalMode = next; },
        revert: () => { state.approvalMode = previous; },
        label: "Approval mode"
    });
}
