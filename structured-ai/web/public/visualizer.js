"use strict";

/*
|--------------------------------------------------------------------------
| Project Intelligence Visualizer — compatibility entry
|--------------------------------------------------------------------------
|
| The client used to be this one file. It is now a graph of native ES modules
| under visualizer/ (page, graph-store, graph-model, api-client, graph-renderer,
| layout-client, viewport, selection-state, node-details, search,
| visualizer-events, main) and visualizer.html loads visualizer/main.js as a
| module.
|
| This file answers to two worlds at once, which is why it looks odd:
|
|   • a browser may still load it as a classic script (an old tab, a bookmark),
|     and the only way a classic script can pull in a module graph is import();
|   • Node reads it as CommonJS, and the visualizer's test harness requires it
|     to prove the bridge is not a decoration: the trace recorded from this file
|     must equal the trace recorded from visualizer/main.js.
|
| Rule 7 keeps the wrapper until phase 30 deletes it.
|
--------------------------------------------------------------------------
*/

if (typeof module !== "undefined" && module.exports) {

    module.exports = require("./visualizer/main.js");

} else {

    import("./visualizer/main.js").catch(error => {

        console.error("visualizer failed to load", error);
    });
}
