"use strict";

/*
|--------------------------------------------------------------------------
| Iteration Runner (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Extracted from agent.js. Live closures come from the bound host; sibling
| runtime modules are required (lazily when a cycle would form).
|--------------------------------------------------------------------------
*/

const { host } = require("./engineContext");

const RetryController = require("./RetryController");
const RunState = require("./RunState");
const RunCorrections = require("./RunCorrections");


async function runSubAgentLoop({
    agentProfile,
    task,
    depth,
    depthBudget,
    context
}) {

    const h = host();


    if (
        depth >
        h.settings.get("MAX_AGENT_DEPTH")
    ) {

        throw new Error(
            `Maximum agent depth exceeded: ${h.settings.get("MAX_AGENT_DEPTH")}`
        );
    }

    const agentDefinition =
        agentProfile;

    const agentName =
        agentDefinition.name;

    h.consumeAgentBudget(
        agentName
    );

    const ownDepthBudget =
        require("./DelegationRunner").resolveDepthBudget(
            agentDefinition,
            Number.isFinite(depthBudget)
                ? depthBudget
                : h.settings.get("MAX_AGENT_DEPTH")
        );

    const capabilities =
        h.resolveAgentCapabilities(
            agentDefinition
        );

    const allowedTools =
        new Set(
            capabilities.tools.map(
                tool =>
                    tool.function.name
            )
        );

    const messages =
        h.createSubAgentMessages(
            agentDefinition,
            task,
            context
        );

    const scope =
        `${agentName}#${depth}`;

    const progress = {
        tools: 0,
        delegations: 0,
        nudges: 0
    };

    h.events.emit("agent:start", {
        agent: agentName,
        scope,
        depth,
        task,

        /*
        | Who asked for this agent. Without it a console can only guess
        | the shape of the tree from the depth number.
        */

        parent:
            context?.parent || null,

        parent_scope:
            context?.parent_scope || null,

        delegation_id:
            context?.delegation_id || null,

        hook:
            context?.hook || null,

        persona:
            agentDefinition.persona || null,

        tools:
            [...allowedTools]
    });

    h.logLine(
        scope,
        `Sub-agent started: ${task}`
    );

    for (
        let iteration = 1;
        iteration <= h.settings.get("MAX_ITERATIONS");
        iteration++
    ) {

        h.assertRunActive(
            `sub-agent ${agentName}`
        );

        await h.maintainContext(messages, scope, capabilities.tools, agentDefinition);

        if (typeof h.refreshRepositoryContext === "function") {
            await h.refreshRepositoryContext();
        }

        h.refreshRuntimeContext(messages);

        h.events.setContext({ scope, iteration });

        h.events.emit("agent:iteration", {
            agent: agentName,
            scope,
            depth,
            iteration
        });

        h.logLine(
            scope,
            `Iteration ${iteration}`
        );

        const data =
            await require("./RetryController").callAI({
                messages,

                agentDefinition,

                tools:
                    capabilities.tools,

                role:
                    h.roleForDepth(depth),

                scope
            });

        /* Keep the provider response visible even when the structured action
           below turns out to be malformed. */
        h.reportModelResponse(data, scope, agentName, depth, iteration);

        let parsed;

        try {

            parsed = h.readModelAction(data);

        } catch (error) {

            if (!h.isModelResponseError(error)) {
                throw error;
            }

            const note =
                require("./RetryController").noteMalformed(progress, error);

            h.logLine(
                scope,
                `Unreadable answer (${error.message}) [${
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
                finish_reason:
                    error.details?.finish_reason || null,
                completion_tokens:
                    error.details?.completion_tokens ?? null,
                output_chars:
                    error.details?.output_chars ?? null,
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

            continue;
        }

        /* The correction succeeded. A malformed-answer allowance is a retry
           budget for one bad-response streak, not a lifetime quota that can
           stop an otherwise productive long run hours later. */
        require("./RetryController").clearMalformed(progress);

        const message =
            parsed.message;

        const action =
            parsed.structured;

        h.events.emit("agent:action", {
            agent: agentName,
            scope,
            depth,
            iteration,
            action: action.action
        });

        h.logLine(
            scope,
            `Action: ${action.action}`
        );



        const outcome =
            await require("./ActionProcessor").process({
                kind: "sub",
                action,
                message,
                messages,
                progress,
                agentDefinition,
                agentName,
                scope,
                depth,
                depthBudget: ownDepthBudget,
                allowedTools,
                iteration,
                context
            });

        if (outcome.type === "continue") {
            continue;
        }

        if (outcome.type === "return") {
            return outcome.value;
        }

    }

    throw new Error(
        `Sub-agent exceeded maximum iterations: ${agentName}`
    );
}


async function runMainLoop({
    messages,
    mainAgentDefinition,
    mainDepthBudget,
    mainAgentTools,
    allowedTools,
    progress
}) {

    const h = host();

    for (
        let iteration = 1;
        iteration <= h.settings.get("MAX_ITERATIONS");
        iteration++
    ) {

        h.assertRunActive("main agent");

        await h.maintainContext(messages, "main_agent", mainAgentTools, mainAgentDefinition);

        if (typeof h.refreshRepositoryContext === "function") {
            await h.refreshRepositoryContext();
        }

        h.refreshRuntimeContext(messages);

        h.events.setContext({ scope: "main_agent", iteration });

        h.events.emit("agent:iteration", {
            agent: "main_agent",
            scope: "main_agent",
            depth: 0,
            iteration
        });

        /* an operator's mid-run correction is read before the next decision */
        RunCorrections.drainInto(h.currentRun(), messages, h.events, iteration);

        if (
            RunState.shouldHintDelegation(
                progress,
                h.currentPlanSummary(),
                mainAgentDefinition
            )
        ) {

            progress.delegationHints =
                (progress.delegationHints || 0) + 1;

            const planSummary = h.currentPlanSummary();

            h.logLine(
                "main_agent",
                `Working alone for ${
                    progress.tools
                } calls with ${
                    h.remainingAgentBudget()
                } agents unused and ${
                    planSummary.pending + planSummary.in_progress
                } open steps; suggesting delegation.`
            );

            h.events.emit("run:delegation_hint", {
                agent: "main_agent",
                iteration,
                attempt: progress.delegationHints,
                agents_remaining: h.remainingAgentBudget(),
                open_steps:
                    planSummary.pending + planSummary.in_progress
            });

            messages.push(
                RunState.delegationHintMessage(
                    planSummary,
                    h.remainingAgentBudget()
                )
            );
        }

        const wrapUpAt =
            Math.min(
                h.settings.get("RUN_WRAPUP_MS"),
                h.settings.get("MAX_RUN_MS") *
                h.settings.get("RUN_WRAPUP_FRACTION")
            );

        if (
            wrapUpAt > 0 &&
            !progress.wrapup &&
            h.runRemainingMs() <= wrapUpAt
        ) {

            progress.wrapup = true;

            const planSummary =
                h.currentPlanSummary();

            h.logLine(
                "main_agent",
                `Run budget nearly spent (${
                    Math.max(0, h.runRemainingMs())
                } ms left); asking for a final answer.`
            );

            h.events.emit("run:wrapup", {
                agent: "main_agent",
                iteration,
                remaining_ms: h.runRemainingMs(),
                max_run_ms: h.settings.get("MAX_RUN_MS")
            });

            messages.push(
                RunState.wrapUpMessage(
                    h.runRemainingMs(),
                    planSummary
                )
            );
        }

        if (h.settings.get("AGENT_VERBOSE")) {

            h.LOG_STREAM(
                `\n=== Agent Iteration ${iteration} ===`
            );
        }

        const data =
            await RetryController.callAI({
                messages,

                agentDefinition:
                    mainAgentDefinition,

                tools:
                    mainAgentTools,

                role: "MAIN",

                scope:
                    "main_agent"
            });

        h.reportModelResponse(data, "main_agent", "main_agent", 0, iteration);

        let parsed;

        try {

            parsed = h.readModelAction(data);

        } catch (error) {

            if (!h.isModelResponseError(error)) {
                throw error;
            }

            const note =
                require("./RetryController").noteMalformed(progress, error);

            h.logLine(
                "main_agent",
                `Unreadable answer (${error.message}) [${
                    note.attempt
                }/${note.maximumAttempts}]`
            );

            h.events.emit("run:malformed", {
                agent: "main_agent",
                scope: "main_agent",
                depth: 0,
                iteration,
                code: error.code,
                reason: error.message,
                finish_reason:
                    error.details?.finish_reason || null,
                completion_tokens:
                    error.details?.completion_tokens ?? null,
                output_chars:
                    error.details?.output_chars ?? null,
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

            continue;
        }

        require("./RetryController").clearMalformed(progress);

        const message =
            parsed.message;

        const action =
            parsed.structured;

        h.events.emit("agent:action", {
            agent: "main_agent",
            scope: "main_agent",
            depth: 0,
            iteration,
            action: action.action
        });

        h.logLine(
            "main_agent",
            `Action: ${action.action}`
        );

        const outcome =
            await require("./ActionProcessor").process({
                kind: "main",
                action,
                message,
                messages,
                progress,
                agentDefinition: mainAgentDefinition,
                agentName: "main_agent",
                scope: "main_agent",
                depth: 0,
                depthBudget: mainDepthBudget,
                allowedTools,
                iteration
            });

        if (outcome.type === "continue") {
            continue;
        }

        if (outcome.type === "return") {
            return outcome.value;
        }
    }

    throw new Error(
        `Agent exceeded maximum iterations: ${h.settings.get("MAX_ITERATIONS")}`
    );
}


module.exports = {
    runSubAgentLoop,
    runMainLoop
};
