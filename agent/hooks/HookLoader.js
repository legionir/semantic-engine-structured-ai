"use strict";

const fs = require("fs");
const path = require("path");

const defaultSettings = require("../config");
const defaultProject = require("../projects/WorkspaceProfile");


/*
|--------------------------------------------------------------------------
| Hook loader — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| Loading is separate from validation so a registry edit can be detected
| without making the registry or runner know where files live. The cache is
| keyed by mtime/size, matching the live-reload semantics of the old facade.
|--------------------------------------------------------------------------
*/

function fileStamp(file) {

    try {

        const stat = fs.statSync(file);

        return `${stat.mtimeMs}:${stat.size}`;

    } catch {
        return "missing";
    }
}


function readJson(file, fallback) {

    if (!fs.existsSync(file)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(
            `Hook configuration is not valid JSON: ${file} (${error.message})`
        );
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


function mergeConfig(base, override) {

    if (
        !override ||
        typeof override !== "object" ||
        Array.isArray(override)
    ) {
        return base;
    }

    const unknown =
        Object.keys(override).filter(
            field =>
                !["version", "before_task", "after_task"]
                    .includes(field)
        );

    if (unknown.length > 0) {
        throw new Error(
            `Project hook override contains unknown field(s): ${unknown.join(", ")}.`
        );
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


class HookLoader {

    constructor({
        settingsStore,
        projectProfile,
        registryPath,
        toolsPath,
        agentsPath
    } = {}) {

        const registryDir =
            path.join(__dirname, "..", "registry");

        this.settings =
            settingsStore || defaultSettings;
        this.project =
            projectProfile || defaultProject;
        /* an injected profile (tests) keeps its single-file behaviour */
        this.projectScoped = !projectProfile;
        this.registryPath =
            registryPath || path.join(registryDir, "hooks.json");
        this.toolsPath =
            toolsPath || path.join(registryDir, "tools.json");
        this.agentsPath =
            agentsPath || path.join(registryDir, "agents.json");
        /* one cache entry PER PROJECT: a hook config loaded for project A
           must never be served to a run of project B */
        this.caches = new Map();
    }


    /*
    | The project whose hooks apply: the delegation frame's project, else
    | the run's, else null (the default project, process workspace).
    */
    activeProject() {

        if (!this.projectScoped) {
            return null;
        }

        try {

            const { effectiveProject } = require("../runtime/ProjectOverride");

            return effectiveProject() || null;

        } catch {

            return null;
        }
    }


    projectKey(project) {

        return project ? String(project.projectId ?? project.id ?? "default") : "default";
    }


    projectHookConfig(project) {

        if (!project) {
            return this.project.loadProject()?.hooks;
        }

        return this.project.loadOverlay(
            project.projectId ?? project.id,
            project.workspaceRoot
        )?.hooks;
    }


    fileStamp(file) {
        return fileStamp(file);
    }


    projectStamp(project) {

        if (!project) {
            return fileStamp(this.project.projectPath());
        }

        const { workspaceFile, centralFile } =
            this.project.overlayFor(
                project.projectId ?? project.id,
                project.workspaceRoot
            );

        return `${fileStamp(workspaceFile)}+${centralFile ? fileStamp(centralFile) : "none"}`;
    }


    signature(project = this.activeProject()) {

        return [
            fileStamp(this.registryPath),
            this.projectStamp(project),
            fileStamp(this.toolsPath),
            fileStamp(this.agentsPath),
            this.settings.get("HOOKS_ON_FAILURE")
        ].join("|");
    }


    readJson(file, fallback) {
        return readJson(file, fallback);
    }


    toolNames() {

        return availableNames(
            this.toolsPath,
            item => item?.function?.name
        );
    }


    agentNames() {

        return availableNames(
            this.agentsPath,
            item => item?.name
        );
    }


    merge(base, override) {
        return mergeConfig(base, override);
    }


    load(validate, force = false) {

        const project = this.activeProject();

        const key = this.projectKey(project);

        const stamp = this.signature(project);

        const cached = this.caches.get(key);

        if (
            !force &&
            cached &&
            cached.config &&
            cached.signature === stamp
        ) {
            return cached.config;
        }

        const base = readJson(this.registryPath, {
            version: "1",
            before_task: [],
            after_task: []
        });

        const merged =
            mergeConfig(base, this.projectHookConfig(project));

        const config =
            typeof validate === "function"
                ? validate(merged)
                : merged;

        this.caches.set(key, { signature: stamp, config });

        return config;
    }
}


module.exports = {
    HookLoader,
    fileStamp,
    readJson,
    availableNames,
    mergeConfig
};
