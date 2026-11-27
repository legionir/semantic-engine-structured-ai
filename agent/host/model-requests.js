"use strict";

/*
|--------------------------------------------------------------------------
| Model requests and responses
|--------------------------------------------------------------------------
|
| The request executor (endpoint, retries, budget) and the wrappers that
| read and repair a model's structured action.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const events = require("../events");
const settings = require("../config");
const { createAgentRequestExecutor } = require("../providers/AgentRequestExecutor");
const actionKit = require("../actions");
const { createUsageRecorder } = require("../runtime/RunCostTracker");


module.exports = function createModelRequests(host) {

    const {
        assertRunActive,
        buildAgentRequest,
        createRequestSignal,
        endpointFor,
        isRetryableStatus,
        isRunCancelled,
        logLine
    } = host;

    const requestExecutor = createAgentRequestExecutor({
        settings,
        endpointFor,
        logLine,
        events,
        buildAgentRequest,
        assertRunActive,
        createRequestSignal,
        isRunCancelled,
        isRetryableStatus,
        recordUsage: createUsageRecorder({
            events,
            currentRun: (...args) => host.currentRun(...args),
            cancelRun: (...args) => host.cancelRun(...args),
            logLine
        })
    });

    const {
        schemaKeyFor,
        responseFormatAllowed,
        mentionsSchemaRejection,
        sendAgentRequest,
        performAgentRequest
    } = requestExecutor;


    /*
    |--------------------------------------------------------------------------
    | Response Parser
    |--------------------------------------------------------------------------
    |
    | Implementation lives in agent/actions/ (EXECUTION_PLAN Phase 15). The
    | functions below stay as compatible wrappers so the runtime loop and the
    | existing exports keep their names and signatures.
    |--------------------------------------------------------------------------
    */

    /*
    | Some OpenAI-compatible servers answer a request that carries `tools`
    | with a native tool call instead of the structured content we asked
    | for. That is a valid protocol answer, so the runtime adapts it to the
    | internal action contract rather than failing the run.
    */

    /*
    | A model that answers with a native tool call has to serialise the
    | arguments itself, and that string is where a small model goes wrong:
    | it appends the shape of the previous tool RESULT, wraps the object in
    | prose, or fences it. The object it meant to send is usually complete
    | and intact, so the runtime reads it out instead of losing the run.
    |
    | Only trailing material is salvaged. Anything that changes the meaning
    | of the arguments is refused, because writing a file with guessed
    | arguments is worse than asking the model again.
    */

    function parseToolArguments(raw) {

        return actionKit.parseToolArguments(raw);
    }


    /*
    | An error the model itself can fix by answering again. The loop turns
    | it into a notice and asks for another answer instead of ending the
    | run, because one badly serialised call is not a failed objective.
    */

    function keepDeclaredArguments(name, args) {

        return actionKit.keepDeclaredArguments(name, args);
    }


    function modelResponseError(message, code, details) {

        return actionKit.modelResponseError(message, code, details);
    }


    function isModelResponseError(error) {

        return actionKit.isModelResponseError(error);
    }


    function responsePreview(data, limit = 2400) {

        return actionKit.responsePreview(data, limit);
    }


    function truncatedResponseError(data) {

        return actionKit.truncatedResponseError(data);
    }


    function compactToolParameterSchema(name) {

        return actionKit.compactToolParameterSchema(name);
    }


    function canonicalActionExamples() {

        return actionKit.canonicalActionExamples();
    }


    function malformedRepairHint(reason, details) {

        return actionKit.malformedRepairHint(reason, details);
    }


    /*
    | A malformed answer is the model's mistake, not a failed objective, so
    | the runtime hands the rejected answer, the exact error, and valid shapes
    | back to the model. This makes the next request a correction attempt,
    | not a blind repetition of the same input.
    */

    function malformedNoticeMessage(error, attempt, retryLimit) {

        return actionKit.malformedNoticeMessage(error, attempt, retryLimit);
    }

    /*
    | A small model sometimes closes the action object one bracket too late and
    | leaves top-level envelope pairs at the tail of the active array:
    |
    |   "tool_calls": [{...}, "version", "1.0"]
    |
    | Those string items can never be calls or delegations, and the version value
    | is fixed by the protocol, so moving an unambiguous suffix is safer than
    | spending every malformed retry on the same bracket mistake. Nothing in the
    | middle of an array, and no ambiguous value, is guessed.
    */

    function repairMarkdownPathArguments(name, args) {

        return actionKit.repairMarkdownPathArguments(name, args);
    }


    function repairStructuredAction(value) {

        return actionKit.repairStructuredAction(value);
    }

    /*
    | Parses and validates one model answer. Everything that is the model's
    | fault is tagged, so the loop can tell a bad answer apart from a broken
    | endpoint.
    */

    function readModelAction(data) {

        return actionKit.readModelAction(data);
    }


    return {
        isModelResponseError,
        keepDeclaredArguments,
        malformedNoticeMessage,
        modelResponseError,
        parseToolArguments,
        readModelAction,
        repairMarkdownPathArguments,
        repairStructuredAction,
        responseFormatAllowed,
        schemaKeyFor,
        sendAgentRequest
    };
};
