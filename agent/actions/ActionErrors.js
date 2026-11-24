"use strict";

/*
|--------------------------------------------------------------------------
| Action Errors (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| Model-response error tagging, truncated-answer detection, and the short
| preview that travels with a correction notice. Codes and messages are
| the historical contract — callers retry on these, not on new names.
|--------------------------------------------------------------------------
*/


function modelResponseError(message, code, details) {

    const error = new Error(message);

    error.model_response = true;

    error.code = code || "MALFORMED_RESPONSE";

    error.details =
        details && typeof details === "object"
            ? details
            : {};

    return error;
}


function isModelResponseError(error) {

    return Boolean(error && error.model_response === true);
}


function responsePreview(data, limit = 2400) {

    const message =
        data?.choices?.[0]?.message;

    if (!message) {
        return null;
    }

    let value;

    if (
        typeof message.content === "string" &&
        message.content.trim() !== ""
    ) {

        value = message.content.trim();

    } else if (
        message.content &&
        typeof message.content === "object"
    ) {

        value = message.content;

    } else if (Array.isArray(message.tool_calls)) {

        value = {
            tool_calls:
                message.tool_calls
        };
    }

    if (value === undefined) {
        return null;
    }

    const text =
        typeof value === "string"
            ? value
            : JSON.stringify(value);

    return text.length > limit
        ? `${text.slice(0, limit)}…[truncated]`
        : text;
}


function truncatedResponseError(data) {

    const choice = data?.choices?.[0];
    const finishReason = choice?.finish_reason;

    if (!["length", "max_tokens"].includes(finishReason)) {
        return null;
    }

    const content =
        typeof choice?.message?.content === "string"
            ? choice.message.content
            : "";

    const nativeCalls =
        Array.isArray(choice?.message?.tool_calls)
            ? choice.message.tool_calls
            : [];

    const detectedAction =
        /"action"\s*:\s*"(tool_call|delegate|final)"/.exec(content)?.[1] ||
        (nativeCalls.length > 0 ? "tool_call" : null);

    const detectedTool =
        detectedAction === "tool_call"
            ? (
                /"name"\s*:\s*"([^"]+)"/.exec(content)?.[1] ||
                nativeCalls[0]?.function?.name ||
                null
            )
            : null;

    const completionTokens =
        Number.isFinite(data?.usage?.completion_tokens)
            ? data.usage.completion_tokens
            : null;

    return modelResponseError(
        `The endpoint truncated the model response${
            completionTokens !== null
                ? ` after ${completionTokens} completion tokens`
                : ""
        } (finish_reason: "${finishReason}"); the partial action was not executed. Raise MAX_RESPONSE_TOKENS if this endpoint supports a larger output, or return a smaller complete action.`,
        "TRUNCATED_RESPONSE",
        {
            truncated: true,
            finish_reason: finishReason,
            completion_tokens: completionTokens,
            output_chars:
                content.length || JSON.stringify(nativeCalls).length,
            detected_action: detectedAction,
            tool: detectedTool,
            rejected_response: responsePreview(data)
        }
    );
}


module.exports = {
    modelResponseError,
    isModelResponseError,
    responsePreview,
    truncatedResponseError
};
