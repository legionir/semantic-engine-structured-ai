/*
|--------------------------------------------------------------------------
| Visualizer layout-client (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| Where positions come from.
|
| Today: a deterministic hierarchical grid, computed on the main thread. The page also ships `web/public/workers/layout.worker.js` — a spring-embedder that posts `{positions}` — and **nothing instantiates it**: no `new Worker` exists in this client or anywhere else in the package (measured, and recorded in EXECUTION_PLAN as a gap with its own step). Wiring it is not part of a move: the worker seeds with `Math.random()`, so positions would stop being reproducible, every trace and test would have to be rewritten around that, and "layout behaviour is unchanged" would become false. The module is named for the job so the seam exists when that step is taken deliberately.
|--------------------------------------------------------------------------
*/

import { state } from "./graph-store.js";
import { renderGraph } from "./graph-renderer.js";
import { fitGraph } from "./viewport.js";

export function layoutAndRender() {
  // Simple hierarchical grid & layer layout
  const cols = Math.max(3, Math.ceil(Math.sqrt(state.nodes.length * 1.5)));
  const spacingX = 220;
  const spacingY = 120;

  state.nodes.forEach((node, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    node.x = 100 + col * spacingX;
    node.y = 100 + row * spacingY;
  });

  renderGraph();
  fitGraph();
}
