/*
|--------------------------------------------------------------------------
| Console store (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The console's state: eleven named domains instead of one 43-key object.
|
| Nothing here is new behaviour. Every key and every initial value is the one the
| monolith's state object held, moved into the domain that owns it —
| `runtimeState` is what the run is doing, `conversationState` is what the model
| was told, `executionState` is the delegation tree and the calls it recorded. A
| module imports the domains it reads, so "which view touches which state" is an
| import list now instead of a grep over 6,170 lines.
|
| The four functions below stayed with the store because they are the only places
| those transitions are legal: `setStatus` stamps the timestamps, `resetRun` is
| what a new task does to a finished one, `pushMessage` is the single writer of
| the transcript, and `updateWaitingElapsed` owns the in-flight timer. All of them
| still redraw the header chip, exactly as they did.
|
| `test/web/frontend.contract.test.js` compares the slices against the `state"
| literal recorded from the original app.js — key set and initial values — so a
| key cannot be dropped, renamed or re-defaulted in silence.
|--------------------------------------------------------------------------
*/

import { el } from "./dom.js";
import { normalizeConversationMessage, renderChat } from "./chat.js";

/*
| The console keeps no state of its own beyond what the runtime reports:
| every box on screen is rebuilt from the event stream, so a reload
| reproduces the same picture from the snapshot.
|
| Three things are deliberately modal rather than inline, because they
| interrupt: settings, an approval request, and the full detail of one
| executed call. They share the Modal service in modal.js.
*/

export const PROJECT_STORAGE_KEY = "structured-ai.currentProjectId";

export const DASHBOARD_TABS = [
    ["overview", "Overview"],
    ["runs", "Agent Runs"],
    ["sessions", "Sessions"],
    ["memory", "Memory"],
    ["plan", "Plan"],
    ["events", "Events"],
    ["approvals", "Approvals"],
    ["semantic", "Semantic Engine"],
    ["mcp", "MCP"],
    ["logs", "Logs"],
    ["settings", "Settings"]
];

export const runtimeState = {
    currentTask: null,
    waiting: null,
    waitingElapsed: null,
    waitingTimer: null,
    status: "idle",
    startedAt: null,
    timer: null,
    eventSource: null,
    multiQueue: [],
    gatewayHealth: null
};

export const conversationState = {
    messages: [],
    session: null,
    sessions: []
};

export const executionState = {
    agents: new Map(),
    order: [],
    graphs: new Map(),
    calls: new Map(),
    loops: [],
    hooks: new Map(),
    hookOrder: [],
    executionModal: null,
    openExecutionKeys: new Set()
};

export const planState = {
    plan: null
};

export const eventState = {
    events: [],
    eventsModal: null,
    logFilter: "",
    logType: ""
};

export const approvalState = {
    approvals: new Map(),
    approvalModal: null
};

export const settingsState = {
    settingsModal: null,
    settings: []
};

export const mcpState = {
    mcpModal: null,
    mcpOpening: false
};

export const historyState = {
    historyModal: null,
    historyOpening: false
};

export const discussionState = {
    discussionModal: null,
    discussion: null,
    discussionEl: null,
    discussionMode: false,
    discussionPersonas: []
};

export const projectState = {
    projects: [],
    currentProjectId: null,
    dashboard: { open: false, projectId: null, tab: "overview" }
};

export function updateWaitingElapsed() {

    if (!runtimeState.waitingElapsed || !runtimeState.waiting) {
        return;
    }

    runtimeState.waitingElapsed.textContent =
        `${((Date.now() - runtimeState.waiting.since) / 1000).toFixed(1)} s`;
}

export function setStatus(status) {

    runtimeState.status = status;

    el("statusDot").className = `dot ${status}`;
    el("statusText").textContent = status;

    el("runButton").disabled = status === "running";
    el("cancelButton").disabled = status !== "running";

    if (status === "running") {

        runtimeState.startedAt = runtimeState.startedAt || Date.now();

        if (!runtimeState.timer) {

            runtimeState.timer =
                setInterval(
                    () => {

                        el("runTimer").textContent =
                            `${(
                                (Date.now() - runtimeState.startedAt) / 1000
                            ).toFixed(1)} s`;
                    },
                    100
                );
        }

    } else {

        clearInterval(runtimeState.timer);

        runtimeState.timer = null;
        runtimeState.startedAt = null;
    }
}

export function resetRun(clearArchive = false) {

    executionState.agents.clear();
    executionState.order = [];
    executionState.graphs.clear();
    executionState.calls.clear();
    approvalState.approvals.clear();
    executionState.loops = [];
    executionState.hooks.clear();
    executionState.hookOrder = [];
    runtimeState.currentTask = null;
    executionState.openExecutionKeys.clear();

    if (clearArchive) {
        el("executionArchive").innerHTML = "";
    }
}

export function pushMessage(message) {

    conversationState.messages.push(
        normalizeConversationMessage(message)
    );

    renderChat();
}
