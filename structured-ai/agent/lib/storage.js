"use strict";

/*
|--------------------------------------------------------------------------
| Settings Storage (legacy wrapper) — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Implementation lives in agent/config/. This file keeps the historical
| require("./lib/storage") path bit-identical until Phase 30 removes
| the wrapper.
|--------------------------------------------------------------------------
*/

module.exports = require("../config");
