"use strict";

/*
|--------------------------------------------------------------------------
| Kit bindings
|--------------------------------------------------------------------------
|
| Hands the live runtime functions to the extracted kits (application,
| actions, context and the runtime engine). They read them through host()
| from their first call, so this must run before main().
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const toolRuntime = require("../tools");
const events = require("../events");
const settings = require("../config");
const eventstore = require("../persistence/EventStoreRepository");
const projects = require("../projects");
const { compactConversation, findExchanges } = require("../context");
const application = require("../application");
const actionKit = require("../actions");
const runtimeEngine = require("../runtime/engine");
const contextKit = require("../context");


module.exports = function bindKits(host) {

    const {
        AGENT_REGISTRY_OF,
        AgentRunContext,
        FILE_MUTATING_TOOLS,
        LOG_STREAM,
        POLICY_ENGINE,
        PRINT_FINAL,
        TOOLS_OF,
        TOOL_REGISTRY_OF,
        applyAfterTaskHooks,
        archiveExchanges,
        assertRunActive,
        autoroutePlanStep,
        buildAgentRequest,
        cancelRun,
        consumeAgentBudget,
        createMainAgentMessages,
        createSubAgentMessages,
        currentAgentBudget,
        currentPlanSummary,
        currentRun,
        delegationProjectSwitchEnabled,
        discoverMcpTools,
        effectiveProject,
        effectiveProjectId,
        enforceCrossProjectWrite,
        hookExecutionContext,
        hookReportText,
        isModelResponseError,
        isMultiProjectTask,
        keepDeclaredArguments,
        loadRegistries,
        logLine,
        logObject,
        main,
        mainAgentProfile,
        maintainContext,
        malformedNoticeMessage,
        mayDelegate,
        modelResponseError,
        noteDelegationProject,
        parseArguments,
        projectIdOf,
        readModelAction,
        readTask,
        refreshRuntimeContext,
        remainingAgentBudget,
        repairMarkdownPathArguments,
        reportModelResponse,
        requestedDelegationProjectId,
        resetAgentBudget,
        resolveAgentCapabilities,
        resolveDelegationProfile,
        resolveRunProjectContext,
        resolveTools,
        roleForDepth,
        runAgent,
        runHooks,
        runRemainingMs,
        runWithProject,
        sendAgentRequest,
        startRun,
        summariseTranscript,
        validateRegistries
    } = host;

    application.bind({
        runAgent,
        main,
        tools: toolRuntime,
        eventstore,
        cancelRun
    });


    actionKit.bind({
        toolsOf: () => TOOLS_OF(),
        events,
        logLine
    });

    contextKit.bind({
        events,
        logLine,
        currentRun,
        assertRunActive,
        summariseTranscript,
        buildAgentRequest
    });

    runtimeEngine.bind({
        settings,
        events,
        logLine,
        logObject,
        LOG_STREAM,
        PRINT_FINAL,
        currentRun,
        AgentRunContext,
        currentAgentBudget,
        toolRuntime,
        POLICY_ENGINE,
        FILE_MUTATING_TOOLS,
        assertRunActive,
        runRemainingMs,
        keepDeclaredArguments,
        parseArguments,
        repairMarkdownPathArguments,
        enforceCrossProjectWrite,
        effectiveProject,
        effectiveProjectId,
        projectIdOf,
        runWithProject,
        noteDelegationProject,
        isMultiProjectTask,
        consumeAgentBudget,
        remainingAgentBudget,
        mayDelegate,
        resolveTools,
        resolveAgentCapabilities,
        resolveDelegationProfile,
        createSubAgentMessages,
        sendAgentRequest,
        readModelAction,
        isModelResponseError,
        malformedNoticeMessage,
        reportModelResponse,
        maintainContext,
        refreshRuntimeContext,
        roleForDepth,
        requestedDelegationProjectId,
        delegationProjectSwitchEnabled,
        projects,
        modelResponseError,
        compactConversation,
        findExchanges,
        archiveExchanges,
        startRun,
        resetAgentBudget,
        discoverMcpTools,
        loadRegistries,
        validateRegistries,
        createMainAgentMessages,
        readTask,
        runHooks,
        hookExecutionContext,
        applyAfterTaskHooks,
        hookReportText,
        autoroutePlanStep,
        AGENT_REGISTRY_OF,
        TOOL_REGISTRY_OF,
        mainAgentProfile,
        currentPlanSummary,
        resolveRunProjectContext
    });


    return {

    };
};
