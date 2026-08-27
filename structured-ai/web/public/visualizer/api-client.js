/*
|--------------------------------------------------------------------------
| Visualizer api-client (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| The three fetches, with the project id that scopes them.
|
| Every URL carries `projectId`, taken from the page URL (`?projectId=…`, default `current`), so the visualizer asks for one project's index and never for "whatever the server last looked at". A failed request is not an error screen: `loadView` falls back to the structured sample dataset, and neighborhood/impact fall back to focus mode over what is already loaded — a viewer that refuses to draw an empty box is the point.
|--------------------------------------------------------------------------
*/

import { projectTitleEl } from "./page.js";
import { setGraphData, state } from "./graph-store.js";
import { generateFallbackData, updateBreadcrumb } from "./graph-model.js";
import { applyFocusMode, selectNode } from "./selection-state.js";

export async function loadView(viewType) {
  projectTitleEl.textContent = `Loading ${viewType} view…`;
  updateBreadcrumb(viewType);

  try {
    const res = await fetch(`/api/graph/${viewType}?projectId=${state.projectId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setGraphData(data.nodes || [], data.edges || []);
    projectTitleEl.textContent = data.projectName || "Active Workspace";
  } catch (err) {
    // Fallback: Generate structured visualization data from client tools
    generateFallbackData(viewType);
  }
}

export async function loadNeighborhood(nodeId) {
  try {
    const res = await fetch(`/api/graph/neighborhood?seedId=${encodeURIComponent(nodeId)}&depth=${state.focusDepth}&projectId=${encodeURIComponent(state.projectId)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    setGraphData(data.nodes || [], data.edges || []);
    selectNode(nodeId);
  } catch {
    applyFocusMode(nodeId);
  }
}

export async function loadImpact(nodeId) {
  try {
    const res = await fetch(`/api/graph/impact?symbol=${encodeURIComponent(nodeId)}&projectId=${encodeURIComponent(state.projectId)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    setGraphData(data.nodes || [], data.edges || []);
    selectNode(nodeId);
  } catch {
    applyFocusMode(nodeId);
  }
}
