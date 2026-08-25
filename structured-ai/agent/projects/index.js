"use strict";

/*
|--------------------------------------------------------------------------
| Projects — public surface
|--------------------------------------------------------------------------
|
| One lazily-built registry instance for the process (data home from
| ProjectStore.resolveDataHome()), plus the class/pure helpers for tests
| and future injection.
|
*/

const { ProjectRegistry } = require("./ProjectRegistry");
const ProjectStore = require("./ProjectStore");
const { createProjectContext } = require("./ProjectContext");
const {
    projectContextMode,
    resolveProjectForRun,
    assertWorkspaceMatch
} = require("./ProjectResolver");

let defaultRegistry = null;

function registry() {

    if (!defaultRegistry) {

        defaultRegistry = new ProjectRegistry();

    }

    return defaultRegistry;

}


module.exports = {
    ProjectRegistry,
    ProjectStore,
    createProjectContext,
    projectContextMode,
    resolveProjectForRun,
    assertWorkspaceMatch,
    registry
};
