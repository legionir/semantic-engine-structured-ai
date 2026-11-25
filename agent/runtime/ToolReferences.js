"use strict";

const { host } = require("./engineContext");
const REFERENCE_PATTERN = /\$\{([A-Za-z0-9_.-]+)\}/g;

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


module.exports = { readReferencePath, resolveReference, resolveArgumentReferences };
