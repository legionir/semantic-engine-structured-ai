const fs = require("fs");
const path = require("path");

const settings = require("./storage");
const { WORKSPACE_ROOT } = require("./workspace");


/*
|--------------------------------------------------------------------------|
| Project Data Root Resolution                                             |
|--------------------------------------------------------------------------|
|
| EXECUTION_PLAN, Phase 8 گام ۱: one resolver answers "where does THIS
| piece of persisted state live", so memory/plan/sessions/archive/
| journal/eventstore implement the rule in exactly one place:
|
|   - PROJECT_CONTEXT_MODE=legacy (default): the historical
|     <workspace>/.agent root — byte-identical to before, no project
|     machinery is consulted at all.
|
|   - PROJECT_CONTEXT_MODE=modular, scoped project available (from an
|     explicit ToolContext/record, or from the AgentRunContext of the
|     ALS scope the caller is inside): project.dataRoot —
|       registered project  -> <dataHome>/projects/<id>    (central)
|       synthetic default   -> <workspace>/.agent          (the compat
|         mapping the plan demands: existing state stays readable)
|
|   - modular, no scoped project: the legacy root. Console/background
|     code outside any run keeps reading the default stores.
|
| Event-bus stores learn the project from the event envelope
| (project_id) instead of a context object: dataRootForProjectId maps a
| REGISTERED id to its central root and deliberately returns null for
| synthetic/unknown ids, which is what keeps legacy events on the
| legacy root.
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
    "logs"
];

/* Roots whose central layout has already been materialised this
   process (mkdir is idempotent; the set just avoids redundant stats). */
const ensuredRoots = new Set();


function legacyDataRoot() {

    return path.join(WORKSPACE_ROOT, ".agent");

}


/* The compat wrapper of گام ۱: every routing decision exists only in
   modular project mode; in legacy mode this module is a constant. */
function modularPersistence() {

    return settings.get("PROJECT_CONTEXT_MODE") === "modular";

}


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

    if (!modularPersistence() || !raw) {
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


/* The root of the run whose async scope we are in, or legacy. The
   runtime module is required lazily so this helper can be loaded by
   low-level stores without a require cycle. */
function currentRoot() {

    if (!modularPersistence()) {
        return legacyDataRoot();
    }

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
   explicit context → the in-scope run's project → legacy. */
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
   root; synthetic or unknown id → null (caller falls back to legacy). */
function dataRootForProjectId(projectId) {

    if (!projectId || !modularPersistence()) {
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


/* Materialises the target layout of گام ۱ for a root that is not the
   legacy one. Filenames themselves are created lazily by their stores;
   the scaffold guarantees the documented directory set exists. */
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
    modularPersistence,
    fromProject,
    fromContext,
    currentRoot,
    resolveRoot,
    dataRootForProjectId,
    ensureRoot
};
