"use strict";

/*
|--------------------------------------------------------------------------
| Application lifecycle — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Startup/shutdown and signal handling extracted from agent.js so the
| facade does not grow new business logic. Dependencies are injected;
| this module never requires agent.js.
|--------------------------------------------------------------------------
*/

async function shutdown({ tools, eventstore } = {}) {

    if (tools && typeof tools.shutdown === "function") {

        tools.shutdown();

    }

    if (eventstore && typeof eventstore.flush === "function") {

        try {

            await eventstore.flush();

        } catch {

            /* a store flush must never hide the run result */

        }

    }

}


function installSignalHandlers({
    cancelRun,
    tools,
    exit = process.exit,
    signals = ["SIGINT", "SIGTERM"]
} = {}) {

    for (const signalName of signals) {

        process.on(signalName, () => {

            console.error(`\nReceived ${signalName}, cancelling run...`);

            if (typeof cancelRun === "function") {

                cancelRun(signalName.toLowerCase());

            }

            if (tools && typeof tools.shutdown === "function") {

                tools.shutdown();

            }

            setTimeout(() => exit(130), 2000).unref();

        });

    }

}


module.exports = {
    shutdown,
    installSignalHandlers
};
