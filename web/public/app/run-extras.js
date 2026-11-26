/*
|--------------------------------------------------------------------------
| Run quality state (roadmap P3-03, P3-05, P3-09)
|--------------------------------------------------------------------------
|
| The part of the event reducer for the agent-quality events, kept apart
| from runtime-state.js: what the run on screen has cost (run:cost,
| run:cost_cap), its goal verdict (run:goal), whether its plan waits for
| approval (run:status with plan_mode) and the latest task snapshot
| (run:snapshot). Pure: state in, regions out.
*/

export function reduceRunExtras(state, event, regions) {

    switch (event.type) {

        case "run:start":
            state.runCost = null;
            state.runGoal = null;
            state.planReady = null;
            regions.add("quality");
            break;

        case "run:cost":
            state.runCost = {
                cost_usd: event.cost_usd,
                max_cost_usd: event.max_cost_usd ?? null,
                prompt_tokens: event.prompt_tokens,
                completion_tokens: event.completion_tokens,
                requests: event.requests,
                unpriced_models: event.unpriced_models || [],
                capReached: Boolean(state.runCost && state.runCost.capReached)
            };
            regions.add("quality");
            break;

        case "run:cost_cap":
            state.runCost = { ...(state.runCost || {}), cost_usd: event.cost_usd, max_cost_usd: event.max_cost_usd, capReached: true };
            regions.add("quality");
            break;

        case "run:goal":
            state.runGoal = { goal: event.goal, met: event.met, reason: event.reason, outcome: event.outcome };
            regions.add("quality");
            break;

        case "run:status":
            if (event.status !== "running") {
                state.planReady =
                    event.plan_mode === true && event.status === "done"
                        ? { turn_id: event.turn_id || null, project_id: event.project_id || null }
                        : null;
                regions.add("quality");
            }
            break;

        case "run:snapshot":
            if (event.phase === "after") {
                state.lastSnapshot = { run_id: event.run_id, project_id: event.project_id || null };
                regions.add("quality");
            }
            break;

        default:
            break;
    }
}


export function formatCost(cost) {

    if (!cost || !Number.isFinite(cost.cost_usd)) return "";

    const amount = cost.cost_usd < 0.01 ? cost.cost_usd.toFixed(4) : cost.cost_usd.toFixed(2);
    const cap = Number.isFinite(cost.max_cost_usd) && cost.max_cost_usd > 0 ? ` / $${cost.max_cost_usd}` : "";
    const unpriced = (cost.unpriced_models || []).length > 0 ? "+" : "";

    return `$${amount}${unpriced}${cap}`;
}
