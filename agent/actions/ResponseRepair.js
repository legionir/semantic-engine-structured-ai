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
const {
    compactToolParameterSchema,
    canonicalActionExamples,
    malformedRepairHint,
    malformedNoticeMessage
} = require("./ActionCorrection");
const { salvageActionFromProse } = require("./ResponseTextParser");


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



module.exports = {
    salvageActionFromProse,
    repairMarkdownPathArguments,
    repairStructuredAction,
    compactToolParameterSchema,
    canonicalActionExamples,
    malformedRepairHint,
    malformedNoticeMessage
};
