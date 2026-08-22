const fs = require("fs");
const path = require("path");

const settings = require("./storage");

const { WORKSPACE_ROOT } = require("./workspace");


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


function loadProject() {

    const file = projectPath();

    if (!fs.existsSync(file)) {
        return emptyProject();
    }

    try {

        const parsed =
            JSON.parse(fs.readFileSync(file, "utf8"));

        const project = emptyProject();

        return {
            ...project,
            ...parsed,

            settings:
                parsed.settings && typeof parsed.settings === "object"
                    ? parsed.settings
                    : {}
        };

    } catch {

        /* a corrupt project file must never stop a run */
        return emptyProject();
    }
}


function saveProject(project) {

    fs.mkdirSync(agentDirectory(), { recursive: true });

    fs.writeFileSync(
        projectPath(),
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

    const project = loadProject();

    project.version = PROJECT_VERSION;

    project.settings = currentOverrides();

    project.updated_at = new Date().toISOString();

    return saveProject(project);
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


function openProject() {

    const project = loadProject();

    const applied = [];
    const skipped = [];

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

        saveProject(project);
    }

    if (settings.get("PROJECT_FILE_ENABLED") === true) {

        watch();
    }

    return {
        path: projectPath(),
        project,
        applied,
        skipped
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
    openProject
};
