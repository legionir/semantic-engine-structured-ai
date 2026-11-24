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


module.exports = {
    bind,
    host,
};
