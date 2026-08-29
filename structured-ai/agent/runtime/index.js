/*
|--------------------------------------------------------------------------
| Runtime (per-run context)
|--------------------------------------------------------------------------
|
| Phase 3 of EXECUTION_PLAN: per-run context and scheduling are the
| canonical runtime boundary. Each run is isolated with async-local state.
|--------------------------------------------------------------------------
*/

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
    runWithProject,
    overrideActive,
    effectiveProject,
    effectiveProjectId,
    projectIdOf,
    noteDelegationProject,
    isMultiProjectTask
};
