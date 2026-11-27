"use strict";

/*
|--------------------------------------------------------------------------
| Run cost tracking (roadmap P3-05)
|--------------------------------------------------------------------------
|
| Every model response's usage is priced (ModelPricing) and added to the
| run's RunCost. Each addition is published as run:cost, so the console
| shows a live per-run figure; the response that reaches the cap emits
| run:cost_cap once and cancels the run with reason "cost_cap", which
| makes the next step stop with a sentence naming the cap and the spend.
|--------------------------------------------------------------------------
*/

const settings = require("../config");
const { costOf } = require("../providers/ModelPricing");
const { RunCost } = require("./RunBudget");


function createUsageRecorder({ events, currentRun, cancelRun, logLine = () => {} }) {

    return function recordUsage({ model, usage, agent = "main_agent", role = "MAIN" } = {}) {

        if (!usage || typeof usage !== "object") {
            return null;
        }

        const run = currentRun();

        /* only a run's own context counts: a request outside any run (a
           console review, a discussion) has no cap to charge */
        if (!run || !(run.cost instanceof RunCost)) {
            return null;
        }

        const entry = costOf(model, usage);
        const settingCap = settings.get("MAX_RUN_COST_USD");
        const reached = run.cost.add(model, entry, settingCap);
        const totals = run.cost.snapshot(settingCap);

        events.emit("run:cost", {
            run_id: run.id || null,
            project_id: run.projectId || null,
            agent,
            role,
            model: model || null,
            prompt_tokens: entry.prompt_tokens,
            completion_tokens: entry.completion_tokens,
            cached_tokens: entry.cached_tokens,
            request_cost_usd: entry.cost_usd,
            priced: entry.priced,
            ...totals
        });

        if (reached && !run.cost.capReached) {

            run.cost.capReached = true;

            events.emit("run:cost_cap", {
                run_id: run.id || null,
                project_id: run.projectId || null,
                ...totals
            });

            logLine(agent, `Cost cap reached: $${totals.cost_usd.toFixed(4)} of $${totals.max_cost_usd}; stopping the run.`);

            cancelRun("cost_cap");
        }

        return totals;
    };
}


module.exports = { createUsageRecorder };
