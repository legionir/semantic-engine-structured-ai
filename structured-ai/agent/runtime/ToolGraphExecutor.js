"use strict";

const { host } = require("./engineContext");

const REFERENCE_PATTERN =
    /\$\{([A-Za-z0-9_.-]+)\}/g;


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
function findDependencyCycle(
    items
) {

    const edges =
        new Map(
            items.map(
                item =>
                    [
                        item.id,
                        item.depends_on || []
                    ]
            )
        );

    const finished = new Set();
    const visiting = new Set();
    const trail = [];

    const walk =
        id => {

            if (finished.has(id)) {
                return null;
            }

            if (visiting.has(id)) {

                const start = trail.indexOf(id);

                return trail
                    .slice(start < 0 ? trail.length - 1 : start)
                    .concat(id);
            }

            visiting.add(id);
            trail.push(id);

            for (const dependency of edges.get(id)) {

                const cycle = walk(dependency);

                if (cycle) {
                    trail.pop();
                    return cycle;
                }
            }

            visiting.delete(id);
            trail.pop();
            finished.add(id);

            return null;
        };

    for (const item of items) {

        const cycle = walk(item.id);

        if (cycle) {
            return cycle;
        }
    }

    return null;
}


function validateDependencyGraph(
    items
) {

    const ids =
        new Set();

    for (
        const item
        of items
    ) {

        if (ids.has(item.id)) {

            throw new Error(
                `Duplicate dependency id: ${item.id}`
            );
        }

        ids.add(item.id);
    }

    for (
        const item
        of items
    ) {

        for (
            const dependency
            of item.depends_on
        ) {

            if (!ids.has(dependency)) {

                throw new Error(
                    `Unknown dependency: ${dependency}`
                );
            }

            if (
                dependency === item.id
            ) {

                throw new Error(
                    `Item cannot depend on itself: ${item.id}`
                );
            }
        }
    }

    const cycle =
        findDependencyCycle(items);

    if (cycle) {

        throw new Error(
            `Dependency cycle: ${cycle.join(" -> ")}`
        );
    }
}


function describeGraph(items, maxParallel) {

    const remaining =
        new Map(items.map(item => [item.id, item]));

    const done = new Set();

    const waves = [];

    while (remaining.size > 0) {

        const ready =
            [...remaining.values()].filter(
                item =>
                    (item.depends_on || []).every(
                        dependency => done.has(dependency)
                    )
            );

        if (ready.length === 0) {

            /* a cycle: the executor will report it, this is only a view */
            break;
        }

        const batch =
            ready.slice(0, Math.max(1, maxParallel));

        waves.push(batch.map(item => item.id));

        for (const item of batch) {

            done.add(item.id);

            remaining.delete(item.id);
        }
    }

    const dependent =
        items.some(
            item => (item.depends_on || []).length > 0
        );

    const shape =
        items.length <= 1
            ? "single"
            : !dependent
                ? "parallel"
                : waves.every(wave => wave.length === 1)
                    ? "sequential"
                    : "graph";

    return {
        shape,

        waves,

        widest:
            waves.reduce(
                (widest, wave) =>
                    Math.max(widest, wave.length),
                0
            )
    };
}


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
async function executeDependencyGraph({
    items,
    executor,
    maxParallel,
    stopReason,
    skipItem
}) {

    validateDependencyGraph(
        items
    );

    if (
        typeof stopReason === "function" &&
        typeof skipItem !== "function"
    ) {

        throw new Error(
            "executeDependencyGraph: stopReason requires skipItem."
        );
    }

    const slots =
        typeof maxParallel === "number" && maxParallel > 0
            ? maxParallel
            : Infinity;

    const remaining =
        new Map(
            items.map(
                item => [
                    item.id,
                    item
                ]
            )
        );

    const results =
        new Map();

    /* Items whose executor is still running, keyed by id. */
    const inFlight =
        new Map();

    let stopping =
        null;

    const isReady =
        item =>
            item.depends_on.every(
                dependency =>
                    results.has(
                        dependency
                    )
            );

    /*
    | P0-7: a call whose dependency failed (or was itself skipped) must not
    | run — it was planned on the assumption that its input exists. It is
    | settled as skipped with success:false, so its own dependents are
    | skipped in turn and every item still gets exactly one result.
    */
    const failedDependency =
        item =>
            item.depends_on.find(
                dependency =>
                    results.has(dependency) &&
                    results.get(dependency).success === false
            );

    const skipForDependency =
        async (item, dependency) => {

            remaining.delete(
                item.id
            );

            const reason =
                `dependency "${dependency}" did not succeed`;

            const skipped =
                typeof skipItem === "function"
                    ? await skipItem(
                        item,
                        reason
                    )
                    : null;

            results.set(
                item.id,
                {
                    id: item.id,
                    success: false,
                    skipped: true,
                    result: skipped,
                    error: {
                        code: "DEPENDENCY_FAILED",
                        message: reason,
                        retryable: false
                    }
                }
            );
        };

    const launch =
        item => {

            /* Claim the item so it is never dispatched twice. */
            remaining.delete(
                item.id
            );

            /*
            | The slot is reserved before any executor body can settle.
            | Every executor today is async, so the first await defers the
            | body; a synchronous executor that threw before that await would
            | run its catch block inside this expression, deleting an inFlight
            | entry that was never added and leaving a settled promise behind
            | for the loop to race forever.
            */
            const running =
                Promise.resolve().then(() => (async () => {

                    let wrapped;

                    try {

                        const result =
                            await executor(
                                item,
                                results
                            );

                        wrapped = {
                            id:
                                item.id,

                            success:
                                true,

                            result
                        };

                    } catch (error) {

                        wrapped = {
                            id:
                                item.id,

                            success:
                                false,

                            result:
                                null,

                            error: {
                                code:
                                    error.name ||
                                    "EXECUTION_ERROR",

                                message:
                                    error.message,

                                retryable:
                                    false
                            }
                        };
                    }

                    results.set(
                        wrapped.id,
                        wrapped
                    );

                    inFlight.delete(
                        wrapped.id
                    );

                    /* Read the stop flag before the next dispatch. */
                    if (
                        !stopping &&
                        typeof stopReason === "function"
                    ) {

                        stopping =
                            stopReason(
                                item,
                                wrapped
                            ) || null;
                    }

                    return wrapped;
                })());

            inFlight.set(
                item.id,
                running
            );
        };

    const skipRemaining =
        async () => {

            for (
                const item
                of [...remaining.values()]
            ) {

                const skipped =
                    await skipItem(
                        item,
                        stopping
                    );

                results.set(
                    item.id,
                    {
                        id: item.id,
                        success: false,
                        skipped: true,
                        result: skipped,
                        error: {
                            code: "SKIPPED",
                            message: stopping,
                            retryable: false
                        }
                    }
                );

                remaining.delete(
                    item.id
                );
            }
        };

    for (
        ;
        ;
    ) {

        /* Fill every free slot, but stop dispatching once a stop is seen. */
        let settledBySkip =
            false;

        if (
            !stopping
        ) {

            for (
                const item
                of [...remaining.values()]
            ) {

                if (
                    !isReady(item)
                ) {
                    continue;
                }

                const failed =
                    failedDependency(item);

                if (
                    failed !== undefined
                ) {

                    await skipForDependency(
                        item,
                        failed
                    );

                    settledBySkip =
                        true;

                    continue;
                }

                if (
                    inFlight.size >= slots
                ) {
                    continue;
                }

                launch(
                    item
                );
            }
        }

        /* A skip may have made further dependents ready: look again. */
        if (
            settledBySkip &&
            inFlight.size === 0
        ) {
            continue;
        }

        if (
            inFlight.size > 0
        ) {

            await Promise.race(
                [...inFlight.values()]
            );

            continue;
        }

        /* Nothing running: the graph is finished, stopped, or cyclic. */
        if (
            remaining.size === 0
        ) {
            break;
        }

        if (
            stopping
        ) {

            await skipRemaining();

            break;
        }

        throw new Error(
            "Dependency graph contains a cycle or unresolved dependency."
        );
    }

    return items.map(
        item =>
            results.get(
                item.id
            )
    );
}


function readReferencePath(
    value,
    segments,
    expression
) {

    let current = value;

    for (const segment of segments) {

        if (
            current === null ||
            current === undefined
        ) {

            throw new Error(
                `Reference "${expression}" cannot be resolved: "${segment}" is not reachable.`
            );
        }

        if (Array.isArray(current)) {

            const index =
                Number(segment);

            if (!Number.isInteger(index)) {

                throw new Error(
                    `Reference "${expression}" expects a numeric index for an array, received "${segment}".`
                );
            }

            current = current[index];

            continue;
        }

        if (typeof current !== "object") {

            throw new Error(
                `Reference "${expression}" cannot descend into "${segment}".`
            );
        }

        current = current[segment];
    }

    return current;
}


function resolveReference(
    expression,
    results,
    allowedIds
) {

    const [id, ...segments] =
        expression.split(".");

    if (!allowedIds.includes(id)) {

        throw new Error(
            `Reference "${expression}" points at "${id}", which is not listed in depends_on.`
        );
    }

    void 0;

    const entry =
        results.get(id);

    if (!entry) {

        throw new Error(
            `Reference "${expression}" points at an unknown call: ${id}`
        );
    }

    if (!entry.success) {

        throw new Error(
            `Reference "${expression}" points at "${id}", which failed: ${
                entry.error?.message || "unknown error"
            }`
        );
    }

    return readReferencePath(
        entry,
        segments,
        expression
    );
}


function resolveArgumentReferences(
    value,
    results,
    allowedIds,
    knownIds
) {

    /*
    | Only an expression that names a call in this action is a
    | reference. Anything else is ordinary text: file content routinely
    | contains ${...}, for example a JavaScript template literal, and
    | rewriting or rejecting that would corrupt the file.
    */

    const isReference = expression => {

        const id =
            expression.split(".")[0];

        return (
            allowedIds.includes(id) ||
            (
                knownIds
                    ? knownIds.has(id)
                    : false
            )
        );
    };

    if (typeof value === "string") {

        /*
        | $${...} is an explicit escape for a literal ${...}. It is
        | protected before the scan and restored afterwards.
        */

        const ESCAPE = "\u0000ESCAPED_REFERENCE\u0000";

        const guarded =
            value.replace(/\$\$\{/g, ESCAPE);

        const restore = text =>
            text.split(ESCAPE).join("${");

        const matches =
            [...guarded.matchAll(REFERENCE_PATTERN)]
                .filter(
                    match => isReference(match[1])
                );

        if (matches.length === 0) {
            return restore(guarded);
        }

        /*
        | A string that is exactly one reference keeps the original
        | type, so an object or number is not stringified.
        */

        if (
            matches.length === 1 &&
            matches[0][0] === guarded
        ) {

            return resolveReference(
                matches[0][1],
                results,
                allowedIds
            );
        }

        return restore(
            guarded.replace(
                REFERENCE_PATTERN,
                (match, expression) => {

                    if (!isReference(expression)) {
                        return match;
                    }

                    const resolved =
                        resolveReference(
                            expression,
                            results,
                            allowedIds
                        );

                    return typeof resolved === "string"
                        ? resolved
                        : JSON.stringify(resolved);
                }
            )
        );
    }

    if (Array.isArray(value)) {

        return value.map(
            item =>
                resolveArgumentReferences(
                    item,
                    results,
                    allowedIds,
                    knownIds
                )
        );
    }

    if (
        value &&
        typeof value === "object"
    ) {

        const output = {};

        for (
            const [key, item]
            of Object.entries(value)
        ) {

            output[key] =
                resolveArgumentReferences(
                    item,
                    results,
                    allowedIds,
                    knownIds
                );
        }

        return output;
    }

    return value;
}


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
}


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
