"use strict";

const {
    ProjectRegistry,
    canonicalizeRoot,
    projectRootHash
} = require("./ProjectRegistry");
const { createProjectContext, normalizeProjectInput } = require("./ProjectContext");

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
| Every run resolves a ProjectContext. An unscoped caller receives the
| synthetic default project, while explicit project options are validated
| against the registry before execution.
|
| EXECUTION_PLAN Phase 6, گام ۱ (findings API-016 / F-008):
|
|   - both the record shape ({ id, rootPath }) and the context shape
|     ({ projectId, workspaceRoot }) are accepted, normalized through
|     `normalizeProjectInput`, so the documented contract and the
|     implementation agree;
|   - an explicit project no longer bypasses validation: its root is
|     canonicalized (a non-existent root fails loudly) and checked for
|     ownership against the registry.
|
| **Unknown / Requires Verification:** an explicit project whose id is NOT
| in the registry is still accepted, because the public caller inventory
| for `runAgent({ project })` has not been proven to be registry-only.
| Ownership checks that ARE provable run today (see
| `validateProjectOwnership`): the claimed root must exist, a registered
| id must keep its registered root, and a synthetic id must carry the hash
| of the root it claims. Tightening this to registry-only membership needs
| caller evidence.
|
*/


/*
| Validate that an explicitly supplied project really owns the root it
| claims, and return the authoritative record to build the context from.
|
| Throws plain Errors whose messages name the failure:
|   Project root does not exist: /x               (bad root)
|   Project "prj-a" is registered at /a, ...      (id/root mismatch)
|   Synthetic project "prj-a" was not derived ... (fabricated default)
*/
function validateProjectOwnership(record, registry) {

    const canonicalRoot = canonicalizeRoot(record.rootPath);

    let registered = null;

    try {

        registered = registry.get(record.id);

    } catch (error) {

        if (!/^Unknown project:/.test(error.message)) {

            throw error;

        }

    }

    if (registered) {

        if (registered.rootPath !== canonicalRoot) {

            throw new Error(
                `Project "${record.id}" is registered at ${registered.rootPath}, ` +
                `but the supplied project claims ${canonicalRoot}. ` +
                `A project root is immutable; register the new root as its ` +
                `own project instead of re-pointing an existing id.`
            );

        }

        /* The registry is authoritative for name, permissions and endpoint;
           only the caller's dataRoot (a context round trip) is kept. */

        return {
            ...registered,
            synthetic: false,
            dataRoot: record.dataRoot || null
        };

    }

    /*
    | Unregistered id. A synthetic default is legitimate here — it is
    | derived from the root itself and keeps the legacy `.agent` layout,
    | and it stays addressable even once a project registers the same
    | root (see test/runs/run-context.test.js, "two concurrent runs on
    | two projects share nothing"). What it may NOT do is name a root it
    | was not derived from: the id's trailing hash binds it to exactly
    | one canonical root, so that binding is checked here.
    */

    if (record.synthetic === true) {

        const expectedHash = projectRootHash(canonicalRoot);

        if (!String(record.id).endsWith(`-${expectedHash}`)) {

            throw new Error(
                `Synthetic project "${record.id}" was not derived from ` +
                `${canonicalRoot} (expected an id ending in -${expectedHash}). ` +
                `Build it with projectRegistry.resolveDefault(root) instead of ` +
                `assembling one by hand.`
            );

        }

    }

    return {
        ...record,
        rootPath: canonicalRoot
    };

}


/*
| Resolve the project context for one run.
|
| Throws plain Errors whose messages name the failure:
|   Unknown project: prj-x            (registry miss)
|   options.project must be ...       (bad shape)
*/
function resolveProjectForRun(options = {}, { registry, workspaceRoot } = {}) {

    const activeRegistry =
        registry || new ProjectRegistry();

    if (options.project !== undefined && options.project !== null) {

        const normalized = normalizeProjectInput(options.project);

        if (!normalized) {

            throw new Error(
                "options.project must be a project record with id and rootPath " +
                "or a project context with projectId and workspaceRoot " +
                "(get it from projectRegistry.get(...) or register one first)."
            );

        }

        return createProjectContext(
            validateProjectOwnership(normalized, activeRegistry)
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
    resolveProjectForRun,
    assertWorkspaceMatch,
    validateProjectOwnership
};
