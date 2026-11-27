/*
|--------------------------------------------------------------------------
| Conversation tabs (roadmap P1-03)
|--------------------------------------------------------------------------
|
| One tab per live conversation: every project with something to show and
| the default workspace when it has one. Each tab carries its state (running,
| awaiting approval, done, failed, stopped), the number of messages waiting
| in its queue, and a marker when it changed while it was not on screen.
| Choosing a tab switches the console to that project's own stream, whose
| snapshot replays the whole conversation, so nothing is lost on a switch.
*/

import { html } from "./dom.js";


const BADGE_TEXT = Object.freeze({
    running: "running",
    awaiting: "awaiting approval",
    done: "done",
    failed: "failed",
    cancelled: "stopped",
    waiting: "waiting for a slot"
});


export function conversationKey(projectId) {

    return projectId || "__default__";
}


/* what a conversation is doing, approvals first: they block the run */
export function badgeOf(item) {

    if (item.pending_approvals > 0) {
        return "awaiting";
    }

    /* P1-07: started, but over the server-wide limit of concurrent runs */
    if (item.waiting_for_slot) {
        return "waiting";
    }

    return item.status || "idle";
}


export function conversationName(state, projectId) {

    if (!projectId) {
        return "Default Workspace";
    }

    const project = (state.projects || []).find(entry => entry.id === projectId);

    return project && project.name ? project.name : projectId;
}


/* the conversations worth a tab: the visible one and any with something to show */
export function visibleTabs(state) {

    const current = state.currentProjectId || null;
    const list = state.conversations || [];

    /* the conversation on screen always has its tab, even while empty */
    const all = list.some(item => item.project_id === current)
        ? list
        : [...list, { project_id: current, status: "idle", pending_approvals: 0, queue_length: 0, messages: 0 }];

    return all.filter(item =>
        item.project_id === current ||
        item.status === "running" ||
        item.pending_approvals > 0 ||
        item.queue_length > 0 ||
        item.messages > 0 ||
        state.attention.has(conversationKey(item.project_id))
    );
}


export function ConversationTabs({ state, onSelect }) {

    const tabs = visibleTabs(state);

    /* a single conversation needs no tab strip */
    if (tabs.length < 2) {
        return null;
    }

    const current = state.currentProjectId || null;

    return html`<div class="conversation-tabs" role="tablist" aria-label="Conversations">
        ${tabs.map(item => {

            const key = conversationKey(item.project_id);
            const active = item.project_id === current;
            const badge = badgeOf(item);
            const marked = state.attention.has(key);

            return html`<button
                type="button"
                role="tab"
                key=${key}
                class=${`conversation-tab ${badge}${active ? " active" : ""}${marked ? " attention" : ""}`}
                aria-selected=${active ? "true" : "false"}
                data-project=${item.project_id || ""}
                title=${item.task || conversationName(state, item.project_id)}
                onClick=${() => onSelect(item.project_id)}
            >
                <span class="tab-dot" aria-hidden="true"></span>
                <span class="tab-name">${conversationName(state, item.project_id)}</span>
                ${BADGE_TEXT[badge] ? html`<span class="tab-badge">${BADGE_TEXT[badge]}</span>` : null}
                ${item.queue_length > 0
                    ? html`<span class="tab-queue" title="messages waiting for the next turn">+${item.queue_length}</span>`
                    : null}
            </button>`;
        })}
    </div>`;
}
