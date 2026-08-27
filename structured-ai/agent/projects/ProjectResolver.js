"use strict";

const settings = require("../lib/storage");

const { ProjectRegistry, canonicalizeRoot } = require("./ProjectRegistry");
const { createProjectContext } = require("./ProjectContext");

/*
|--------------------------------------------------------------------------
| Project Resolver
|--------------------------------------------------------------------------
|
| Turns the project-ish options a caller may pass (
|   runAgent({ task, project })            — a registry record or context
|   runAgent({ task, projectId })          — looked up in the registry
|   runAgent({ task })                     — the default project
| ) into exactly one ProjectContext, with one class of clear error text
| for every failure mode.
|
| PROJECT_CONTEXT_MODE=legacy keeps today's behavior: project options are
| ignored entirely and nothing in the run notices multi-project exists.
| This is the default until the pool/runtime phases complete (rule 8).
| The flag is a declared setting (lib/storage), so env, overlay and UI all
| see the same value.
|
*/


function projectContextMode() {

    const mode =
        String(settings.get("PROJECT_CONTEXT_MODE") || "legacy").toLowerCase();

    return mode === "modular" ? "modular" : "legacy";

}


function looksLikeProjectRecord(value) {

    return (
        value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        typeof value.rootPath === "string"
    );

}


/*
| Resolve the project context for one run.
|
| Throws plain Errors whose messages name the failure:
|   Unknown project: prj-x            (registry miss)
|   project must be a registry record (bad shape)
*/
function resolveProjectForRun(options = {}, { registry, workspaceRoot } = {}) {

    const activeRegistry =
        registry || new ProjectRegistry();

    if (looksLikeProjectRecord(options.project)) {

        return createProjectContext(options.project);

    }

    if (options.project) {

        throw new Error(
            "options.project must be a project record with id and rootPath " +
            "(get it from projectRegistry.get(...) or register one first)."
        );

    }

    if (options.projectId !== undefined && options.projectId !== null) {

        const record = activeRegistry.get(options.projectId);

        return createProjectContext(record);

    }

    const defaultRecord =
        activeRegistry.resolveDefault(
            workspaceRoot || process.env.WORKSPACE_ROOT || process.cwd()
        );

    /*
    | A registered workspace keeps the central dataRoot; only the
    | synthesized default falls back to the legacy .agent layout.
    */

    return createProjectContext(defaultRecord);

}


/*
| One canonical mismatch message used while the tool layer still reads the
| process-wide WORKSPACE_ROOT (until Phase 4). Running a project rooted
| somewhere else would silently mis-scope every tool call, so it fails
| loudly instead.
*/
function assertWorkspaceMatch(context, workspaceRoot) {

    const canonicalWorkspace = canonicalizeRoot(workspaceRoot);

    if (context.workspaceRoot !== canonicalWorkspace) {

        throw new Error(
            `Project "${context.projectId}" is rooted at ${context.workspaceRoot}, ` +
            `but this process is bound to workspace ${canonicalWorkspace}. ` +
            `Running tools across two roots lands with the project-aware tool runtime ` +
            `(Phase 4); start the agent on the project root or select a matching project.`
        );

    }

}


module.exports = {
    projectContextMode,
    resolveProjectForRun,
    assertWorkspaceMatch
};
