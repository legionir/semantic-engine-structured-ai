"use strict";

/*
|--------------------------------------------------------------------------
| Tools facade — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
|
| Implementation lives in ToolRuntime.js and the group modules under
| filesystem/, process/, code/, planning/ and memory/. This file keeps
| the historical require("./tools") surface until Phase 30 (law 7).
|--------------------------------------------------------------------------
*/

const runtime = require("./ToolRuntime");
const ToolRegistryAdapter = require("./ToolRegistryAdapter");

module.exports = {
    ...runtime,
    ToolRegistryAdapter
};
