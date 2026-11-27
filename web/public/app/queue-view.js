/*
|--------------------------------------------------------------------------
| Message queue (roadmap P1-04)
|--------------------------------------------------------------------------
|
| The messages waiting for the visible project's next turn, under the
| composer: each can be edited or deleted, the whole queue cleared, and a
| queue a cancel paused can be resumed. A course correction the run ended
| before reading waits here too, marked as such.
*/

import { html } from "./dom.js";


function QueueItem({ item, index, editing, actions }) {

    if (editing) {

        return html`<li class="queue-item editing" key=${item.id}>
            <textarea class="queue-edit" aria-label=${`Edit queued message ${index + 1}`} defaultValue=${item.text}></textarea>
            <div class="queue-item-actions">
                <button type="button" class="chip button queue-save" onClick=${event => {
                    const field = event.currentTarget.closest(".queue-item").querySelector(".queue-edit");
                    actions.save(item.id, field ? field.value : item.text);
                }}>Save</button>
                <button type="button" class="chip button ghost queue-cancel-edit" onClick=${() => actions.edit(null)}>Cancel</button>
            </div>
        </li>`;
    }

    return html`<li class=${`queue-item${item.kind === "correction" ? " correction" : ""}`} key=${item.id}>
        <span class="queue-index">${index + 1}</span>
        <span class="queue-text">${item.kind === "correction" ? html`<em>correction · </em>` : null}${item.text}</span>
        <div class="queue-item-actions">
            <button type="button" class="chip button queue-edit-button" aria-label=${`Edit queued message ${index + 1}`} onClick=${() => actions.edit(item.id)}>Edit</button>
            <button type="button" class="chip button queue-delete" aria-label=${`Delete queued message ${index + 1}`} onClick=${() => actions.remove(item.id)}>Delete</button>
        </div>
    </li>`;
}


export function QueuePanel({ state, actions }) {

    const queue = state.queue;

    if (!queue || queue.project_id !== state.currentProjectId) {
        return null;
    }

    const items = queue.items || [];

    if (items.length === 0 && !queue.paused) {
        return null;
    }

    return html`<section class=${`message-queue${queue.paused ? " paused" : ""}`} aria-label="Queued messages">
        <div class="queue-head">
            <strong>Queued for the next turn (${items.length})</strong>
            ${queue.paused
                ? html`<span class="queue-paused" role="status">paused after a stop</span>`
                : null}
            <span class="grow-right"></span>
            ${queue.paused && items.length > 0
                ? html`<button type="button" class="chip button queue-resume" onClick=${actions.resume}>Resume</button>`
                : null}
            <button type="button" class="chip button ghost queue-clear" onClick=${actions.clear}>Clear</button>
        </div>
        <ol class="queue-list">
            ${items.map((item, index) => QueueItem({
                item,
                index,
                editing: state.editingQueueItem === item.id,
                actions
            }))}
        </ol>
    </section>`;
}
