"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
|--------------------------------------------------------------------------|
| Semantic Engine paths — the consumer side of one contract                |
|--------------------------------------------------------------------------|
|
| The engine moved its generated data out of the workspace
| (MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md, فاز ۳/۴). Its artifacts now live
| in a per-user data directory:
|
|   linux    $XDG_DATA_HOME/semantic-engine      (else ~/.local/share/…)
|   macOS    ~/Library/Application Support/SemanticEngine
|   windows  %LOCALAPPDATA%\SemanticEngine
|
|   <dataHome>/projects/<projectId>/project-index.json
|
| with projectId = `prj-<slug(name)>-<sha256(canonicalRoot)[0:8]>`.
|
| This module mirrors those two rules — and nothing else. It deliberately has
| no dependency on the settings store or the MCP layer, so the engine's own
| test suite can require it and assert that both sides still agree
| (semantic-engine/src/core/config/structuredAiContract.test.ts). If either
| rule changes, that test fails instead of a user's index going missing.
|
| Legacy in-root locations stay readable forever; they are never written.
|--------------------------------------------------------------------------|
*/

const ENGINE_DIR_POSIX = "semantic-engine";
const ENGINE_DIR_WINDOWS = "SemanticEngine";
const PROJECTS_DIR = "projects";
const INDEX_FILE = "project-index.json";

/*
| The slug length (24) and the hash length (8) are part of the id *format*
| shared with the engine, not tunables, so they are written inline where they
| are used: this repository's runtime governance test treats a module-level
| numeric constant as configuration in hiding.
*/


/*
| Windows paths are built with the Windows separator even when this code runs
| elsewhere (tests, config previews). On Windows `path` already *is*
| `path.win32`, so this is a no-op there — and it keeps this function's output
| identical to the engine's `resolveDataRoot` on every platform.
*/
function pathFor(platform) {

    return platform === "win32" ? path.win32 : path;
}


function engineDataHome(options = {}) {

    const env = options.env || process.env;
    const platform = options.platform || process.platform;
    const homeDir = options.homeDir || os.homedir();
    const platformPath = pathFor(platform);

    const override = (options.override || "").trim();

    if (override) {
        return platformPath.resolve(override);
    }

    if (platform === "darwin") {
        return platformPath.join(
            homeDir,
            "Library",
            "Application Support",
            ENGINE_DIR_WINDOWS
        );
    }

    if (platform === "win32") {
        const localAppData = (env.LOCALAPPDATA || "").trim();
        const base = localAppData ||
            platformPath.join(homeDir, "AppData", "Local");

        return platformPath.join(base, ENGINE_DIR_WINDOWS);
    }

    /* A relative XDG_DATA_HOME is invalid per spec; joining it onto the cwd
       would scatter data directories, so it is ignored. */
    const xdg = (env.XDG_DATA_HOME || "").trim();
    const base = xdg && platformPath.isAbsolute(xdg)
        ? xdg
        : platformPath.join(homeDir, ".local", "share");

    return platformPath.join(base, ENGINE_DIR_POSIX);
}


function slugify(name) {

    const slug =
        String(name == null ? "" : name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 24);

    return slug || "project";
}


/* Real path when the directory exists, textual path otherwise: an index may
   be inspected for a checkout that is not mounted right now. */
function canonicalRoot(rootPath) {

    const resolved = path.resolve(String(rootPath));

    try {
        return fs.realpathSync(resolved);
    } catch {
        return resolved;
    }
}


function engineProjectIdFor(rootPath, name) {

    const canonical = canonicalRoot(rootPath);
    const label = (name == null || String(name).trim() === "")
        ? path.basename(canonical)
        : name;

    const hash =
        crypto
            .createHash("sha256")
            .update(canonical)
            .digest("hex")
            .slice(0, 8);

    return `prj-${slugify(label)}-${hash}`;
}


function externalIndexPath(rootPath, options = {}) {

    const projectId =
        options.projectId ||
        engineProjectIdFor(rootPath, options.name);

    return path.join(
        engineDataHome(options),
        PROJECTS_DIR,
        projectId,
        INDEX_FILE
    );
}


/*
| Read order: the data directory first, then the three historical in-root
| locations. The engine never writes to the legacy ones again, but an index
| that predates the move must keep working until it is migrated.
*/
function indexPathCandidates(rootPath, options = {}) {

    const base = path.resolve(String(rootPath));

    return [
        externalIndexPath(base, options),
        path.join(base, ".semantic-engine", INDEX_FILE),
        path.join(base, ".agent", "semantic", INDEX_FILE),
        path.join(base, "semantic", INDEX_FILE)
    ];
}


function firstExistingIndexPath(rootPath, options = {}) {

    const candidates = indexPathCandidates(rootPath, options);

    return (
        candidates.find(candidate => fs.existsSync(candidate)) ||
        candidates[0]
    );
}


module.exports = {
    ENGINE_DIR_POSIX,
    ENGINE_DIR_WINDOWS,
    PROJECTS_DIR,
    INDEX_FILE,
    engineDataHome,
    slugify,
    canonicalRoot,
    engineProjectIdFor,
    externalIndexPath,
    indexPathCandidates,
    firstExistingIndexPath
};
