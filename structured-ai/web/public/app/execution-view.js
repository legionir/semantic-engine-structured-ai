/* Execution view boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";
import { statusIcon } from "./formatters.js";

export function renderExecution(execution, container = byId("tree")) {
  if (!container) return;
  clear(container);
  const agents = execution?.agents || {};
  const order = execution?.order || Object.keys(agents);
  if (!order.length) {
    container.appendChild(create("p", "empty", "No run yet. Send a task to see the agent tree."));
    return;
  }
  order.forEach(scope => {
    const agent = agents[scope] || { scope, status: "running" };
    const row = create("div", "agent-row");
    row.append(
      create("span", "status", statusIcon(agent.status)),
      create("strong", "agent-name", agent.name || scope)
    );
    container.appendChild(row);
  });
}
