/*
 * Visualizer API client — EXECUTION_PLAN Phase 25.
 * All URLs are relative to the console origin and every project id is
 * encoded before crossing the browser/server boundary.
 */

export function projectIdFromLocation(location = globalThis.location) {
  try {
    return new URLSearchParams(location?.search || "").get("projectId") || "current";
  } catch {
    return "current";
  }
}


export function graphUrl(view, { projectId = "current", seedId, depth, symbol } = {}) {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (seedId !== undefined) params.set("seedId", seedId);
  if (depth !== undefined) params.set("depth", String(depth));
  if (symbol !== undefined) params.set("symbol", symbol);
  return `/api/graph/${encodeURIComponent(view)}?${params.toString()}`;
}


async function read(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}


export async function fetchGraph(view, options = {}, fetcher = globalThis.fetch) {
  return read(await fetcher(graphUrl(view, options)));
}

export async function fetchNeighborhood(nodeId, options = {}, fetcher = globalThis.fetch) {
  return read(await fetcher(graphUrl("neighborhood", { ...options, seedId: nodeId })));
}

export async function fetchImpact(nodeId, options = {}, fetcher = globalThis.fetch) {
  return read(await fetcher(graphUrl("impact", { ...options, symbol: nodeId })));
}
