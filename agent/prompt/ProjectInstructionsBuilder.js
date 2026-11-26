"use strict";

/*
|--------------------------------------------------------------------------
| Project Instructions Builder (roadmap P1-01)
|--------------------------------------------------------------------------
|
| The project_instructions system message: what the project's maintainers
| wrote for coding agents in AGENTS.md / CLAUDE.md.
|
|   - At the workspace root, AGENTS.override.md replaces AGENTS.md and
|     CLAUDE.md; otherwise both are read (a second file with the same
|     content, a symlink for instance, is not repeated).
|   - Instruction files in sub-directories are not inlined: their paths
|     are listed with the rule to read one before working under its
|     directory, so a monorepo does not pay for every package on every
|     request.
|   - PROJECT_INSTRUCTIONS_MAX_CHARS bounds what is inlined; a cut is
|     marked in the message and reported once to the application log.
|   - A file reached through a symlink that leaves the workspace is not
|     read: the boundary that applies to the tools applies here too.
|
| Nothing found means no message, so a workspace without such files gets
| a prompt byte-identical to the one it had before.
|
| `/init` (or `agent init`) is expanded into the task that writes the
| first AGENTS.md; isInitCommand / initTask live here so every surface
| (CLI, REPL, web console) shares one definition.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const settings = require("../config");
const { jsonSystem } = require("./PromptMessages");
const { logs } = require("../runtime/LogStore");

const OVERRIDE_FILE = "AGENTS.override.md";

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

/* directories that never hold the project's own instructions */
const SKIPPED_DIRECTORIES = new Set([
    ".git", ".hg", ".svn", "node_modules", "vendor", "dist", "build", "out",
    "coverage", "target", ".venv", "venv", "__pycache__", ".next", ".nuxt",
    ".cache", ".turbo", ".idea", ".vscode"
]);


function realpathOrNull(target) {

    try {
        return fs.realpathSync(target);
    } catch {
        return null;
    }

}


function isInside(root, candidate) {

    const relative = path.relative(root, candidate);

    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

}


/* The instruction files that apply to one directory, by priority. */
function instructionFilesIn(directory, names) {

    if (names.has(OVERRIDE_FILE)) {
        return [OVERRIDE_FILE];
    }

    return INSTRUCTION_FILES.filter(name => names.has(name));

}


function directoryNames(directory) {

    try {
        return fs.readdirSync(directory, { withFileTypes: true });
    } catch {
        return [];
    }

}


class ProjectInstructionsBuilder {

    constructor({ workspaceRoot, log = logs, maxDirectories = 2000, maxNested = 50 } = {}) {

        /* () => absolute root of the active workspace */
        this.workspaceRoot = workspaceRoot;
        this.log = log;
        this.maxDirectories = maxDirectories;
        this.maxNested = maxNested;
        this.reported = new Set();

    }


    enabled() {

        return settings.get("PROJECT_INSTRUCTIONS_ENABLED") !== false;

    }


    /* Root files to inline: [{ path, content, truncated }] */
    readRootFiles(root, realRoot) {

        const names = new Set(directoryNames(root).filter(entry => !entry.isDirectory()).map(entry => entry.name));
        const chosen = instructionFilesIn(root, names);
        const budget = settings.get("PROJECT_INSTRUCTIONS_MAX_CHARS");
        const seen = new Set();
        const files = [];
        let remaining = budget;

        for (const name of chosen) {

            const full = path.join(root, name);
            const real = realpathOrNull(full);

            if (!real || !isInside(realRoot, real) || seen.has(real)) {
                continue;
            }

            let content;

            try {
                if (!fs.statSync(real).isFile()) continue;
                content = fs.readFileSync(real, "utf8").replace(/^\uFEFF/, "").trim();
            } catch {
                continue;
            }

            if (!content || files.some(file => file.content === content)) {
                seen.add(real);
                continue;
            }

            seen.add(real);

            const truncated = content.length > remaining;

            if (truncated) {
                this.reportOnce(`${real}:${content.length}:${budget}`, name, content.length, budget);
            }

            files.push({
                path: name,
                content: truncated ? content.slice(0, Math.max(0, remaining)) : content,
                ...(truncated ? { truncated: true } : {})
            });

            remaining = Math.max(0, remaining - content.length);
        }

        return files.filter(file => file.content.length > 0);

    }


    /* Relative paths of instruction files below the root, breadth first. */
    findNested(root, realRoot) {

        const depthLimit = settings.get("PROJECT_INSTRUCTIONS_SCAN_DEPTH");

        if (!(depthLimit > 0)) {
            return [];
        }

        const found = [];
        const queue = [{ directory: root, depth: 0 }];
        let visited = 0;

        while (queue.length > 0 && visited < this.maxDirectories && found.length < this.maxNested) {

            const { directory, depth } = queue.shift();
            const entries = directoryNames(directory);

            visited += 1;

            if (depth > 0) {

                const names = new Set(entries.filter(entry => !entry.isDirectory()).map(entry => entry.name));

                for (const name of instructionFilesIn(directory, names)) {

                    const real = realpathOrNull(path.join(directory, name));

                    if (real && isInside(realRoot, real)) {
                        found.push(path.relative(root, path.join(directory, name)).split(path.sep).join("/"));
                    }
                }
            }

            if (depth >= depthLimit) {
                continue;
            }

            for (const entry of entries) {

                /* symlinked directories are not followed: no loops, no escapes */
                if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
                    queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
                }
            }
        }

        return found.sort().slice(0, this.maxNested);

    }


    reportOnce(key, name, length, budget) {

        if (this.reported.has(key)) {
            return;
        }

        this.reported.add(key);

        this.log.warn(
            "prompt",
            `${name} is ${length} characters; only the first ${budget} (PROJECT_INSTRUCTIONS_MAX_CHARS) reach the model`,
            { file: name, length, limit: budget }
        );

    }


    collect() {

        if (!this.enabled()) {
            return null;
        }

        const root = typeof this.workspaceRoot === "function" ? this.workspaceRoot() : this.workspaceRoot;

        if (typeof root !== "string" || root === "") {
            return null;
        }

        const realRoot = realpathOrNull(root);

        if (!realRoot) {
            return null;
        }

        const files = this.readRootFiles(root, realRoot);
        const nested = this.findNested(root, realRoot);

        if (files.length === 0 && nested.length === 0) {
            return null;
        }

        return { files, nested };

    }


    build() {

        const found = this.collect();

        if (!found) {
            return null;
        }

        return jsonSystem({
            type: "project_instructions",

            note:
                "Instructions the project's maintainers wrote for coding agents. Follow them for this project unless they conflict with the execution rules or the user's task; the user's explicit request wins.",

            ...(found.files.length > 0 ? { files: found.files } : {}),

            ...(found.nested.length > 0
                ? {
                      directory_instructions: {
                          note:
                              "Instructions for one directory. Read the file with fs_read before changing anything under that directory; for its directory it takes precedence over the files above.",
                          files: found.nested
                      }
                  }
                : {})
        });

    }

}


function isInitCommand(task) {

    return typeof task === "string" && /^\/init\s*$/i.test(task.trim());

}


function initTask() {

    return [
        "Create or update AGENTS.md at the root of the active workspace: the instructions future coding agents will read before working on this project.",
        "",
        "1. Study the repository first: the directory layout, the package and build manifests, the CI configuration, the existing README and any CLAUDE.md or AGENTS.md files.",
        "2. Write concise Markdown with these sections: Overview (what the project is), Tech stack, Project structure (the directories that matter and what lives there), Commands (install, build, run, test, lint — only commands you verified in the manifests or CI files), Conventions (code style, naming, testing and commit rules you can observe), and Gotchas (anything surprising a newcomer would trip over).",
        "3. If AGENTS.md already exists, keep everything a person wrote and only correct or extend it. If only CLAUDE.md exists, do not delete it.",
        "4. Never invent commands, paths or rules. Keep the file under 300 lines.",
        "5. Finish with a short summary of what you wrote and anything you could not verify."
    ].join("\n");

}


module.exports = ProjectInstructionsBuilder;
module.exports.ProjectInstructionsBuilder = ProjectInstructionsBuilder;
module.exports.isInitCommand = isInitCommand;
module.exports.initTask = initTask;
