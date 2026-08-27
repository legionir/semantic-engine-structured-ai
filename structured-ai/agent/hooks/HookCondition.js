/*
|--------------------------------------------------------------------------\
| Hook conditions
|--------------------------------------------------------------------------\
|
| The closed condition language: `&&`-joined terms, each optionally negated
| with `!`, resolved against a fixed set of context paths. Nothing is ever
| evaluated — a hook condition comes from a config file and must not become a
| code-execution surface.
|
| `conditionTerms` is shared with the loader on purpose: validation and
| evaluation must not disagree about what a condition means, and a term the
| loader accepts but the evaluator cannot read would silently disable a hook.
|--------------------------------------------------------------------------*/

function conditionTerms(expression) {

    if (
        expression === undefined ||
        expression === null ||
        expression === "" ||
        expression === "always"
    ) {
        return [];
    }

    if (typeof expression !== "string") {
        throw new Error("hook.when must be a string.");
    }

    return expression
        .split("&&")
        .map(term => term.trim())
        .filter(Boolean)
        .map(term => ({
            negated: term.startsWith("!"),
            name: term.startsWith("!") ? term.slice(1).trim() : term
        }));
}


function assertCondition(expression, where) {

    for (const term of conditionTerms(expression)) {

        if (
            ![
                "repository.dirty",
                "files_changed",
                "plan.complete"
            ].includes(term.name) &&
            !/^hooks\.[A-Za-z0-9_.-]+\.ok$/.test(term.name)
        ) {

            throw new Error(
                `${where}.when contains unsupported condition "${term.name}". ` +
                "Use repository.dirty, files_changed, plan.complete, hooks.<id>.ok, !condition, and &&."
            );
        }
    }
}


function hookReferences(expression) {

    return conditionTerms(expression)
        .map(term => /^hooks\.([A-Za-z0-9_.-]+)\.ok$/.exec(term.name))
        .filter(Boolean)
        .map(match => match[1]);
}


function readPath(source, reference) {

    let value = source;

    for (const segment of reference.split(".")) {

        if (value === null || value === undefined || typeof value !== "object") {
            return undefined;
        }

        value = value[segment];
    }

    return value;
}


function conditionValue(name, context) {

    if (name === "repository.dirty") {
        return context.repository?.dirty === true || context.repository?.clean === false;
    }

    if (name === "files_changed") {
        return Array.isArray(context.files_changed) && context.files_changed.length > 0;
    }

    if (name === "plan.complete") {
        return context.plan?.complete === true;
    }

    const hook = /^hooks\.([A-Za-z0-9_.-]+)\.ok$/.exec(name);

    if (hook) {
        return context.hooks?.[hook[1]]?.ok === true;
    }

    return false;
}


function evaluateWhen(expression, context) {

    const terms = conditionTerms(expression);

    return terms.every(term => {

        const value = conditionValue(term.name, context);

        return term.negated ? !value : value;
    });
}


module.exports = {
    conditionTerms,
    assertCondition,
    hookReferences,
    readPath,
    conditionValue,
    evaluateWhen,
};
