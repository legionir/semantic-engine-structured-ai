"use strict";

/*
|--------------------------------------------------------------------------
| Hooks kit — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| The default HookRegistry is the legacy-compatible facade. Named modules
| are exported alongside it so new runtime code can depend on one concern
| at a time without making `agent.js` a dependency of the hook layer.
|--------------------------------------------------------------------------
*/

const registry = require("./HookRegistry");
const HookCondition = require("./HookCondition");
const HookRenderer = require("./HookRenderer");
const HookLoader = require("./HookLoader");
const HookResult = require("./HookResult");
const HookRunner = require("./HookRunner");


module.exports = {
    ...registry,
    HookCondition,
    HookRenderer,
    HookLoader: HookLoader.HookLoader,
    HookResult,
    HookRunner: HookRunner.HookRunner
};
