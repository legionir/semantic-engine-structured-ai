/* Pure graph model operations — EXECUTION_PLAN Phase 25. */

export function confidenceOf(edge) {
  return edge?.metadata?.confidence ?? 100;
}

export function visibleEdges(edges, resolvedOnly = false) {
  return (edges || []).filter(edge => !resolvedOnly || confidenceOf(edge) >= 70);
}

export function nodesWithinFocus(nodes, edges, nodeId, depth = 2) {
  const ids = new Set([nodeId]);
  let frontier = [nodeId];
  for (let level = 0; level < Math.max(0, depth); level += 1) {
    const next = [];
    frontier.forEach(current => {
      (edges || []).forEach(edge => {
        const other = edge.source === current ? edge.target
          : edge.target === current ? edge.source
            : null;
        if (other && !ids.has(other)) {
          ids.add(other);
          next.push(other);
        }
      });
    });
    frontier = next;
  }
  return new Set((nodes || []).filter(node => ids.has(node.id)).map(node => node.id));
}

export function layoutGrid(nodes, { width = 1200, height = 800, spacingX = 220, spacingY = 120 } = {}) {
  const columns = Math.max(3, Math.ceil(Math.sqrt((nodes || []).length * 1.5)));
  return Object.fromEntries((nodes || []).map((node, index) => [
    node.id,
    {
      x: 100 + (index % columns) * spacingX,
      y: 100 + Math.floor(index / columns) * spacingY,
      width,
      height
    }
  ]));
}

export function applyPositions(nodes, positions) {
  return (nodes || []).map(node => ({
    ...node,
    ...(positions?.[node.id] || {})
  }));
}

export function searchNodes(nodes, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (needle.length < 2) return [];
  return (nodes || []).filter(node =>
    String(node.label || "").toLowerCase().includes(needle) ||
    String(node.metadata?.path || "").toLowerCase().includes(needle)
  );
}

export function connectedEdges(edges, nodeId) {
  return (edges || []).filter(edge => edge.source === nodeId || edge.target === nodeId);
}

export function graphBounds(nodes, padding = 100) {
  const values = nodes || [];
  if (!values.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const xs = values.map(node => Number(node.x) || 0);
  const ys = values.map(node => Number(node.y) || 0);
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function fallbackData(viewType = "architecture") {
  const baseNodes = [
    { id: "mod-auth", type: "module", label: "Auth Module", metadata: { path: "src/auth" } },
    { id: "mod-users", type: "module", label: "Users Module", metadata: { path: "src/users" } },
    { id: "api-login", type: "api", label: "POST /auth/login", metadata: { path: "src/auth/login.ts" } },
    { id: "class-auth-service", type: "class", label: "AuthService", metadata: { path: "src/auth/auth.service.ts", line: 10, endLine: 45, complexity: 4, referencesCount: 12 } },
    { id: "fn-login", type: "function", label: "login()", metadata: { path: "src/auth/auth.service.ts", line: 15, endLine: 35, complexity: 3, referencesCount: 8 } },
    { id: "class-user-repo", type: "class", label: "UserRepository", metadata: { path: "src/users/user.repo.ts", line: 5, endLine: 50, complexity: 2, referencesCount: 18 } }
  ];
  const baseEdges = [
    { id: "e1", source: "api-login", target: "fn-login", relation: "calls", metadata: { confidence: 95 } },
    { id: "e2", source: "class-auth-service", target: "fn-login", relation: "contains", metadata: { confidence: 100 } },
    { id: "e3", source: "fn-login", target: "class-user-repo", relation: "calls", metadata: { confidence: 90 } },
    { id: "e4", source: "mod-auth", target: "mod-users", relation: "depends_on", metadata: { confidence: 85 } }
  ];
  if (viewType === "hotspots") {
    return {
      nodes: baseNodes.slice(0, 3).map((node, index) => ({
        ...node,
        id: `hot-${index + 1}`,
        type: "file",
        label: `${node.label}.ts (Hotspot)`
      })),
      edges: baseEdges.slice(0, 1)
    };
  }
  return { nodes: baseNodes, edges: baseEdges };
}
