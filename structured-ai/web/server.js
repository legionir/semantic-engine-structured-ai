"use strict";

/*
|--------------------------------------------------------------------------
| Web Console — compatibility entry point
|--------------------------------------------------------------------------
|
| `createServer(runtime, options)` used to be a single 3,139-line function in
| this file. It is now composed from web/server/ (WebServer, Router,
| Middleware, SseHub, services/, controllers/, serializers/) and this file is
| the wrapper the plan keeps until phase 30: `bin/agent.js --serve` and every
| test still require web/server.js and get the same five-key handle back.
|
| Why a wrapper at all, and not just a moved file: the console's module graph
| is a contract other people's code depends on. `require("./web/server.js")`
| appears in the CLI and in five test files; a rename would have been a
| breaking change in a phase whose acceptance criteria say responses and status
| codes are untouched. Rule 7 keeps legacy wrappers for exactly this.
|
| WEB_SERVER_MODE is read by web/server/index.js and reported to the server.
| Both of its values compose the same modules — this split is a move, not a
| fork, and a second monolith to compare against is the only thing that could
| make the halves drift (decision 42).
|
| What lives where:
|
|   web/server/WebServer.js       state, wiring, the socket, listen/close
|   web/server/Router.js          which URL is which handler, in the old order
|   web/server/Middleware.js      token, rate limit, same-origin gate, cookie
|   web/server/SseHub.js          who is watching and what each may see
|   web/server/controllers/       one file per route group
|   web/server/services/          conversation, task loop, stream, approvals,
|                                 git report, discussion, settings
|   web/server/serializers/       the snapshot, the row shapes, the error answer
|
|--------------------------------------------------------------------------
*/

/*
| `./server/index.js` and not `./server`: from this file the shorter form
| resolves back to web/server.js, which is a self-require that returns a
| half-built module. The explicit path costs nothing and the mistake cannot be
| made twice.
*/

const { createServer } = require("./server/index.js");

module.exports = {
    createServer
};
