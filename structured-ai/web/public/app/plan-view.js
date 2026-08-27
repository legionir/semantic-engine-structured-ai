/*
|--------------------------------------------------------------------------
| Console plan-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The plan card: phases, steps, agents and evidence, read from the runtime's own
| plan view so the operator sees the plan the loop is following rather than a
| second copy of it.
|--------------------------------------------------------------------------
*/

import { el, node } from "./dom.js";
import { planState } from "./store.js";

export function renderPlan() {

    const container = el("plan");
    const plan = planState.plan;

    container.innerHTML = "";

    if (!plan || !plan.exists) {

        container.appendChild(
            node(
                "p",
                "empty",
                plan?.error
                    ? `Plan unavailable: ${plan.error}`
                    : "No plan yet."
            )
        );

        el("planSummary").textContent = "";
        return;
    }

    el("planSummary").textContent =
        `${plan.done || 0}/${plan.steps || 0} done${
            plan.blocked ? ` · ${plan.blocked} blocked` : ""
        }`;

    if (plan.objective) {
        container.appendChild(
            node("p", "plan-objective", plan.objective)
        );
    }

    for (const [index, phase] of (plan.phases || []).entries()) {

        const details = node("details", "plan-phase");

        details.open =
            phase.status === "in_progress" ||
            (
                index === 0 &&
                !(plan.phases || []).some(item => item.status === "in_progress")
            );

        const summary = node("summary");

        summary.append(
            node("span", null, `${phase.id || `phase ${index + 1}`} · ${phase.title || "Untitled phase"}`),
            node("span", `badge ${phase.status || "pending"}`, phase.status || "pending")
        );

        details.appendChild(summary);

        if (phase.goal) {
            details.appendChild(node("div", "plan-goal", phase.goal));
        }

        const steps = node("ol", "plan-steps");

        for (const step of phase.steps || []) {

            const item = node("li", `plan-step ${step.status || "pending"}`);
            const head = node("div", "plan-step-head");

            head.append(
                node("span", "plan-step-id", step.id),
                node("span", "plan-step-title", step.title),
                node("span", `badge ${step.status || "pending"}`, step.status || "pending")
            );

            if (step.agent) {
                head.appendChild(
                    node("span", "plan-step-agent", `@${step.agent}`)
                );
            }

            item.appendChild(head);

            if (step.evidence) {
                item.appendChild(
                    node("div", "plan-evidence", step.evidence)
                );
            }

            steps.appendChild(item);
        }

        if ((phase.steps || []).length === 0) {
            steps.appendChild(node("li", "empty", "No steps defined."));
        }

        details.appendChild(steps);
        container.appendChild(details);
    }

    if (plan.routine?.enabled) {

        container.appendChild(
            node(
                "div",
                "plan-routine",
                `Runtime routine · before: ${
                    (plan.routine.before_task || []).join(", ") || "none"
                } · after: ${
                    (plan.routine.after_task || []).join(", ") || "none"
                }`
            )
        );
    }
}
