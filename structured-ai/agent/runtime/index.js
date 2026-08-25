/*
|--------------------------------------------------------------------------
| Runtime (per-run context)
|--------------------------------------------------------------------------
|
| Phase 3 of EXECUTION_PLAN: the per-run context modules, gated by the
| RUN_CONTEXT_MODE setting ('legacy' default, 'modular' for isolated
| concurrent runs). Anything above an empty/unknown value behaves as
| legacy, so a misspelled flag can never silently fork the engine.
|--------------------------------------------------------------------------
*/

const settings = require("../lib/storage");

const AgentRunContext = require("./AgentRunContext");
const RunCancellation = require("./RunCancellation");
const { RunBudget, AgentSpawnBudget } = require("./RunBudget");
const { RunManager, runManager } = require("./RunManager");


function runContextMode() {

    return (
        settings.get("RUN_CONTEXT_MODE") === "modular"
            ? "modular"
            : "legacy"
    );

}


module.exports = {
    AgentRunContext,
    RunCancellation,
    RunBudget,
    AgentSpawnBudget,
    RunManager,
    runManager,
    runContextMode
};
