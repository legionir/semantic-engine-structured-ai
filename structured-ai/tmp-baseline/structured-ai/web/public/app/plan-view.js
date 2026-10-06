/* Plan view boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";

export function renderPlan(plan, container = byId("plan")) {
  if (!container) return;
  clear(container);
  if (!plan) {
    container.appendChild(create("p", "empty", "No plan yet."));
    return;
  }
  const title = plan.objective || plan.title || "Plan";
  container.appendChild(create("h3", "plan-title", title));
  (plan.steps || []).forEach(step => {
    const row = create("div", `plan-step ${step.status || "open"}`);
    row.textContent = `${step.id || ""} ${step.title || step.description || ""}`.trim();
    container.appendChild(row);
  });
}
