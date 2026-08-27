"use strict";

const path = require("path");

const ProjectStore = require("./ProjectStore");

/*
|--------------------------------------------------------------------------
| Project Context
|--------------------------------------------------------------------------
|
| The explicit per-project context every runtime operation receives
| (EXECUTION_PLAN, Phase 2). It is built from a registry record and is the
| ONLY shape downstream code may use — it never exposes the raw, possibly
| uncanonicalized root a caller typed.
|
| dataRoot layout:
|   registered project   -> <dataHome>/projects/<id>   (central store)
|   synthetic default    -> <workspaceRoot>/.agent     (legacy layout kept
|      (from -w/WORKSPACE_ROOT)                          until the Phase-8
|                                                          migration)
|
| The legacy mapping is what lets the CLI keep working byte-for-byte while
| the multi-project machinery lands in phases 3–8.
|
*/

function createProjectContext(project, { syntheticDefault = false } = {}) {

    if (!project || typeof project !== "object") {

        throw new Error(
            "Cannot build a project context without a project record."
        );

    }

    const synthetic =
        syntheticDefault || project.synthetic === true;

    const dataRoot =
        synthetic
            ? path.join(project.rootPath, ".agent")
            : path.join(
                  ProjectStore.resolveDataHome(),
                  "projects",
                  project.id
              );

    return {
        projectId: project.id,
        projectName: project.name,
        workspaceRoot: project.rootPath,
        dataRoot,
        semanticEndpoint: project.semanticEndpoint ?? null,
        permissions: { ...(project.permissions || {}) },
        synthetic
    };

}


module.exports = {
    createProjectContext
};
