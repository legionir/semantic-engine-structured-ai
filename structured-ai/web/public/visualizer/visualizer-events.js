/*
|--------------------------------------------------------------------------
| Visualizer visualizer-events (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| The page's listeners, in one place.
|
| View tabs, focus depth, the resolved-only filter, fit/reset, the inspector close, pan and zoom on the container, and the two inspector actions that re-fetch instead of re-filtering. Nothing here computes anything: each handler calls the module that owns the behaviour.
|--------------------------------------------------------------------------
*/

import { container, searchDropdown, searchInput } from "./page.js";
import { state } from "./graph-store.js";
import { loadImpact, loadNeighborhood, loadView } from "./api-client.js";
import { renderGraph } from "./graph-renderer.js";
import { fitGraph, onMouseDown, onMouseMove, onMouseUp, onWheel } from "./viewport.js";
import { applyFocusMode, resetFocus } from "./selection-state.js";
import { onSearchInput } from "./search.js";

export function bindEvents() {
  // View Switcher
  document.querySelectorAll(".view-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".view-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentView = tab.dataset.view;
      loadView(state.currentView);
    });
  });

  // Focus depth
  document.getElementById("focusDepth").addEventListener("change", e => {
    state.focusDepth = parseInt(e.target.value, 10) || 2;
    if (state.selectedNodeId) {
      applyFocusMode(state.selectedNodeId);
    }
  });

  // Resolved only checkbox
  document.getElementById("filterResolvedOnly").addEventListener("change", e => {
    state.resolvedOnly = e.target.checked;
    renderGraph();
  });

  // Fit & Reset buttons
  document.getElementById("fitGraphBtn").addEventListener("click", fitGraph);
  document.getElementById("resetFocusBtn").addEventListener("click", resetFocus);

  // Inspector close
  document.getElementById("closeInspectorBtn").addEventListener("click", () => {
    resetFocus();
  });

  // Pan & Zoom
  container.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  container.addEventListener("wheel", onWheel, { passive: false });

  // Search
  searchInput.addEventListener("input", onSearchInput);
  document.addEventListener("click", e => {
    if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
      searchDropdown.hidden = true;
    }
  });

  // Inspector Action buttons
  document.getElementById("btnExploreNeighborhood").addEventListener("click", () => {
    if (state.selectedNodeId) {
      loadNeighborhood(state.selectedNodeId);
    }
  });

  document.getElementById("btnAnalyzeImpact").addEventListener("click", () => {
    if (state.selectedNodeId) {
      loadImpact(state.selectedNodeId);
    }
  });
}
