"use strict";

const { host } = require("./engineContext");
const { findDependencyCycle, validateDependencyGraph, describeGraph } = require("./ToolGraphValidation");
const { executeDependencyGraph } = require("./ToolGraphScheduler");
const { readReferencePath, resolveReference, resolveArgumentReferences } = require("./ToolReferences");
const { createToolGraphRunner } = require("./ToolGraphRunner");
const { channel: imageChannel } = require("./ImageChannel");


function assertToolAllowed(
    toolName,
    allowedTools
) {

    if (
        !host().TOOL_REGISTRY_OF().has(toolName) &&
        !host().toolRuntime.mcp._hasDiscoveredTool(toolName)
    ) {

        throw new Error(
            `Tool is not available: ${toolName}`
        );
    }

    if (!host().toolRuntime.hasTool(toolName)) {

        throw new Error(
            `Tool is declared but not implemented: ${toolName}`
        );
    }

    if (!allowedTools.has(toolName)) {

        throw new Error(
            `Tool "${toolName}" is not allowed for this agent.`
        );
    }
}


function normalizeToolCalls(
    toolCalls
) {

    /*
    | A generated id must not collide with one the model chose, or the
    | whole action would be rejected for a duplicate it never wrote.
    */

    const taken =
        new Set(
            toolCalls
                .map(call => call && call.id)
                .filter(Boolean)
        );

    const generateId = index => {

        let candidate =
            `call_${index + 1}`;

        let suffix = 1;

        while (taken.has(candidate)) {

            candidate = `call_${index + 1}_${suffix}`;

            suffix++;
        }

        taken.add(candidate);

        return candidate;
    };

    return toolCalls.map(
        (call, index) => {

            const parsedArguments =
                host().parseArguments(
                    call.arguments,
                    call.name
                );

            const pathRepair =
                host().repairMarkdownPathArguments(
                    call.name,
                    parsedArguments
                );

            if (pathRepair.repaired_fields.length > 0) {

                host().events.emit("response:repaired", {
                    repair: "markdown_path",
                    tool: call.name,
                    repaired_fields: pathRepair.repaired_fields
                });

                host().logLine(
                    null,
                    `Repaired Markdown links in ${call.name}.${
                        pathRepair.repaired_fields.join(`, ${call.name}.`)
                    }.`
                );
            }

            return {
                id:
                    call.id ||
                    generateId(index),

                name:
                    call.name,

                /* Arguments may arrive as an object or, under a strict
                   schema, as a JSON encoded string. */
                arguments:
                    pathRepair.arguments,

                depends_on:
                    Array.isArray(call.depends_on)
                        ? call.depends_on
                        : []
            };
        }
    );
}


/*
| A cycle used to be discovered only when the loop ran out of ready items,
| after the rest of the graph had already executed and published results.
| Finding it up front names the nodes and lets nothing run, which matters
| most for hooks: a hook phase can commit or push before it notices.
*/
/*
| 'stopReason(item, wrapped)' (optional): called for every finished item; a
| truthy return is a "stop the graph" signal (a hook that failed with
| 'on_failure: stop'). The scheduler reads it before dispatching the NEXT
| item, so once a stop is seen nothing that has not started yet runs; every
| remaining item gets a result from 'skipItem(item, reason)'. Items already
| in flight when the stop arrives finish normally. 'stopReason' REQUIRES
| 'skipItem': there is no generic skipped envelope, because consumers key off
| the exact shape 'skipItem' produces, and a half-built one would crash them.
| A skipped item is published with success:false (plus skipped:true), so a
| reference into it fails loudly instead of resolving a stub value.
*/
function appendToolConversation(
    messages,
    message,
    toolCalls,
    results,
    scope
) {

    messages.push({

        role: "assistant",

        content:
            message.content ??
            null,

        tool_calls:
            toolCalls.map(
                call => ({
                    id:
                        call.id,

                    type:
                        "function",

                    function: {
                        name:
                            call.name,

                        arguments:
                            JSON.stringify(
                                call.arguments
                            )
                    }
                })
            )
    });

    for (
        const result
        of results
    ) {

        messages.push({

            role: "tool",

            tool_call_id:
                result.id,

            content:
                JSON.stringify(
                    result
                )
        });
    }

    /*
    | Archived before compaction touches it, because a compressed result
    | is exactly the thing the archive exists to replace.
    */

    const appended =
        host().findExchanges(messages);

    host().archiveExchanges(
        messages,
        appended.slice(appended.length - 1),
        scope
    );

    const compaction =
        host().compactConversation(messages, {

            onDrop: (current, exchange) =>
                host().archiveExchanges(current, [exchange], scope)
        });

    if (compaction.compacted) {

        host().events.emit("context:compacted", {
            agent: scope || "main_agent",
            ...compaction
        });

        host().logLine(
            scope,
            `Context compacted: ${
                Math.round(compaction.before / 1000)
            }k -> ${
                Math.round(compaction.after / 1000)
            }k chars (${
                compaction.elided_results
            } results elided, ${
                compaction.dropped_exchanges
            } exchanges dropped)`
        );
    }

    /*
    | Pictures a tool returned (an MCP screenshot) follow as one user
    | message with image parts; an earlier one is reduced to a note
    | (roadmap P3-01).
    */

    imageChannel.appendFor(messages, results);
}


const executeToolGraph = createToolGraphRunner({
    host,
    assertToolAllowed,
    normalizeToolCalls,
    describeGraph,
    executeDependencyGraph,
    resolveArgumentReferences,
    appendToolConversation
});


module.exports = {
    assertToolAllowed,
    normalizeToolCalls,
    validateDependencyGraph,
    describeGraph,
    executeDependencyGraph,
    readReferencePath,
    resolveReference,
    resolveArgumentReferences,
    executeToolGraph,
    appendToolConversation
};
