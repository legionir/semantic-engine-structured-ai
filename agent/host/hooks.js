"use strict";

/*
|--------------------------------------------------------------------------
| Hooks and plan autoroute
|--------------------------------------------------------------------------
|
| The hook runner and its entry points, routing the next plan step to an
| agent, and the project a run executes in.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");
const toolRuntime = require("../tools");
const events = require("../events");
const settings = require("../config");
const projects = require("../projects");
const hookRegistry = require("../hooks");
const HookRunner = require("../hooks/HookRunner").HookRunner;


module.exports = function createHooks(host) {

    const {
        TOOL_REGISTRY_OF,
        assertRunActive,
        cancelAllRuns,
        cancelRun,
        currentPlanSummary,
        currentRun,
        detectRepository,
        executeDelegations,
        executeDependencyGraph,
        executeToolGraph,
        mainAgentProfile,
        resolveDepthBudget
    } = host;

    /*
    |--------------------------------------------------------------------------
    | Deterministic Runtime Hooks
    |--------------------------------------------------------------------------
    */

    let HOOK_RUNNER = null;


    function hookRunner() {

        if (!HOOK_RUNNER) {

            HOOK_RUNNER = new HookRunner({
                settings,
                registry: hookRegistry,
                events,
                currentRun,
                assertRunActive,
                cancelRun,
                cancelAllRuns,
                currentPlanSummary,
                detectRepository,
                toolRuntime,
                executeToolGraph,
                executeDependencyGraph,
                executeDelegations,
                resolveDepthBudget,
                toolRegistryOf: () => TOOL_REGISTRY_OF(),
                mainAgentProfile
            });
        }

        return HOOK_RUNNER;
    }


    /* Compatibility wrappers: the runtime host and public agent facade retain
       their historical hook function names while the implementation lives in
       agent/hooks/HookRunner.js. */
    function hookExecutionContext(...args) {
        return hookRunner().executionContext(...args);
    }


    async function runHooks(...args) {
        return hookRunner().runHooks(...args);
    }


    function hookReportText(...args) {
        return hookRunner().hookReportText(...args);
    }


    async function applyAfterTaskHooks(...args) {
        return hookRunner().applyAfterTaskHooks(...args);
    }


    async function autoroutePlanStep(mainAgentDefinition) {

        if (
            settings.get("PLAN_AUTOROUTE") !== true ||
            currentRun().inHook
        ) {
            return null;
        }

        const planTools = require("../tools/planning");
        const summary = currentPlanSummary();
        const step = summary.next_step;

        if (!step || !step.agent || step.agent === "main_agent") {
            return null;
        }

        events.emit("plan:autoroute:start", {
            step: step.id,
            title: step.title,
            agent: step.agent
        });

        await planTools.plan_update({
            updates: [
                {
                    id: step.id,
                    status: "in_progress",
                    evidence: `Automatically routed to ${step.agent}.`
                }
            ]
        });

        const results =
            await executeDelegations(
                [
                    {
                        id: `autoroute_${step.id}`,
                        agent: step.agent,
                        persona: null,
                        skills: null,
                        tools: null,
                        task:
                            `Complete plan step ${step.id}: ${step.title}. ` +
                            `Objective: ${summary.objective}. Verify the work and report exact evidence.`,
                        depends_on: []
                    }
                ],
                1,
                mainAgentDefinition,
                Math.max(0, resolveDepthBudget(
                    mainAgentDefinition,
                    settings.get("MAX_AGENT_DEPTH")
                ) - 1),
                "main_agent"
            );

        const delegated = results[0];
        const report = delegated?.result;
        const didWork =
            (report?.performed?.tools || 0) +
            (report?.performed?.delegations || 0) > 0;
        const ok = Boolean(
            delegated?.success &&
            report?.success &&
            !report?.error &&
            didWork
        );
        const evidence =
            ok
                ? report.response?.content || "Assigned agent completed the step."
                : !didWork && report?.success
                    ? "Assigned agent returned without executing a tool or delegation; no runtime evidence was produced."
                    : delegated?.error?.message || report?.error?.message || "Assigned agent failed.";

        await planTools.plan_update({
            updates: [
                {
                    id: step.id,
                    status: ok ? "done" : "blocked",
                    evidence:
                        `PLAN_AUTOROUTE (${step.agent}): ${evidence}`
                }
            ]
        });

        const outcome = {
            step: step.id,
            agent: step.agent,
            ok,
            evidence,
            summary: currentPlanSummary()
        };

        events.emit("plan:autoroute:end", outcome);

        return outcome;
    }


    /*
    |--------------------------------------------------------------------------
    | Main Agent
    |--------------------------------------------------------------------------
    */

    /*
    | Resolve the ProjectContext for one run (EXECUTION_PLAN, Phase 2).
    |
    | legacy mode (default): returns null and the run behaves exactly as
    | before — project options are ignored, nothing looks at RUN.project.
    |
    | modular mode: the explicit option wins ({project, projectId}), else the
    | default project; while the tool layer still reads the process-wide
    | WORKSPACE_ROOT, a project rooted elsewhere fails loudly here instead of
    | silently mis-scoping tool calls (the cross-root execution lands with
    | the project-aware tool runtime in Phase 4).
    */
    function resolveRunProjectContext(options) {

        return projects.resolveProjectForRun(options, {
            registry: projects.registry(),
            workspaceRoot: WORKSPACE_ROOT
        });

    }


    return {
        applyAfterTaskHooks,
        autoroutePlanStep,
        hookExecutionContext,
        hookReportText,
        resolveRunProjectContext,
        runHooks
    };
};
