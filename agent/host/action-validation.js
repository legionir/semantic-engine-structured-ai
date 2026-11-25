"use strict";

/*
|--------------------------------------------------------------------------
| Action validation and delegation
|--------------------------------------------------------------------------
|
| Reporting model responses, validating an action and its graph, the
| delegation policy, loop/nudge messages and running sub-agents.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const events = require("../events");
const settings = require("../config");
const { createResponseReporter } = require("../providers/ResponseReporter");
const actionKit = require("../actions");
const runtimeEngine = require("../runtime/engine");


module.exports = function createActionValidation(host) {

    const {
        currentRun,
        effectiveProject,
        promptFacade
    } = host;

    const responseReporter = createResponseReporter({ settings, events });

    const {
        reasoningText,
        modelMessageText,
        reportThinking,
        reportModelResponse
    } = responseReporter;


    function adaptNativeToolCalls(message) {

        return actionKit.adaptNativeToolCalls(message);
    }


    /*
    | Models occasionally wrap the JSON object in a markdown fence even when
    | a schema was requested. Unwrapping it is cheaper than losing the run.
    */

    function stripCodeFence(text) {

        return actionKit.stripCodeFence(text);
    }


    function parseStructuredResponse(
        data
    ) {

        return actionKit.parseStructuredResponse(data);
    }


    /*
    |--------------------------------------------------------------------------
    | Action Validation
    |--------------------------------------------------------------------------
    */

    function validateActionGraph(items, noun) {

        return actionKit.validateActionGraph(items, noun);
    }


    function requireNullFields(action, fields) {

        return actionKit.requireNullFields(action, fields);
    }


    /* Phase 12: a delegation may name a project. Missing / null means
       inherit the active project. Both camelCase (implementation plan)
       and snake_case are accepted; conflicting values are rejected. */
    function requestedDelegationProjectId(delegation) {

        return actionKit.requestedDelegationProjectId(delegation);
    }


    function delegationProjectSwitchEnabled() {

        return true;

    }


    function findingsFromReport(...args) {

        return runtimeEngine.findingsFromReport(...args);

    }


    function validateAction(
        action
    ) {

        return actionKit.validateAction(action);
    }

    /*
    |--------------------------------------------------------------------------
    | OpenAI Tool Conversation
    |--------------------------------------------------------------------------
    */

    function appendToolConversation(...args) {

        return runtimeEngine.appendToolConversation(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Delegation Validation
    |--------------------------------------------------------------------------
    */

    /* A delegation that violates the profile policy (disabled, too deep, or too
       many children) is the model's decision, not a broken objective. It used to
       be thrown as a plain Error from the delegate branch, which is outside the
       malformed-response retry loop, so a single oversized delegation killed the
       whole run instead of being handed back to the model for correction. These
       are now model-response errors so the loop returns them to the model with
       the same retry budget as any other invalid action. */

    function validateDelegationPolicy(...args) {

        return runtimeEngine.validateDelegationPolicy(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Delegation Depth Budget
    |--------------------------------------------------------------------------
    |
    | An agent may delegate as deep as its own policy allows, but never
    | deeper than the budget inherited from its parent or the runtime cap.
    |--------------------------------------------------------------------------
    */

    function resolveDepthBudget(...args) {

        return runtimeEngine.resolveDepthBudget(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Unfinished Final Detection
    |--------------------------------------------------------------------------
    */

    function isUnfinishedFinal(...args) {

        return runtimeEngine.isUnfinishedFinal(...args);

    }


    function failureSignature(...args) {

        return runtimeEngine.failureSignature(...args);

    }


    function trackRepeatedFailure(...args) {

        return runtimeEngine.trackRepeatedFailure(...args);

    }


    /*
    | A run that dies on its deadline throws away whatever it had. The last
    | slice of the budget is therefore reserved for finishing: the agent is
    | told to stop exploring and answer with what it has, which turns a
    | cancelled run into a partial result and a named next step.
    */

    function wrapUpMessage(...args) {

        return runtimeEngine.wrapUpMessage(...args);

    }


    function loopNoticeMessage(...args) {

        return runtimeEngine.loopNoticeMessage(...args);

    }


    function planContinuationMessage(...args) {

        return runtimeEngine.planContinuationMessage(...args);

    }


    function nudgeMessage(...args) {

        return runtimeEngine.nudgeMessage(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Sub-Agent Messages
    |--------------------------------------------------------------------------
    */

    function createSubAgentMessages(
        agentDefinition,
        task,
        context
    ) {
        return promptFacade().subAgentMessages(
            agentDefinition,
            task,
            context,
            { project: effectiveProject(currentRun().project) }
        );
    }


    /*
    |--------------------------------------------------------------------------
    | Sub-Agent Runtime
    |--------------------------------------------------------------------------
    */

    /*
    | A sub-agent that dies mid-run, on its iteration limit, on a repeated
    | failure or on the deadline, used to leave its node in the console
    | running for ever, because agent:end was only emitted on a final
    | answer. Whatever happens, the node now closes.
    */

    async function runSubAgent(...args) {

        return await runtimeEngine.runSubAgent(...args);

    }


    async function runSubAgentLoop(...args) {

        return await runtimeEngine.runSubAgentLoop(...args);

    }


    /*
    |--------------------------------------------------------------------------
    | Delegation Graph
    |--------------------------------------------------------------------------
    */

    async function executeDelegations(...args) {

        return await runtimeEngine.executeDelegations(...args);

    }


    return {
        adaptNativeToolCalls,
        appendToolConversation,
        createSubAgentMessages,
        delegationProjectSwitchEnabled,
        executeDelegations,
        isUnfinishedFinal,
        parseStructuredResponse,
        reportModelResponse,
        requestedDelegationProjectId,
        resolveDepthBudget,
        trackRepeatedFailure,
        validateAction,
        validateDelegationPolicy
    };
};
