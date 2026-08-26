"use strict";

/*
|--------------------------------------------------------------------------
| Web server facade — EXECUTION_PLAN Phase 23
|--------------------------------------------------------------------------
|
| WEB_SERVER_MODE is the only rollout switch. Legacy remains the default so
| existing launchers keep their historical server object and behaviour;
| modular mode uses web/server/WebServer.js and its router/controllers.
|--------------------------------------------------------------------------
*/

const { createServer: createLegacyServer } = require("./server/LegacyWebServer");
const { createServer: createModularServer } = require("./server/WebServer");


function webServerMode(runtime, options = {}) {

    const requested =
        options.mode ||
        (runtime?.settings && typeof runtime.settings.get === "function"
            ? runtime.settings.get("WEB_SERVER_MODE")
            : "legacy");

    return requested === "modular"
        ? "modular"
        : "legacy";
}


function createServer(runtime, options = {}) {

    return webServerMode(runtime, options) === "modular"
        ? createModularServer(runtime, options)
        : createLegacyServer(runtime, options);
}


module.exports = {
    createServer,
    webServerMode
};
