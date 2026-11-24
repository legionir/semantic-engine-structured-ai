"use strict";

const { host } = require("./engineContext");
const { validateDependencyGraph } = require("./ToolGraphValidation");

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


module.exports = { executeDependencyGraph };
