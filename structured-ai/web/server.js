"use strict";

/*
| Canonical web server entry point — EXECUTION_PLAN Phase 30.
| The extracted WebServer is now the only implementation; no rollout flag
| or compatibility server is selected at runtime.
*/

module.exports = require("./server/WebServer");
