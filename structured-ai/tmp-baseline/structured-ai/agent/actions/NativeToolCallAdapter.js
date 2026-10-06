"use strict";

/*
|--------------------------------------------------------------------------
| Native Tool Call Adapter (EXECUTION_PLAN Phase 15)
|--------------------------------------------------------------------------
|
| Some OpenAI-compatible servers answer a request that carries `tools`
| with a native tool call instead of the structured content we asked
| for. That is a valid protocol answer, so the runtime adapts it to the
| internal action contract rather than failing the run.
|--------------------------------------------------------------------------
*/

const ctx = require("./context");
const { modelResponseError } = require("./ActionErrors");
const { keepDeclaredArguments } = require("./ActionNormalizer");
const { repairMarkdownPathArguments } = require("./ResponseRepair");


function adaptNativeToolCalls(message) {

    const { parseToolArguments } = require("./ActionParser");

    const nativeCalls =
        Array.isArray(message.tool_calls)
            ? message.tool_calls
            : [];

    if (nativeCalls.length === 0) {
        return null;
    }

    return {
        version: "1.0",

        action: "tool_call",

        tool_calls:
            nativeCalls.map(
                (call, index) => {

                    const name =
                        call?.function?.name;

                    if (!name) {

                        throw modelResponseError(
                            "Native tool call is missing a function name.",
                            "MISSING_TOOL_NAME"
                        );
                    }

                    let parsedArguments = {};

                    const rawArguments =
                        call.function.arguments;

                    if (
                        typeof rawArguments === "string" &&
                        rawArguments.trim() !== ""
                    ) {

                        const read =
                            parseToolArguments(rawArguments);

                        if (read.failed) {

                            throw modelResponseError(
                                `Native tool call "${name}" has arguments that are not valid JSON: ${
                                    read.failed
                                }.`,
                                "MALFORMED_TOOL_ARGUMENTS",
                                {
                                    detected_action:
                                        "tool_call",

                                    tool:
                                        name,

                                    rejected_arguments:
                                        String(rawArguments).slice(0, 1200)
                                }
                            );
                        }

                        parsedArguments = read.arguments;

                        if (read.repaired) {

                            /*
                            | A salvaged object often carries the keys of
                            | the result the model was copying, so only
                            | the parameters the tool declares are kept.
                            */

                            const cleaned =
                                keepDeclaredArguments(
                                    name,
                                    parsedArguments
                                );

                            parsedArguments = cleaned.arguments;

                            ctx.events.emit("response:repaired", {
                                tool: name,

                                dropped:
                                    cleaned.dropped,

                                ignored:
                                    (read.ignored || "").slice(0, 200)
                            });

                            ctx.logLine(
                                null,
                                `Repaired the arguments of "${name}"${
                                    cleaned.dropped.length > 0
                                        ? `, ignoring ${cleaned.dropped.join(", ")}`
                                        : ""
                                }`
                            );
                        }

                    } else if (
                        rawArguments &&
                        typeof rawArguments === "object"
                    ) {

                        parsedArguments = rawArguments;
                    }

                    const pathRepair =
                        repairMarkdownPathArguments(
                            name,
                            parsedArguments
                        );

                    if (pathRepair.repaired_fields.length > 0) {

                        parsedArguments = pathRepair.arguments;

                        ctx.events.emit("response:repaired", {
                            repair: "markdown_path",
                            tool: name,
                            repaired_fields: pathRepair.repaired_fields
                        });

                        ctx.logLine(
                            null,
                            `Repaired Markdown links in ${name}.${
                                pathRepair.repaired_fields.join(`, ${name}.`)
                            }.`
                        );
                    }

                    return {
                        id:
                            call.id ||
                            `call_${index + 1}`,

                        name,

                        arguments:
                            parsedArguments,

                        depends_on: []
                    };
                }
            ),

        delegations: null,

        response: null,

        data: null,

        error: null,

        performed: null
    };
}




module.exports = {
    adaptNativeToolCalls
};
