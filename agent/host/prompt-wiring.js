"use strict";

/*
|--------------------------------------------------------------------------
| Prompt kit wiring
|--------------------------------------------------------------------------
|
| The tool and skill resolvers and the prompt builder, created lazily on
| first use so they always read the live registries, settings and run.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");
const projects = require("../projects");
const promptKit = require("../prompt");
const memoryStore = require("../context/Memory");
const {
    _skillIndex: skillIndex,
    _isActiveSkill: isActiveSkill
} = require("../tools/skills");
const archive = require("../persistence/ArchiveRepository");
const { runDirectives } = require("../runtime/RunDirectives");
const ScopedRules = require("../prompt/ScopedRules");


module.exports = function createPromptWiring(host) {

    const {
        AGENTS_OF,
        CONFIGURED_RUNTIME_OF,
        PERSONAS_OF,
        POLICY_ENGINE,
        RESPONSE_FORMAT_OF,
        SKILL_REGISTRY_OF,
        TOOL_REGISTRY_OF,
        currentAgentBudget,
        currentPlanSummary,
        currentRun,
        detectEnvironment,
        detectRepository,
        discussionPersonaNames,
        effectiveProject,
        endpointFor,
        endpointOverview,
        executionRules,
        mcpContext,
        mcpToolDeclarations,
        resolveAgentCapabilities,
        runRemainingMs,
        systemPrompt
    } = host;

    /* set up by a later factory, so looked up when called */
    const describeCapability = (...args) => host.describeCapability(...args);
    const mainAgentProfile = (...args) => host.mainAgentProfile(...args);
    const mayDelegate = (...args) => host.mayDelegate(...args);
    const readTask = (...args) => host.readTask(...args);

    /*
    | Prompt kit wiring (EXECUTION_PLAN Phase 5). The injected builders and
    | resolvers are created lazily on first use: every dependency they take
    | is a closure over live registry/settings/run state, so nothing ages,
    | and are constructed lazily so live registry/settings state is always used.
    */

    let TOOL_RESOLVER = null;

    let SKILL_RESOLVER = null;

    let PROMPT_FACADE = null;


    function toolResolver() {

        if (!TOOL_RESOLVER) {

            TOOL_RESOLVER =
                promptKit.createToolResolver({
                    TOOL_REGISTRY_OF: () => TOOL_REGISTRY_OF(),
                    mcpToolDeclarations: options => mcpToolDeclarations(options),
                    allMcpToolDeclarations: options =>
                        typeof host.allMcpToolDeclarations === "function"
                            ? host.allMcpToolDeclarations(options)
                            : mcpToolDeclarations(options)
                });

        }

        return TOOL_RESOLVER;

    }


    function skillResolver() {

        if (!SKILL_RESOLVER) {

            SKILL_RESOLVER =
                promptKit.createSkillResolver({
                    SKILL_REGISTRY_OF: () => SKILL_REGISTRY_OF(),
                    isActiveSkill: skill => isActiveSkill(skill)
                });

        }

        return SKILL_RESOLVER;

    }


    function promptFacade() {

        if (!PROMPT_FACADE) {

            PROMPT_FACADE =
                promptKit.createPromptBuilder({
                    listProjects:
                        () => projects.registry().list(),

                    main: {
                        systemPrompt: () => systemPrompt(),
                        executionRules: () => executionRules(),
                        skillIndex: () => skillIndex(),
                        PERSONAS_OF: () => PERSONAS_OF(),
                        AGENTS_OF: () => AGENTS_OF(),
                        discussionPersonaNames: () => discussionPersonaNames(),
                        describeCapability: agent => describeCapability(agent),
                        mayDelegate: () => mayDelegate(mainAgentProfile()),
                        readTask: () => readTask()
                    },

                    subAgent: {
                        resolveAgentCapabilities:
                            agentDefinition =>
                                resolveAgentCapabilities(agentDefinition),
                        executionRules:
                            agentDefinition => executionRules(agentDefinition),
                        mayDelegate:
                            agentDefinition => mayDelegate(agentDefinition)
                    },

                    runtimeContext: {
                        CONFIGURED_RUNTIME_OF: () => CONFIGURED_RUNTIME_OF(),
                        detectEnvironment: () => detectEnvironment(),
                        detectRepository: () =>
                            detectRepository(
                                effectiveProject(currentRun().project)
                                    ? effectiveProject(currentRun().project).workspaceRoot
                                    : undefined
                            ),
                        workspaceRoot: () =>
                            effectiveProject(currentRun().project)
                                ? effectiveProject(currentRun().project).workspaceRoot
                                : WORKSPACE_ROOT,
                        planSummary: () => currentPlanSummary(),
                        memorySizeChars: () =>
                            memoryStore.memorySize(memoryStore.loadMemory()),
                        archiveStats: () => archive.stats(),
                        policySummary: () => POLICY_ENGINE.summary(),
                        endpointOverview: () => endpointOverview(),
                        agentsSpawned: () => currentAgentBudget().spawned,
                        runStartedAt: () => currentRun().started_at,
                        runRemainingMs: () => runRemainingMs(),
                        mcpContext: () => mcpContext(),
                        runDirectives: () => runDirectives(currentRun()),
                        projectRules: () =>
                            ScopedRules.rulesFor(
                                effectiveProject(currentRun().project)
                                    ? effectiveProject(currentRun().project).workspaceRoot
                                    : WORKSPACE_ROOT,
                                currentRun().touchedPaths
                            )
                    },

                    request: {
                        endpointFor:
                            (role, agentDefinition) =>
                                endpointFor(role, agentDefinition),
                        RESPONSE_FORMAT_OF: () => RESPONSE_FORMAT_OF()
                    }
                });

        }

        return PROMPT_FACADE;

    }


    return {
        promptFacade,
        skillResolver,
        toolResolver
    };
};
