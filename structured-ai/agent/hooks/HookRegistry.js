"use strict";

const defaultSettings = require("../config");

const HookCondition = require("./HookCondition");
const HookRenderer = require("./HookRenderer");
const { HookLoader } = require("./HookLoader");


/*
|--------------------------------------------------------------------------
| Hook registry — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| Validation, live loading and enabled-hook selection are kept together;
| condition evaluation and rendering are pure sibling modules. The default
| instance below is the compatibility facade used by legacy call sites.
|--------------------------------------------------------------------------
*/

const PHASES = Object.freeze(["before_task", "after_task"]);
const TYPES = Object.freeze(["tool", "agent", "git_commit"]);
const FAILURES = Object.freeze(["report", "stop"]);


function assertString(value, field) {

    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} is required.`);
    }

    return value;
}


class HookRegistry {

    constructor({ loader, settingsStore } = {}) {

        this.settings =
            settingsStore || defaultSettings;
        this.loader =
            loader || new HookLoader({ settingsStore: this.settings });
    }


    normaliseHook(raw, phase, index, knownTools, knownAgents) {

        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`${phase}[${index}] must be an object.`);
        }

        const id =
            assertString(raw.id, `${phase}[${index}].id`);

        if (!/^[A-Za-z0-9_-]+$/.test(id)) {
            throw new Error(
                `${phase}[${index}].id may contain only letters, numbers, underscores and hyphens.`
            );
        }

        const hook = {
            ...raw,
            id,
            type: assertString(raw.type, `${phase}[${index}].type`),
            phase,
            enabled: raw.enabled !== false,
            when: raw.when || "always",
            on_failure:
                raw.on_failure || this.settings.get("HOOKS_ON_FAILURE"),
            depends_on:
                Array.isArray(raw.depends_on)
                    ? [...raw.depends_on]
                    : []
        };

        if (!TYPES.includes(hook.type)) {
            throw new Error(
                `${phase}[${index}].type must be one of: ${TYPES.join(", ")}`
            );
        }

        const allowedFields = new Set([
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
            throw new Error(
                `${phase}[${index}] contains unknown field(s): ${unknownFields.join(", ")}.`
            );
        }

        if (!FAILURES.includes(hook.on_failure)) {
            throw new Error(
                `${phase}[${index}].on_failure must be report or stop.`
            );
        }

        HookCondition.assertCondition(hook.when, `${phase}[${index}]`);

        for (const reference of HookCondition.hookReferences(hook.when)) {

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
                throw new Error(
                    `${phase}[${index}] names unknown tool "${hook.tool}".`
                );
            }

            if (
                raw.arguments !== undefined &&
                (!raw.arguments ||
                    typeof raw.arguments !== "object" ||
                    Array.isArray(raw.arguments))
            ) {
                throw new Error(
                    `${phase}[${index}].arguments must be an object.`
                );
            }

            hook.arguments = raw.arguments || {};
        }

        if (hook.type === "agent") {

            hook.agent = assertString(raw.agent, `${phase}[${index}].agent`);
            hook.task = assertString(raw.task, `${phase}[${index}].task`);

            if (!knownAgents.has(hook.agent) || hook.agent === "main_agent") {
                throw new Error(
                    `${phase}[${index}] names unavailable agent "${hook.agent}".`
                );
            }
        }

        if (hook.type === "git_commit") {

            hook.message =
                assertString(raw.message, `${phase}[${index}].message`);

            if (
                raw.paths !== undefined &&
                typeof raw.paths !== "string" &&
                !Array.isArray(raw.paths)
            ) {
                throw new Error(
                    `${phase}[${index}].paths must be a template string or an array.`
                );
            }
        }

        HookRenderer.assertTemplateReferences(hook, `${phase}[${index}]`);

        for (const reference of HookRenderer.templateReferences(hook)) {

            const match =
                /^hooks\.([A-Za-z0-9_.-]+)\./.exec(reference);

            if (match && !hook.depends_on.includes(match[1])) {
                hook.depends_on.push(match[1]);
            }
        }

        return hook;
    }


    validateGraph(items, phase) {

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
                    throw new Error(
                        `Hook "${hook.id}" depends on unknown ${phase} hook "${dependency}".`
                    );
                }

                if (dependency === hook.id) {
                    throw new Error(
                        `Hook "${hook.id}" cannot depend on itself.`
                    );
                }
            }
        }

        const visiting = new Set();
        const visited = new Set();
        const byId = new Map(items.map(item => [item.id, item]));

        const visit = id => {

            if (visiting.has(id)) {
                throw new Error(
                    `${phase} hook graph contains a cycle at "${id}".`
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


    validateConfig(input) {

        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new Error("Hook configuration must be an object.");
        }

        const unknownTopLevel =
            Object.keys(input).filter(
                field => !["version", "before_task", "after_task"]
                    .includes(field)
            );

        if (unknownTopLevel.length > 0) {
            throw new Error(
                `Hook configuration contains unknown field(s): ${unknownTopLevel.join(", ")}.`
            );
        }

        const knownTools = this.loader.toolNames();
        const knownAgents = this.loader.agentNames();

        const config = {
            version: String(input.version || "1"),
            before_task: [],
            after_task: []
        };

        if (config.version !== "1") {
            throw new Error(
                `Unsupported hook configuration version: ${config.version}`
            );
        }

        for (const phase of PHASES) {

            const source =
                input[phase] === undefined
                    ? []
                    : input[phase];

            if (!Array.isArray(source)) {
                throw new Error(`${phase} must be an array.`);
            }

            config[phase] = source.map(
                (hook, index) =>
                    this.normaliseHook(
                        hook,
                        phase,
                        index,
                        knownTools,
                        knownAgents
                    )
            );
        }

        const beforeIds =
            new Set(config.before_task.map(item => item.id));

        /* before_task has already completed when after_task is scheduled, so
           a reference to its result is a context dependency, not a graph edge. */
        for (const hook of config.after_task) {
            hook.depends_on = hook.depends_on.filter(
                id => !beforeIds.has(id)
            );
        }

        this.validateGraph(config.before_task, "before_task");
        this.validateGraph(config.after_task, "after_task");

        const allIds = new Set();

        for (const hook of [...config.before_task, ...config.after_task]) {

            if (allIds.has(hook.id)) {
                throw new Error(
                    `Hook ids must be unique across all phases: ${hook.id}`
                );
            }

            allIds.add(hook.id);
        }

        return config;
    }


    load(force = false) {

        return this.loader.load(
            config => this.validateConfig(config),
            force
        );
    }


    enabledHooks(phase) {

        if (!PHASES.includes(phase)) {
            throw new Error(`Unknown hook phase: ${phase}`);
        }

        if (this.settings.get("HOOKS_ENABLED") !== true) {
            return [];
        }

        return this.load()[phase].filter(hook => hook.enabled);
    }


    routine() {

        const enabled =
            this.settings.get("HOOKS_ENABLED") === true;

        if (!enabled) {
            return {
                enabled: false,
                before_task: [],
                after_task: []
            };
        }

        const config = this.load();

        return {
            enabled: true,
            before_task:
                config.before_task
                    .filter(item => item.enabled)
                    .map(item => item.id),
            after_task:
                config.after_task
                    .filter(item => item.enabled)
                    .map(item => item.id)
        };
    }
}


const defaultRegistry = new HookRegistry();


module.exports = {
    PHASES,
    TYPES,
    FAILURES,
    HookRegistry,
    defaultRegistry,
    load: (...args) => defaultRegistry.load(...args),
    validateConfig: (...args) => defaultRegistry.validateConfig(...args),
    enabledHooks: (...args) => defaultRegistry.enabledHooks(...args),
    evaluateWhen: HookCondition.evaluateWhen,
    render: HookRenderer.render,
    routine: (...args) => defaultRegistry.routine(...args),
    _conditionTerms: HookCondition.conditionTerms,
    _hookReferences: HookCondition.hookReferences,
    _registryPath: defaultRegistry.loader.registryPath
};
