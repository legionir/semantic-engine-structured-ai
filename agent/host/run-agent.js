"use strict";

/*
|--------------------------------------------------------------------------
| Running the agent
|--------------------------------------------------------------------------
|
| runAgent (one run in the scheduler, with after-task hooks) and the CLI
| entry point main().
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const toolRuntime = require("../tools");
const events = require("../events");
const eventstore = require("../persistence/EventStoreRepository");
const runtimeEngine = require("../runtime/engine");


module.exports = function createRunAgent(host) {

    const {
        applyAfterTaskHooks,
        cancelAllRuns,
        hookReportText,
        isRunCancelled,
        resolveRunProjectContext,
        runManager,
        runScheduler
    } = host;

    async function runAgentCore(...args) {

        return await runtimeEngine.runAgentCore(...args);

    }


    /*
    | Canonical run variant (EXECUTION_PLAN Phase 3):
    | the run gets its own AgentRunContext before anything starts, the whole
    | core executes inside the run's async scopes, and two such calls may
    | interleave without sharing messages, budgets or cancellation.
    |
    | The error path runs after-task hooks only when a run actually started;
    | failures during context resolution or registry validation do not inherit
    | them.
    */
    async function runAgentModular(options = {}) {

        /* Resolved before the context is created so a bad project reference
           still fails fast and no half-built run is ever tracked. */
        const projectContext =
            resolveRunProjectContext(options);

        const context =
            runManager.createRun({
                task: options.task || "",
                parentRunId: options.parent_run_id || null,
                project: projectContext,
                reasoningEffort: options.reasoning_effort || null
            });

        const projectId =
            projectContext && projectContext.projectId
                ? projectContext.projectId
                : null;

        runManager.enqueue(context);

        try {

        return await runScheduler.schedule(projectId, () =>
            runManager.execute(context, async () => {

            try {
                return await runAgentCore(options);
            } catch (error) {

                if (
                    context.started_at &&
                    !context.after_hooks_ran
                ) {

                    try {

                        const finalized =
                            await applyAfterTaskHooks(null, error);

                        const report =
                            hookReportText(finalized.report);

                        if (report) {
                            error.message = `${error.message}\n\nAutomated routine:\n${report}`;
                        }

                    } catch (hookError) {

                        error.message =
                            `${error.message}\n\nafter_task hooks could not finish: ${hookError.message}`;
                    }
                }

                /*
                | Single terminal path (audit REL-013): a model / tool / cancel /
                | hook exception ends the run with run:error - the event
                | Observability, the journal and the event store count. Without
                | it the run stays "active" forever and the failure never reaches
                | metrics. A run that already emitted run:end is not ended twice.
                */
                if (context.run_open) {

                    context.run_open = false;

                    events.emit("run:error", {
                        run_id: context.id,
                        message: error.message,
                        cancelled: isRunCancelled(),
                        code: error.name || "RUNTIME_ERROR"
                    });
                }

                /* callers that emit their own terminal event must not double it */
                if (context.started_at) {
                    error.runTerminalEmitted = true;
                }

                throw error;

            }

            /* Leaving the async scopes restores the correlation context:
               run-local state is restored by RunManager's async scope. */
        }), { runId: context.runId });

        } catch (error) {

            /* rejected or cancelled before it ever started: settle its
               bookkeeping (queue entry, id) exactly once */
            if (context.status === "queued") {
                runManager.abandon(context, error);
            }

            throw error;
        }
    }


    async function runAgent(options = {}) {

        return await runAgentModular(options);

    }

    /*
    |--------------------------------------------------------------------------
    | Main
    |--------------------------------------------------------------------------
    */

    async function main() {

        /*
        | An interrupt cancels the in-flight request, the tool graph, and
        | every running sub-agent instead of leaving orphans behind.
        */

        for (const signalName of ["SIGINT", "SIGTERM"]) {

            process.on(
                signalName,
                () => {

                    console.error(
                        `\nReceived ${signalName}, cancelling run...`
                    );

                    cancelAllRuns(signalName.toLowerCase());

                    toolRuntime.shutdown();

                    setTimeout(
                        () => process.exit(130),
                        2000
                    ).unref();
                }
            );
        }

        try {

            const result =
                await runAgent();

            /*
            | Background processes must not keep the runtime alive.
            */

            toolRuntime.shutdown();

            try {
                await eventstore.flush();
            } catch {
                /* a store flush must never hide the run result */
            }

            /*
            | A final action that carries an error is a failed run,
            | even though the agent loop itself completed.
            */

            process.exit(
                result?.error
                    ? 1
                    : 0
            );

        } catch (error) {

            toolRuntime.shutdown();

            try {
                await eventstore.flush();
            } catch {
                /* a store flush must never hide the run result */
            }

            console.error(
                "\nAgent failed:\n"
            );

            console.error(
                error
            );

            process.exit(1);
        }
    }


    return {
        main,
        runAgent
    };
};
