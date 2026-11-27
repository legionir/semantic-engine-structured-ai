"use strict";

/*
|--------------------------------------------------------------------------
| Agent Run (EXECUTION_PLAN Phase 16)
|--------------------------------------------------------------------------
|
| Extracted from agent.js. Live closures come from the bound host; sibling
| runtime modules are required (lazily when a cycle would form).
|--------------------------------------------------------------------------
*/

const { host } = require("./engineContext");

const Delegation = require("./DelegationRunner");

const { isInitCommand, initTask } = require("../prompt/ProjectInstructionsBuilder");
const { expandTask } = require("../prompt/TaskMentions");
const { parseSkillCommand, attachSkill } = require("../tools/skills/SkillCommand");
const { syncSkillIndex } = require("../prompt/SkillIndexMessage");
const { channel: imageChannel } = require("./ImageChannel");


async function runAgentCore(options = {}) {

    const h = host();


    const projectContext =
        h.resolveRunProjectContext(options);

    /*
    | Pick up any edit made to a registry or the policy since the last
    | run, then validate what was actually loaded.
    */

    h.loadRegistries(false);

    h.validateRegistries();

    const carried =
        h.currentRun().carried || { background_processes: [] };

    if (carried.background_processes.length > 0) {

        h.logLine(
            "main_agent",
            `${carried.background_processes.length} background process(es) from an earlier run are still alive: ${
                carried.background_processes
                    .map(item => item.process_id)
                    .join(", ")
            }`
        );
    }

    h.startRun();

    /*
    | Context resolved before startRun so a bad project reference fails
    | fast, assigned after it so the clean-slate reset cannot drop it.
    | Still inert in legacy mode (null).
    */
    h.currentRun().project = projectContext;

    h.resetAgentBudget();

    /*
    | The tools an MCP server offers have to be known before the first
    | request is built, or the model is told about a capability one
    | iteration after it needed it. Discovery is bounded, and a server
    | that does not answer is left out rather than allowed to hold up
    | the run.
    */

    await h.discoverMcpTools();

    /* `/init` writes the project's AGENTS.md (roadmap P1-01) */
    if (isInitCommand(options.task)) {
        options = { ...options, task: initTask() };
    }

    h.currentRun().task =
        options.task ||
        h.readTask();

    /* Every user task in this run starts a new turn; all events and
       conversation steps it produces share the same turn_id, so the UI can
       render the execution for a user message as one stage-by-stage block.
       A caller (such as the web server) may pass its own turn_id so the
       conversation message and the runtime events line up. */
    const turn_id =
        options.turn_id ||
        `${h.currentRun().id}_t${(h.currentRun().turnCounter = (h.currentRun().turnCounter || 0) + 1)}`;

    if (h.currentRun() instanceof h.AgentRunContext) {
        h.currentRun().turnId = turn_id;
    }

    h.events.setContext({ turn_id });

    /*
    | A caller that keeps a history array across calls gets a
    | multi-turn session: the array is filled on the first run and
    | extended with the new task on every following run.
    */

    h.events.emit("run:start", {
        run_id:
            h.currentRun().id,

        turn_id,

        task:
            h.currentRun().task,

        continued:
            Array.isArray(options.history) &&
            options.history.length > 0
    });

    /* Exactly one terminal event (run:end or run:error) must follow a
       run:start; `run_open` is what lets the error path know whether one
       is still owed. */
    h.currentRun().run_open = true;

    const messages =
        Array.isArray(options.history)
            ? options.history
            : [];

    /* The run context aliases the very array the loop mutates, so a
       run handle always sees its own conversation as it grows. */
    if (h.currentRun() instanceof h.AgentRunContext) {
        h.currentRun().messages = messages;
    }

    if (typeof h.refreshRepositoryContext === "function") {
        await h.refreshRepositoryContext();
    }

    /*
    | @path mentions are read into the message and attached pictures are
    | shown to the model (roadmap P1-09); the run keeps the user's own
    | words as its task.
    */

    /* `/skill <name> [message]`: that skill's full text rides with this message */
    const skillCommand =
        parseSkillCommand(options.task);

    const prepared =
        expandTask(
            skillCommand
                ? skillCommand.message
                : options.task && options.task.trim() !== ""
                    ? options.task
                    : h.readTask(),
            (projectContext && (projectContext.workspaceRoot || projectContext.rootPath)) ||
                require("../context/WorkspaceBoundary").WORKSPACE_ROOT
        );

    if (skillCommand) {

        prepared.task =
            await attachSkill(skillCommand, prepared.task, {
                toolContext: require("../tools/ToolContext").from({
                    agent: "main_agent",
                    runId: h.currentRun().runId,
                    projectContext: projectContext || undefined
                })
            });
    }

    if (messages.length === 0) {

        messages.push(
            ...h.createMainAgentMessages(prepared.task, { omitSkillIndex: Boolean(skillCommand) })
        );

    } else {

        /* the index of this turn: refreshed, or none beside a chosen skill */
        if (skillCommand) {
            syncSkillIndex(messages, null);
        } else if (typeof h.createSkillIndexMessage === "function") {
            syncSkillIndex(messages, h.createSkillIndexMessage(prepared.task));
        }

        messages.push({
            role: "user",

            turn_id,

            content:
                prepared.task
        });
    }

    if (prepared.images.length > 0) {

        imageChannel.appendFor(messages, prepared.images, {
            label: "Pictures the user attached to this message"
        });
    }

    const mainAgentDefinition =
        (() => {

            const configured =
                h.AGENT_REGISTRY_OF().get(
                    "main_agent"
                );

            /*
            | Delegation is a capability declared by the profile,
            | not an intrinsic property of being the root agent.
            */

            const base =
                configured || {
                    name: "main_agent",
                    tools: "*",
                    delegation: {
                        enabled: true,
                        max_depth:
                            h.settings.get("MAX_AGENT_DEPTH"),
                        max_children:
                            h.settings.get("MAX_PARALLEL_AGENTS")
                    }
                };

            return {
                ...base,

                model:
                    base.model || h.settings.get("AGENT_MODEL"),

                temperature:
                    base.temperature ??
                    h.settings.get("AGENT_TEMPERATURE")
            };
        })();

    h.currentRun().main_agent_definition =
        mainAgentDefinition;

    const mainDepthBudget =
        Delegation.resolveDepthBudget(
            mainAgentDefinition,
            h.settings.get("MAX_AGENT_DEPTH")
        );

    const mainAgentTools =
        h.resolveTools(
            mainAgentDefinition.tools,
            mainAgentDefinition.name || "main_agent"
        );

    const allowedTools =
        new Set(
            mainAgentTools.map(
                tool =>
                    tool.function.name
            )
        );

    const progress = {
        tools: 0,
        delegations: 0,
        nudges: 0,
        continuations: 0
    };

    const beforeHooks =
        await h.runHooks(
            "before_task",
            h.hookExecutionContext(),
            mainAgentDefinition
        );

    if (beforeHooks.stopped) {

        /* The report carries its own verdict: a phase that only
           short-circuited has no failed entry to find, and dereferencing a
           missing one would replace the real reason with a TypeError. */
        const failed =
            beforeHooks.results.find(
                item =>
                    item &&
                    item.status === "failed" &&
                    item.on_failure === "stop"
            ) || null;

        throw new Error(
            failed
                ? `Required before_task hook "${failed.id}" failed: ${failed.summary}`
                : `before_task hooks were stopped: ${beforeHooks.stop_reason || beforeHooks.stopped_by || "unknown stop"}`
        );
    }

    if (beforeHooks.results.length > 0) {

        messages.push({
            role: "user",
            content:
                JSON.stringify({
                    type: "runtime_notice",
                    notice: "before_task_hooks_complete",
                    results:
                        beforeHooks.results.map(item => ({
                            id: item.id,
                            status: item.status,
                            ok: item.ok,
                            summary: item.summary
                        })),
                    instruction:
                        "These deterministic routine steps already ran. Use their evidence and do not repeat them in the plan or with tools."
                })
        });
    }

    const routed =
        await h.autoroutePlanStep(mainAgentDefinition);

    if (routed) {

        progress.delegations++;

        messages.push({
            role: "user",
            content:
                JSON.stringify({
                    type: "runtime_notice",
                    notice: "plan_step_autorouted",
                    result: routed,
                    instruction:
                        "The runtime already delegated this assigned plan step and recorded its evidence. Do not repeat it. Continue from the updated plan and report the verified result."
                })
        });
    }


    return require("./IterationRunner").runMainLoop({
        messages,
        mainAgentDefinition,
        mainDepthBudget,
        mainAgentTools,
        allowedTools,
        progress
    });
}


module.exports = {
    runAgentCore
};
