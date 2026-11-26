/* Composer: the chips of the files attached to the next task. */

import { html } from "./dom.js";


export function Attachments({ state, onRemove }) {

    return html`
        ${state.attachments.map((attachment, index) => html`<span class="attachment-chip" key=${attachment.id || index}>
            <span class="attachment-name">${attachment.file.name}</span>
            <button
                type="button"
                aria-label=${`Remove ${attachment.file.name}`}
                onClick=${() => onRemove(index)}
            >×</button>
        </span>`)}
        ${state.attachmentError ? html`<span class="attachment-error">${state.attachmentError}</span>` : null}
    `;
}
