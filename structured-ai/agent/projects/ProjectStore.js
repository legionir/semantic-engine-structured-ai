"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const settings = require("../config");
const AtomicFile = require("../persistence/AtomicFile");

/*
|--------------------------------------------------------------------------
| Project Store
|--------------------------------------------------------------------------
|
| Owns the on-disk form of the project registry. The registry lives in the
| user's data home (never inside a workspace, so a workspace can be moved
| or deleted without losing the agent's knowledge of projects):
|
|   ~/.local/share/structured-ai/registry.json
|
| overridable through the STRUCTURED_AI_DATA_HOME setting (declared in
| lib/storage schema — the store's internal contract forbids reading raw
| env vars outside it).
|
| Writes are atomic (temp file + rename) so a crash mid-save can never
| leave half a registry behind. A corrupt file surfaces as a clear error
| naming the path, never as a silent reset.
|
*/

/*
| Same convention as the workspace project file (lib/project.js): format
| versions are strings so they are read as labels, not tunable numbers —
| and they stay out of the settings store's "no bare numeric constant"
| boundary.
*/
const STORE_VERSION = "1";



function resolveDataHome() {

    const override = settings.get("STRUCTURED_AI_DATA_HOME");

    if (override) {

        return path.resolve(override);

    }

    return path.join(

        os.homedir(),

        ".local",

        "share",

        "structured-ai"
    );

}



function resolveRegistryPath(dataHome = resolveDataHome()) {

    return path.join(dataHome, "registry.json");

}



function emptyRegistry() {

    return {
        version: STORE_VERSION,
        projects: {}
    };

}



function load(registryPath = resolveRegistryPath()) {

    if (!fs.existsSync(registryPath)) {

        return emptyRegistry();

    }

    let text;

    try {

        text = fs.readFileSync(registryPath, "utf8");

    } catch (error) {

        throw new Error(
            `Project registry could not be read from ${registryPath}: ${error.message}`
        );

    }

    let data;

    try {

        data = JSON.parse(text);

    } catch (error) {

        throw new Error(
            `Project registry at ${registryPath} is corrupt (invalid JSON): ${error.message}`
        );

    }

    if (!data || typeof data !== "object" || typeof data.projects !== "object" || data.projects === null) {

        throw new Error(
            `Project registry at ${registryPath} is corrupt: expected an object with a projects map.`
        );

    }

    return {
        version: data.version || STORE_VERSION,
        projects: data.projects
    };

}



function save(registry, registryPath = resolveRegistryPath()) {

    /*
    | SA-F-016 (contained half) — this used to hand-roll the atomic write
    | with `${registryPath}.tmp-${process.pid}`: two saves sharing a pid
    | (container pid namespaces, or a retried save overlapping a slow one)
    | wrote through the SAME temp path, so one rename could publish the
    | other's bytes; and a crash between write and rename left a stale
    | `.tmp-<pid>` file forever. Both are the exact hazards AtomicFile
    | already solves (pid+time+random suffix, unlink-on-failure). The
    | cross-process read-modify-write race (load→mutate→save with no lock)
    | is a separate design decision and stays tracked in the ledger.
    */

    AtomicFile.writeFile(
        registryPath,
        JSON.stringify(
            {
                version: registry.version || STORE_VERSION,
                projects: registry.projects
            },
            null,
            2
        ) + "\n",
        "utf8"
    );

}



module.exports = {
    STORE_VERSION,
    resolveDataHome,
    resolveRegistryPath,
    emptyRegistry,
    load,
    save
};
