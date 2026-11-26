/*
|--------------------------------------------------------------------------
| Interrupted conversations (roadmap P1-06)
|--------------------------------------------------------------------------
|
| A conversation whose turn was running when the server stopped is
| "interrupted" after the restart. The banner above the chat lists the
| ones this token may see, each with Continue (the agent picks up from the
| saved context: what it did, the tool results, the files it read) and
| Dismiss. The list comes with the snapshot and is refreshed when the
| server reports new ones (session:interrupted) or one is acted on.
*/

import { state, touch } from "./store.js";
import { html, mount } from "./dom.js";
import { el } from "./console-core.js";
import { apiRequest } from "./operator-api.js";
import { conversationName } from "./conversation-tabs-view.js";


function when(iso) {

    const at = Date.parse(iso);

    if (!Number.isFinite(at)) return "";

    const minutes = Math.round((Date.now() - at) / 60000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h ago`;

    return new Date(at).toLocaleString();
}


export function InterruptedBanner({ state: view, actions }) {

    const items = view.interrupted || [];

    if (items.length === 0) return null;

    const busy = view.interruptedBusy || new Set();

    return html`
        <div class="interrupted-banner" role="status" aria-live="polite">
            <strong>${items.length === 1 ? "A conversation was interrupted" : `${items.length} conversations were interrupted`} by a server restart</strong>
            ${items.map(item => html`
                <div class="interrupted-item" key=${item.id}>
                    <span class="badge">interrupted</span>
                    <span class="title" title=${item.task || item.title || ""}>${item.title || item.task || item.id}</span>
                    <span class="muted">
                        ${conversationName(view, item.project_id)}
                        ${item.interrupted_at ? ` · ${when(item.interrupted_at)}` : ""}
                        ${Number.isFinite(item.messages) ? ` · ${item.messages} messages` : ""}
                    </span>
                    <span class="spacer"></span>
                    <button
                        type="button"
                        disabled=${busy.has(item.id)}
                        title="continue with the saved context"
                        onClick=${() => actions.resume(item)}
                    >Continue</button>
                    <button
                        type="button"
                        class="ghost"
                        disabled=${busy.has(item.id)}
                        onClick=${() => actions.dismiss(item)}
                    >Dismiss</button>
                </div>
            `)}
            ${view.interruptedError ? html`<p class="interrupted-error">${view.interruptedError}</p>` : null}
        </div>
    `;
}


export async function refreshInterrupted() {

    const result = await apiRequest("/api/interrupted");

    if (result.ok) {
        state.interrupted = result.payload.sessions || [];
        touch("interrupted");
    }
}


function busySet() {

    if (!state.interruptedBusy) state.interruptedBusy = new Set();

    return state.interruptedBusy;
}


async function act(item, request) {

    const busy = busySet();

    busy.add(item.id);
    state.interruptedError = null;
    touch("interrupted");

    const result = await request();

    busy.delete(item.id);

    if (!result.ok) {
        state.interruptedError = `${item.title || item.id}: ${result.error}`;
        touch("interrupted");
        return false;
    }

    state.interrupted = (state.interrupted || []).filter(entry => entry.id !== item.id);
    touch("interrupted");

    return true;
}


export const interruptedActions = {

    async resume(item) {

        const ok = await act(item, () =>
            apiRequest(`/api/interrupted/${encodeURIComponent(item.id)}/resume`, { json: {} })
        );

        /* show the continued conversation */
        if (ok && (item.project_id || null) !== (state.currentProjectId || null)) {

            const { setCurrentProject } = await import("./projects-controller.js");

            setCurrentProject(item.project_id || null);
        }
    },

    dismiss(item) {

        return act(item, () =>
            apiRequest(`/api/interrupted/${encodeURIComponent(item.id)}`, { method: "DELETE" })
        );
    }
};


export function initInterrupted() {

    const host = el("interruptedBanner");

    if (!host) return;

    mount(host, () => InterruptedBanner({ state, actions: interruptedActions }), ["interrupted", "projects"]);
}
