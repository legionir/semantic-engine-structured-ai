"use strict";

const { AsyncLocalStorage } = require("async_hooks");

/*
|--------------------------------------------------------------------------
| Project Override (Phase 12)
|--------------------------------------------------------------------------
|
| Concurrent Sub-Agents share the parent's AgentRunContext. Mutating
| currentRun().project would therefore mix two projects' tools and
| events. Each delegation instead enters an AsyncLocalStorage frame
| whose project is fixed for the whole Sub-Agent: nested delegations
| may start a new frame, but the current frame cannot be rewritten.
|
| effectiveProject() = override frame (if any) || the run's project.
| In legacy mode the override is never entered, so callers see the
| same project they always did.
|
| A run is a multi-project task once it has delegated to more than
| one distinct project id (including the run's own). Writes in that
| task, and any write whose effective project is not the run's, need
| a separate approval (EXECUTION_PLAN Phase 12 گام ۲).
|--------------------------------------------------------------------------
*/

const storage = new AsyncLocalStorage();


function currentOverride() {

    return storage.getStore() || null;

}


function runWithProject(project, fn) {

    return storage.run({ project: project || null }, fn);

}


function overrideActive() {

    return currentOverride() !== null;

}


function effectiveProject(fallback) {

    const store = currentOverride();

    if (store) {
        return store.project;
    }

    if (fallback !== undefined) {
        return fallback;
    }

    try {

        const { runManager } = require("./RunManager");

        const run =
            runManager && typeof runManager.current === "function"
                ? runManager.current()
                : null;

        return (run && run.project) || null;

    } catch {

        return null;

    }

}


function projectIdOf(project) {

    if (!project || typeof project !== "object") {
        return null;
    }

    return project.projectId ?? project.id ?? null;

}


function effectiveProjectId(fallback) {

    if (fallback !== undefined) {
        return projectIdOf(effectiveProject(fallback));
    }

    return projectIdOf(effectiveProject());

}


function noteDelegationProject(run, projectId) {

    if (!run || !projectId) {
        return;
    }

    if (!run.delegationProjectIds) {

        run.delegationProjectIds = new Set();

        const own = projectIdOf(run.project) || run.projectId || null;

        if (own) {
            run.delegationProjectIds.add(own);
        }

    }

    run.delegationProjectIds.add(projectId);

}


function isMultiProjectTask(run) {

    return Boolean(
        run &&
        run.delegationProjectIds &&
        run.delegationProjectIds.size > 1
    );

}


module.exports = {
    runWithProject,
    overrideActive,
    effectiveProject,
    effectiveProjectId,
    projectIdOf,
    noteDelegationProject,
    isMultiProjectTask
};
