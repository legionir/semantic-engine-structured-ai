/* History view boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";

export function renderHistory(sessions, container = byId("historyBody")) {
  if (!container) return;
  clear(container);
  (sessions || []).forEach(session => {
    const row = create("div", "history-row");
    row.textContent = session.title || session.id || "conversation";
    container.appendChild(row);
  });
}
