/*
| Plan card: objective, phases with their steps, and the runtime routine.
|
| A phase starts open when it is in progress (or, with nothing in
| progress, when it is the first). Preact only writes `open` when that
| default changes, so a phase the operator folded or unfolded stays the
| way they left it while the plan keeps updating.
*/

import { html } from "./dom.js";


export function planSummary(plan) {

    if (!plan || !plan.exists) {
        return "";
    }

    return `${plan.done || 0}/${plan.steps || 0} done${plan.blocked ? ` · ${plan.blocked} blocked` : ""}`;
}


function Step({ step }) {

    const status = step.status || "pending";

    return html`<li class=${`plan-step ${status}`}>
        <div class="plan-step-head">
            <span class="plan-step-id">${step.id}</span>
            <span class="plan-step-title">${step.title}</span>
            <span class=${`badge ${status}`}>${status}</span>
            ${step.agent ? html`<span class="plan-step-agent">${`@${step.agent}`}</span>` : null}
        </div>
        ${step.evidence ? html`<div class="plan-evidence">${step.evidence}</div>` : null}
    </li>`;
}


function Phase({ phase, index, open }) {

    const status = phase.status || "pending";
    const steps = phase.steps || [];

    return html`<details class="plan-phase" open=${open}>
        <summary>
            <span>${`${phase.id || `phase ${index + 1}`} · ${phase.title || "Untitled phase"}`}</span>
            <span class=${`badge ${status}`}>${status}</span>
        </summary>
        ${phase.goal ? html`<div class="plan-goal">${phase.goal}</div>` : null}
        <ol class="plan-steps">
            ${steps.map((step, position) => html`<${Step} key=${step.id || position} step=${step} />`)}
            ${steps.length === 0 ? html`<li class="empty">No steps defined.</li>` : null}
        </ol>
    </details>`;
}


export function Plan({ plan }) {

    if (!plan || !plan.exists) {
        return html`<p class="empty">${plan?.error ? `Plan unavailable: ${plan.error}` : "No plan yet."}</p>`;
    }

    const phases = plan.phases || [];
    const anyInProgress = phases.some(item => item.status === "in_progress");

    return html`
        ${plan.objective ? html`<p class="plan-objective">${plan.objective}</p>` : null}
        ${phases.map((phase, index) => html`<${Phase}
            key=${phase.id || `phase-${index}`}
            phase=${phase}
            index=${index}
            open=${phase.status === "in_progress" || (index === 0 && !anyInProgress)}
        />`)}
        ${plan.routine?.enabled ? html`<div class="plan-routine">${
            `Runtime routine · before: ${(plan.routine.before_task || []).join(", ") || "none"} · after: ${
                (plan.routine.after_task || []).join(", ") || "none"}`
        }</div>` : null}
    `;
}
