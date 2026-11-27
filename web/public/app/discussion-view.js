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
import { SkeletonRows } from "./skeleton-view.js";


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


function DiscussionTranscript({ discussion }) {

    if (!discussion) {
        return html`<p class="muted">No discussion yet. Configure a topic and personas to start a multi-agent deliberation.</p>`;
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
function SetupStatus({ state }) {

    if (state.discussionError) {
        return html`<span class="bad" id="discussionStatusLine">${state.discussionError}</span>`;
    }

    const text = composerDiscussionText(state.discussion);

    return html`<span class="muted discussion-status-line" id="discussionStatusLine">
        ${text ? html`<span>${text}</span>` : null}
    </span>`;
}


export function DiscussionOptions({ state, actions }) {

    const selected = new Set(state.discussionSelection || []);
    const running = state.discussion?.status === "running";
    const busy = running || state.submitting || state.uploading;

    return html`
        <form class="discussion-setup" onSubmit=${event => { event.preventDefault(); actions.submit?.(); }}>
            <div class="discussion-field">
                <label class="discussion-field-label" for="discussionTask">Topic or task</label>
                <textarea
                    id="discussionTask"
                    class="discussion-task-input"
                    rows="3"
                    placeholder="What should the specialist personas deliberate on?"
                    disabled=${busy}
                    value=${state.discussionDraft ?? ""}
                    onInput=${event => actions.draft?.(event.currentTarget.value)}
                ></textarea>
            </div>
            <div class="discussion-persona-head">
                <span>personas</span>
                <button type="button" class="link" onClick=${() => actions.selectAll(true)}>all</button>
                <button type="button" class="link" onClick=${() => actions.selectAll(false)}>none</button>
            </div>
            <div class="discussion-personas">
                ${state.discussionPersonasLoading && state.discussionPersonas.length === 0
                    ? html`<${SkeletonRows} count=${3} compact=${true} label="Loading personas…" />`
                    : null}
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
        </form>
    `;
}


export function DiscussionFooter({ state, actions, onClose }) {

    const discussion = state.discussion;
    const running = discussion?.status === "running";
    const busy = running || state.submitting || state.uploading;
    const showSetup = !discussion || (state.discussionShowSetup && !running);

    return html`
        ${showSetup ? html`
            <div class="discussion-footer-meta">
                <label class="discussion-rounds-label" for="discussionRounds">
                    <span>Rounds</span>
                    <input
                        class="filter"
                        id="discussionRounds"
                        type="number"
                        min="1"
                        max="10"
                        title="Rounds (1-10)"
                        value=${state.discussionRounds}
                        onInput=${event => actions.rounds(event.currentTarget.value)}
                    />
                </label>
                <${SetupStatus} state=${state} />
            </div>
        ` : html`<span class="discussion-footer-spacer"></span>`}
        <div class="discussion-footer-actions">
            <button type="button" class="ghost" onClick=${onClose}>Close</button>
            ${showSetup ? html`
                <button type="button" id="startDiscussionButton" disabled=${busy} onClick=${() => actions.submit?.()}>
                    ${state.uploading ? "Uploading files…" : state.submitting ? "Starting…" : running ? "Discussion running…" : "Start"}
                </button>
            ` : null}
        </div>
    `;
}


export function Discussion({ state, actions }) {

    const discussion = state.discussion;

    if (!actions) {
        return html`<${DiscussionTranscript} discussion=${discussion} />`;
    }

    const showSetup = !discussion || (state.discussionShowSetup && discussion.status !== "running");

    return html`
        ${discussion ? html`
            <div class="mcp-tabs discussion-modal-tabs" role="tablist">
                <button
                    type="button"
                    class=${`mcp-tab${!showSetup ? " active" : ""}`}
                    aria-selected=${!showSetup ? "true" : "false"}
                    onClick=${() => actions.setView(false)}
                >Transcript</button>
                <button
                    type="button"
                    class=${`mcp-tab${showSetup ? " active" : ""}`}
                    aria-selected=${showSetup ? "true" : "false"}
                    disabled=${discussion.status === "running"}
                    onClick=${() => actions.setView(true)}
                >New discussion</button>
            </div>
        ` : null}
        ${showSetup
            ? html`<${DiscussionOptions} state=${state} actions=${actions} />`
            : html`<${DiscussionTranscript} discussion=${discussion} />`}
    `;
}
