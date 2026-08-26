/*
 * Visualizer ESM entry point — EXECUTION_PLAN Phase 25.
 *
 * Domain modules are explicit and independently testable. The existing
 * visualizer.js is imported as a compatibility renderer so the current graph
 * UX, selectors and fallback behavior remain unchanged during extraction.
 */

import * as api from "./api-client.js";
import * as model from "./graph-model.js";
import { createGraphStore } from "./graph-store.js";
import { LayoutClient } from "./layout-client.js";
import { SelectionState } from "./selection-state.js";
import { GraphRenderer } from "./graph-renderer.js";
import * as details from "./node-details.js";
import * as events from "./visualizer-events.js";

import "../visualizer.js";

export const store = createGraphStore(api.projectIdFromLocation());
export const layout = new LayoutClient();
export const selection = new SelectionState();

export const modules = Object.freeze({
  api,
  model,
  store,
  layout,
  selection,
  GraphRenderer,
  details,
  events
});

if (typeof globalThis !== "undefined") {
  globalThis.StructuredAIVisualizer = modules;
}
