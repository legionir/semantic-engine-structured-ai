"use strict";

/*
|--------------------------------------------------------------------------
| Action Processor (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Extracted from agent.js. Live closures come from the bound host; sibling
| runtime modules are required (lazily when a cycle would form).
|--------------------------------------------------------------------------
*/

const { host } = require("./engineContext");

const RunState = require("./RunState");
const RetryController = require("./RetryController");
const ReportVerifier = require("./ReportVerifier");
const RunGoal = require("./RunGoal");
const ToolGraph = require("./ToolGraphExecutor");


function graph() {
    return require("./ToolGraphExecutor");
}


function delegation() {
    return require("./DelegationRunner");
}


async function handleMalformed(progress, error, {
    agentName,
    scope,
    depth,
    iteration,
    messages
}) {

    const h = host();

    if (!h.isModelResponseError(error)) {
        throw error;
    }

    const note =
        RetryController.noteMalformed(progress, error);

    h.logLine(
        scope,
        `Invalid delegation (${error.message}) [${
            note.attempt
        }/${note.maximumAttempts}]`
    );

    h.events.emit("run:malformed", {
        agent: agentName,
        scope,
        depth,
        iteration,
        code: error.code,
        reason: error.message,
        attempt: note.attempt,
        limit: note.limit,
        max_attempts: note.maximumAttempts,
        retries_left: note.retriesLeft,
        outcome:
            note.stopped
                ? "stopped"
                : "retry"
    });

    if (note.stopped) {
        throw error;
    }

    messages.push(
        h.malformedNoticeMessage(
            error,
            note.attempt,
            note.limit
        )
    );

    return { type: "continue" };

}


async function processToolCall(ctx) {

    const h = host();
    const {
        action,
        message,
        messages,
        progress,
        agentName,
        scope,
        depth,
        allowedTools,
        iteration
    } = ctx;

    const toolCalls =
        graph().normalizeToolCalls(
            action.tool_calls
        );

    const results =
        await graph().executeToolGraph(
            toolCalls,
            allowedTools,
            scope,
            { iteration }
        );

    progress.tools += results.length;

    graph().appendToolConversation(
        messages,
        message,
        toolCalls,
        results,
        scope
    );

    const repeats =
        RunState.trackRepeatedFailure(progress, results);

    if (repeats >= h.settings.get("MAX_REPEATED_FAILURES")) {

        h.logLine(
            scope,
            `The same failure repeated ${repeats} times.`
        );

        h.events.emit("run:loop", {
            agent: agentName,
            scope,
            depth,
            iteration,
            repeats,
            limit:
                h.settings.get("MAX_REPEATED_FAILURES"),
            signature:
                progress.lastFailure,
            outcome:
                repeats > h.settings.get("MAX_REPEATED_FAILURES")
                    ? "stopped"
                    : "notice"
        });

        if (repeats > h.settings.get("MAX_REPEATED_FAILURES")) {

            throw new Error(
                ctx.kind === "sub"
                    ? `Sub-agent "${agentName}" repeated the same failing call ${repeats} times: ${progress.lastFailure}`
                    : `The agent repeated the same failing call ${repeats} times: ${progress.lastFailure}`
            );
        }

        messages.push(
            RunState.loopNoticeMessage(
                progress.lastFailure,
                repeats
            )
        );
    }

    return { type: "continue" };

}


async function processDelegate(ctx) {

    const h = host();
    const {
        action,
        message,
        messages,
        progress,
        agentDefinition,
        agentName,
        scope,
        depth,
        depthBudget,
        iteration
    } = ctx;

    try {

        delegation().validateDelegationPolicy(
            agentDefinition,
            depthBudget,
            action.delegations
        );

    } catch (error) {

        return handleMalformed(progress, error, {
            agentName,
            scope,
            depth,
            iteration,
            messages
        });

    }

    h.events.emit("delegation:start", {
        parent: agentName,
        parent_scope: scope,
        depth,
        delegations:
            action.delegations.map(item => ({
                id: item.id,
                agent: item.agent || `adhoc:${item.persona}`,
                task: item.task,
                depends_on: item.depends_on,
                projectId:
                    h.requestedDelegationProjectId(item).value
            }))
    });

    h.logLine(
        scope,
        `Delegating to ${
            action.delegations
                .map(item => item.agent)
                .join(", ")
        }`
    );

    const childDepth =
        ctx.kind === "sub"
            ? depth + 1
            : 1;

    const results =
        await delegation().executeDelegations(
            action.delegations,
            childDepth,
            agentDefinition,
            depthBudget - 1,
            scope
        );

    progress.delegations += action.delegations.length;

    messages.push({

        role: "assistant",

        content:
            message.content ??
            JSON.stringify(
                action
            )
    });

    messages.push({

        role: "user",

        content:
            JSON.stringify({
                type:
                    "sub_agent_results",

                results
            })
    });

    return { type: "continue" };

}


async function checkRunGoal(h, run, action, message, messages, progress, iteration) {

    progress.goalChecks = (progress.goalChecks || 0) + 1;

    const verdict = await RunGoal.checkGoal({
        goal: run.goal,
        action,
        messages,
        callAI: options => RetryController.callAI(options)
    });

    const limit = h.settings.get("GOAL_MAX_CHECKS");
    const sendBack = verdict.met === false && progress.goalChecks <= limit && !progress.wrapup;

    run.goalStatus = { goal: run.goal, met: verdict.met, reason: verdict.reason, checks: progress.goalChecks };

    h.events.emit("run:goal", {
        run_id: run.id || null,
        agent: "main_agent",
        iteration,
        goal: run.goal,
        met: verdict.met,
        reason: verdict.reason,
        attempt: progress.goalChecks,
        limit,
        outcome: verdict.met === true ? "met" : sendBack ? "continue" : "stopped"
    });

    if (!sendBack) {
        return null;
    }

    h.logLine("main_agent", `Goal not met yet (${verdict.reason}); continuing [${progress.goalChecks}/${limit}]`);

    messages.push({ role: "assistant", content: message.content ?? JSON.stringify(action) });
    messages.push(RunGoal.notMetMessage(run.goal, verdict, progress.goalChecks));

    return { type: "continue" };
}


async function finalize(ctx) {

    const h = host();
    const {
        action,
        message,
        messages,
        progress,
        agentName,
        scope,
        depth,
        iteration,
        context
    } = ctx;

    const run = h.currentRun();

    /* P3-03: a plan-mode answer IS the plan; its open steps wait for approval */
    const planMode = ctx.kind === "main" && run && run.planMode === true;

    /* P3-05: the goal decides whether the agent is really done */
    if (ctx.kind === "main" && action.action === "final" && !action.error && !planMode && run && run.goal) {

        const outcome = await checkRunGoal(h, run, action, message, messages, progress, iteration);

        if (outcome) {
            return outcome;
        }
    }

    if (ctx.kind === "main" && action.action === "final" && !action.error && !planMode) {

        const planSummary =
            h.currentPlanSummary();

        const openSteps =
            planSummary.exists
                ? planSummary.pending + planSummary.in_progress
                : 0;

        const continuationFloor =
            Math.min(
                h.settings.get("MAX_REQUEST_MS"),
                Math.max(5000, h.settings.get("MAX_RUN_MS") * 0.1)
            );

        if (
            openSteps > 0 &&
            !progress.wrapup &&
            progress.continuations < h.settings.get("MAX_PLAN_CONTINUATIONS") &&
            h.runRemainingMs() > continuationFloor
        ) {

            progress.continuations++;

            h.logLine(
                "main_agent",
                `Plan still has ${openSteps} open step(s); continuing with "${
                    planSummary.next_step
                        ? planSummary.next_step.title
                        : "the next step"
                }".`
            );

            h.events.emit("run:continue", {
                agent: "main_agent",
                open_steps: openSteps,
                next_step: planSummary.next_step,
                attempt: progress.continuations
            });

            messages.push({
                role: "assistant",

                content:
                    message.content ??
                    JSON.stringify(action)
            });

            messages.push(
                RunState.planContinuationMessage(
                    planSummary,
                    h.runRemainingMs()
                )
            );

            return { type: "continue" };
        }
    }

    const nudgeGuard =
        ctx.kind === "sub"
            ? (
                action.action === "final" &&
                !progress.wrapup &&
                RunState.isUnfinishedFinal(action, progress) &&
                progress.nudges < h.settings.get("MAX_EMPTY_FINAL_NUDGES")
            )
            : (
                action.action === "final" &&
                RunState.isUnfinishedFinal(action, progress) &&
                progress.nudges < h.settings.get("MAX_EMPTY_FINAL_NUDGES")
            );

    if (nudgeGuard) {

        progress.nudges++;

        h.logLine(
            scope,
            ctx.kind === "sub"
                ? "Sub-agent finished without doing anything; handing the task back once."
                : "Final answer arrived with no work performed; handing the objective back once."
        );

        const nudgeEvent =
            ctx.kind === "sub"
                ? {
                    agent: agentName,
                    scope,
                    iteration,
                    attempt: progress.nudges
                }
                : {
                    agent: "main_agent",
                    iteration,
                    attempt: progress.nudges
                };

        h.events.emit("run:nudge", nudgeEvent);

        messages.push({
            role: "assistant",

            content:
                message.content ??
                JSON.stringify(action)
        });

        messages.push(
            RunState.nudgeMessage({
                iteration,
                maxIterations: h.settings.get("MAX_ITERATIONS"),
                remainingMs: h.runRemainingMs()
            })
        );

        return { type: "continue" };
    }

    if (action.action !== "final") {
        return { type: "unknown" };
    }

    if (ctx.kind === "sub") {

        h.logObject(
            scope,
            "Final response",
            action.response
        );

        h.events.emit("agent:end", {
            agent: agentName,
            scope,
            depth,
            hook: context?.hook || null,
            success: true,
            response: action.response
        });

        return {
            type: "return",
            value: {
                agent:
                    agentName,

                success:
                    true,

                response:
                    action.response,

                data:
                    action.data ?? null,

                error:
                    action.error ?? null,

                performed: {
                    tools: progress.tools,
                    delegations: progress.delegations
                },

                projectId:
                    h.effectiveProjectId(h.currentRun().project),

                findings:
                    delegation().findingsFromReport({
                        response: action.response,
                        data: action.data
                    })
            }
        };
    }

    messages.push({
        role: "assistant",

        content:
            message.content ??
            JSON.stringify(action)
    });

    const finalized =
        await h.applyAfterTaskHooks(action, null);

    const finalAction =
        finalized.action;

    messages[messages.length - 1].content =
        JSON.stringify(finalAction);

    const mismatch =
        ReportVerifier.checkPerformedClaim(finalAction, progress, "main_agent");

    h.events.emit("run:end", {
        action: finalAction,

        /* P3-03 / P3-05: plan awaiting approval, goal verdict, what the run cost */
        plan_mode: planMode || undefined,

        goal: run && run.goalStatus ? run.goalStatus : undefined,

        cost: run && run.cost ? run.cost.snapshot(h.settings.get("MAX_RUN_COST_USD")) : undefined,

        hooks:
            finalized.report || undefined,

        claim_mismatch:
            mismatch || undefined,

        ok:
            !finalAction.error
    });

    h.currentRun().run_open = false;

    if (h.PRINT_FINAL) {

        h.LOG_STREAM(
            "\n=== FINAL RESPONSE ===\n"
        );

        h.LOG_STREAM(
            JSON.stringify(
                finalAction,
                null,
                2
            )
        );
    }

    return { type: "return", value: finalAction };

}


async function process(ctx) {

    const { action } = ctx;

    if (action.action === "final") {
        return finalize(ctx);
    }

    if (action.action === "tool_call") {
        return processToolCall(ctx);
    }

    if (action.action === "delegate") {
        return processDelegate(ctx);
    }

    return { type: "unknown" };

}


module.exports = {
    process,
    processToolCall,
    processDelegate,
    finalize
};
