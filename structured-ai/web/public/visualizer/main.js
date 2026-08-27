/*
|--------------------------------------------------------------------------
| Visualizer main (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| Boot: bind, then load the default view.
|
| The page ends with `window.addEventListener("DOMContentLoaded", init)`; as a module this file is deferred, so the DOM exists when page.js resolves its ids, and DOMContentLoaded still fires after module evaluation — the order the classic script relied on is kept by the platform rather than by where the tag sits.
|--------------------------------------------------------------------------
*/

import { loadView } from "./api-client.js";
import { bindEvents } from "./visualizer-events.js";

/*
|--------------------------------------------------------------------------
| Project Intelligence Visualizer Client
|--------------------------------------------------------------------------
|
| Handles Level of Detail (LoD) graph rendering, progressive drill-down,
| focus mode, search-to-graph highlights, and the 360° Symbol Inspector.
|--------------------------------------------------------------------------
*/

export function init() {
  bindEvents();
  loadView("architecture");
}

window.addEventListener("DOMContentLoaded", init);
