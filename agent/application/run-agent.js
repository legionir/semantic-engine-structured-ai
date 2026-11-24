"use strict";

/*
|--------------------------------------------------------------------------
| Run-agent application entry — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Bound from agent.js after the engine is constructed so this file never
| requires the monolith at load time (no cycle). The facade then exports
| application.runAgent, which delegates to the bound implementation.
|--------------------------------------------------------------------------
*/

const lifecycle = require("./lifecycle");

const bound = {
    runAgent: null,
    main: null
};


function bind(deps) {

    bound.runAgent = deps.runAgent;
    bound.main = deps.main;
    bound.tools = deps.tools;
    bound.eventstore = deps.eventstore;
    bound.cancelRun = deps.cancelRun;
    bound.cancelAllRuns = deps.cancelAllRuns;

}


async function runAgent(options) {

    if (typeof bound.runAgent !== "function") {

        throw new Error("application.runAgent is not bound");

    }

    return bound.runAgent(options);

}


async function main() {

    if (typeof bound.main === "function") {

        return bound.main();

    }

    lifecycle.installSignalHandlers({
        /* every active and queued run, not only the current one */
        cancelRun: bound.cancelAllRuns || bound.cancelRun,
        tools: bound.tools
    });

    try {

        const result = await runAgent();

        await lifecycle.shutdown({
            tools: bound.tools,
            eventstore: bound.eventstore
        });

        process.exit(result?.error ? 1 : 0);

    } catch (error) {

        await lifecycle.shutdown({
            tools: bound.tools,
            eventstore: bound.eventstore
        });

        console.error("\nAgent failed:\n");
        console.error(error);
        process.exit(1);

    }

}


module.exports = {
    bind,
    runAgent,
    main
};
