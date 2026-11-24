/* Event view boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";
import { shorten } from "./formatters.js";

export function eventMatches(event, text = "", type = "") {
  if (type && event.type !== type) return false;
  if (!text) return true;
  const haystack = JSON.stringify(event).toLowerCase();
  return haystack.includes(String(text).toLowerCase());
}

export function renderEvents(events, { container = byId("log"), text = "", type = "" } = {}) {
  if (!container) return;
  clear(container);
  (events || []).filter(event => eventMatches(event, text, type)).forEach(event => {
    const row = create("li", "log-row");
    row.textContent = `${event.type || "event"} ${shorten(event.summary || event.name || "", 160)}`;
    container.appendChild(row);
  });
}
