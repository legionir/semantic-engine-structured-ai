/*
|--------------------------------------------------------------------------\
| Hook loader and validation
|--------------------------------------------------------------------------\
|
| Reads `registry/hooks.json`, folds in the per-project overlay, stamps the
| files so a hot edit is picked up without a restart, and normalises each
| declaration into the shape the runner consumes.
|
| Two checks here are ones a JSON schema cannot express: that a tool or agent
| named by a hook actually exists in the shipped registries, and that the
| dependency graph between hooks is acyclic and confined to one phase. The
| error texts are contract — the settings UI shows them verbatim — so they
| moved with the code rather than being rewritten alongside it.
|--------------------------------------------------------------------------*/

const fs = require("fs");
const path = require("path");
const settings = require("../lib/storage");
const project = require("../lib/project");
const { assertCondition, conditionTerms, hookReferences } = require("./HookCondition");
const { assertTemplateReferences, templateReferences } = require("./HookRenderer");


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


function assertString(value, field) {

    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} is required.`);
    }

    return value;
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


module.exports = {
    REGISTRY_PATH,
    PHASES,
    TYPES,
    FAILURES,
    fileStamp,
    signature,
    readJson,
    availableNames,
    toolNames,
    agentNames,
    normaliseHook,
    validateGraph,
    validateConfig,
    mergeConfig,
    load,
};
