"use strict";

/*
|--------------------------------------------------------------------------
| Context-kit bindings (EXECUTION_PLAN Phase 17)
|--------------------------------------------------------------------------
|
| Context/memory/archive modules must not require agent.js (cycle). The
| facade binds a host of live closures after those exist. Until bind(),
| host is empty and any accidental call that needs the runtime fails
| loudly. Pure sizing/compaction does not go through host().
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

        throw new Error("context kit is not bound");

    }

    return state.host;

}


module.exports = {
    bind,
    host
};
