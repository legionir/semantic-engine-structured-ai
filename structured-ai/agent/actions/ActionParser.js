"use strict";

/*
|--------------------------------------------------------------------------
| Action Parser (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| Reads a provider response into the internal action envelope: structured
| JSON, fenced JSON, or a native tool-call payload. readModelAction is the
| orchestration entry: parse → repair → validate, tagging every model fault.
|--------------------------------------------------------------------------
*/

const ctx = require("./context");
const {
    modelResponseError,
    isModelResponseError,
    responsePreview,
    truncatedResponseError
} = require("./ActionErrors");
const { repairStructuredAction } = require("./ResponseRepair");
const { adaptNativeToolCalls } = require("./NativeToolCallAdapter");
const { validateAction } = require("./ActionValidator");


function stripCodeFence(text) {

    const match =
        /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);

    return match
        ? match[1]
        : text;
}


function parseToolArguments(raw) {

    const text =
        stripCodeFence(String(raw)).trim();

    try {

        const parsed = JSON.parse(text);

        /*
        | Arguments are always an object. An array or a bare value parses
        | cleanly and would then reach a tool as nonsense, so it is
        | refused here rather than deeper in.
        */

        if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {

            return {
                arguments: parsed,
                repaired: false
            };
        }

        return { failed: "the arguments are not a JSON object" };

    } catch {

        /* fall through to the salvage pass */
    }

    const start = text.indexOf("{");

    if (start === -1) {

        return { failed: "there is no JSON object in the arguments" };
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index++) {

        const character = text[index];

        if (escaped) {

            escaped = false;

            continue;
        }

        if (character === "\\" && inString) {

            escaped = true;

            continue;
        }

        if (character === '"') {

            inString = !inString;

            continue;
        }

        if (inString) {
            continue;
        }

        if (character === "{") {

            depth++;

            continue;
        }

        if (character !== "}") {
            continue;
        }

        depth--;

        if (depth !== 0) {
            continue;
        }

        const candidate =
            text.slice(start, index + 1);

        try {

            const parsed = JSON.parse(candidate);

            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
            ) {
                return { failed: "the arguments are not a JSON object" };
            }

            return {
                arguments: parsed,

                repaired: true,

                ignored:
                    text.slice(index + 1).trim()
            };

        } catch {

            return { failed: "the arguments are not valid JSON" };
        }
    }

    return { failed: "the arguments are not valid JSON" };
}




function parseStructuredResponse(
    data
) {

    const message =
        data?.choices?.[0]?.message;

    if (!message) {

        throw new Error(
            "AI response does not contain a message."
        );
    }

    if (
        typeof message.content === "object" &&
        message.content !== null
    ) {

        return {
            message,

            structured:
                message.content,

            source:
                "structured_content"
        };
    }

    if (typeof message.content === "string") {

        const candidate =
            stripCodeFence(message.content).trim();

        if (candidate !== "") {

            try {

                return {
                    message,

                    structured:
                        JSON.parse(candidate),

                    source:
                        "structured_content"
                };

            } catch {

                /* fall through to the native protocol adapter */
            }
        }
    }

    const adapted =
        adaptNativeToolCalls(message);

    if (adapted) {

        return {
            message,

            structured:
                adapted,

            source:
                "native_tool_calls"
        };
    }

    throw new Error(
        `AI returned neither structured JSON nor a native tool call. Content: ${
            typeof message.content === "string"
                ? message.content.slice(0, 200)
                : typeof message.content
        }`
    );
}




function readModelAction(data) {

    let parsed;

    try {

        parsed = parseStructuredResponse(data);

    } catch (error) {

        /* A response capped mid-JSON is not an unexplained parser failure.
           The finish reason is authoritative and lets the correction prompt
           ask for a bounded write instead of repeating the same large action. */
        const truncated = truncatedResponseError(data);

        if (truncated) {
            throw truncated;
        }

        const rejectedResponse =
            responsePreview(data);

        if (isModelResponseError(error)) {

            error.details = {
                ...(error.details || {}),

                rejected_response:
                    error.details?.rejected_response ||
                    rejectedResponse
            };

            throw error;
        }

        throw modelResponseError(
            error.message,
            "UNREADABLE_RESPONSE",
            {
                rejected_response:
                    rejectedResponse
            }
        );
    }

    const envelopeRepair =
        repairStructuredAction(parsed.structured);

    if (envelopeRepair.repaired) {

        parsed.structured = envelopeRepair.action;

        /* The corrected action, not the malformed source string, belongs in
           the following tool conversation and any persisted session. */
        parsed.message.content =
            JSON.stringify(parsed.structured);

        const reportableRepair =
            envelopeRepair.moved_fields.length > 0 ||
            envelopeRepair.removed_items.length > 0 ||
            envelopeRepair.argument_repairs.length > 0;

        /* Defaulting fixed protocol metadata is normalisation, not an error.
           DeepSeek omits version routinely, so emitting a warning for every
           iteration only floods the event log with "repaired" noise. */
        if (reportableRepair) {

            ctx.events.emit("response:repaired", {
                repair: "action_envelope",
                tool: "action_envelope",
                dropped: [],
                source_field: envelopeRepair.source_field,
                moved_fields: envelopeRepair.moved_fields,
                defaulted_fields: envelopeRepair.defaulted_fields,
                removed_items: envelopeRepair.removed_items,
                argument_repairs: envelopeRepair.argument_repairs
            });

            const repairs = [
                envelopeRepair.moved_fields.length > 0
                    ? `moved ${envelopeRepair.moved_fields.join(", ")} out of ${envelopeRepair.source_field}`
                    : null,
                envelopeRepair.defaulted_fields.length > 0
                    ? `defaulted ${envelopeRepair.defaulted_fields.join(", ")}`
                    : null,
                envelopeRepair.removed_items.length > 0
                    ? `removed ${envelopeRepair.removed_items.join(", ")}`
                    : null,
                envelopeRepair.argument_repairs.length > 0
                    ? `cleaned Markdown links from ${
                        envelopeRepair.argument_repairs
                            .flatMap(item => item.fields.map(field => `${item.tool}.${field}`))
                            .join(", ")
                    }`
                    : null
            ].filter(Boolean);

            ctx.logLine(
                null,
                `Repaired the action envelope: ${repairs.join("; ")}.`
            );
        }
    }

    try {

        validateAction(parsed.structured);

    } catch (error) {

        throw modelResponseError(
            error.message,
            "INVALID_ACTION",
            {
                detected_action:
                    parsed.structured?.action ||
                    null,

                tool:
                    parsed.structured?.action === "tool_call" &&
                    Array.isArray(parsed.structured.tool_calls) &&
                    parsed.structured.tool_calls.length === 1
                        ? parsed.structured.tool_calls[0]?.name || null
                        : null,

                rejected_response:
                    responsePreview(data) ||
                    JSON.stringify(parsed.structured).slice(0, 2400)
            }
        );
    }

    return parsed;
}




module.exports = {
    stripCodeFence,
    parseToolArguments,
    parseStructuredResponse,
    readModelAction
};
