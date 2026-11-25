"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ProjectStore = require("./ProjectStore");

/*
|--------------------------------------------------------------------------
| Project Registry
|--------------------------------------------------------------------------
|
| Registers and resolves the projects Structured AI knows about. Rules
| (EXECUTION_PLAN, Phase 2):
|
|   - roots are canonicalized with realpath before they identify anything
|   - registering an already-known root returns the existing project,
|     never a duplicate
|   - a project id is NOT derived from the raw root string; it is slug of
|     the display name plus a short hash of the CANONICAL root, fixed at
|     registration time — so renaming the project never changes its id
|   - a root path may therefore be read only through the registry
|
| Ids look like:  prj-engine-core-3fa9c1d2
|
*/

const DEFAULT_PERMISSIONS = Object.freeze({
    read: true,
    write: true,
    terminal: true,
    git: true
});


function slugify(name) {

    const slug =

        String(name || "project")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 24);

    return slug || "project";

}


/*
| The identity-bearing half of a project id: a short hash of the CANONICAL
| root. The slug in front of it is display text and may drift with a
| rename; this suffix may not, which is what lets an explicit project
| record be checked against the root it claims (ProjectResolver).
*/
function projectRootHash(canonicalRoot) {

    return crypto
        .createHash("sha256")
        .update(canonicalRoot)
        .digest("hex")
        .slice(0, 8);

}


function projectIdFor(name, canonicalRoot) {

    return `prj-${slugify(name)}-${projectRootHash(canonicalRoot)}`;

}


function canonicalizeRoot(rootPath) {

    if (typeof rootPath !== "string" || rootPath.trim() === "") {

        throw new Error(
            "Project rootPath is required and must be a non-empty string."
        );

    }

    const resolved = path.resolve(rootPath);

    let stats;

    try {

        stats = fs.statSync(resolved);

    } catch (error) {

        throw new Error(
            `Project root does not exist: ${rootPath} (${error.code || error.message})`
        );

    }

    if (!stats.isDirectory()) {

        throw new Error(
            `Project root is not a directory: ${rootPath}`
        );

    }

    return fs.realpathSync(resolved);

}


class ProjectRegistry {

    constructor({ registryPath } = {}) {

        this.registryPath =
            registryPath || ProjectStore.resolveRegistryPath();

    }

    _load() {

        return ProjectStore.load(this.registryPath);

    }

    _save(data) {

        ProjectStore.save(data, this.registryPath);

    }

    /*
    | Register a project. Idempotent on the canonical root: re-registering
    | an existing root returns the existing record unchanged.
    */
    register(config = {}) {

        if (config.createIfMissing === true) {

            if (typeof config.rootPath !== "string" || config.rootPath.trim() === "") {
                throw new Error("Project rootPath is required and must be a non-empty string.");
            }

            const requestedRoot = path.resolve(config.rootPath);

            if (!fs.existsSync(requestedRoot)) {
                try {
                    fs.mkdirSync(requestedRoot, { recursive: true });
                } catch (error) {
                    throw new Error(`Could not create project root: ${config.rootPath} (${error.code || error.message})`);
                }
            }
        }

        const canonicalRoot = canonicalizeRoot(config.rootPath);

        const data = this._load();

        for (const existing of Object.values(data.projects)) {

            if (existing.rootPath === canonicalRoot) {

                return cloneProject(existing);

            }
        }

        const name =
            typeof config.name === "string" && config.name.trim() !== ""
                ? config.name.trim()
                : path.basename(canonicalRoot);

        const id =
            config.id ||
            projectIdFor(name, canonicalRoot);

        if (data.projects[id]) {

            throw new Error(
                `Project id already in use by a different project: ${id}`
            );

        }

        const record = {
            id,
            name,
            rootPath: canonicalRoot,
            enabled: config.enabled ?? true,
            autoStart: config.autoStart ?? true,
            permissions: {
                ...DEFAULT_PERMISSIONS,
                ...(config.permissions || {})
            },
            created_at: new Date().toISOString()
        };

        data.projects[id] = record;

        this._save(data);

        return cloneProject(record);

    }

    get(projectId) {

        const record = this._load().projects[projectId];

        if (!record) {

            throw new Error(
                `Unknown project: ${projectId}`
            );

        }

        return cloneProject(record);

    }

    list() {

        const projects = Object.values(this._load().projects);

        return projects
            .slice()
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            .map(cloneProject);

    }

    findByRoot(rootPath) {

        const canonicalRoot = canonicalizeRoot(rootPath);

        for (const record of Object.values(this._load().projects)) {

            if (record.rootPath === canonicalRoot) {

                return cloneProject(record);

            }
        }

        return null;

    }

    remove(projectId) {

        const data = this._load();

        if (!data.projects[projectId]) {

            throw new Error(
                `Unknown project: ${projectId}`
            );

        }

        const removed = data.projects[projectId];

        delete data.projects[projectId];

        this._save(data);

        return cloneProject(removed);

    }

    /*
    | Patch mutable fields. Identity fields (id, rootPath) cannot be
    | patched: a new root means a new registration, and a rename keeps
    | the id — that is what makes references durable.
    */
    update(projectId, patch = {}) {

        for (const forbidden of ["id", "rootPath"]) {

            if (Object.prototype.hasOwnProperty.call(patch, forbidden)) {

                throw new Error(
                    `Project field ${forbidden} is immutable; ` +
                    (forbidden === "rootPath"
                        ? "register the new root as its own project instead."
                        : "ids are fixed at registration time.")
                );

            }
        }

        const data = this._load();

        const record = data.projects[projectId];

        if (!record) {

            throw new Error(
                `Unknown project: ${projectId}`
            );

        }

        if (typeof patch.name === "string" && patch.name.trim() !== "") {

            record.name = patch.name.trim();

        }

        if (typeof patch.enabled === "boolean") {

            record.enabled = patch.enabled;

        }

        if (typeof patch.autoStart === "boolean") {

            record.autoStart = patch.autoStart;

        }

        if (patch.permissions && typeof patch.permissions === "object") {

            record.permissions = {
                ...record.permissions,
                ...patch.permissions
            };

        }

        record.updated_at = new Date().toISOString();

        this._save(data);

        return cloneProject(record);

    }

    /*
    | The default project keeps today's single-workspace behavior:
    | if the workspace root is registered, that project is the default;
    | otherwise a synthetic (unpersisted) project is derived from the
    | workspace itself with the legacy .agent data layout, which
    | Phase 8 migrates into the central store.
    */
    resolveDefault(workspaceRoot) {

        const canonicalRoot = canonicalizeRoot(workspaceRoot);

        const registered = this.findByRoot(canonicalRoot);

        if (registered) {

            return registered;

        }

        const name = path.basename(canonicalRoot);

        return {
            id: projectIdFor(name, canonicalRoot),
            name,
            rootPath: canonicalRoot,
            enabled: true,
            autoStart: true,
            permissions: { ...DEFAULT_PERMISSIONS },
            synthetic: true
        };

    }

}


function cloneProject(record) {

    return {
        ...record,
        permissions: { ...record.permissions }
    };

}


module.exports = {
    ProjectRegistry,
    canonicalizeRoot,
    projectIdFor,
    projectRootHash,
    DEFAULT_PERMISSIONS
};
