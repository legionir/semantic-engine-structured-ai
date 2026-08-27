"use strict";

/*
|--------------------------------------------------------------------------
| Runtime-engine bindings (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| The loop modules must not require agent.js (cycle). The facade binds a
| host of live closures after those exist. Until bind(), host is empty
| and any accidental call fails loudly.
|--------------------------------------------------------------------------
*/

const state = {
    host: null
};


function bind(host) {

    if (!host || typeof host !== "object") {
        return;
    }

    state.host = host;

}


function host() {

    if (!state.host) {

        throw new Error("runtime engine is not bound");

    }

    return state.host;

}


function runtimeEngineMode() {

    const settings = host().settings;

    return (
        settings.get("RUNTIME_ENGINE_MODE") === "modular"
            ? "modular"
            : "legacy"
    );

}


module.exports = {
    bind,
    host,
    runtimeEngineMode
};
