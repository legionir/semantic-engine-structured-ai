/*
|--------------------------------------------------------------------------
| Shared controller helpers
|--------------------------------------------------------------------------
|
| What every controller needs: the element lookup, reporting a failed
| request in the conversation, the run status, the open-modal handles and
| in-flight flags (they describe the page, not the runtime, so they sit
| beside the store's data), the approval queue and the call detail modal.
*/

import { batch, state, touch } from "./store.js";
import { setRunStatus } from "./runtime-state.js";
import { currentRun, resetRun } from "./execution-model.js";
import { normalizeConversationMessage } from "./conversation-model.js";
import { openCallDetail as showCallDetail } from "./execution-view.js";
import { createApprovals } from "./approval-state.js";


export const el = id => document.getElementById(id);


/*
| Handles of open modals and in-flight flags. They describe the page, not
| the runtime, so they live beside the store's data rather than in it.
*/
Object.assign(state, {
    historyModal: null,
    executionModal: null,
    eventsModal: null,
    settingsModal: null,
    llmSettingsModal: null,
    planModal: null,
    mcpModal: null,
    logsModal: null,
    terminalModal: null,
    filesModal: null,
    mcpTab: "servers",
    mcpConfigText: "",
    mcpConfigPath: "",
    mcpConfigError: null,
    mcpConfigNotice: "",
    discussionModal: null,
    historyOpening: false,
    mcpOpening: false,
    eventSource: null
});


export function setStatus(status) {

    batch(() => {
        setRunStatus(state, status);
        touch("run");
    });
}


export function pushMessage(message) {

    state.messages.push(normalizeConversationMessage(message, state.messages));
    touch("chat");
}


/*
| A request the operator made failed. The conversation is where the
| console has always reported that ("Could not start …"), so failures of
| every action are reported the same way.
*/
export function notifyError(text) {

    pushMessage({ role: "assistant", kind: "error", content: text, at: Date.now() });
}


export async function failureText(response, fallback) {

    const payload = await response.json().catch(() => ({}));

    return `${fallback}: ${payload.error || `request failed (${response.status})`}`;
}


/* drops the previous project's live cards while the new snapshot is in flight */
export function resetProjectView() {

    batch(() => {
        resetRun(state, true);
        state.messages = [];
        state.events = [];
        state.logRows = [];
        state.approvals.clear();
        touch("tree", "chat", "log", "approvals", "plan");
    });
}


export function openCallDetail(call, graph, run = currentRun(state)) {

    return showCallDetail({ Modal, call, graph, run, touchTree: () => touch("tree") });
}


export function openCallByKey(key) {

    const call = state.calls.get(key);

    if (call) {
        openCallDetail(call, state.graphs.get(call.graph_id));
    }
}


export const approvals = createApprovals({ Modal, state, touch });
