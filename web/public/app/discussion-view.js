/*
| Discussion modal body. Drawn from state.discussion alone, so the live
| transcript and a reopened one are the same view in the same order.
|
| DiscussionOptions is the composer's row under the task box: the persona
| picker, the round limit and the status line, drawn from the store.
*/

import { html } from "./dom.js";
import { markdownParagraph } from "./markdown.js";
import { composerDiscussionText, discussionStatusLine, discussionTimeline } from "./discussion-model.js";


function Report({ report }) {

    const steps = [...(report.next_steps || [])].sort((a, b) => a.order - b.order);

    return html`<div class="discussion-report">
        <h3>Final report</h3>
        ${report.summary ? html`<p class="discussion-summary">${markdownParagraph([report.summary])}</p>` : null}
        ${report.agreed_points?.length ? html`
            <h4>Agreed</h4>
            <ul class="discussion-points">
                ${report.agreed_points.map((point, index) => html`<li key=${index}>${point}</li>`)}
            </ul>` : null}
        ${report.unresolved?.length ? html`
            <h4>Unresolved</h4>
            ${report.unresolved.map((item, index) => html`<div class="discussion-unresolved" key=${index}>
                <strong>${item.topic || "(topic)"}</strong>
                ${(item.sides || []).map((side, position) => html`<p key=${position}>${`${side.persona}: ${side.reasoning}`}</p>`)}
            </div>`)}` : null}
        ${steps.length ? html`
            <h4>Next steps</h4>
            ${steps.map((step, index) => html`<p class="discussion-step" key=${index}>${
                `${step.order}. [${step.layer}] ${step.action}`
            }</p>`)}` : null}
    </div>`;
}


function Message({ message }) {

    /* closed by default; one the operator opened stays open */
    return html`<details class="discussion-message">
        <summary>${`${message.persona_name || message.persona} · round ${message.round}`}</summary>
        <div class="discussion-message-body">${markdownParagraph([message.content || "(empty)"])}</div>
    </details>`;
}


function Observer({ decision }) {

    return html`<div class=${`discussion-observer ${decision.decision === "FINISH" ? "finish" : "continue"}`}>
        <strong>${`observer · round ${decision.round} → ${decision.decision}`}</strong>
        ${(decision.open_points || []).map((point, index) => html`<p key=${`p${index}`}>${
            `${point.topic}${point.disagreeing?.length ? ` — ${point.disagreeing.join("; ")}` : ""}`
        }</p>`)}
        ${Object.values(decision.instructions || {}).map((instruction, index) => html`<p class="muted" key=${`i${index}`}>${instruction}</p>`)}
    </div>`;
}


export function Discussion({ state }) {

    const discussion = state.discussion;

    if (!discussion) {
        return html`<p class="muted">No discussion yet. Enable Discussion under the task box, pick your personas, and send the task.</p>`;
    }

    const items = discussionTimeline(discussion);

    return html`
        <div class="discussion-status" id="discussionStatus">${discussionStatusLine(discussion)}</div>
        <p class="discussion-task">${discussion.task}</p>
        ${items.map(item => {
            switch (item.type) {
                case "round":
                    return html`<h4 class="discussion-round-head" key=${item.key}>${`Round ${item.round}`}</h4>`;
                case "message":
                    return html`<${Message} key=${item.key} message=${item.message} />`;
                case "observer":
                    return html`<${Observer} key=${item.key} decision=${item.decision} />`;
                case "error":
                    return html`<p class="bad" key=${item.key}>${item.error}</p>`;
                case "report":
                    return html`<${Report} key=${item.key} report=${item.report} />`;
                default:
                    return null;
            }
        })}
    `;
}


/* an error stays on the line until the operator submits again */
function ComposerStatus({ state, onView }) {

    if (state.discussionError) {
        return html`<span class="bad" id="discussionStatusLine">${state.discussionError}</span>`;
    }

    const text = composerDiscussionText(state.discussion);

    return html`<span class="muted discussion-status-line" id="discussionStatusLine">
        ${text ? html`<span>${text}</span>` : null}
        ${text && state.discussion.status !== "failed"
            ? html`<button type="button" class="link" onClick=${onView}>view</button>`
            : null}
    </span>`;
}


export function DiscussionOptions({ state, actions }) {

    const selected = new Set(state.discussionSelection || []);

    return html`
        <div class="discussion-persona-head">
            <span>personas</span>
            <button type="button" class="link" onClick=${() => actions.selectAll(true)}>all</button>
            <button type="button" class="link" onClick=${() => actions.selectAll(false)}>none</button>
        </div>
        <div class="discussion-personas">
            ${state.discussionPersonas.map(persona => html`<label class="discussion-persona" key=${persona.id} title=${persona.description}>
                <input
                    type="checkbox"
                    class="persona-box"
                    value=${persona.id}
                    checked=${selected.has(persona.id)}
                    onChange=${event => actions.toggle(persona.id, event.currentTarget.checked)}
                />
                <span>${persona.id}</span>
            </label>`)}
        </div>
        <div class="discussion-meta">
            <span>max rounds</span>
            <input
                class="filter"
                id="discussionRounds"
                type="number"
                min="1"
                max="10"
                title="maximum rounds (1-10)"
                value=${state.discussionRounds}
                onInput=${event => actions.rounds(event.currentTarget.value)}
            />
            <${ComposerStatus} state=${state} onView=${actions.view} />
        </div>
    `;
}
