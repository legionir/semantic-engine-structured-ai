"use strict";

/* Bounded examples and correction prompts for malformed model actions. */

const ctx = require("./context");

function compactToolParameterSchema(name) {

    const tool =
        ctx.toolsOf().find(
            item => item.function.name === name
        );

    const parameters =
        tool?.function?.parameters;

    if (!parameters) {
        return null;
    }

    const properties = {};

    for (
        const [key, definition]
        of Object.entries(parameters.properties || {})
    ) {

        properties[key] = {
            type:
                definition.type ||
                (
                    definition.anyOf
                        ? definition.anyOf.map(item => item.type).filter(Boolean)
                        : undefined
                ),

            enum:
                definition.enum,

            description:
                typeof definition.description === "string"
                    ? definition.description.slice(0, 300)
                    : undefined
        };

        for (const field of Object.keys(properties[key])) {

            if (properties[key][field] === undefined) {
                delete properties[key][field];
            }
        }
    }

    return {
        tool: name,
        arguments_must_be:
            ctx.settings.get("AGENT_SCHEMA") === "strict"
                ? "one JSON object encoded as a string"
                : "one JSON object",
        required:
            parameters.required ||
            [],
        properties,
        additional_properties_allowed:
            parameters.additionalProperties !== false
    };
}


function canonicalActionExamples() {

    const argumentsValue =
        ctx.settings.get("AGENT_SCHEMA") === "strict"
            ? JSON.stringify({
                path: "IMPLEMENTATION_PLAN.md"
            })
            : {
                path: "IMPLEMENTATION_PLAN.md"
            };

    return {
        tool_call: {
            version: "1.0",
            action: "tool_call",
            tool_calls: [
                {
                    id: "read_plan",
                    name: "fs_read",
                    arguments: argumentsValue,
                    depends_on: []
                }
            ],
            delegations: null,
            response: null,
            data: null,
            error: null,
            performed: null
        },

        delegate: {
            version: "1.0",
            action: "delegate",
            tool_calls: null,
            delegations: [
                {
                    id: "analyze_1",
                    agent: "code_analysis",
                    persona: null,
                    skills: null,
                    tools: null,
                    task:
                        "Inspect the relevant files and report findings with evidence.",
                    depends_on: []
                }
            ],
            response: null,
            data: null,
            error: null,
            performed: null
        },

        final: {
            version: "1.0",
            action: "final",
            tool_calls: null,
            delegations: null,
            response: {
                type: "text",
                content: "The actual result for the user."
            },
            data: null,
            error: null,
            performed: null
        }
    };
}


function malformedRepairHint(reason, details) {

    const action =
        details?.detected_action;

    if (details?.truncated) {

        return "The endpoint cut the previous answer off before its JSON closed. Return one much smaller complete action now; do not resend the full oversized payload. Prefer a concise change or a localized fs_edit. For a genuinely large new file, write a temporary path in bounded chunks across iterations (overwrite first, append later), then move it into place only after it is complete.";
    }

    const missingTopLevel =
        /missing required top-level field "([^"]+)"/i.exec(reason);

    if (missingTopLevel) {

        return `Return the complete top-level ${action || "action"} envelope. The field "${missingTopLevel[1]}" was absent; copy the closest valid shape exactly and replace only its example values.`;
    }

    const missingCallFields =
        /Tool call is missing required field\(s\): ([^.]+)\./i.exec(reason);

    if (missingCallFields) {

        return `Every tool_calls item must contain id, name, arguments and depends_on. This item is missing ${missingCallFields[1]}; use one arguments object and use depends_on: [] only when the call is genuinely independent.`;
    }

    if (/Each tool call must be an object/i.test(reason)) {

        return "Every tool_calls item must be one object with exactly id, name, arguments and depends_on. Remove prose and misplaced envelope values from the array, but do not omit an intended call.";
    }

    if (
        action === "delegate" &&
        /delegations/i.test(reason)
    ) {

        return "You selected delegate but did not provide a delegation. If you really need a sub-agent, keep action=delegate and add at least one complete delegation. If your next step is reading, searching, running, or writing, change action to tool_call and call the tool now.";
    }

    if (
        action === "tool_call" &&
        /tool_calls/i.test(reason)
    ) {

        return "You selected tool_call but did not provide a call. Add at least one complete tool call. Do not describe the intended call in data, response, or prose.";
    }

    if (
        action === "final" ||
        /Final response/i.test(reason)
    ) {

        return "action=final requires a non-null response object with type and content. If an operation is still needed, do not use final; return tool_call or delegate with a non-empty active array.";
    }

    if (details?.tool) {

        return `Rewrite the arguments for "${details.tool}" as exactly one JSON object containing only that tool's declared parameters. Do not append prose, result fields, or another object.`;
    }

    return "Rebuild the whole response from one canonical example. Choose the action from the operation you are returning now, replace the example values, and keep every inactive field null.";
}




function malformedNoticeMessage(error, attempt, retryLimit) {

    const reason =
        typeof error === "string"
            ? error
            : error?.message || "Malformed model response.";

    const code =
        typeof error === "object" && error?.code
            ? error.code
            : "MALFORMED_RESPONSE";

    const details =
        typeof error === "object" && error?.details
            ? error.details
            : {};

    const examples =
        canonicalActionExamples();

    const detectedAction =
        ["tool_call", "delegate", "final"].includes(
            details.detected_action
        )
            ? details.detected_action
            : null;

    const maximumAttempts =
        retryLimit + 1;

    return {
        role: "user",

        content:
            JSON.stringify({
                type: "runtime_notice",
                notice: "malformed_response",

                correction_attempt: {
                    attempt,
                    maximum_attempts: maximumAttempts,
                    attempts_left:
                        Math.max(0, maximumAttempts - attempt)
                },

                error: {
                    code,
                    message: reason
                },

                response_diagnostics:
                    details.truncated
                        ? {
                            finish_reason: details.finish_reason,
                            completion_tokens: details.completion_tokens,
                            output_chars: details.output_chars
                        }
                        : null,

                rejected_response:
                    details.rejected_response ||
                    null,

                detected_action: detectedAction,

                repair: {
                    instruction:
                        "Your previous answer was rejected before any action ran. Do not repeat it. Return a corrected replacement as exactly one JSON object, with no Markdown fence or prose before or after it.",

                    issue_specific:
                        malformedRepairHint(reason, details),

                    action_field_matrix: {
                        tool_call:
                            "tool_calls must be a non-empty array; delegations, response, data, error and performed must be null.",
                        delegate:
                            "delegations must be a non-empty array; tool_calls, response, data, error and performed must be null.",
                        final:
                            "response must be a non-null {type, content} object; tool_calls and delegations must be null. data, error and performed are final-only."
                    },

                    closest_valid_shape:
                        detectedAction
                            ? examples[detectedAction]
                            : null,

                    canonical_complete_examples:
                        examples,

                    expected_tool_arguments:
                        details.tool
                            ? compactToolParameterSchema(details.tool)
                            : null,

                    checklist: [
                        "version is the top-level literal string 1.0, never an item inside tool_calls or delegations",
                        "action matches the one active field",
                        "the active array is not empty, or final response is non-null",
                        "all inactive and non-final fields are null",
                        "all required nested fields are present",
                        "the output contains one JSON object and nothing else"
                    ]
                }
            })
    };
}



module.exports = { compactToolParameterSchema, canonicalActionExamples, malformedRepairHint, malformedNoticeMessage };
