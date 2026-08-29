/* Settings view boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";

export function renderSettings(settings, container = byId("settingsBody")) {
  if (!container) return;
  clear(container);
  (settings || []).forEach(setting => {
    const row = create("div", "setting-row");
    row.append(
      create("strong", "setting-key", setting.key),
      create("span", "setting-value", setting.value == null ? "" : String(setting.value))
    );
    container.appendChild(row);
  });
}
