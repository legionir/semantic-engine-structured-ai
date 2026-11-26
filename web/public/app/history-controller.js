/*
|--------------------------------------------------------------------------
| Saved conversations
|--------------------------------------------------------------------------
|
| The Conversations modal, starting a new conversation, and opening a stored
| one. A stored conversation is replayed through the same reducer that
| draws the live stream, so the Execution and Events cards match.
*/

import { batch, REGIONS, state, touch } from "./store.js";
import { mountInModal } from "./dom.js";
import { reduce } from "./runtime-state.js";
import { resetRun } from "./execution-model.js";
import { normalizeConversationMessages } from "./conversation-model.js";
import { historySubtitle, Sessions } from "./history-view.js";
import { failureText, notifyError } from "./console-core.js";


export async function openHistory() {

    if (state.historyModal && state.historyModal.isOpen()) {
        return state.historyModal;
    }

    /* Fetching the list is asynchronous. Ignore double clicks while it is
       in flight; otherwise two orphaned dialogs are pushed onto the modal
       stack and the visible one no longer matches state.historyModal. */
    if (state.historyOpening) {
        return null;
    }

    state.historyOpening = true;

    let payload = null;

    try {
        const response = await fetch("/api/sessions");
        payload = response.ok ? await response.json() : null;
    } catch {
        payload = null;
    }

    if (!payload || !Array.isArray(payload.sessions)) {
        state.historyOpening = false;
        notifyError("The saved conversations could not be loaded.");
        return null;
    }

    state.sessions = payload.sessions;
    state.history = { sessions: payload.sessions, current: payload.current, pending: null, error: null };

    let dispose = () => {};

    const handle = Modal.open({
        title: "Conversations",
        subtitle: historySubtitle(payload.sessions),
        size: "medium",
        footer: Modal.row(
            Modal.button("New conversation", "ghost", () => startNewConversation(handle)),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            dispose();
            state.historyModal = null;
        }
    });

    state.historyModal = handle;
    state.historyOpening = false;

    dispose = mountInModal(
        handle,
        () => Sessions({ history: state.history, onOpen: loadSession }),
        ["history"]
    );

    return handle;
}


function historyFailure(message) {

    if (state.historyModal && state.historyModal.isOpen()) {
        state.history.pending = null;
        state.history.error = message;
        touch("history");
    } else {
        notifyError(message);
    }
}


async function startNewConversation(handle) {

    if (state.history?.pending) return;

    state.history.pending = "new";
    state.history.error = null;
    touch("history");

    try {
        const response = await fetch("/api/sessions", { method: "POST" });
        if (!response.ok) {
            historyFailure(await failureText(response, "A new conversation was not started"));
            return;
        }
    } catch (error) {
        historyFailure(`A new conversation was not started: ${error.message || "network error"}`);
        return;
    }

    handle.close("new");
}


/*
| Another console switched conversation: load it. Several switches in a
| row resolve out of order, so only the newest request is applied.
*/
let sessionRequest = 0;


export async function refreshSession(id) {

    const request = ++sessionRequest;

    try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
        if (!response.ok) return;
        const payload = await response.json();
        if (request === sessionRequest && payload?.session) applySession(payload.session);
    } catch {
        /* the next session:switched or snapshot redraws it */
    }
}


async function loadSession(id) {

    const request = ++sessionRequest;

    if (state.history) {
        state.history.pending = id;
        state.history.error = null;
        touch("history");
    }

    let payload = null;

    try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "POST" });
        if (!response.ok) {
            historyFailure(await failureText(response, "The conversation could not be opened"));
            return;
        }
        payload = await response.json();
    } catch (error) {
        historyFailure(`The conversation could not be opened: ${error.message || "network error"}`);
        return;
    }

    if (request !== sessionRequest || !payload?.session) {
        return;
    }

    applySession(payload.session);
    state.historyModal?.close("loaded");
}


/* ------------------------------------------------------------------ mcp */

/*
| Every MCP action reports its outcome: a refused toggle or removal is
| shown on its row, a failed connect in the form, a failed save under the
| editor. The list only changes when the server says it did.
*/


/*
| Opening a conversation replays the events it stored, so the Execution
| and Events cards are rebuilt by the same code that draws them live.
*/
function applySession(session) {

    batch(() => {

        resetRun(state, true);

        state.messages = normalizeConversationMessages(session.messages);
        state.session = { id: session.id, title: session.title, turns: session.turns };
        state.events = [];
        state.logRows = [];

        for (const event of session.events || []) {
            if (event.type !== "session:message") {
                reduce(state, event);
            }
        }

        for (const call of session.calls || []) {

            if (call.key && !state.calls.has(call.key)) {

                state.calls.set(call.key, {
                    ...call,
                    argumentsPreview: JSON.stringify(call.arguments ?? {}, null, 2),
                    duration: call.duration_ms
                });
            }
        }

        touch(...REGIONS);
    });
}
