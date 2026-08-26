/* SVG graph renderer — EXECUTION_PLAN Phase 25. */

import { confidenceOf, visibleEdges } from "./graph-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function truncate(value, length = 18) {
  const text = String(value || "");
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function shapeFor(node) {
  if (node.type === "module") return ["rect", { x: -80, y: -30, width: 160, height: 60, rx: 8, fill: "#1c2128", stroke: "#8957e5" }];
  if (node.type === "api") return ["polygon", { points: "-60,-24 60,-24 75,0 60,24 -60,24 -75,0", fill: "#1c2128", stroke: "#d29922" }];
  if (node.type === "workflow") return ["polygon", { points: "0,-30 70,0 0,30 -70,0", fill: "#1c2128", stroke: "#db6d28" }];
  return ["rect", { x: -70, y: -22, width: 140, height: 44, rx: node.type === "class" ? 12 : 4, fill: "#161b22", stroke: node.type === "class" ? "#2ea043" : "#388bfd" }];
}

export class GraphRenderer {
  constructor({ svg, onSelect, onDrillDown } = {}) {
    this.svg = svg;
    this.onSelect = onSelect || (() => {});
    this.onDrillDown = onDrillDown || (() => {});
  }

  render(nodes, edges, { resolvedOnly = false, zoom = { scale: 1, panX: 0, panY: 0 } } = {}) {
    if (!this.svg) return;
    this.svg.replaceChildren();
    const viewport = document.createElementNS(SVG_NS, "g");
    viewport.id = "viewport";
    viewport.setAttribute("transform", `translate(${zoom.panX}, ${zoom.panY}) scale(${zoom.scale})`);

    visibleEdges(edges, resolvedOnly).forEach(edge => {
      const source = nodes.find(node => node.id === edge.source);
      const target = nodes.find(node => node.id === edge.target);
      if (!source || !target) return;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", `graph-edge ${confidenceOf(edge) >= 70 ? "solid" : "dashed"}`);
      path.dataset.source = edge.source;
      path.dataset.target = edge.target;
      path.setAttribute("d", `M ${source.x || 0} ${source.y || 0} Q ${((source.x || 0) + (target.x || 0)) / 2} ${((source.y || 0) + (target.y || 0)) / 2 - 20} ${target.x || 0} ${target.y || 0}`);
      viewport.appendChild(path);
    });

    nodes.forEach(node => {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", `graph-node type-${node.type || "symbol"}`);
      group.id = `node-${node.id}`;
      group.setAttribute("transform", `translate(${node.x || 0}, ${node.y || 0})`);
      const [tag, attributes] = shapeFor(node);
      const shape = document.createElementNS(SVG_NS, tag);
      Object.entries(attributes).forEach(([key, value]) => shape.setAttribute(key, String(value)));
      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = truncate(node.label);
      group.append(shape, text);
      group.addEventListener("click", event => {
        event.stopPropagation();
        this.onSelect(node.id);
      });
      group.addEventListener("dblclick", event => {
        event.stopPropagation();
        this.onDrillDown(node);
      });
      viewport.appendChild(group);
    });

    this.svg.appendChild(viewport);
  }

  transform(zoom) {
    const viewport = this.svg?.querySelector("#viewport");
    if (viewport) viewport.setAttribute("transform", `translate(${zoom.panX}, ${zoom.panY}) scale(${zoom.scale})`);
  }
}
