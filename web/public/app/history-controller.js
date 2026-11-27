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
import { groupSessions, historySubtitle, Sessions } from "./history-view.js";
import { failureText, notifyError } from "./console-core.js";
import { confirmDialog } from "./operator-api.js";
import { apiFetch } from "./auth-transport.js";


let historyRequest = 0;

function computeSubtitle(sessions) {

    const groups = groupSessions(sessions, {
        projects: state.projects,
        defaultWorkspace: state.workspace,
        currentProjectId: state.currentProjectId,
        currentSessionId: state.history?.current || state.session?.id || null
    });
    return historySubtitle(sessions, groups);
}


function sessionQuery(session) {

    return session?.project_id
        ? `?projectId=${encodeURIComponent(session.project_id)}`
        : "";
}


async function fetchHistory(handle) {

    const request = ++historyRequest;

    if (state.history) {
        state.history.loading = true;
        state.history.error = null;
        touch("history");
    }

    let payload = null;

    try {
        const requests = [apiFetch("/api/sessions")];
        const needProjects = !Array.isArray(state.projects) || state.projects.length === 0;
        if (needProjects) requests.push(apiFetch("/api/projects"));
        const [response, projResponse] = await Promise.all(requests);
        payload = response.ok ? await response.json() : null;
        if (projResponse && projResponse.ok) {
            const projPayload = await projResponse.json().catch(() => null);
            if (Array.isArray(projPayload?.projects)) {
                state.projects = projPayload.projects;
                touch("projects");
            }
        }
    } catch {
        payload = null;
    }

    if (request !== historyRequest || !state.historyModal || state.historyModal !== handle) {
        return;
    }

    if (!payload || !Array.isArray(payload.sessions)) {
        state.history = {
            ...(state.history || { sessions: [], current: null, pending: null, search: "", scope: "all" }),
            loading: false,
            error: "The saved conversations could not be loaded."
        };
        handle.setSubtitle("unavailable");
        touch("history");
        return;
    }

    state.sessions = payload.sessions;
    state.history = {
        sessions: payload.sessions,
        current: payload.current,
        pending: null,
        error: null,
        loading: false,
        search: state.history?.search || "",
        scope: state.history?.scope || "all"
    };
    handle.setSubtitle(computeSubtitle(payload.sessions));
    touch("history");
}


export function openHistory() {

    if (state.historyModal && state.historyModal.isOpen()) {
        return state.historyModal;
    }

    const cached = Array.isArray(state.sessions) ? state.sessions : [];
    state.history = {
        sessions: cached,
        current: state.history?.current || state.session?.id || null,
        pending: null,
        error: null,
        loading: true,
        search: "",
        scope: "all"
    };

    let dispose = () => {};

    const handle = Modal.open({
        title: "Conversations",
        subtitle: cached.length > 0 ? computeSubtitle(cached) : "Loading…",
        size: "medium",
        footer: Modal.row(
            Modal.button("New conversation", "ghost", () => startNewConversation(handle)),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            historyRequest++;
            dispose();
            state.historyModal = null;
        }
    });

    state.historyModal = handle;

    dispose = mountInModal(
        handle,
        () => Sessions({
            history: state.history,
            projects: state.projects,
            defaultWorkspace: state.workspace,
            currentProjectId: state.currentProjectId,
            onOpen: loadSession,
            onDelete: deleteSession,
            onRetry: () => fetchHistory(handle),
            onSearch: value => {
                if (!state.history) return;
                state.history.search = value;
                touch("history");
            },
            onScopeChange: scope => {
                if (!state.history) return;
                state.history.scope = scope;
                touch("history");
            }
        }),
        ["history", "projects"]
    );

    void fetchHistory(handle);

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
        const response = await apiFetch("/api/sessions", { method: "POST" });
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


async function deleteSession(session) {

    if (!session || state.history?.pending) return;

    const title = session.title || session.id;
    const approved = await confirmDialog(`Delete conversation "${title}"?`, {
        title: "Conversations",
        confirmLabel: "Delete",
        confirmClass: "danger"
    });

    if (!approved || !state.history) return;

    state.history.pending = session.id;
    state.history.error = null;
    touch("history");

    try {
        const response = await apiFetch(
            `/api/sessions/${encodeURIComponent(session.id)}${sessionQuery(session)}`,
            { method: "DELETE" }
        );
        if (!response.ok) {
            historyFailure(await failureText(response, "The conversation could not be deleted"));
            return;
        }
    } catch (error) {
        historyFailure(`The conversation could not be deleted: ${error.message || "network error"}`);
        return;
    }

    const remaining = (state.history.sessions || []).filter(item => item.id !== session.id);
    state.sessions = remaining;
    state.history.sessions = remaining;
    state.history.pending = null;
    state.history.error = null;
    state.historyModal?.setSubtitle(computeSubtitle(remaining));
    touch("history");
}


/*
| Another console switched conversation: load it. Several switches in a
| row resolve out of order, so only the newest request is applied.
*/
let sessionRequest = 0;


export async function refreshSession(id) {

    const request = ++sessionRequest;

    try {
        const response = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`);
        if (!response.ok) return;
        const payload = await response.json();
        if (request === sessionRequest && payload?.session) applySession(payload.session);
    } catch {
        /* the next session:switched or snapshot redraws it */
    }
}


async function loadSession(sessionOrId) {

    const session = typeof sessionOrId === "object" && sessionOrId !== null
        ? sessionOrId
        : (state.history?.sessions || []).find(item => item.id === sessionOrId) || { id: sessionOrId };
    const id = session.id;
    const request = ++sessionRequest;

    if (state.history) {
        state.history.pending = id;
        state.history.error = null;
        touch("history");
    }

    let payload = null;

    try {
        const response = await apiFetch(
            `/api/sessions/${encodeURIComponent(id)}${sessionQuery(session)}`,
            { method: "POST" }
        );
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
