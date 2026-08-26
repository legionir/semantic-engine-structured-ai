"use strict";

/*
|--------------------------------------------------------------------------
| Process group — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
*/

const ProcessManager = require("./ProcessManager");
const ForegroundCommand = require("./ForegroundCommand");
const BackgroundSession = require("./BackgroundSession");

module.exports = {
    ...ForegroundCommand,
    ...BackgroundSession,

    shutdownAll: ProcessManager.shutdownAll,

    _sessions: ProcessManager.SESSIONS
};
