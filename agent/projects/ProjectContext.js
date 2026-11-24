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
| Two shapes name a project in this codebase (EXECUTION_PLAN Phase 6,
| finding API-016 / F-008):
|
|   registry record  ->  { id, rootPath, ... }
|   project context  ->  { projectId, workspaceRoot, dataRoot, ... }
|
| `normalizeProjectInput` is the single place that maps either one onto the
| record field names, so callers may hand a record OR an already-built
| context to any project-aware entry point and get the same context back.
| Building a context from a context is idempotent.
|
*/

function isProjectRecordShape(value) {

    return (
        !!value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        value.id !== "" &&
        typeof value.rootPath === "string" &&
        value.rootPath !== ""
    );

}


function isProjectContextShape(value) {

    return (
        !!value &&
        typeof value === "object" &&
        typeof value.projectId === "string" &&
        value.projectId !== "" &&
        typeof value.workspaceRoot === "string" &&
        value.workspaceRoot !== ""
    );

}


/*
| Map a registry record OR a project context onto the record field names.
| Returns null when the value is neither shape, so callers can produce
| their own error text.
|
| A context carries a `dataRoot` that was already derived (and, for a
| synthetic default, points at the legacy `.agent` layout). It is carried
| through verbatim so a round trip never silently relocates a project's
| data.
*/
function normalizeProjectInput(value) {

    if (isProjectRecordShape(value)) {

        return {
            id: value.id,
            name: value.name,
            rootPath: value.rootPath,
            semanticEndpoint: value.semanticEndpoint ?? null,
            permissions: { ...(value.permissions || {}) },
            synthetic: value.synthetic === true,
            dataRoot:
                typeof value.dataRoot === "string" && value.dataRoot !== ""
                    ? value.dataRoot
                    : null
        };

    }

    if (isProjectContextShape(value)) {

        return {
            id: value.projectId,
            name: value.projectName,
            rootPath: value.workspaceRoot,
            semanticEndpoint: value.semanticEndpoint ?? null,
            permissions: { ...(value.permissions || {}) },
            synthetic: value.synthetic === true,
            dataRoot:
                typeof value.dataRoot === "string" && value.dataRoot !== ""
                    ? value.dataRoot
                    : null
        };

    }

    return null;

}


function createProjectContext(project, { syntheticDefault = false } = {}) {

    const record = normalizeProjectInput(project);

    if (!record) {

        throw new Error(
            "Cannot build a project context without a project record " +
            "({ id, rootPath }) or an existing project context " +
            "({ projectId, workspaceRoot })."
        );

    }

    const synthetic =
        syntheticDefault || record.synthetic === true;

    const dataRoot =
        record.dataRoot ||
        (synthetic
            ? path.join(record.rootPath, ".agent")
            : path.join(
                  ProjectStore.resolveDataHome(),
                  "projects",
                  record.id
              ));

    return {
        projectId: record.id,
        projectName: record.name,
        workspaceRoot: record.rootPath,
        dataRoot,
        semanticEndpoint: record.semanticEndpoint ?? null,
        permissions: { ...(record.permissions || {}) },
        synthetic
    };

}


module.exports = {
    createProjectContext,
    normalizeProjectInput,
    isProjectRecordShape,
    isProjectContextShape
};
