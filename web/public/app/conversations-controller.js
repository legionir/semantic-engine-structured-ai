/*
|--------------------------------------------------------------------------
| Conversations: tabs, attention and notifications (roadmap P1-03 / P1-05)
|--------------------------------------------------------------------------
|
| The server pushes a summary of every conversation beside the event
| stream. This controller keeps it in the store for the tabs, works out what
| changed since the previous summary (a run ended, failed, was stopped, or
| asked for an approval) and tells the operator:
|
| - the tab gets an attention marker until it is opened;
| - the page title counts the conversations that need a look;
| - while the page is in the background, a browser notification, if the
|   operator switched them on; clicking it opens that conversation.
*/

import { state, touch } from "./store.js";
import { el, notifyError } from "./console-core.js";
import { mount } from "./dom.js";
import { onConversationSummary } from "./stream-controller.js";
import { setCurrentProject } from "./projects-controller.js";
import { ConversationTabs, badgeOf, conversationKey, conversationName } from "./conversation-tabs-view.js";


const PREFERENCE_KEY = "structured-ai.notifications";

let previous = null;

let baseTitle = null;


function pageHidden() {

    return document.hidden === true || document.visibilityState === "hidden";
}


function notificationApi() {

    return typeof window !== "undefined" && typeof window.Notification === "function"
        ? window.Notification
        : null;
}


function readPreference() {

    try {
        return localStorage.getItem(PREFERENCE_KEY) === "on";
    } catch {
        return false;
    }
}


function writePreference(enabled) {

    try {
        localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off");
    } catch {
        /* a browser without storage forgets the choice on reload */
    }
}


/* What happened between two summaries: one entry per notable change. */
export function conversationChanges(before, after) {

    const known = new Map((before || []).map(item => [conversationKey(item.project_id), item]));
    const changes = [];

    for (const item of after || []) {

        const old = known.get(conversationKey(item.project_id));

        if (!old) {
            continue;
        }

        if (old.status === "running" && item.status !== "running" && item.status !== "idle") {
            changes.push({ item, kind: item.status === "done" ? "done" : item.status === "cancelled" ? "cancelled" : "failed" });
        }

        if ((item.pending_approvals || 0) > (old.pending_approvals || 0)) {
            changes.push({ item, kind: "approval" });
        }
    }

    return changes;
}


const NOTICE = Object.freeze({
    done: "finished",
    failed: "failed",
    cancelled: "was stopped",
    approval: "needs your approval"
});


function notify({ item, kind }) {

    const Api = notificationApi();

    if (!state.notificationsEnabled || !Api || Api.permission !== "granted" || !pageHidden()) {
        return;
    }

    const name = conversationName(state, item.project_id);

    try {

        const notice = new Api(`${name} ${NOTICE[kind]}`, {
            body: item.task || "",
            tag: `structured-ai-${conversationKey(item.project_id)}-${kind}`
        });

        notice.onclick = () => {

            if (typeof window.focus === "function") window.focus();
            openConversation(item.project_id);
            if (typeof notice.close === "function") notice.close();
        };

    } catch {

        /* a browser that refuses to show one (e.g. a mobile page) is fine */
    }
}


/* the page title counts the conversations waiting for the operator */
export function attentionCount(conversations, attention) {

    const keys = new Set(attention);

    for (const item of conversations || []) {
        if (badgeOf(item) === "awaiting") keys.add(conversationKey(item.project_id));
    }

    return keys.size;
}


function updateTitle() {

    if (baseTitle === null) {
        baseTitle = String(document.title || "structured-ai console").replace(/^\(\d+\)\s+/, "");
    }

    const count = attentionCount(state.conversations, state.attention);

    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
}


/* the visible conversation, while the page is seen, needs no marker */
function clearSeen() {

    if (!pageHidden()) {
        state.attention.delete(conversationKey(state.currentProjectId));
    }
}


export function applyConversationSummary(conversations) {

    const changes = previous ? conversationChanges(previous, conversations) : [];

    previous = conversations.map(item => ({ ...item }));
    state.conversations = conversations;

    for (const change of changes) {

        const key = conversationKey(change.item.project_id);

        if (pageHidden() || key !== conversationKey(state.currentProjectId)) {
            state.attention.add(key);
        }

        notify(change);
    }

    clearSeen();
    updateTitle();
    touch("tabs");
}


export function openConversation(projectId) {

    state.attention.delete(conversationKey(projectId));
    setCurrentProject(projectId || null);
    updateTitle();
    touch("tabs");
}


function renderNotificationsButton() {

    const button = el("notificationsButton");

    if (!button) return;

    button.textContent = state.notificationsEnabled ? "Notify · on" : "Notify · off";
    button.setAttribute("aria-pressed", state.notificationsEnabled ? "true" : "false");
}


export async function toggleNotifications() {

    const enable = !state.notificationsEnabled;
    const Api = notificationApi();

    if (enable) {

        if (!Api) {
            notifyError("This browser cannot show notifications.");
            return;
        }

        let permission = Api.permission;

        if (permission === "default" && typeof Api.requestPermission === "function") {
            try {
                permission = await Api.requestPermission();
            } catch {
                permission = "denied";
            }
        }

        if (permission !== "granted") {
            notifyError("The browser blocked notifications for this page; allow them in its site settings.");
            return;
        }
    }

    state.notificationsEnabled = enable;
    writePreference(enable);
    renderNotificationsButton();
}


export function initConversations() {

    state.notificationsEnabled = readPreference();
    renderNotificationsButton();

    onConversationSummary(applyConversationSummary);

    const host = el("conversationTabs");

    if (host) {
        mount(host, () => ConversationTabs({ state, onSelect: openConversation }), ["tabs", "projects"]);
    }

    document.addEventListener("visibilitychange", () => {
        clearSeen();
        updateTitle();
        touch("tabs");
    });
}
