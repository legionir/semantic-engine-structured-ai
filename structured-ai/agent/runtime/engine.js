"use strict";

/*
|--------------------------------------------------------------------------
| Runtime engine kit (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Facade over the extracted loop. bind() is called from agent.js once the
| live closures exist. Both RUNTIME_ENGINE_MODE values run this engine
| (a move, not a fork — decision 35).
|--------------------------------------------------------------------------
*/

const context = require("./engineContext");
const RunState = require("./RunState");
const RetryController = require("./RetryController");
const ReportVerifier = require("./ReportVerifier");
const ToolGraphExecutor = require("./ToolGraphExecutor");
const DelegationRunner = require("./DelegationRunner");
const ActionProcessor = require("./ActionProcessor");
const IterationRunner = require("./IterationRunner");
const AgentRun = require("./AgentRun");


module.exports = {
    bind: context.bind,
    host: context.host,
    runtimeEngineMode: context.runtimeEngineMode,

    ...RunState,
    ...RetryController,
    ...ReportVerifier,
    ...ToolGraphExecutor,
    ...DelegationRunner,
    processAction: ActionProcessor.process,
    ...IterationRunner,
    ...AgentRun
};
