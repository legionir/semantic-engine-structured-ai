"use strict";

/*
|--------------------------------------------------------------------------
| Run directives (roadmap P3-03, P3-05)
|--------------------------------------------------------------------------
|
| What the agent is told, on every iteration (inside runtime_context),
| about the run's own mode: plan mode, the goal that ends the run and the
| dollar cap with what has been spent. null when none applies, so an
| ordinary run's prompt does not change.
|--------------------------------------------------------------------------
*/

const settings = require("../config");

const PLAN_MODE_INSTRUCTIONS = [
    "Plan mode is on. Investigate with read-only tools (reading, searching, git inspection, read-only commands),",
    "write the plan with plan_set (objective, phases, steps, the files each step touches),",
    "then return action final whose response presents the plan and any open questions.",
    "Do not edit files, run changing commands, commit or start processes: such calls are refused until the operator approves the plan.",
    "After approval a new turn without plan mode executes this same plan."
].join(" ");

const GOAL_INSTRUCTIONS =
    "This condition ends the run. Keep working until it holds; your final answer is checked against it, and an answer that does not meet it sends you back to work. If it cannot be met, say exactly why in the final answer.";


function runDirectives(run) {

    if (!run) {
        return null;
    }

    const directives = {};

    if (run.planMode === true) {
        directives.plan_mode = { active: true, instructions: PLAN_MODE_INSTRUCTIONS };
    }

    if (typeof run.goal === "string" && run.goal !== "") {
        directives.goal = { condition: run.goal, instructions: GOAL_INSTRUCTIONS };
    }

    const cap = run.cost && typeof run.cost.cap === "function"
        ? run.cost.cap(settings.get("MAX_RUN_COST_USD"))
        : 0;

    if (cap > 0) {
        directives.cost = {
            max_cost_usd: cap,
            spent_usd: Math.round(run.cost.totalUsd * 10000) / 10000,
            note: "The run is stopped when the spend reaches the cap; finish the important part first."
        };
    }

    return Object.keys(directives).length > 0 ? directives : null;
}


module.exports = { runDirectives, PLAN_MODE_INSTRUCTIONS };
