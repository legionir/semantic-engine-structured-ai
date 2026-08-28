"use strict";

const { OutputRenderer, COLOURS, formatDuration } = require("./OutputRenderer");
const { InputReader } = require("./InputReader");
const { ApprovalPrompt } = require("./ApprovalPrompt");
const { ReplCommands, COMMANDS } = require("./ReplCommands");
const { Repl, startSession } = require("./Repl");

/*
|--------------------------------------------------------------------------
| Interactive REPL Subsystem — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Entry point for the interactive session module.
|--------------------------------------------------------------------------
*/

module.exports = {
    startSession,
    Repl,
    ReplCommands,
    InputReader,
    OutputRenderer,
    ApprovalPrompt,
    COLOURS,
    COMMANDS,
    formatDuration
};
