/*
|--------------------------------------------------------------------------
| Console api (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| Every network call the console makes, in one place.
|
| Each function is the original body, moved: no new retry, no new error shape, no
| catch that was not already there. An operator reading the console has to be able
| to read what it asked for. `eventsUrl` is here because the stream is the one
| endpoint whose URL depends on the project in focus.
|--------------------------------------------------------------------------
*/

import { applySession } from "./history-view.js";
import { renderApprovals } from "./approvals-view.js";
import { settingsBody } from "./settings-view.js";
import { renderProjectSwitcher } from "./project-switcher.js";
import { refreshGatewayHealthChip } from "./project-dashboard.js";
import { approvalState, historyState, projectState, runtimeState, settingsState } from "./store.js";

/*
| Opening a conversation replays the events it stored, so the Execution
| and Events cards are rebuilt by the same code that draws them live.
| Nothing is summarised for storage, which is why this works at all.
*/

export async function refreshSession(id) {

    const response =
        await fetch(`/api/sessions/${encodeURIComponent(id)}`);

    if (!response.ok) {
        return;
    }

    const payload =
        await response.json();

    applySession(payload.session);
}

export async function loadSession(id) {

    const response =
        await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
            method: "POST"
        });

    if (!response.ok) {
        return;
    }

    const payload =
        await response.json();

    applySession(payload.session);

    if (historyState.historyModal) {
        historyState.historyModal.close("loaded");
    }
}

export async function answerApproval(id, approved) {

    approvalState.approvals.delete(id);

    renderApprovals();

    await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved })
    });
}

export async function approveAll() {

    const ids =
        [...approvalState.approvals.keys()];

    approvalState.approvals.clear();

    renderApprovals();

    for (const id of ids) {

        await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ approved: true })
        });
    }
}

export async function loadSettings() {

    const response =
        await fetch("/api/settings");

    const payload =
        await response.json();

    settingsState.settings = payload.settings;

    if (settingsState.settingsModal && settingsState.settingsModal.isOpen()) {

        settingsState.settingsModal.setBody(settingsBody(settingsState.settings));
    }
}

export async function loadProjects() {

    try {

        const response = await fetch("/api/projects");

        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        projectState.projects = payload.projects || [];
        renderProjectSwitcher();

    } catch {
        projectState.projects = [];
    }
}

export async function loadGatewayHealth() {

    try {

        const response = await fetch("/api/health");

        if (!response.ok) {
            return;
        }

        runtimeState.gatewayHealth = await response.json();
        refreshGatewayHealthChip(runtimeState.gatewayHealth);

    } catch {
        /* health is optional */
    }
}

export function eventsUrl() {

    if (projectState.currentProjectId) {

        return `/api/events?projectId=${encodeURIComponent(projectState.currentProjectId)}`;
    }

    return "/api/events";
}
