"use strict";

/*
|--------------------------------------------------------------------------
| Tools facade — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
|
| ToolRuntime and the named group modules are exposed through this
| canonical public entry point.
|--------------------------------------------------------------------------
*/

const runtime = require("./ToolRuntime");
const ToolRegistryAdapter = require("./ToolRegistryAdapter");

module.exports = {
    ...runtime,
    ToolRegistryAdapter
};
