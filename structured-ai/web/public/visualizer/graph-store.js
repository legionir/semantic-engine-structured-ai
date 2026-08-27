/*
|--------------------------------------------------------------------------
| Visualizer graph-store (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| The one mutable thing in the visualizer.
|
| Everything the page remembers — the loaded graph, which node is selected, how deep focus mode reaches, the zoom transform — lives here and nowhere else. That is the phase's independence criterion made checkable: no other module declares a top-level `let`, so state cannot hide in a view.
|
| `setGraphData` is the single writer of nodes and edges, which is also why a reloaded view replaces the graph instead of merging into it: a project switch must not leave the previous project's symbols on screen.
|--------------------------------------------------------------------------
*/

import { edgeCountEl, nodeCountEl, projectIdFromPage } from "./page.js";
import { layoutAndRender } from "./layout-client.js";

export const state = {
  currentView: "architecture",
  projectId: projectIdFromPage(),
  nodes: [],
  edges: [],
  selectedNodeId: null,
  focusDepth: 2,
  resolvedOnly: false,
  zoom: { scale: 1, panX: 0, panY: 0 },
  isDragging: false,
  dragStart: { x: 0, y: 0 },
};

export function setGraphData(nodes, edges) {
  state.nodes = nodes;
  state.edges = edges;
  nodeCountEl.textContent = nodes.length;
  edgeCountEl.textContent = edges.length;
  layoutAndRender();
}
