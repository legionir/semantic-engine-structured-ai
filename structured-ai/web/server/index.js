"use strict";

/*
|--------------------------------------------------------------------------
| Web console entry (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The entry point of the split console: read the mode, compose the server
| behind it.
|
| `WEB_SERVER_MODE` reaches WebServer so the value a boot was started with is
| visible from the inside, and both values reach the same composition — a
| move, not a fork (decision 42). The flag's only other reader is
| test/web/layer.test.js, which asserts the default, the misspelling and the
| equality of the two modes.
|
| web/server.js is the compatible entry today's callers require; it forwards
| here. It exports `createServer` and nothing else, exactly as the monolith
| did, so `bin/agent.js --serve` and every test boot unchanged.
|--------------------------------------------------------------------------
*/

const { createServer: createWebServer } = require("./WebServer");
const { webServerMode } = require("./ServerMode");

function createServer(runtime, options = {}) {

    const mode = webServerMode(runtime);

    return createWebServer(runtime, options, { mode });
}

module.exports = {
    createServer,
    webServerMode
};
