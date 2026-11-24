"use strict";

/* Validate dependency DAGs before any node can execute and describe their waves. */

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


module.exports = { findDependencyCycle, validateDependencyGraph, describeGraph };
