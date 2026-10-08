/* Node inspector model and safe DOM renderer — Phase 25. */

import { connectedEdges } from "./graph-model.js";

export function detailsFor(node, nodes, edges) {
  if (!node) return null;
  const connections = connectedEdges(edges, node.id).map(edge => {
    const outbound = edge.source === node.id;
    const otherId = outbound ? edge.target : edge.source;
    const other = (nodes || []).find(item => item.id === otherId);
    return {
      direction: outbound ? "out" : "in",
      relation: edge.relation || "connected",
      id: otherId,
      label: other?.label || otherId
    };
  });
  return {
    type: node.type || "symbol",
    title: node.label || node.id,
    path: node.metadata?.path || "in-memory",
    range: node.metadata?.line
      ? `Line ${node.metadata.line}–${node.metadata.endLine || node.metadata.line}`
      : "Workspace level",
    complexity: node.metadata?.complexity || 1,
    references: node.metadata?.referencesCount || 0,
    confidence: node.metadata?.confidence ?? 100,
    signature: node.metadata?.path
      ? `export ${node.type || "symbol"} ${node.label || node.id} {\n  // defined in ${node.metadata.path}\n}`
      : `// ${node.label || node.id}`,
    connections
  };
}

export function renderDetails(details, elements) {
  if (!details || !elements) return;
  elements.emptyHint.hidden = true;
  elements.details.hidden = false;
  elements.type.textContent = details.type;
  elements.type.className = `node-type-badge ${details.type}`;
  elements.title.textContent = details.title;
  elements.path.textContent = details.path;
  elements.range.textContent = details.range;
  elements.complexity.textContent = details.complexity;
  elements.refs.textContent = details.references;
  elements.confidence.textContent = `${details.confidence}%`;
  elements.signature.textContent = details.signature;
  elements.connections.replaceChildren();
  details.connections.slice(0, 10).forEach(connection => {
    const item = document.createElement("li");
    item.textContent = `${connection.direction === "out" ? "→" : "←"} ${connection.relation} ${connection.label}`;
    elements.connections.appendChild(item);
  });
  if (!details.connections.length) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = "No direct connections in view";
    elements.connections.appendChild(item);
  }
  /*
  | SA-F-006 — the node model carries NO coverage field and no test lookup is
  | performed here. The previous code rendered a per-node fabricated pass-mark
  | …test.ts" row — invented evidence shown as fact (§15: an AI or user
  | reading the inspector would believe a test exists that may not). The
  | honest state of "we did not check" is now displayed; the engine's
  | find_tests tool is named as the way to get the real answer.
  */
  elements.tests.replaceChildren();
  const coverage = document.createElement("li");
  coverage.className = "muted";
  coverage.textContent = "Coverage not known to this view (no test data in the graph model — use the find_tests tool)";
  elements.tests.appendChild(coverage);
}
