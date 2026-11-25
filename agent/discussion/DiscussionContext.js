"use strict";

const dataRoot = require("../persistence/DataRoot");


/*
| Discussion runtime context — EXECUTION_PLAN Phase 28.
| Project identity is resolved from the trusted runtime/registry context,
| never from model-facing workspace arguments.
*/

function projectIdOf(project) {
    return project?.projectId ?? project?.id ?? null;
}


function projectFromRuntime(runtime) {

    const run =
        runtime?.runManager && typeof runtime.runManager.current === "function"
            ? runtime.runManager.current()
            : null;

    const project =
        typeof runtime?.effectiveProject === "function"
            ? runtime.effectiveProject(run?.project)
            : run?.project || null;

    const projectId =
        typeof runtime?.effectiveProjectId === "function"
            ? runtime.effectiveProjectId(project)
            : projectIdOf(project) || run?.projectId || null;

    return { run, project, projectId };
}


function resolveDiscussionContext(runtime, { projectContext, projectId } = {}) {

    let project = projectContext || null;
    let resolvedId = projectId || null;

    if (!project && resolvedId && runtime?.projects) {

        const record = runtime.projects.registry().get(resolvedId);
        project = runtime.projects.createProjectContext(record);
    }

    if (!project) {

        const resolved = projectFromRuntime(runtime);
        project = resolved.project;
        resolvedId = resolvedId || resolved.projectId;
    }

    const runtimeContext =
        typeof runtime?.createRuntimeContext === "function"
            ? runtime.createRuntimeContext()
            : {};

    const workspaceRoot =
        project?.workspaceRoot ||
        runtimeContext.runtime?.workspace_root ||
        null;

    const resolvedProjectId =
        resolvedId || projectIdOf(project) || null;

    return {
        project,
        projectId: resolvedProjectId,
        workspaceRoot,
        dataRoot:
            project?.dataRoot ||
            dataRoot.legacyDataRoot(),
        workspaceContext:
            project
                ? `Project: ${project.projectName || project.name || resolvedProjectId}\nWorkspace root: ${workspaceRoot}`
                : workspaceRoot
                    ? `Workspace root: ${workspaceRoot}`
                    : ""
    };
}


function withProjectId(payload, projectId) {
    return projectId
        ? { ...payload, project_id: projectId }
        : payload;
}


module.exports = {
    projectIdOf,
    projectFromRuntime,
    resolveDiscussionContext,
    withProjectId
};
