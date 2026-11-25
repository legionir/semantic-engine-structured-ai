const fs = require("fs");
const path = require("path");

const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");


/*
|--------------------------------------------------------------------------|
| Project Data Root Resolution                                             |
|--------------------------------------------------------------------------|
|
| EXECUTION_PLAN, Phase 8 گام ۱: one resolver answers "where does THIS
| piece of persisted state live", so memory/plan/sessions/archive/
| journal/eventstore implement the rule in exactly one place. A registered
| project resolves to <dataHome>/projects/<id>; the synthetic default
| intentionally retains <workspace>/.agent so existing data remains
| readable. Event stores derive registered routing from project_id; an
| unknown or synthetic id stays on the default data root.
|
|--------------------------------------------------------------------------
*/

const SCAFFOLD_DIRS = [
    "sessions",
    "archive",
    "journal",
    "eventstore",
    "searches",
    "processes",
    "logs",
    "discussion"
];

/* Roots whose central layout has already been materialised this
   process (mkdir is idempotent; the set just avoids redundant stats). */
const ensuredRoots = new Set();


function legacyDataRoot() {

    return path.join(WORKSPACE_ROOT, ".agent");

}


/* Internal marker retained for callers that need to document that
   project-aware routing is active. */
function fromProject(project) {

    if (
        !project ||
        typeof project !== "object" ||
        typeof project.dataRoot !== "string" ||
        project.dataRoot === ""
    ) {
        return null;
    }

    return project.dataRoot;

}


/* Accepts a ToolContext, an AgentRunContext, or any { project } /
   { projectContext } shape; returns null unless project persistence is
   modular AND a project context is actually present. */
function fromContext(raw) {

    if (!raw) {
        return null;
    }

    /* ToolContext / AgentRunContext expose .project directly; raw
       executeTool-shaped objects carry projectContext. */
    const project =

        raw.project ??
        raw.projectContext ??
        null;

    return fromProject(project);

}


/* The root of the run whose async scope we are in, or the default
   workspace data root. The runtime module is lazy to avoid a cycle. */
function currentRoot() {

    try {

        const runtime = require("../runtime");

        const overrideProject =
            typeof runtime.effectiveProject === "function"
                ? runtime.effectiveProject()
                : null;

        if (fromProject(overrideProject)) {
            return fromProject(overrideProject);
        }

        const run =
            runtime.runManager && typeof runtime.runManager.current === "function"
                ? runtime.runManager.current()
                : null;

        return (
            (run && fromProject(run.project)) ||
            legacyDataRoot()
        );

    } catch {

        return legacyDataRoot();

    }

}


/* Resolution order used by every store: explicit root string →
   explicit context → the in-scope run's project → default workspace root. */
function resolveRoot(explicit) {

    if (typeof explicit === "string" && explicit !== "") {
        return explicit;
    }

    return (
        fromContext(explicit) ||
        currentRoot()
    );

}


/* Registry-backed mapping for event envelopes: registered id → central
   root; synthetic or unknown id → null (caller uses the default root). */
function dataRootForProjectId(projectId) {

    if (!projectId) {
        return null;
    }

    try {

        const { registry, createProjectContext } = require("../projects");

        const record = registry().get(projectId);

        return createProjectContext(record).dataRoot;

    } catch {

        return null;

    }

}


/* Materialises the target layout for a project root. Filenames are
   created lazily by their stores; the scaffold guarantees the directory set. */
function ensureRoot(root) {

    if (!root || ensuredRoots.has(root)) {
        return;
    }

    fs.mkdirSync(root, { recursive: true });

    for (const dir of SCAFFOLD_DIRS) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
    }

    ensuredRoots.add(root);

}


module.exports = {
    SCAFFOLD_DIRS,
    legacyDataRoot,
    fromProject,
    fromContext,
    currentRoot,
    resolveRoot,
    dataRootForProjectId,
    ensureRoot
};
