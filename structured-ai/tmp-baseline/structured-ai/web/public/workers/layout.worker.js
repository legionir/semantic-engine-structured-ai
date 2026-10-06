/* Deterministic layout worker — EXECUTION_PLAN Phase 25. */

self.onmessage = function (event) {
  const { nodes = [], options = {}, requestId } = event.data || {};
  const width = options.width || 1200;
  const height = options.height || 800;
  const columns = Math.max(3, Math.ceil(Math.sqrt(nodes.length * 1.5)));
  const positions = {};

  nodes.forEach((node, index) => {
    positions[node.id] = {
      x: 100 + (index % columns) * 220,
      y: 100 + Math.floor(index / columns) * 120,
      width,
      height
    };
  });

  self.postMessage({ requestId, positions });
};
