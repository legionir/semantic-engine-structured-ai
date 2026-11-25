/* MCP view boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";

export function renderMcp(payload, container = byId("mcpBody")) {
  if (!container) return;
  clear(container);
  (payload?.servers || []).forEach(server => {
    const row = create("div", "mcp-row");
    row.textContent = `${server.name || server.server || "server"} · ${server.status || "unknown"}`;
    container.appendChild(row);
  });
}
