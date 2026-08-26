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
const { RunScheduler, runScheduler, schedulerEnabled } = require("./RunScheduler");
const { Observability, observability } = require("./Observability");
const {
    runWithProject,
    overrideActive,
    effectiveProject,
    effectiveProjectId,
    projectIdOf,
    noteDelegationProject,
    isMultiProjectTask
} = require("./ProjectOverride");

observability.attach();

runScheduler.memoryFor = key => {

    const bucket = observability.projects.get(key);

    return bucket ? bucket.project_memory_bytes : 0;
};


function runContextMode() {

    return (
        settings.get("RUN_CONTEXT_MODE") === "modular"
            ? "modular"
            : "legacy"
    );

}


const { runtimeEngineMode } = require("./engineContext");


module.exports = {
    AgentRunContext,
    RunCancellation,
    RunBudget,
    AgentSpawnBudget,
    RunManager,
    runManager,
    RunScheduler,
    runScheduler,
    schedulerEnabled,
    Observability,
    observability,
    runContextMode,
    runtimeEngineMode,
    runWithProject,
    overrideActive,
    effectiveProject,
    effectiveProjectId,
    projectIdOf,
    noteDelegationProject,
    isMultiProjectTask
};
