/*
| Discussion modal body. Drawn from state.discussion alone, so the live
| transcript and a reopened one are the same view in the same order.
*/

import { html } from "./dom.js";
import { markdownParagraph } from "./markdown.js";
import { discussionStatusLine, discussionTimeline } from "./discussion-model.js";


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
