/*
|--------------------------------------------------------------------------
| Visualizer viewport (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| Pan, zoom, fit and the transform they share.
|
| Wheel zoom is anchored at the cursor (the pan is adjusted by the same ratio as the scale), fit clamps to 0.4–1.2 and centres, and every gesture writes the same `translate(x, y) scale(s)` onto `#viewport` — the one element both the renderer and the viewport math agree on.
|--------------------------------------------------------------------------
*/

import { container } from "./page.js";
import { state } from "./graph-store.js";

export function centerNode(node) {
  const rect = container.getBoundingClientRect();
  state.zoom.panX = rect.width / 2 - node.x * state.zoom.scale;
  state.zoom.panY = rect.height / 2 - node.y * state.zoom.scale;
  updateViewportTransform();
}

export function fitGraph() {
  if (state.nodes.length === 0) return;
  const rect = container.getBoundingClientRect();
  const minX = Math.min(...state.nodes.map(n => n.x)) - 100;
  const maxX = Math.max(...state.nodes.map(n => n.x)) + 100;
  const minY = Math.min(...state.nodes.map(n => n.y)) - 100;
  const maxY = Math.max(...state.nodes.map(n => n.y)) + 100;

  const w = maxX - minX;
  const h = maxY - minY;
  const scale = Math.min(1.2, Math.max(0.4, Math.min(rect.width / w, rect.height / h)));

  state.zoom.scale = scale;
  state.zoom.panX = (rect.width - w * scale) / 2 - minX * scale;
  state.zoom.panY = (rect.height - h * scale) / 2 - minY * scale;
  updateViewportTransform();
}

export function updateViewportTransform() {
  const vp = document.getElementById("viewport");
  if (vp) {
    vp.setAttribute("transform", `translate(${state.zoom.panX}, ${state.zoom.panY}) scale(${state.zoom.scale})`);
  }
}

export function onMouseDown(e) {
  if (e.target.closest(".graph-node")) return;
  state.isDragging = true;
  state.dragStart = { x: e.clientX - state.zoom.panX, y: e.clientY - state.zoom.panY };
}

export function onMouseMove(e) {
  if (!state.isDragging) return;
  state.zoom.panX = e.clientX - state.dragStart.x;
  state.zoom.panY = e.clientY - state.dragStart.y;
  updateViewportTransform();
}

export function onMouseUp() {
  state.isDragging = false;
}

export function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.min(2.5, Math.max(0.2, state.zoom.scale * delta));

  const rect = container.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  state.zoom.panX = mouseX - (mouseX - state.zoom.panX) * (newScale / state.zoom.scale);
  state.zoom.panY = mouseY - (mouseY - state.zoom.panY) * (newScale / state.zoom.scale);
  state.zoom.scale = newScale;

  updateViewportTransform();
}
