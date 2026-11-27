/* Composer: the chips of the files attached to the next task. */

import { html } from "./dom.js";


function imageInputOff(state) {

    const setting = (state.settings || []).find(item => item.key === "MODEL_IMAGE_INPUT");

    return Boolean(setting && setting.value === "off");
}


export function Attachments({ state, onRemove }) {

    const pictures = state.attachments.some(attachment => /^image\//.test(attachment.file.type || ""));

    return html`
        ${state.attachments.map((attachment, index) => html`<span class="attachment-chip" key=${attachment.id || index}>
            <span class="attachment-name">${attachment.file.name}</span>
            <button
                type="button"
                aria-label=${`Remove ${attachment.file.name}`}
                onClick=${() => onRemove(index)}
            >×</button>
        </span>`)}
        ${pictures && imageInputOff(state)
            ? html`<span class="attachment-error" role="status">MODEL_IMAGE_INPUT is off: the model gets the picture's path, not the picture.</span>`
            : null}
        ${state.attachmentError ? html`<span class="attachment-error">${state.attachmentError}</span>` : null}
    `;
}
