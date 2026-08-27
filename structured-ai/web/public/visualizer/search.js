/*
|--------------------------------------------------------------------------
| Visualizer search (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| Search-to-graph: the box under the header, not a separate page.
|
| Two characters before it looks, matches on label or path over the loaded graph only, eight results maximum, and picking one selects *and* centres it — so search is a way to move inside the picture rather than a query that replaces it.
|--------------------------------------------------------------------------
*/

import { searchDropdown, searchInput } from "./page.js";
import { state } from "./graph-store.js";
import { centerNode } from "./viewport.js";
import { selectNode } from "./selection-state.js";

export async function onSearchInput(e) {
  const q = e.target.value.trim().toLowerCase();
  if (q.length < 2) {
    searchDropdown.hidden = true;
    return;
  }

  const matches = state.nodes.filter(n => n.label.toLowerCase().includes(q) || (n.metadata?.path && n.metadata.path.toLowerCase().includes(q)));

  searchDropdown.innerHTML = "";
  if (matches.length === 0) {
    searchDropdown.innerHTML = "<div class='search-item muted'>No symbols or files found</div>";
  } else {
    matches.slice(0, 8).forEach(node => {
      const item = document.createElement("div");
      item.className = "search-item";
      item.innerHTML = `<span>${node.label}</span><span class="search-item-kind">${node.type}</span>`;
      item.addEventListener("click", () => {
        searchDropdown.hidden = true;
        searchInput.value = node.label;
        selectNode(node.id);
        centerNode(node);
      });
      searchDropdown.appendChild(item);
    });
  }
  searchDropdown.hidden = false;
}
