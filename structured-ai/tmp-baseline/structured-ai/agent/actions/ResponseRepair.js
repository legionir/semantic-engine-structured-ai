"use strict";

/*
|--------------------------------------------------------------------------
| Response Repair (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| Envelope salvage (trailing leaked keys, missing protocol defaults) and
| Markdown-link cleanup on path-like tool arguments. The correction notice
| the loop feeds back to the model also lives here so retry text, error
| codes and response_diagnostics stay in one place.
|--------------------------------------------------------------------------
*/

const ctx = require("./context");


function repairMarkdownPathArguments(name, args) {

    if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args)
    ) {
        return { arguments: args, repaired_fields: [] };
    }

    const declared =
        ctx.toolsOf().find(
            tool => tool.function.name === name
        );

    const properties =
        declared?.function?.parameters?.properties || {};

    const pathFields =
        new Set([
            "path",
            "paths",
            "cwd",
            "source",
            "destination"
        ]);

    const repaired = { ...args };
    const fields = [];

    const clean = value => {

        if (typeof value !== "string") {
            return value;
        }

        return value.replace(
            /\[([^\]\r\n]+)\]\(https?:\/\/[^)\s]+\)/g,
            "$1"
        );
    };

    for (const [field, value] of Object.entries(args)) {

        if (
            !pathFields.has(field) ||
            !Object.prototype.hasOwnProperty.call(properties, field)
        ) {
            continue;
        }

        const next =
            Array.isArray(value)
                ? value.map(clean)
                : clean(value);

        if (JSON.stringify(next) !== JSON.stringify(value)) {
            repaired[field] = next;
            fields.push(field);
        }
    }

    return {
        arguments: repaired,
        repaired_fields: fields
    };
}


function repairStructuredAction(value) {

    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !["tool_call", "delegate", "final"].includes(value.action)
    ) {

        return {
            action: value,
            repaired: false,
            moved_fields: [],
            defaulted_fields: [],
            removed_items: [],
            argument_repairs: []
        };
    }

    const activeField =
        value.action === "tool_call"
            ? "tool_calls"
            : value.action === "delegate"
                ? "delegations"
                : null;

    const action = {
        ...value,

        ...(activeField && Array.isArray(value[activeField])
            ? { [activeField]: [...value[activeField]] }
            : {})
    };

    const moved = [];
    const defaulted = [];
    const removed = [];
    const argumentRepairs = [];

    if (activeField && Array.isArray(action[activeField])) {

        const expectedNull =
            value.action === "tool_call"
                ? new Set(["delegations", "response", "data", "error", "performed"])
                : new Set(["tool_calls", "response", "data", "error", "performed"]);

        const canMove = (field, fieldValue) => {

            if (
                Object.prototype.hasOwnProperty.call(action, field) ||
                field === activeField
            ) {
                return false;
            }

            if (field === "version") {
                return fieldValue === "1.0";
            }

            return expectedNull.has(field) && fieldValue === null;
        };

        while (action[activeField].length > 0) {

            const last =
                action[activeField][action[activeField].length - 1];

            let field;
            let fieldValue;
            let remove = 0;

            if (
                Array.isArray(last) &&
                last.length === 2 &&
                typeof last[0] === "string"
            ) {

                [field, fieldValue] = last;
                remove = 1;

            } else if (
                action[activeField].length >= 2 &&
                typeof action[activeField][action[activeField].length - 2] === "string"
            ) {

                field = action[activeField][action[activeField].length - 2];
                fieldValue = last;
                remove = 2;

            } else if (
                typeof last === "string"
            ) {

                /* The model sometimes closes the object one bracket too
                   late and drops the envelope pair as a single trailing
                   string item instead of two tokens or an array pair, e.g.
                   "version": "1.0". Version's value is protocol-fixed, so
                   recovering it deterministically (never guessing) is safe
                   and avoids burning a malformed retry on the same bracket
                   mistake. Only version is treated this way; any other
                   trailing string is left alone. */
                const leakedVersion =
                    /^"?version"?\s*:\s*"?([^"]*)"?$/.exec(
                        last
                    );

                if (
                    leakedVersion &&
                    leakedVersion[1] === "1.0"
                ) {

                    field = "version";
                    fieldValue = "1.0";
                    remove = 1;
                }
            }

            if (!remove || !canMove(field, fieldValue)) {
                break;
            }

            action[activeField].splice(-remove, remove);
            action[field] = fieldValue;
            moved.unshift(field);
        }

        /* A dangling "version" item is also impossible array content. The
           value is protocol-fixed, so removing it and defaulting below is
           deterministic rather than a guess. */
        if (
            !Object.prototype.hasOwnProperty.call(action, "version") &&
            action[activeField][action[activeField].length - 1] === "version"
        ) {

            action[activeField].pop();
            removed.push(`${activeField}[-1]:version`);
        }
    }

    /* Version 1.0 is runtime metadata with one legal value. Requiring a weak
       model to repeat it correctly adds failure surface but no information. */
    if (!Object.prototype.hasOwnProperty.call(action, "version")) {
        action.version = "1.0";
        defaulted.push("version");
    }

    /* Missing inactive envelope fields carry no model-owned information: for
       the selected branch their only valid value is null. The final-only data,
       error and performed fields also define absence as null. Filling those
       deterministic values is safe; active fields such as tool_calls,
       delegations and response are deliberately never invented. */
    const envelopeDefaults = {
        tool_call: {
            delegations: null,
            response: null,
            data: null,
            error: null,
            performed: null
        },
        delegate: {
            tool_calls: null,
            response: null,
            data: null,
            error: null,
            performed: null
        },
        final: {
            tool_calls: null,
            delegations: null,
            data: null,
            error: null,
            performed: null
        }
    };

    for (
        const [field, fieldValue]
        of Object.entries(envelopeDefaults[action.action])
    ) {

        if (!Object.prototype.hasOwnProperty.call(action, field)) {
            action[field] = fieldValue;
            defaulted.push(field);
        }
    }

    if (action.action === "tool_call" && Array.isArray(action.tool_calls)) {

        action.tool_calls =
            action.tool_calls.map(call => {

                if (
                    !call ||
                    typeof call !== "object" ||
                    Array.isArray(call)
                ) {
                    return call;
                }

                /* depends_on is fixed protocol metadata whose only legal
                   value for an independent call is []. normalizeToolCalls
                   and adaptNativeToolCalls both already default a missing
                   depends_on, so rejecting it here only spends a retry on
                   a value the runtime can derive deterministically. Only a
                   genuinely absent field is defaulted; a malformed value
                   (e.g. a plain string) is left alone so it still fails
                   loudly rather than silently dropping a dependency the
                   model meant to declare. */
                let normalized = call;

                if (
                    !Object.prototype.hasOwnProperty.call(call, "depends_on")
                ) {

                    normalized = {
                        ...call,
                        depends_on: []
                    };

                    defaulted.push(
                        `${activeField}.${call.id || "?"}.depends_on`
                    );
                }

                const pathRepair =
                    repairMarkdownPathArguments(
                        normalized.name,
                        normalized.arguments
                    );

                if (pathRepair.repaired_fields.length > 0) {

                    argumentRepairs.push({
                        call_id: normalized.id || null,
                        tool: normalized.name,
                        fields: pathRepair.repaired_fields
                    });

                    return {
                        ...normalized,
                        arguments: pathRepair.arguments
                    };
                }

                return normalized;
            });
    }

    /* Delegations have the same fixed-protocol depends_on default as tool
       calls, and executeDelegations already defaults a missing depends_on to
       []. validateAction would otherwise reject it and spend a retry on a
       value the runtime can derive, so the same repair is applied here. The
       model-owned fields (agent, persona, task, tools, skills) are never
       invented; only a genuinely absent depends_on is defaulted. */
    if (action.action === "delegate" && Array.isArray(action.delegations)) {

        action.delegations =
            action.delegations.map(delegation => {

                if (
                    !delegation ||
                    typeof delegation !== "object" ||
                    Array.isArray(delegation)
                ) {
                    return delegation;
                }

                if (
                    !Object.prototype.hasOwnProperty.call(delegation, "depends_on")
                ) {

                    defaulted.push(
                        `${activeField}.${delegation.id || "?"}.depends_on`
                    );

                    return {
                        ...delegation,
                        depends_on: []
                    };
                }

                return delegation;
            });
    }

    return {
        action,
        repaired:
            moved.length > 0 ||
            defaulted.length > 0 ||
            removed.length > 0 ||
            argumentRepairs.length > 0,
        moved_fields: moved,
        defaulted_fields: defaulted,
        removed_items: removed,
        argument_repairs: argumentRepairs,
        source_field: activeField
    };
}



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



module.exports = {
    repairMarkdownPathArguments,
    repairStructuredAction,
    compactToolParameterSchema,
    canonicalActionExamples,
    malformedRepairHint,
    malformedNoticeMessage
};
