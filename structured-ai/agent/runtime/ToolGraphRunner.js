"use strict";

/* Run the normalized tool-call action through policy, dependency scheduling and events. */

function createToolGraphRunner({ host, assertToolAllowed, normalizeToolCalls, describeGraph, executeDependencyGraph, resolveArgumentReferences, appendToolConversation }) {
let GRAPH_SEQUENCE = 0;

async function executeToolGraph(
    toolCalls,
    allowedTools,
    scope,
    context = {}
) {

    const calls =
        normalizeToolCalls(
            toolCalls
        );

    const callIds =
        new Set(
            calls.map(call => call.id)
        );

    const maxParallel =
        host().settings.get("MAX_PARALLEL_TOOLS");

    const graph =
        describeGraph(calls, maxParallel);

    const graphId =
        `graph_${++GRAPH_SEQUENCE}`;

    /*
    | The wave index is what the scheduler PLANNED, not what it did: items
    | are dispatched continuously, so a call starts the moment its own
    | dependencies are published. Calls in one planned wave need not overlap,
    | and calls in different planned waves may run together. What really ran
    | alongside is recovered from the started_at/finished_at pair every
    | tool:end carries — that is the only honest source for "in parallel".
    */

    const waveOf = new Map();

    graph.waves.forEach((wave, index) => {

        for (const id of wave) {
            waveOf.set(id, index);
        }
    });

    host().logLine(
        scope,
        `Executing tool graph (${calls.length} call(s), ${
            graph.shape
        }, ${graph.waves.length} planned wave(s)).`
    );

    host().events.emit("tool:graph", {
        agent:
            scope || "main_agent",

        scope:
            scope || "main_agent",

        graph_id:
            graphId,

        iteration:
            context.iteration || null,

        hook:
            context.hook || null,

        shape:
            graph.shape,

        /* planned grouping: see the note above the waveOf map */
        wave_basis:
            "planned",

        waves:
            graph.waves,

        max_parallel:
            maxParallel,

        calls:
            calls.map(call => ({
                id: call.id,
                name: call.name,
                depends_on: call.depends_on,
                wave: waveOf.get(call.id) ?? null
            }))
    });

    const results =
        await executeDependencyGraph({

            items: calls,

            maxParallel:
                host().settings.get("MAX_PARALLEL_TOOLS"),

            executor:
                async (
                    call,
                    results
                ) => {

                    host().assertRunActive(
                        `tool ${call.name}`
                    );

                    assertToolAllowed(
                        call.name,
                        allowedTools
                    );

                    const resolved =
                        resolveArgumentReferences(
                            call.arguments,
                            results,
                            call.depends_on,
                            callIds
                        );

                    /*
                    | An argument the tool does not declare used to be
                    | dropped in silence, so "fs_read with a content
                    | field" looked like a successful read instead of the
                    | mistake it is. The call still runs, and the result
                    | says what was ignored.
                    */

                    const checked =
                        host().keepDeclaredArguments(call.name, resolved);

                    const resolvedArguments =
                        checked.dropped.length > 0
                            ? checked.arguments
                            : resolved;

                    if (checked.dropped.length > 0) {

                        host().logLine(
                            scope,
                            `${call.name} does not take ${
                                checked.dropped.join(", ")
                            }; ignored`
                        );

                        host().events.emit("tool:arguments_ignored", {
                            agent: scope || "main_agent",
                            scope: scope || "main_agent",
                            id: call.id,
                            name: call.name,
                            dropped: checked.dropped
                        });
                    }

                    /*
                    | Policy is evaluated on the resolved arguments, so a
                    | value injected by a dependency cannot slip past a
                    | rule that inspects arguments.
                    */

                    await host().POLICY_ENGINE.enforce(
                        call.name,
                        resolvedArguments,
                        scope || "main_agent"
                    );

                    await host().enforceCrossProjectWrite(
                        call.name,
                        resolvedArguments,
                        scope || "main_agent"
                    );

                    host().logObject(
                        scope,
                        `Tool ${call.id} -> ${call.name}`,
                        resolvedArguments
                    );

                    host().events.emit("tool:start", {
                        agent:
                            scope || "main_agent",

                        scope:
                            scope || "main_agent",

                        id:
                            call.id,

                        name:
                            call.name,

                        graph_id:
                            graphId,

                        shape:
                            graph.shape,

                        wave:
                            waveOf.get(call.id) ?? null,

                        depends_on:
                            call.depends_on,

                        iteration:
                            context.iteration || null,

                        hook:
                            context.hook || null,

                        arguments:
                            resolvedArguments
                    });

                    const startedAt = Date.now();

                    try {

                        const result =
                            await host().toolRuntime.executeTool(
                                call.name,
                                resolvedArguments,

                                /*
                                | Identity comes from the run context,
                                | never from the call's arguments
                                | (rule 9). Legacy runs keep the exact
                                | historical { agent } shape.
                                */
                                (
                                    host().currentRun() instanceof host().AgentRunContext
                                        ? (() => {

                                              const project =
                                                  host().effectiveProject(host().currentRun().project);

                                              return {
                                                  agent: scope || "main_agent",
                                                  runId: host().currentRun().runId,
                                                  projectId:
                                                      host().projectIdOf(project) ??
                                                      host().currentRun().projectId ??
                                                      undefined,
                                                  projectContext:
                                                      project ?? undefined
                                              };

                                          })()
                                        : {
                                              agent: scope || "main_agent"
                                          }
                                )
                            );

                        /*
                        | Loading a skill is a decision, not plumbing,
                        | so the operator sees which agent took it.
                        */

                        if (
                            call.name === "skill_get" &&
                            result &&
                            Array.isArray(result.skills)
                        ) {

                            host().logLine(
                                scope,
                                `Loaded skill ${
                                    result.skills
                                        .map(skill => skill.name)
                                        .join(", ")
                                }`
                            );
                        }

                        /*
                        | The warning travels with the result, because
                        | that is the only place the model reliably
                        | reads.
                        */

                        if (
                            checked.dropped.length > 0 &&
                            result &&
                            typeof result === "object" &&
                            !Array.isArray(result)
                        ) {

                            result.ignored_arguments =
                                checked.dropped;

                            result.note =
                                `${call.name} does not take ${
                                    checked.dropped.join(", ")
                                }. Those arguments were ignored; use the tool that does, or drop them.`;
                        }

                        /*
                        | A command that exits non-zero is data, not a
                        | tool failure, so the runtime keeps going. The
                        | console said "ok" for it, which is how a build
                        | that never ran looked like a build that
                        | passed, so the code travels with the event.
                        */

                        host().events.emit("tool:end", {
                            agent:
                                scope || "main_agent",

                            scope:
                                scope || "main_agent",

                            id:
                                call.id,

                            name:
                                call.name,

                            graph_id:
                                graphId,

                            wave:
                                waveOf.get(call.id) ?? null,

                            iteration:
                                context.iteration || null,

                            hook:
                                context.hook || null,

                            arguments:
                                resolvedArguments,

                            exit_code:
                                result &&
                                typeof result === "object"
                                    ? result.exit_code
                                    : undefined,

                            warning:
                                result &&
                                typeof result === "object"
                                    ? result.warning
                                    : undefined,

                            started_at:
                                startedAt,

                            success: true,

                            duration_ms:
                                Date.now() - startedAt,

                            result
                        });

                        return result;

                    } catch (error) {

                        host().events.emit("tool:end", {
                            agent:
                                scope || "main_agent",

                            scope:
                                scope || "main_agent",

                            id:
                                call.id,

                            name:
                                call.name,

                            graph_id:
                                graphId,

                            wave:
                                waveOf.get(call.id) ?? null,

                            iteration:
                                context.iteration || null,

                            hook:
                                context.hook || null,

                            arguments:
                                resolvedArguments,

                            started_at:
                                startedAt,

                            success: false,

                            duration_ms:
                                Date.now() - startedAt,

                            error:
                                error.message
                        });

                        throw error;
                    }
                }
        });

    /*
    | Each result carries the tool name so the model can read the
    | tool message without correlating ids by itself.
    */

    const named =
        results.map(
            (result, index) => ({
                ...result,

                name:
                    calls[index].name
            })
        );

    for (
        const result
        of named
    ) {

        host().logObject(
            scope,
            `Tool result ${result.id} (${
                result.success
                    ? "success"
                    : "failed"
            })`,
            result.success
                ? result.result
                : result.error
        );
    }

    return named;
}



    return executeToolGraph;
}

module.exports = { createToolGraphRunner };
