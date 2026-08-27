"use strict";

/*
|--------------------------------------------------------------------------
| Action-kit runtime bindings (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| The parser/validator modules must not require agent.js (that would be a
| cycle). Live registry, event bus and logLine are therefore injected by
| the facade after those closures exist. settings is the same singleton
| agent.js already uses (agent/lib/storage → agent/config).
|--------------------------------------------------------------------------
*/

const storage = require("../lib/storage");

const state = {
    toolsOf: () => [],
    settings: storage,
    events: { emit() {} },
    logLine() {}
};


function bind(deps) {

    if (!deps || typeof deps !== "object") {
        return;
    }

    if (typeof deps.toolsOf === "function") {
        state.toolsOf = deps.toolsOf;
    }

    if (deps.settings) {
        state.settings = deps.settings;
    }

    if (deps.events) {
        state.events = deps.events;
    }

    if (typeof deps.logLine === "function") {
        state.logLine = deps.logLine;
    }

}


module.exports = {
    bind,
    get toolsOf() {
        return state.toolsOf;
    },
    get settings() {
        return state.settings;
    },
    get events() {
        return state.events;
    },
    get logLine() {
        return state.logLine;
    }
};
