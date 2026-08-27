/*
|--------------------------------------------------------------------------
| Console history-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| Stored conversations: the list, the preview line, and opening one. The fetch is
| in api.js, so this module is only about what a session looks like and what
| choosing one does to the page.
|--------------------------------------------------------------------------
*/

import { Modal, el, node } from "./dom.js";
import { renderTree } from "./execution-view.js";
import { normalizeConversationMessages, renderChat } from "./chat.js";
import { loadSession } from "./api.js";
import { apply } from "./event-stream.js";
import { conversationState, eventState, executionState, historyState, resetRun } from "./store.js";

export function describeSession(session) {

    return `${session.turns || 0} turn${
        (session.turns || 0) === 1 ? "" : "s"
    } · ${session.events || 0} events · ${
        new Date(session.updated_at).toLocaleString("en-GB", {
            hour12: false
        })
    }`;
}

export async function openHistory() {

    if (historyState.historyModal && historyState.historyModal.isOpen()) {
        return historyState.historyModal;
    }

    /* Fetching the list is asynchronous. Ignore double clicks while it is
       in flight; otherwise two orphaned dialogs are pushed onto the modal
       stack and the visible one no longer matches historyState.historyModal. */
    if (historyState.historyOpening) {
        return null;
    }

    historyState.historyOpening = true;

    let response;

    try {
        response = await fetch("/api/sessions");
    } catch {
        historyState.historyOpening = false;
        return null;
    }

    if (!response.ok) {
        historyState.historyOpening = false;
        return null;
    }

    let payload;

    try {
        payload = await response.json();
    } catch {
        historyState.historyOpening = false;
        return null;
    }

    if (!payload || !Array.isArray(payload.sessions)) {
        historyState.historyOpening = false;
        return null;
    }

    conversationState.sessions = payload.sessions;

    const body = node("div", "sessions");

    if (payload.sessions.length === 0) {

        body.appendChild(
            node("p", "empty", "No conversations have been saved yet.")
        );
    }

    for (const session of payload.sessions) {

        const row =
            node(
                "button",
                `session${
                    session.id === payload.current
                        ? " current"
                        : ""
                }`
            );

        row.type = "button";

        row.append(
            node("span", "name", session.title || session.id),
            node("span", "facts", describeSession(session))
        );

        row.addEventListener(
            "click",
            () => loadSession(session.id)
        );

        body.appendChild(row);
    }

    const handle =
        Modal.open({
            title: "Conversations",

            subtitle:
                `${payload.sessions.length} saved in this workspace`,

            size: "medium",

            body,

            footer:
                Modal.row(
                    Modal.button(
                        "New conversation",
                        "ghost",
                        async () => {

                            await fetch("/api/sessions", { method: "POST" });

                            handle.close("new");
                        }
                    ),
                    Modal.button(
                        "Close",
                        "",
                        () => handle.close("footer")
                    )
                ),

            onClose: () => {

                historyState.historyModal = null;
            }
        });

    historyState.historyModal = handle;
    historyState.historyOpening = false;

    return handle;
}

export function applySession(session) {

    resetRun(true);

    conversationState.messages = normalizeConversationMessages(session.messages);

    conversationState.session = {
        id: session.id,
        title: session.title,
        turns: session.turns
    };

    el("sessionTitle").textContent =
        session.title || "new conversation";

    eventState.events = [];
    el("log").innerHTML = "";

    for (const event of session.events || []) {
        apply(event);
    }

    for (const call of session.calls || []) {

        if (call.key && !executionState.calls.has(call.key)) {

            executionState.calls.set(call.key, {
                ...call,
                argumentsPreview:
                    JSON.stringify(call.arguments ?? {}, null, 2),
                duration: call.duration_ms
            });
        }
    }

    renderChat();
    renderTree();
}
