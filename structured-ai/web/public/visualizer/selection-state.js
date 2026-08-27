/*
|--------------------------------------------------------------------------
| Visualizer selection-state (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| Selecting a node and what selection does to the picture.
|
| `applyFocusMode` walks the graph outward to `focusDepth` over both edge directions and marks everything outside that set `dimmed`; the selected node gets `focused`, edges touching it get `active`. `resetFocus` is the only way out, and the inspector's close button calls it — so "closed" and "no selection" cannot drift apart.
|--------------------------------------------------------------------------
*/

import { emptyHint, inspTitle, inspectorDetails } from "./page.js";
import { state } from "./graph-store.js";
import { openInspector } from "./node-details.js";

export function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;

  applyFocusMode(nodeId);
  openInspector(node);
}

export function applyFocusMode(nodeId) {
  // Find nodes within focusDepth
  const neighborIds = new Set([nodeId]);
  let frontier = [nodeId];

  for (let d = 0; d < state.focusDepth; d++) {
    const nextFrontier = [];
    frontier.forEach(curr => {
      state.edges.forEach(edge => {
        if (edge.source === curr && !neighborIds.has(edge.target)) {
          neighborIds.add(edge.target);
          nextFrontier.push(edge.target);
        }
        if (edge.target === curr && !neighborIds.has(edge.source)) {
          neighborIds.add(edge.source);
          nextFrontier.push(edge.source);
        }
      });
    });
    frontier = nextFrontier;
  }

  // Update SVG classes
  document.querySelectorAll(".graph-node").forEach(el => {
    const id = el.id.replace(/^node-/, "");
    if (id === nodeId) {
      el.classList.add("focused");
      el.classList.remove("dimmed");
    } else if (neighborIds.has(id)) {
      el.classList.remove("focused", "dimmed");
    } else {
      el.classList.remove("focused");
      el.classList.add("dimmed");
    }
  });

  document.querySelectorAll(".graph-edge").forEach(el => {
    const src = el.getAttribute("data-source");
    const tgt = el.getAttribute("data-target");
    if (neighborIds.has(src) && neighborIds.has(tgt)) {
      el.classList.remove("dimmed");
      if (src === nodeId || tgt === nodeId) el.classList.add("active");
      else el.classList.remove("active");
    } else {
      el.classList.add("dimmed");
      el.classList.remove("active");
    }
  });
}

export function resetFocus() {
  state.selectedNodeId = null;
  document.querySelectorAll(".graph-node").forEach(el => el.classList.remove("focused", "dimmed"));
  document.querySelectorAll(".graph-edge").forEach(el => el.classList.remove("active", "dimmed"));
  emptyHint.hidden = false;
  inspectorDetails.hidden = true;
  inspTitle.textContent = "Select a node";
}
