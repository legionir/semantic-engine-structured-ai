/*
|--------------------------------------------------------------------------
| Visualizer page (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| Every element the visualizer touches, resolved once.
|
| The page's own ids and two classes — nothing from the chat console, and nothing the console owns. Reading them here rather than in each view makes "which DOM does this page need" a single list, and it is why the module graph can be loaded by a test with a 300-line shim.
|--------------------------------------------------------------------------
*/

export function projectIdFromPage() {

  try {

    const params = new URLSearchParams(window.location.search);
    return params.get("projectId") || "current";

  } catch {

    return "current";
  }
}

export const svg = document.getElementById("graphSvg");

export const container = document.getElementById("canvasContainer");

export const nodeCountEl = document.getElementById("nodeCount");

export const edgeCountEl = document.getElementById("edgeCount");

export const projectTitleEl = document.getElementById("projectTitle");

export const inspectorSidebar = document.getElementById("inspectorSidebar");

export const inspectorDetails = document.getElementById("inspectorDetails");

export const emptyHint = document.querySelector(".empty-hint");

export const inspType = document.getElementById("inspType");

export const inspTitle = document.getElementById("inspTitle");

export const inspPath = document.getElementById("inspPath");

export const inspRange = document.getElementById("inspRange");

export const inspComplexity = document.getElementById("inspComplexity");

export const inspRefs = document.getElementById("inspRefs");

export const inspConfidence = document.getElementById("inspConfidence");

export const inspSignature = document.getElementById("inspSignature");

export const inspConnections = document.getElementById("inspConnections");

export const inspTests = document.getElementById("inspTests");

export const searchInput = document.getElementById("graphSearch");

export const searchDropdown = document.getElementById("searchResults");
