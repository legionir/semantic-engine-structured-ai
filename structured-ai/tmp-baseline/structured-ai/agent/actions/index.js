"use strict";

/*
|--------------------------------------------------------------------------
| Action Kit (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| Parse, repair, normalise and validate a model response. The runtime
| loop still lives in agent.js (Phase 16); this kit is the extracted
| reader. bind() is called from the facade once TOOLS_OF / events /
| logLine exist. Until then toolsOf is empty and emit/log are no-ops.
|--------------------------------------------------------------------------
*/

const context = require("./context");
const ActionErrors = require("./ActionErrors");
const ActionNormalizer = require("./ActionNormalizer");
const ResponseRepair = require("./ResponseRepair");
const NativeToolCallAdapter = require("./NativeToolCallAdapter");
const ActionParser = require("./ActionParser");
const ActionValidator = require("./ActionValidator");


module.exports = {
    bind: context.bind,

    modelResponseError: ActionErrors.modelResponseError,
    isModelResponseError: ActionErrors.isModelResponseError,
    responsePreview: ActionErrors.responsePreview,
    truncatedResponseError: ActionErrors.truncatedResponseError,

    parseArguments: ActionNormalizer.parseArguments,
    keepDeclaredArguments: ActionNormalizer.keepDeclaredArguments,

    repairMarkdownPathArguments: ResponseRepair.repairMarkdownPathArguments,
    repairStructuredAction: ResponseRepair.repairStructuredAction,
    compactToolParameterSchema: ResponseRepair.compactToolParameterSchema,
    canonicalActionExamples: ResponseRepair.canonicalActionExamples,
    malformedRepairHint: ResponseRepair.malformedRepairHint,
    malformedNoticeMessage: ResponseRepair.malformedNoticeMessage,

    adaptNativeToolCalls: NativeToolCallAdapter.adaptNativeToolCalls,

    stripCodeFence: ActionParser.stripCodeFence,
    parseToolArguments: ActionParser.parseToolArguments,
    parseStructuredResponse: ActionParser.parseStructuredResponse,
    readModelAction: ActionParser.readModelAction,

    validateActionGraph: ActionValidator.validateActionGraph,
    requireNullFields: ActionValidator.requireNullFields,
    requestedDelegationProjectId: ActionValidator.requestedDelegationProjectId,
    validateAction: ActionValidator.validateAction
};
