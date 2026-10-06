"use strict";

/*
|--------------------------------------------------------------------------
| Hook templates — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
*/

const TEMPLATE = /\$\{([A-Za-z0-9_.-]+)\}/g;

const ALLOWED_ROOTS = Object.freeze([
    "task",
    "objective",
    "files_changed",
    "repository",
    "plan",
    "hooks",
    "action",
    "run_error"
]);


function templateReferences(value, references = []) {

    if (typeof value === "string") {

        for (const match of value.matchAll(TEMPLATE)) {
            references.push(match[1]);
        }

        return references;
    }

    if (Array.isArray(value)) {

        for (const item of value) {
            templateReferences(item, references);
        }

        return references;
    }

    if (value && typeof value === "object") {

        for (const item of Object.values(value)) {
            templateReferences(item, references);
        }
    }

    return references;
}


function assertTemplateReferences(value, where) {

    const allowedRoots = new Set(ALLOWED_ROOTS);

    for (const reference of templateReferences(value)) {

        const root = reference.split(".")[0];

        if (!allowedRoots.has(root)) {
            throw new Error(
                `${where} contains unsupported template reference "${reference}".`
            );
        }
    }
}


function readPath(source, reference) {

    let value = source;

    for (const segment of reference.split(".")) {

        if (
            value === null ||
            value === undefined ||
            typeof value !== "object"
        ) {
            return undefined;
        }

        value = value[segment];
    }

    return value;
}


function renderString(text, context) {

    const matches = [...text.matchAll(TEMPLATE)];

    if (matches.length === 1 && matches[0][0] === text) {

        const exact =
            readPath(context, matches[0][1]);

        if (exact === undefined) {
            throw new Error(
                `Hook template reference is unavailable: ${matches[0][1]}`
            );
        }

        return exact;
    }

    return text.replace(TEMPLATE, (match, reference) => {

        const value =
            readPath(context, reference);

        if (value === undefined) {
            throw new Error(
                `Hook template reference is unavailable: ${reference}`
            );
        }

        if (Array.isArray(value)) {
            return value.join(", ");
        }

        return value && typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
    });
}


function render(value, context) {

    if (typeof value === "string") {
        return renderString(value, context);
    }

    if (Array.isArray(value)) {
        return value.map(item => render(item, context));
    }

    if (value && typeof value === "object") {

        return Object.fromEntries(
            Object.entries(value).map(
                ([key, item]) => [key, render(item, context)]
            )
        );
    }

    return value;
}


module.exports = {
    TEMPLATE,
    ALLOWED_ROOTS,
    templateReferences,
    assertTemplateReferences,
    readPath,
    renderString,
    render
};
