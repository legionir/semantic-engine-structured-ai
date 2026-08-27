/*
|--------------------------------------------------------------------------\
| Declarative runtime hooks (EXECUTION_PLAN Phase 22)
|--------------------------------------------------------------------------\
|
| `agent/lib/hooks.js` used to hold all of this in one file: the loader, the
| condition language, the template language, and — after this phase, imported
| from `agent.js` — the runner and its result shape.
|
| The barrel keeps the family one require for callers while each concern stays
| reviewable on its own. `lib/hooks.js` remains a facade over this module, so
| nothing outside it changes.
|--------------------------------------------------------------------------*/

const hookRegistry = require("./HookRegistry");
const HookLoader = require("./HookLoader");
const HookCondition = require("./HookCondition");
const HookRenderer = require("./HookRenderer");
const HookResult = require("./HookResult");
const HookRunner = require("./HookRunner");


module.exports = {
    /* the read-side facade `agent.js` keeps calling as `hookRegistry` */
    ...hookRegistry,
    hookRegistry,

    /* execution: bind the live runtime, then run a phase */
    runHooks: HookRunner.runHooks,
    bind: HookRunner.bind,

    HookLoader,
    HookCondition,
    HookRenderer,
    HookResult,
    HookRunner
};
