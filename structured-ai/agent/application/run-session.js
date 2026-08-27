"use strict";

/*
|--------------------------------------------------------------------------
| Session run — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| A conversation is a sequence of runAgent calls that share a history
| array. The web console and the interactive REPL both go through this
| helper so session continuation is not reimplemented at each entry.
|--------------------------------------------------------------------------
*/

async function runSession({ runAgent, history, task, turn_id, projectId }) {

    if (typeof runAgent !== "function") {

        throw new Error("runSession requires a runAgent function");

    }

    const transcript = Array.isArray(history) ? history : [];

    return runAgent({
        task,
        history: transcript,
        turn_id,
        projectId
    });

}


module.exports = {
    runSession
};
