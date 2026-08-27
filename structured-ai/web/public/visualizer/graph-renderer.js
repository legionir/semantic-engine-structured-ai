/*
|--------------------------------------------------------------------------
| Visualizer graph-renderer (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| Drawing nodes and edges into the SVG.
|
| Shapes by node type, `type-<kind>` classes the stylesheet keys on, a dashed edge below 70% confidence, labels truncated for the box — and click/dblclick handlers bound to the node group itself, so selection and drill-down are one gesture away from the data that produced them.
|--------------------------------------------------------------------------
*/

import { svg } from "./page.js";
import { state } from "./graph-store.js";
import { drillDown } from "./graph-model.js";
import { selectNode } from "./selection-state.js";

export function renderGraph() {
  svg.innerHTML = "";

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", "viewport");
  g.setAttribute("transform", `translate(${state.zoom.panX}, ${state.zoom.panY}) scale(${state.zoom.scale})`);

  // Render Edges
  state.edges.forEach(edge => {
    if (state.resolvedOnly && (edge.metadata?.confidence || 100) < 70) {
      return;
    }

    const src = state.nodes.find(n => n.id === edge.source);
    const tgt = state.nodes.find(n => n.id === edge.target);
    if (!src || !tgt) return;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const isSolid = (edge.metadata?.confidence || 100) >= 70;
    path.setAttribute("class", `graph-edge ${isSolid ? "solid" : "dashed"}`);
    path.setAttribute("data-source", edge.source);
    path.setAttribute("data-target", edge.target);

    const d = `M ${src.x} ${src.y} Q ${(src.x + tgt.x) / 2} ${(src.y + tgt.y) / 2 - 20} ${tgt.x} ${tgt.y}`;
    path.setAttribute("d", d);
    g.appendChild(path);
  });

  // Render Nodes
  state.nodes.forEach(node => {
    const nodeG = document.createElementNS("http://www.w3.org/2000/svg", "g");
    nodeG.setAttribute("class", `graph-node type-${node.type}`);
    nodeG.setAttribute("id", `node-${node.id}`);
    nodeG.setAttribute("transform", `translate(${node.x}, ${node.y})`);

    let shape;
    if (node.type === "module") {
      shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      shape.setAttribute("x", "-80");
      shape.setAttribute("y", "-30");
      shape.setAttribute("width", "160");
      shape.setAttribute("height", "60");
      shape.setAttribute("rx", "8");
      shape.setAttribute("fill", "#1c2128");
      shape.setAttribute("stroke", "#8957e5");
    } else if (node.type === "api") {
      shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      shape.setAttribute("points", "-60,-24 60,-24 75,0 60,24 -60,24 -75,0");
      shape.setAttribute("fill", "#1c2128");
      shape.setAttribute("stroke", "#d29922");
    } else if (node.type === "workflow") {
      shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      shape.setAttribute("points", "0,-30 70,0 0,30 -70,0");
      shape.setAttribute("fill", "#1c2128");
      shape.setAttribute("stroke", "#db6d28");
    } else {
      shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      shape.setAttribute("x", "-70");
      shape.setAttribute("y", "-22");
      shape.setAttribute("width", "140");
      shape.setAttribute("height", "44");
      shape.setAttribute("rx", node.type === "class" ? "12" : "4");
      shape.setAttribute("fill", "#161b22");
      shape.setAttribute("stroke", node.type === "class" ? "#2ea043" : "#388bfd");
    }

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = truncate(node.label, 18);

    nodeG.appendChild(shape);
    nodeG.appendChild(text);

    nodeG.addEventListener("click", e => {
      e.stopPropagation();
      selectNode(node.id);
    });

    nodeG.addEventListener("dblclick", e => {
      e.stopPropagation();
      drillDown(node);
    });

    g.appendChild(nodeG);
  });

  svg.appendChild(g);
}

export function truncate(str, len = 20) {
  if (!str) return "";
  return str.length <= len ? str : str.slice(0, len - 1) + "…";
}
