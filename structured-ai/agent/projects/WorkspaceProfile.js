const fs = require("fs");
const AtomicFile = require("../persistence/AtomicFile");
const path = require("path");

const settings = require("../config");

const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");

const WorkspaceTrust = require("./WorkspaceTrust");


/*
|--------------------------------------------------------------------------
| Project File
|--------------------------------------------------------------------------
|
| A workspace is opened again and again, and everything tuned during the
| last visit used to live only in the process that was tuned. The
| project file is the memory of the workspace itself:
|
|   .agent/project.json   settings and declarative hook policy this project
|                         overrides, and when it was last opened
|
| Only values the operator actually changed are written, so the file
| stays a diff against the defaults rather than a copy of them: a new
| default in a later version still reaches an old project.
|
| Secrets are left out unless PROJECT_SAVE_SECRETS says otherwise,
| because a workspace is usually a repository and an API key does not
| belong in one.
|--------------------------------------------------------------------------
*/

const PROJECT_VERSION = "1";

/*
|--------------------------------------------------------------------------|
| Settings Overlay (EXECUTION_PLAN Phase 8, گام ۲)                          |
|--------------------------------------------------------------------------|
|
| Priority chain, most specific last (each layer overrides the previous):
|
|   global settings  <-  project file  <-  run override
|
| A project ADDITIONALLY has two file layers with the same relation:
|
|   <workspace>/.agent/project.json        the legacy floor - always read
|   <dataHome>/projects/<id>/project.json  the central cap - read and
|                                          WRITTEN when the project is a
|                                          registered one and the run is
|                                          modular
|
| Reads merge floor-with-cap (cap wins per key); new writes land in the
| central file so the workspace file stays a legacy compatibility layer,
| exactly as Decision 21 fixes it. In legacy mode, or for projects the
| registry does not know, every read and write is the historical one.
|
|--------------------------------------------------------------------------
*/


/* The project the boot opened, if any: writes flow to its layer. */
let openedProjectId = null;


function centralProjectPath(projectId) {

    if (!projectId) {
        return null;
    }

    try {

        const {
            registry,
            createProjectContext
        } = require("../projects");

        const record = registry().get(projectId);

        return path.join(
            createProjectContext(record).dataRoot,
            "project.json"
        );

    } catch {

        /* an id the registry does not know has no central layer */
        return null;

    }
}


/* The two physical layers of the overlay for a project id. `workspaceRoot`
   names the project's OWN workspace; when the caller does not know it, the
   registry record for `projectId` supplies it (SA-F-007). Only when there is
   no own root — the null default project, or an id the registry does not
   know — does the process workspace stand in (the pre-F-015 behaviour, kept
   for the legacy single-project flow). Reading the process workspace's file
   for EVERY project was audit F-015. */
function overlayFor(projectId, workspaceRoot) {

    const root =
        workspaceRoot || projectWorkspaceRoot(projectId);

    return {
        workspaceFile:
            root
                ? path.join(root, ".agent", "project.json")
                : projectPath(),
        centralFile: centralProjectPath(projectId)
    };
}


/*
| SA-F-007 — the workspace layer of a project is that PROJECT's own root,
| not whichever workspace the process happens to have. The registry record
| is the only authority on the root; an id it does not know (and the null
| default project) resolves to the process workspace, exactly as before.
| Reading the central cap was already project-aware; this makes the floor
| layer project-aware too, so openProject(A) can never apply B's settings.
*/
function projectWorkspaceRoot(projectId) {

    if (!projectId) {
        return null;
    }

    try {

        const { registry } = require("../projects");

        const rootPath = registry().get(projectId).rootPath;

        return typeof rootPath === "string" && rootPath !== "" ? rootPath : null;

    } catch {

        /* an id the registry does not know has no own workspace layer */
        return null;

    }
}


function readProjectFile(file) {

    if (!file || !fs.existsSync(file)) {
        return null;
    }

    try {

        return JSON.parse(fs.readFileSync(file, "utf8"));

    } catch {

        /* a corrupt project file must never stop a run */
        return null;

    }
}


function agentDirectory() {

    return path.join(WORKSPACE_ROOT, ".agent");
}


function projectPath() {

    return path.join(agentDirectory(), "project.json");
}


function emptyProject() {

    return {
        version: PROJECT_VERSION,
        name: path.basename(WORKSPACE_ROOT),
        created_at: null,
        last_opened_at: null,
        opened: 0,
        settings: {},
        hooks: null
    };
}


function normaliseProject(parsed) {

    const project = emptyProject();

    if (!parsed || typeof parsed !== "object") {
        return project;
    }

    return {
        ...project,
        ...parsed,

        settings:
            parsed.settings && typeof parsed.settings === "object"
                ? parsed.settings
                : {}
    };
}


function loadProject() {

    return normaliseProject(
        readProjectFile(projectPath())
    );
}


/*
| P0-1 — every project file is workspace input: the workspace layer sits
| in a repository, and the central layer starts life as a copy of it
| (ProjectMigration). Security settings are therefore never taken from
| either layer, and switches that make repository code run only from a
| workspace the operator trusted (see WorkspaceTrust).
*/
function overlayRoot(projectId, workspaceRoot) {

    return workspaceRoot || projectWorkspaceRoot(projectId) || WORKSPACE_ROOT;
}


function isWorkspaceTrusted(projectId, workspaceRoot) {

    try {

        return WorkspaceTrust.isTrusted(overlayRoot(projectId, workspaceRoot));

    } catch {

        /* an unreadable trust store trusts nothing */
        return false;
    }
}


function screenSettings(values, trusted) {

    return WorkspaceTrust.filterProjectSettings(values, {
        trusted,
        settings
    });
}


function withoutLocked(values) {

    const kept = {};

    for (const [key, value] of Object.entries(values || {})) {

        if (!WorkspaceTrust.isLocked(key, settings)) {
            kept[key] = value;
        }
    }

    return kept;
}


/* The effective project carries what was refused, and the settings as
   the files state them, without either reaching JSON.stringify. */
function screened(project, rawSettings, trusted) {

    const { allowed, blocked } = screenSettings(rawSettings, trusted);

    project.settings = allowed;

    Object.defineProperty(project, "blocked", {
        value: blocked,
        enumerable: false,
        configurable: true,
        writable: true
    });

    Object.defineProperty(project, "rawSettings", {
        value: { ...(rawSettings || {}) },
        enumerable: false,
        configurable: true,
        writable: true
    });

    Object.defineProperty(project, "trusted", {
        value: trusted,
        enumerable: false,
        configurable: true,
        writable: true
    });

    return project;
}


/* The overlay read: legacy floor with the central cap merged on top.
   Without a central layer this is exactly loadProject(), minus the
   settings a project file may not change (P0-1). */
function loadOverlay(projectId, workspaceRoot) {

    const { workspaceFile, centralFile } = overlayFor(projectId, workspaceRoot);

    const trusted = isWorkspaceTrusted(projectId, workspaceRoot);

    const floor = normaliseProject(readProjectFile(workspaceFile));

    const capRaw = readProjectFile(centralFile);

    /* No central file: the floor is the answer. (Spreading a normalised
       EMPTY cap over the floor used to overwrite the floor's own fields,
       hooks included, with the empty defaults.) */
    if (!capRaw || typeof capRaw !== "object") {

        return screened(floor, floor.settings, trusted);
    }

    const cap = normaliseProject(capRaw);

    /* only what the central file actually says wins over the floor */
    const stated = {};

    for (const key of Object.keys(cap)) {

        if (Object.prototype.hasOwnProperty.call(capRaw, key)) {
            stated[key] = cap[key];
        }
    }

    return screened(
        {
            ...floor,
            ...stated
        },
        {
            ...floor.settings,
            ...cap.settings
        },
        trusted
    );
}


function saveProject(project, target) {

    const file = target || projectPath();

    fs.mkdirSync(path.dirname(file), { recursive: true });

    AtomicFile.writeFile(
        file,
        `${JSON.stringify(project, null, 2)}\n`,
        "utf8"
    );

    return project;
}


/*
| A flag typed on this command line belongs to this run, not to the
| project: --quiet once should not make a workspace quiet for ever. The
| entry point declares those keys and they are applied but never saved.
*/

const SESSION_ONLY = new Set();


function sessionOnly(keys) {

    for (const key of keys) {
        SESSION_ONLY.add(key);
    }

    return [...SESSION_ONLY];
}


/*
| Everything the operator changed, as a diff against the defaults.
*/

function currentOverrides() {

    const saved = {};

    for (const setting of settings.all()) {

        if (setting.source !== "override" || setting.fixed) {
            continue;
        }

        if (SESSION_ONLY.has(setting.key)) {
            continue;
        }

        if (
            setting.secret &&
            settings.get("PROJECT_SAVE_SECRETS") !== true
        ) {
            continue;
        }

        saved[setting.key] =
            settings.get(setting.key);
    }

    return saved;
}


function persist() {

    if (settings.get("PROJECT_FILE_ENABLED") !== true) {
        return null;
    }

    const { workspaceFile, centralFile } =
        overlayFor(openedProjectId);

    const project = loadOverlay(openedProjectId);

    project.version = PROJECT_VERSION;

    /* A security setting is never written to a project file: it would
       never be read back (P0-1), and a base URL does not belong in a
       repository. A switch refused only because the workspace is not
       trusted yet is kept, so trusting the folder later restores it. */
    const kept = {};

    for (const item of project.blocked || []) {

        if (
            !WorkspaceTrust.isLocked(item.key, settings) &&
            Object.prototype.hasOwnProperty.call(project.rawSettings || {}, item.key)
        ) {
            kept[item.key] = project.rawSettings[item.key];
        }
    }

    project.settings = {
        ...kept,
        ...withoutLocked(currentOverrides())
    };

    project.updated_at = new Date().toISOString();

    /* گام ۲ write target: the central cap when the opened project is a
       registered modular one, the legacy workspace file otherwise. */
    return saveProject(project, centralFile || workspaceFile);
}


/*
| Opening a project applies what it remembers, then records the visit.
| A key the running version no longer knows is reported rather than
| dropped silently, because a renamed setting is a real change.
*/

/*
| Once a project is open, a change made from the console belongs to the
| project, not to the process. Writes are debounced because a settings
| panel can produce a burst of them.
*/

let watching = false;

let pending = null;


function watch() {

    if (watching) {
        return false;
    }

    watching = true;

    settings.bus.on("change", () => {

        if (pending) {
            clearTimeout(pending);
        }

        pending =
            setTimeout(
                () => {

                    pending = null;

                    try {

                        persist();

                    } catch {

                        /* a project that cannot be written is not fatal */
                    }
                },
                200
            );

        if (typeof pending.unref === "function") {
            pending.unref();
        }
    });

    return true;
}


function openProject(projectId) {

    /* The id may arrive as the CLI's --project value or as an options
       object from a programmatic caller ({ project: "id" } /
       { projectId: "id" }); positional-null keeps the legacy shape. */
    if (projectId && typeof projectId === "object") {
        projectId = projectId.projectId ?? projectId.project ?? null;
    }

    openedProjectId = projectId || null;

    const { workspaceFile, centralFile } =
        overlayFor(openedProjectId);

    const project = loadOverlay(openedProjectId);

    const applied = [];
    const skipped = [];
    const blocked = [...(project.blocked || [])];

    if (settings.get("PROJECT_FILE_ENABLED") === true) {

        for (
            const [key, value]
            of Object.entries(project.settings || {})
        ) {

            try {

                settings.set(key, value);

                applied.push(key);

            } catch (error) {

                skipped.push({ key, reason: error.message });
            }
        }
    }

    const stamp = new Date().toISOString();

    project.created_at = project.created_at || stamp;
    project.last_opened_at = stamp;
    project.opened = (project.opened || 0) + 1;

    if (settings.get("PROJECT_FILE_ENABLED") === true) {

        /* Recording the visit must not rewrite what the files say: the
           workspace file keeps its settings exactly as the repository
           has them; the central file drops security settings, which a
           migrated copy of a repository file may carry (P0-1). */
        saveProject(
            {
                ...project,
                settings: centralFile
                    ? withoutLocked(project.rawSettings)
                    : { ...(project.rawSettings || {}) }
            },
            centralFile || workspaceFile
        );
    }

    if (settings.get("PROJECT_FILE_ENABLED") === true) {

        watch();
    }

    return {
        path: workspaceFile,
        ...(centralFile ? { overlay_path: centralFile } : {}),
        project,
        applied,
        skipped,
        blocked,
        trusted: project.trusted === true,
        workspace_root: overlayRoot(openedProjectId)
    };
}


module.exports = {
    PROJECT_VERSION,
    agentDirectory,
    projectPath,
    emptyProject,
    loadProject,
    saveProject,
    currentOverrides,
    sessionOnly,
    persist,
    watch,
    openProject,

    /* Phase 8 گام ۲ overlay surface */
    overlayFor,
    centralProjectPath,
    loadOverlay,

    /* P0-1 workspace trust */
    isWorkspaceTrusted,
    WorkspaceTrust
};
