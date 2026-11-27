"use strict";

/*
| Run flags a console request may carry (roadmap P3-03, P3-05):
|
|   plan_mode      true: the turn may only plan; writes are refused until
|                  the operator approves (the approving turn runs without it)
|   goal           the condition that ends the run (<= 2000 characters)
|   max_cost_usd   dollar cap for this run (0: none; absent: MAX_RUN_COST_USD)
|
| requestRunFlags(body) validates them (status 400 on a bad value) and
| returns only the ones present; runFlagOptions(flags) turns them into
| runAgent options. A queued message keeps its flags.
*/

function requestRunFlags(body) {

    const flags = {};
    const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

    if (!body || typeof body !== "object") {
        return flags;
    }

    if (body.plan_mode !== undefined && body.plan_mode !== null) {
        if (typeof body.plan_mode !== "boolean") fail("plan_mode must be true or false");
        if (body.plan_mode) flags.planMode = true;
    }

    if (body.goal !== undefined && body.goal !== null && body.goal !== "") {
        if (typeof body.goal !== "string") fail("goal must be a string");
        const goal = body.goal.trim();
        if (goal.length > 2000) fail("goal is longer than 2000 characters");
        if (goal !== "") flags.goal = goal;
    }

    if (body.max_cost_usd !== undefined && body.max_cost_usd !== null && body.max_cost_usd !== "") {
        const cap = Number(body.max_cost_usd);
        if (!Number.isFinite(cap) || cap < 0) fail("max_cost_usd must be a number of dollars, 0 or more");
        flags.maxCostUsd = cap;
    }

    return flags;
}


function runFlagOptions(flags) {

    if (!flags || typeof flags !== "object") {
        return {};
    }

    return {
        ...(flags.planMode === true ? { plan_mode: true } : {}),
        ...(typeof flags.goal === "string" && flags.goal !== "" ? { goal: flags.goal } : {}),
        ...(Number.isFinite(flags.maxCostUsd) ? { max_cost_usd: flags.maxCostUsd } : {})
    };
}


function hasRunFlags(flags) {

    return Boolean(flags && Object.keys(runFlagOptions(flags)).length > 0);
}


module.exports = { requestRunFlags, runFlagOptions, hasRunFlags };
