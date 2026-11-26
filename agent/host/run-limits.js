"use strict";

/*
|--------------------------------------------------------------------------
| Run limits
|--------------------------------------------------------------------------
|
| Time left in a run, the cancellation checks every step makes, the abort
| signal of a model request and the budget of spawned agents.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const settings = require("../config");


module.exports = function createRunLimits(host) {

    /* set up by a later factory, so looked up when called */
    const cancelRun = (...args) => host.cancelRun(...args);
    const currentAgentBudget = (...args) => host.currentAgentBudget(...args);
    const currentRun = (...args) => host.currentRun(...args);
    const runDeadlineAt = (...args) => host.runDeadlineAt(...args);

    function runRemainingMs() {

        const deadline = runDeadlineAt();

        if (!deadline) {
            return settings.get("MAX_RUN_MS");
        }

        return deadline - Date.now();
    }


    function isRunCancelled() {

        return Boolean(
            currentRun().controller &&
            currentRun().controller.signal.aborted
        );
    }


    function runElapsedMs() {

        return currentRun().started_at
            ? Date.now() - currentRun().started_at
            : 0;
    }


    /*
    | A stopped run has to say which limit stopped it and how much of it was
    | spent, otherwise "cancelled" reads like a bug rather than a budget.
    */

    function budgetSentence() {

        /* P3-05: the dollar cap, with what was spent */
        if (currentRun().cancelled_reason === "cost_cap" && currentRun().cost) {

            const spent = currentRun().cost.snapshot(settings.get("MAX_RUN_COST_USD"));

            return `the cost cap of $${spent.max_cost_usd} was reached: $${
                spent.cost_usd.toFixed(4)
            } spent on ${spent.requests} model request(s) (${spent.prompt_tokens} input, ${spent.completion_tokens} output tokens)`;
        }

        if (currentRun().inHook) {

            return `the ${currentRun().hook_phase || "hook"} budget of ${
                settings.get("HOOK_TIMEOUT_MS")
            } ms (HOOK_TIMEOUT_MS) was spent`;
        }

        return `the run budget of ${
            settings.get("MAX_RUN_MS")
        } ms (MAX_RUN_MS) was spent after ${runElapsedMs()} ms`;
    }


    function assertRunActive(what) {

        if (isRunCancelled()) {

            throw new Error(
                `Run cancelled${
                    currentRun().cancelled_reason
                        ? ` (${currentRun().cancelled_reason})`
                        : ""
                }: ${what}${
                    currentRun().cancelled_reason === "deadline" ||
                    currentRun().cancelled_reason === "cost_cap"
                        ? ` — ${budgetSentence()}`
                        : ""
                }`
            );
        }

        if (runRemainingMs() <= 0) {

            cancelRun("deadline");

            throw new Error(
                `Run stopped at ${what}: ${budgetSentence()}`
            );
        }
    }


    /*
    | A per-request signal that fires on the request timeout, the run
    | deadline, or an explicit cancellation, whichever comes first.
    */

    function createRequestSignal(timeoutOverride) {

        const controller =
            new AbortController();

        const remainingMs =
            runRemainingMs();

        const requestCeiling =
            timeoutOverride ||
            settings.get("MAX_REQUEST_MS");

        /*
        | Whichever limit is closer decides both the timer and the message,
        | so a run that dies from its deadline is not reported as a slow
        | endpoint.
        */

        const boundedByRun =
            remainingMs < requestCeiling;

        const timeoutMs =
            Math.max(
                1,
                Math.min(
                    requestCeiling,
                    remainingMs
                )
            );

        const state = {
            reason: null
        };

        const timer =
            setTimeout(
                () => {

                    state.reason =
                        boundedByRun
                            ? budgetSentence()
                            : `request timed out after ${timeoutMs} ms (MAX_REQUEST_MS)`;

                    if (boundedByRun) {
                        cancelRun("deadline");
                    }

                    controller.abort();
                },
                timeoutMs
            );

        const onRunAbort = () => {

            /*
            | A deadline is a budget, not a mystery, so the reason carries
            | the limit and what was spent rather than the word "deadline".
            */

            state.reason =
                currentRun().cancelled_reason === "deadline" ||
                currentRun().cancelled_reason === "cost_cap"
                    ? budgetSentence()
                    : `run cancelled (${
                        currentRun().cancelled_reason || "unknown"
                    })`;

            controller.abort();
        };

        if (currentRun().controller) {

            if (currentRun().controller.signal.aborted) {
                onRunAbort();
            } else {

                currentRun().controller.signal.addEventListener(
                    "abort",
                    onRunAbort,
                    {
                        once: true
                    }
                );
            }
        }

        return {
            signal:
                controller.signal,

            get reason() {
                return state.reason;
            },

            release() {

                clearTimeout(timer);

                if (currentRun().controller) {

                    currentRun().controller.signal.removeEventListener(
                        "abort",
                        onRunAbort
                    );
                }
            }
        };
    }


    /*
    |--------------------------------------------------------------------------
    | Agent Budget
    |--------------------------------------------------------------------------
    |
    | max_total_agents caps how many sub-agents a single run may spawn,
    | across every depth and branch of the delegation tree.
    |--------------------------------------------------------------------------
    */

    const AGENT_BUDGET = {
        spawned: 0
    };


    function resetAgentBudget() {

        currentAgentBudget().spawned = 0;
    }


    function remainingAgentBudget() {

        return Math.max(
            0,
            settings.get("MAX_TOTAL_AGENTS") - currentAgentBudget().spawned
        );
    }


    function consumeAgentBudget(
        agentName
    ) {

        currentAgentBudget().spawned++;

        if (
            currentAgentBudget().spawned >
            settings.get("MAX_TOTAL_AGENTS")
        ) {

            throw new Error(
                `Total agent budget exceeded (${settings.get("MAX_TOTAL_AGENTS")}) while starting "${agentName}".`
            );
        }
    }


    return {
        AGENT_BUDGET,
        assertRunActive,
        consumeAgentBudget,
        createRequestSignal,
        isRunCancelled,
        remainingAgentBudget,
        resetAgentBudget,
        runElapsedMs,
        runRemainingMs
    };
};
