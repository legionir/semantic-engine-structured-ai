const fs = require("fs");

const settings = require("../lib/storage");
const { WORKSPACE_ROOT, realpath } = require("../lib/workspace");

const legacy = require("./semantic");
const { pool } = require("./SemanticClientPool");


/*
|--------------------------------------------------------------------------|
| Project Semantic Resolver                                                |
|--------------------------------------------------------------------------|
|
| Phase 6 of EXECUTION_PLAN: the one place that answers "which semantic
| client serves THIS context". Routing rules, in order:
|
|   SEMANTIC_POOL_MODE=legacy (default)
|     → the historical process-wide client from mcp/semantic.js, always.
|       A scoped context rooted OUTSIDE the workspace still fails loudly
|       (the Phase-4 pending-gate semantics the code family used to rely
|       on): silently answering a foreign root's query from the
|       workspace index is the exact mis-scoping this plan exists to
|       remove.
|
|   SEMANTIC_POOL_MODE=modular, unscoped context
|     → the legacy client. There is no project, so nothing to route.
|
|   SEMANTIC_POOL_MODE=modular, scoped context
|     → the pool client keyed by the context's projectId, built from the
|       ProjectContext fields (endpoint from the registry record).
|     → a scoped project on the workspace root WITHOUT an endpoint keeps
|       the legacy client: its index IS the workspace index, so the
|       local engine answers for exactly the right tree (isolation is
|       vacuous there).
|     → a scoped foreign-root project WITHOUT an endpoint gets a pool
|       client in permanent "unavailable" state: controlled, per-project
|       degradation instead of a silent detour to another index.
|
|--------------------------------------------------------------------------
*/


function poolMode() {

    return (
        settings.get("SEMANTIC_POOL_MODE") === "modular"
            ? "modular"
            : "legacy"
    );

}


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

    if (poolMode() !== "modular") {

        if (scoped && !context.sharesWorkspaceRoot()) {

            throw new Error(
                "Semantic code tools are not yet project-aware in legacy " +
                `pool mode and cannot run on project "${context.projectId}" ` +
                "rooted outside this process workspace (the workspace-wide " +
                "engine would answer for the wrong index). Use " +
                "SEMANTIC_POOL_MODE=modular with a semanticEndpoint per " +
                "project, or a workspace-rooted project."
            );

        }

        return legacy;

    }

    if (!scoped) {
        return legacy;
    }

    const project = context.project;

    if (
        !project.semanticEndpoint &&
        sharesWorkspaceRoot(project.workspaceRoot)
    ) {

        /* The default, workspace-rooted project: the local engine
           already indexes exactly this tree. */
        return legacy;

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

    if (poolMode() !== "modular" || !project) {
        return legacy.isAvailable() === true;
    }

    const root =

        project.workspaceRoot ??
        project.rootPath ??
        null;

    if (project.semanticEndpoint) {
        return true;
    }

    if (root && sharesWorkspaceRoot(root)) {
        return legacy.isAvailable() === true;
    }

    return false;

}


/* run:started baggage for the owning run's project alone: availability
   and index state as seen by that project, not the process-wide engine
   (a global snapshot in a per-run event would be cross-project
   information). */
function startRunScope(runId) {

    if (poolMode() === "modular" && runId) {

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

    return legacy.startRunScope();

}


/* process shutdown: close the pool alongside the legacy single client. */
function shutdown() {

    legacy.shutdown();

    void pool.disconnectAll().catch(() => {});

}


module.exports = {
    poolMode,
    semanticFor,
    isEndpointActiveFor,
    startRunScope,
    shutdown,
    pool
};
