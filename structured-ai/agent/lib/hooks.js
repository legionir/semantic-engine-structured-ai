"use strict";

/*
|--------------------------------------------------------------------------
| Legacy hooks facade — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| Hook declaration, conditions, rendering, results and execution now live
| under agent/hooks/. Keep this path for the existing runtime, CLI and tests
| until the final wrapper-removal phase.
|--------------------------------------------------------------------------
*/

module.exports = require("../hooks");
