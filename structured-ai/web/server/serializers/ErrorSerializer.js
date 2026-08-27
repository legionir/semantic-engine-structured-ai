"use strict";

/*
|--------------------------------------------------------------------------
| Web console error answers (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| One place maps a thrown error onto an HTTP answer.
|
| The route chain used to wrap *every* handler in a single try/catch and the
| handlers came to depend on it: a controller reports a status by throwing
| an error carrying `.status` — the project routes do exactly that — and
| anything without one is a 500. Both halves moved verbatim, because
| dropping either turns a 404 into a 500 somewhere in the project routes.
|
| The message is echoed raw deliberately: this is an operator-facing
| console and error.message is what tells an operator which registration or
| path was refused.
|--------------------------------------------------------------------------
*/

const { sendJson } = require("../Response");

function sendError(res, error) {

    sendJson(
        res,
        error.status || 500,
        {
            error: error.message
        }
    );

}

module.exports = {
    sendError
};
