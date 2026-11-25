"use strict";

/* Shared action/delegation graph contracts. */

function validateActionGraph(items, noun) {

    const ids =
        new Set();

    for (const item of items) {

        if (
            typeof item.id !== "string" ||
            item.id.trim() === ""
        ) {

            throw new Error(
                `${noun}.id is required and must be non-empty.`
            );
        }

        if (ids.has(item.id)) {

            throw new Error(
                `Duplicate ${noun} id: ${item.id}`
            );
        }

        ids.add(item.id);

        if (!Array.isArray(item.depends_on)) {

            throw new Error(
                `${noun}.depends_on must be an array; use [] when there is no dependency.`
            );
        }
    }

    for (const item of items) {

        for (const dependency of item.depends_on) {

            if (
                typeof dependency !== "string" ||
                dependency.trim() === ""
            ) {

                throw new Error(
                    `${noun}.depends_on entries must be non-empty ids.`
                );
            }

            if (!ids.has(dependency)) {

                throw new Error(
                    `${noun} "${item.id}" depends on unknown id "${dependency}".`
                );
            }

            if (dependency === item.id) {

                throw new Error(
                    `${noun} "${item.id}" cannot depend on itself.`
                );
            }
        }
    }

    const visiting = new Set();
    const visited = new Set();
    const byId =
        new Map(items.map(item => [item.id, item]));

    const visit = id => {

        if (visiting.has(id)) {

            throw new Error(
                `${noun} dependency graph contains a cycle at "${id}".`
            );
        }

        if (visited.has(id)) {
            return;
        }

        visiting.add(id);

        for (const dependency of byId.get(id).depends_on) {
            visit(dependency);
        }

        visiting.delete(id);
        visited.add(id);
    };

    for (const id of ids) {
        visit(id);
    }
}



function requestedDelegationProjectId(delegation) {

    if (!delegation || typeof delegation !== "object") {

        return { value: null, error: null };

    }

    const hasCamel =
        Object.prototype.hasOwnProperty.call(delegation, "projectId");

    const hasSnake =
        Object.prototype.hasOwnProperty.call(delegation, "project_id");

    const rawCamel = hasCamel ? delegation.projectId : undefined;

    const rawSnake = hasSnake ? delegation.project_id : undefined;

    const normalize = value => {

        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value !== "string") {

            return { error: "delegation.projectId must be a string or null." };

        }

        const trimmed = value.trim();

        if (trimmed === "") {

            return { error: "delegation.projectId must be a non-empty string when set." };

        }

        return { value: trimmed };

    };

    const camel = normalize(rawCamel);

    if (camel && camel.error) {
        return { value: null, error: camel.error };
    }

    const snake = normalize(rawSnake);

    if (snake && snake.error) {
        return { value: null, error: snake.error };
    }

    const camelValue = camel ? camel.value : null;

    const snakeValue = snake ? snake.value : null;

    if (
        hasCamel &&
        hasSnake &&
        camelValue &&
        snakeValue &&
        camelValue !== snakeValue
    ) {

        return {
            value: null,
            error: "delegation.projectId and project_id disagree."
        };

    }

    return {
        value: camelValue || snakeValue || null,
        error: null
    };

}



module.exports = { validateActionGraph, requestedDelegationProjectId };
