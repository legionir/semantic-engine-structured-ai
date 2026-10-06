"use strict";

/*
|--------------------------------------------------------------------------
| Run State (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Progress counters and the notices the loop feeds back to the model.
| Pure against the bound host (settings only).
|--------------------------------------------------------------------------
*/

const { host } = require("./engineContext");


function createProgress() {

    return {
        tools: 0,
        delegations: 0,
        nudges: 0,
        continuations: 0
    };

}


function isUnfinishedFinal(action, progress) {

    if (action.action !== "final") {
        return false;
    }

    if (action.error) {
        return false;
    }

    return (
        progress.tools === 0 &&
        progress.delegations === 0
    );
}


function failureSignature(results) {

    const failures =
        results.filter(
            result => !result.success
        );

    if (
        failures.length === 0 ||
        failures.length !== results.length
    ) {

        return null;
    }

    return failures
        .map(
            result =>
                `${result.name}:${
                    (result.error && result.error.message) || ""
                }`
        )
        .sort()
        .join("|");
}


function trackRepeatedFailure(progress, results) {

    const signature =
        failureSignature(results);

    if (!signature) {

        progress.lastFailure = null;
        progress.repeats = 0;

        return 0;
    }

    if (signature === progress.lastFailure) {

        progress.repeats = (progress.repeats || 0) + 1;

    } else {

        progress.lastFailure = signature;
        progress.repeats = 1;
    }

    return progress.repeats;
}


function wrapUpMessage(remainingMs, planSummary) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type: "runtime_notice",

                notice: "budget_almost_spent",

                remaining_ms: remainingMs,

                max_run_ms:
                    host().settings.get("MAX_RUN_MS"),

                plan:
                    planSummary && planSummary.exists
                        ? {
                            done: planSummary.done,
                            open:
                                planSummary.pending +
                                planSummary.in_progress,
                            next_step: planSummary.next_step
                        }
                        : null,

                instruction:
                    "The run is nearly out of time. Do not start new work and do not call another tool unless it takes seconds. Return action final now: report what was actually done and verified, what remains, and the next concrete step. Record any finished step in the plan first if that costs one quick call."
            })
    };
}


function loopNoticeMessage(signature, repeats) {

    const pathGuessLoop =
        /does not exist/i.test(signature || "");

    const detail =
        "The same call failed the same way several times, so repeating it will not help. Read the error text literally and change something concrete: fix the argument it complains about, use a different tool, or split the work. If the error mentions a dependency reference, note that ${...} inside file content is treated as literal text only when it does not name a call in the same action, so rename the call id or escape the sequence as $${...}."

        + (pathGuessLoop
            ? " The repeated error is \"does not exist\": you are guessing a path. Do not keep probing guessed paths. Discover the real layout once with fs_list, fs_tree or search_start, and read only a path a tool result actually confirmed."
            : "");

    return {
        role: "user",

        content:
            JSON.stringify({
                type:
                    "runtime_notice",

                notice:
                    "repeated_failure",

                repeats,

                failure:
                    signature,

                detail
            })
    };
}


function planContinuationMessage(summary, remainingMs) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type:
                    "runtime_notice",

                notice:
                    "plan_incomplete",

                progress: {
                    done:
                        summary.done,

                    open:
                        summary.pending + summary.in_progress,

                    blocked:
                        summary.blocked,

                    total:
                        summary.steps
                },

                next_step:
                    summary.next_step,

                run_remaining_ms:
                    Math.max(0, remainingMs),

                detail:
                    "The plan still has open steps and this run still has budget, so the work is not finished. Continue with the next step: do it, verify it, record it with plan_update, and only then move on. Stop early only if you are blocked by something a tool cannot reach, in which case mark the step blocked and return final with error.code NEEDS_INPUT."
            })
    };
}


function nudgeMessage({
    iteration,
    maxIterations,
    remainingMs
}) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type:
                    "runtime_notice",

                notice:
                    "unfinished_run",

                detail:
                    "You returned a final answer without executing a single tool or delegation, so nothing in the workspace was inspected or changed. If the objective needs work, start it now: choose the next unfinished piece yourself, use the tools, verify the result, and report what you actually did. If you are genuinely blocked by a decision only the user can make, return final again with error.code set to NEEDS_INPUT and the specific question.",

                budget: {
                    iteration,

                    iterations_remaining:
                        maxIterations - iteration,

                    run_remaining_ms:
                        Math.max(0, remainingMs)
                }
            })
    };
}


function delegationHintMessage(planSummary, remainingAgents) {

    return {
        role: "user",

        content:
            JSON.stringify({
                type: "runtime_notice",

                notice: "delegation_available",

                agents_remaining: remainingAgents,

                open_steps:
                    planSummary.pending + planSummary.in_progress,

                assigned_steps:
                    planSummary.assigned_open_steps || [],

                instruction:
                    (planSummary.assigned_open_steps || []).length > 0
                        ? `The plan already assigns open work to agent profiles: ${
                            planSummary.assigned_open_steps
                                .map(step => `${step.id} → ${step.agent}`)
                                .join(", ")
                        }. Delegate independent assigned steps to those exact profiles in one action instead of continuing alone. Keep only sequential work that depends on state you hold.`
                        : "You have been working alone while the plan still has open steps and the whole agent budget is unspent. Steps that do not depend on each other can run at the same time, each in its own context: hand them to sub-agents in one delegate action, and keep for yourself only what depends on state you hold. If the remaining work really is one sequential thread, say so in your next answer and carry on."
            })
    };
}


function shouldHintDelegation(progress, planSummary, agentDefinition) {

    const h = host();

    const after =
        h.settings.get("DELEGATION_NUDGE_AFTER");

    if (
        after === 0 ||
        !h.mayDelegate(agentDefinition) ||
        progress.delegations > 0 ||
        (progress.delegationHints || 0) >=
            h.settings.get("MAX_DELEGATION_NUDGES")
    ) {
        return false;
    }

    if (progress.tools < after) {
        return false;
    }

    if (
        !planSummary.exists ||
        planSummary.pending + planSummary.in_progress < 2
    ) {
        return false;
    }

    return h.remainingAgentBudget() >= 2;
}


module.exports = {
    createProgress,
    isUnfinishedFinal,
    failureSignature,
    trackRepeatedFailure,
    wrapUpMessage,
    loopNoticeMessage,
    planContinuationMessage,
    nudgeMessage,
    delegationHintMessage,
    shouldHintDelegation
};
