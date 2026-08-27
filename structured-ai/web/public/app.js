"use strict";

/*
|--------------------------------------------------------------------------
| Web Console — compatibility entry point
|--------------------------------------------------------------------------
|
| The console used to be this one file. It is now a graph of native ES modules
| under app/ (store, dom, formatters, markdown, direction, the views, api,
| event-stream, task-runner, the project modules and main.js), and the page loads
| app/main.js as a module.
|
| This file stays for CommonJS consumers — the test harness in particular, which
| requires the console to run it against a DOM shim. Node's dynamic import() works
| for both, so the harness uses that; this bridge is what keeps `require()`
| working on Node >= 20.19, where requiring an ESM graph is allowed.
|
| Nothing loads it in the browser any more, and that is safe for a specific
| reason rather than by luck: the static server answers with
| `cache-control: no-store`, so an old index.html cannot be served from cache
| pointing here. Rule 7 keeps the wrapper until phase 30 deletes it.
|
--------------------------------------------------------------------------
*/

module.exports = require("./app/main.js");
