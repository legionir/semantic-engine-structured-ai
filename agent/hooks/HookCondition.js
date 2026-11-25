"use strict";

/*
|--------------------------------------------------------------------------
| Hook conditions — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| The condition language is deliberately closed. It can inspect repository
| dirt, changed files, plan completion and earlier hook results, but it
| cannot evaluate JavaScript or read process/environment state.
|--------------------------------------------------------------------------
*/

const SUPPORTED_CONDITIONS = Object.freeze([
    "repository.dirty",
    "files_changed",
    "plan.complete"
]);


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
            name: term.startsWith("!")
                ? term.slice(1).trim()
                : term
        }));
}


function assertCondition(expression, where) {

    for (const term of conditionTerms(expression)) {

        if (
            !SUPPORTED_CONDITIONS.includes(term.name) &&
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
        .map(term =>
            /^hooks\.([A-Za-z0-9_.-]+)\.ok$/.exec(term.name)
        )
        .filter(Boolean)
        .map(match => match[1]);
}


function conditionValue(name, context = {}) {

    if (name === "repository.dirty") {
        return context.repository?.dirty === true ||
            context.repository?.clean === false;
    }

    if (name === "files_changed") {
        return Array.isArray(context.files_changed) &&
            context.files_changed.length > 0;
    }

    if (name === "plan.complete") {
        return context.plan?.complete === true;
    }

    const hook =
        /^hooks\.([A-Za-z0-9_.-]+)\.ok$/.exec(name);

    if (hook) {
        return context.hooks?.[hook[1]]?.ok === true;
    }

    return false;
}


function evaluateWhen(expression, context = {}) {

    return conditionTerms(expression).every(term => {

        const value =
            conditionValue(term.name, context);

        return term.negated ? !value : value;
    });
}


module.exports = {
    SUPPORTED_CONDITIONS,
    conditionTerms,
    assertCondition,
    hookReferences,
    conditionValue,
    evaluateWhen
};
