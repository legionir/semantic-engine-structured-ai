const fs = require("fs");
const path = require("path");

const settings = require("./storage");
const project = require("./project");


/*
|--------------------------------------------------------------------------
| Declarative Runtime Hooks
|--------------------------------------------------------------------------
|
| Hooks are policy owned by the runtime, not plan steps owned by a model.
| This module deliberately does no execution: it loads and validates the
| declaration, evaluates the closed condition language, and resolves the
| small template language. agent.js sends the resulting work through the
| normal tool and delegation executors so policy, telemetry and events still
| apply.
|--------------------------------------------------------------------------
*/

const REGISTRY_PATH =
    path.join(__dirname, "..", "registry", "hooks.json");

const PHASES = ["before_task", "after_task"];
const TYPES = ["tool", "agent", "git_commit"];
const FAILURES = ["report", "stop"];

const CACHE = {
    signature: null,
    config: null
};


function fileStamp(file) {

    try {

        const stat = fs.statSync(file);

        return `${stat.mtimeMs}:${stat.size}`;

    } catch {
        return "missing";
    }
}


function signature() {

    return [
        fileStamp(REGISTRY_PATH),
        fileStamp(project.projectPath()),
        fileStamp(path.join(__dirname, "..", "registry", "tools.json")),
        fileStamp(path.join(__dirname, "..", "registry", "agents.json")),
        settings.get("HOOKS_ON_FAILURE")
    ].join("|");
}


function readJson(file, fallback) {

    if (!fs.existsSync(file)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(`Hook configuration is not valid JSON: ${file} (${error.message})`);
    }
}


function availableNames(file, selector) {

    const value = readJson(file, []);

    return new Set(
        (Array.isArray(value) ? value : [])
            .map(selector)
            .filter(Boolean)
    );
}


function toolNames() {

    return availableNames(
        path.join(__dirname, "..", "registry", "tools.json"),
        item => item?.function?.name
    );
}


function agentNames() {

    return availableNames(
        path.join(__dirname, "..", "registry", "agents.json"),
        item => item?.name
    );
}


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


function assertString(value, field) {

    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} is required.`);
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


function normaliseHook(raw, phase, index, knownTools, knownAgents) {

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${phase}[${index}] must be an object.`);
    }

    const id =
        assertString(raw.id, `${phase}[${index}].id`);

    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error(`${phase}[${index}].id may contain only letters, numbers, underscores and hyphens.`);
    }

    const hook = {
        ...raw,
        id,
        type: assertString(raw.type, `${phase}[${index}].type`),
        phase,
        enabled: raw.enabled !== false,
        when: raw.when || "always",
        on_failure:
            raw.on_failure || settings.get("HOOKS_ON_FAILURE"),
        depends_on:
            Array.isArray(raw.depends_on)
                ? [...raw.depends_on]
                : []
    };

    if (!TYPES.includes(hook.type)) {
        throw new Error(`${phase}[${index}].type must be one of: ${TYPES.join(", ")}`);
    }

    const allowedFields =
        new Set([
            "id",
            "type",
            "enabled",
            "when",
            "on_failure",
            "depends_on",
            ...(hook.type === "tool" ? ["tool", "arguments"] : []),
            ...(hook.type === "agent" ? ["agent", "task"] : []),
            ...(hook.type === "git_commit" ? ["message", "paths"] : [])
        ]);

    const unknownFields =
        Object.keys(raw).filter(field => !allowedFields.has(field));

    if (unknownFields.length > 0) {
        throw new Error(`${phase}[${index}] contains unknown field(s): ${unknownFields.join(", ")}.`);
    }

    if (!FAILURES.includes(hook.on_failure)) {
        throw new Error(`${phase}[${index}].on_failure must be report or stop.`);
    }

    assertCondition(hook.when, `${phase}[${index}]`);

    for (const reference of hookReferences(hook.when)) {

        if (!hook.depends_on.includes(reference)) {
            hook.depends_on.push(reference);
        }
    }

    for (const dependency of hook.depends_on) {
        assertString(dependency, `${phase}[${index}].depends_on[]`);
    }

    if (hook.type === "tool") {

        hook.tool = assertString(raw.tool, `${phase}[${index}].tool`);

        if (!knownTools.has(hook.tool)) {
            throw new Error(`${phase}[${index}] names unknown tool "${hook.tool}".`);
        }

        if (
            raw.arguments !== undefined &&
            (!raw.arguments || typeof raw.arguments !== "object" || Array.isArray(raw.arguments))
        ) {
            throw new Error(`${phase}[${index}].arguments must be an object.`);
        }

        hook.arguments = raw.arguments || {};
    }

    if (hook.type === "agent") {

        hook.agent = assertString(raw.agent, `${phase}[${index}].agent`);
        hook.task = assertString(raw.task, `${phase}[${index}].task`);

        if (!knownAgents.has(hook.agent) || hook.agent === "main_agent") {
            throw new Error(`${phase}[${index}] names unavailable agent "${hook.agent}".`);
        }
    }

    if (hook.type === "git_commit") {

        hook.message = assertString(raw.message, `${phase}[${index}].message`);

        if (
            raw.paths !== undefined &&
            typeof raw.paths !== "string" &&
            !Array.isArray(raw.paths)
        ) {
            throw new Error(`${phase}[${index}].paths must be a template string or an array.`);
        }
    }

    assertTemplateReferences(hook, `${phase}[${index}]`);

    for (const reference of templateReferences(hook)) {

        const match = /^hooks\.([A-Za-z0-9_.-]+)\./.exec(reference);

        if (match && !hook.depends_on.includes(match[1])) {
            hook.depends_on.push(match[1]);
        }
    }

    return hook;
}


function validateGraph(items, phase) {

    const ids = new Set();

    for (const hook of items) {

        if (ids.has(hook.id)) {
            throw new Error(`Duplicate hook id in ${phase}: ${hook.id}`);
        }

        ids.add(hook.id);
    }

    for (const hook of items) {

        for (const dependency of hook.depends_on) {

            if (!ids.has(dependency)) {
                throw new Error(`Hook "${hook.id}" depends on unknown ${phase} hook "${dependency}".`);
            }

            if (dependency === hook.id) {
                throw new Error(`Hook "${hook.id}" cannot depend on itself.`);
            }
        }
    }

    const visiting = new Set();
    const visited = new Set();
    const byId = new Map(items.map(item => [item.id, item]));

    const visit = id => {

        if (visiting.has(id)) {
            throw new Error(`${phase} hook graph contains a cycle at "${id}".`);
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


function validateConfig(input) {

    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Hook configuration must be an object.");
    }

    const unknownTopLevel =
        Object.keys(input).filter(
            field => !["version", "before_task", "after_task"].includes(field)
        );

    if (unknownTopLevel.length > 0) {
        throw new Error(`Hook configuration contains unknown field(s): ${unknownTopLevel.join(", ")}.`);
    }

    const knownTools = toolNames();
    const knownAgents = agentNames();

    const config = {
        version: String(input.version || "1"),
        before_task: [],
        after_task: []
    };

    if (config.version !== "1") {
        throw new Error(`Unsupported hook configuration version: ${config.version}`);
    }

    for (const phase of PHASES) {

        const source = input[phase] === undefined ? [] : input[phase];

        if (!Array.isArray(source)) {
            throw new Error(`${phase} must be an array.`);
        }

        config[phase] = source.map(
            (hook, index) =>
                normaliseHook(hook, phase, index, knownTools, knownAgents)
        );
    }

    const beforeIds =
        new Set(config.before_task.map(item => item.id));

    /* before_task has already completed when after_task is scheduled, so a
       reference to its result is a context dependency, not a graph edge. */
    for (const hook of config.after_task) {
        hook.depends_on = hook.depends_on.filter(id => !beforeIds.has(id));
    }

    validateGraph(config.before_task, "before_task");
    validateGraph(config.after_task, "after_task");

    const allIds = new Set();

    for (const hook of [...config.before_task, ...config.after_task]) {

        if (allIds.has(hook.id)) {
            throw new Error(`Hook ids must be unique across all phases: ${hook.id}`);
        }

        allIds.add(hook.id);
    }

    return config;
}


function mergeConfig(base, override) {

    if (!override || typeof override !== "object" || Array.isArray(override)) {
        return base;
    }

    const unknown =
        Object.keys(override).filter(
            field => !["version", "before_task", "after_task"].includes(field)
        );

    if (unknown.length > 0) {
        throw new Error(`Project hook override contains unknown field(s): ${unknown.join(", ")}.`);
    }

    return {
        version: override.version || base.version,
        before_task:
            override.before_task === undefined
                ? base.before_task
                : override.before_task,
        after_task:
            override.after_task === undefined
                ? base.after_task
                : override.after_task
    };
}


function load(force = false) {

    const stamp = signature();

    if (!force && CACHE.config && CACHE.signature === stamp) {
        return CACHE.config;
    }

    const base = readJson(REGISTRY_PATH, {
        version: "1",
        before_task: [],
        after_task: []
    });

    const override = project.loadProject().hooks;

    CACHE.config = validateConfig(mergeConfig(base, override));
    CACHE.signature = stamp;

    return CACHE.config;
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


function enabledHooks(phase) {

    if (!PHASES.includes(phase)) {
        throw new Error(`Unknown hook phase: ${phase}`);
    }

    if (settings.get("HOOKS_ENABLED") !== true) {
        return [];
    }

    return load()[phase].filter(hook => hook.enabled);
}


function routine() {

    const enabled = settings.get("HOOKS_ENABLED") === true;

    if (!enabled) {

        return {
            enabled: false,
            before_task: [],
            after_task: []
        };
    }

    const config = load();

    return {
        enabled: true,
        before_task:
            config.before_task.filter(item => item.enabled).map(item => item.id),
        after_task:
            config.after_task.filter(item => item.enabled).map(item => item.id)
    };
}


module.exports = {
    PHASES,
    TYPES,
    load,
    validateConfig,
    enabledHooks,
    evaluateWhen,
    render,
    routine,

    _conditionTerms: conditionTerms,
    _hookReferences: hookReferences,
    _registryPath: REGISTRY_PATH
};
