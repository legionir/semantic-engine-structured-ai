/*
|--------------------------------------------------------------------------\
| Hook templates
|--------------------------------------------------------------------------\
|
| `${path.into.context}` is the whole language, and two rules about it are
| easy to get wrong from the outside:
|
|   • a template that is exactly one reference keeps the referenced **value**,
|     so `${files_changed}` renders an array rather than a joined string — a
|     `git_add` hook needs the list;
|   • a reference that does not resolve **throws**. Nothing renders as empty.
|     A hook that quietly ran with a blank path or a blank commit message
|     would report success for work it never described.
|
| `templateReferences`/`assertTemplateReferences` are the same pattern applied
| at load time, so an unresolvable name is a validation error before a hook is
| ever enabled rather than a failure mid-run.
|--------------------------------------------------------------------------*/

const { readPath } = require("./HookCondition");


const TEMPLATE = /\$\{([A-Za-z0-9_.-]+)\}/g;


function renderString(text, context) {

    const matches = [...text.matchAll(TEMPLATE)];

    if (matches.length === 1 && matches[0][0] === text) {

        const exact = readPath(context, matches[0][1]);

        if (exact === undefined) {
            throw new Error(`Hook template reference is unavailable: ${matches[0][1]}`);
        }

        return exact;
    }

    return text.replace(TEMPLATE, (match, reference) => {

        const value = readPath(context, reference);

        if (value === undefined) {
            throw new Error(`Hook template reference is unavailable: ${reference}`);
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


function templateReferences(value, references = []) {

    if (typeof value === "string") {

        for (const match of value.matchAll(/\$\{([A-Za-z0-9_.-]+)\}/g)) {
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

    const allowedRoots =
        new Set([
            "task",
            "objective",
            "files_changed",
            "repository",
            "plan",
            "hooks",
            "action",
            "run_error"
        ]);

    for (const reference of templateReferences(value)) {

        const root = reference.split(".")[0];

        if (!allowedRoots.has(root)) {
            throw new Error(`${where} contains unsupported template reference "${reference}".`);
        }
    }
}


module.exports = {
    TEMPLATE,
    renderString,
    render,
    templateReferences,
    assertTemplateReferences,
};
