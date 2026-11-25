/*
| Conversations modal: the saved sessions of this workspace. Opening one
| or starting a new one reports a failure in the modal instead of
| silently doing nothing.
*/

import { html } from "./dom.js";
import { describeSession } from "./formatters.js";


export function historySubtitle(sessions) {

    return `${sessions.length} saved in this workspace`;
}


/* props: history {sessions, current, pending, error}, onOpen(id) */
export function Sessions({ history, onOpen }) {

    const sessions = history.sessions || [];

    return html`<div class="sessions">
        ${history.error ? html`<p class="mcp-error">${history.error}</p>` : null}
        ${sessions.length === 0 ? html`<p class="empty">No conversations have been saved yet.</p>` : null}
        ${sessions.map(session => html`<button
            type="button"
            key=${session.id}
            class=${`session${session.id === history.current ? " current" : ""}`}
            disabled=${Boolean(history.pending)}
            onClick=${() => onOpen(session.id)}
        >
            <span class="name">${session.title || session.id}</span>
            <span class="facts">${describeSession(session)}</span>
        </button>`)}
    </div>`;
}
