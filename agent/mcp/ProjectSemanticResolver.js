const fs = require("fs");

const { WORKSPACE_ROOT, realpath } = require("../context/WorkspaceBoundary");

const localEngine = require("./semantic");
const { pool } = require("./SemanticClientPool");


/*
|--------------------------------------------------------------------------|
| Project Semantic Resolver                                                |
|--------------------------------------------------------------------------|
|
| Phase 6 of EXECUTION_PLAN: the one place that answers "which semantic
| client serves THIS context". Routing rules, in order:
|
| Unscoped callers use the local engine because no project route is
| necessary. A scoped workspace project without a remote endpoint also
| uses that local engine because its index is exactly the active tree.
| Every other scoped project is routed through a pool client keyed by its
| project id; a missing endpoint degrades only that project.
|
|--------------------------------------------------------------------------
*/


function canonicalRoot(root) {

    if (!root) {
        return root;
    }

    try {

        if (fs.existsSync(root)) {
            return realpath(root);
        }

    } catch {
        /* fall through to the textual root */
    }

    return root;

}


function sharesWorkspaceRoot(rootPath) {

    return (
        canonicalRoot(rootPath) === canonicalRoot(WORKSPACE_ROOT)
    );

}


/* context: a normalized ToolContext (ToolContext.from output). Never a
   model-shaped object — tool arguments carrying identity are rejected
   upstream (rule 9). */
function semanticFor(context) {

    const scoped = Boolean(context && context.scoped);

    if (!scoped) {
        return localEngine;
    }

    const project = context.project;

    if (
        !project.semanticEndpoint &&
        sharesWorkspaceRoot(project.workspaceRoot)
    ) {

        /* The workspace-rooted project uses the local engine because its
           index covers exactly the same tree. */
        return localEngine;

    }

    return pool.connect({
        projectId: context.projectId,
        workspaceRoot: project.workspaceRoot,
        semanticEndpoint: project.semanticEndpoint ?? null
    });

}

/* Would the semantic capability be active for this project? Set-based,
   never a network call — prompts are built synchronously. Mirrors the
   routing of semanticFor so the skill gate and the tools agree. */
function isEndpointActiveFor(project) {

    if (!project) {
        return localEngine.isAvailable() === true;
    }

    const root =
        project.workspaceRoot ??
        project.rootPath ??
        null;

    if (project.semanticEndpoint) {
        return true;
    }

    if (root && sharesWorkspaceRoot(root)) {
        return localEngine.isAvailable() === true;
    }

    return false;

}

/* run:started baggage for the owning run's project alone: availability
   and index state as seen by that project, not the process-wide engine
   (a global snapshot in a per-run event would be cross-project
   information). */
function startRunScope(runId) {

    if (runId) {

        const { runManager } = require("../runtime");
        const run = runManager.get(runId);

        if (run && run.project) {

            const client =
                pool.connect({
                    projectId: run.projectId ?? run.project.projectId,
                    workspaceRoot: run.project.workspaceRoot,
                    semanticEndpoint:
                        run.project.semanticEndpoint ?? null
                });

            return {
                semantic_available: client.isAvailable(),
                index_status: client.checkStaleness().state
            };

        }

    }

    return localEngine.startRunScope();

}

/* process shutdown: close the pool alongside the legacy single client. */
function shutdown() {

    localEngine.shutdown();

    void pool.disconnectAll().catch(() => {});

}


module.exports = {
    semanticFor,
    isEndpointActiveFor,
    startRunScope,
    shutdown,
    pool
};
