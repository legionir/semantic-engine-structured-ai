"use strict";

/*
|--------------------------------------------------------------------------
| Path-scoped project rules (roadmap P3-06)
|--------------------------------------------------------------------------
|
| Rule files are Markdown with optional front matter, the layout Cursor
| and Claude Code use:
|
|   <workspace>/.agent/rules/**\/*.md
|   <workspace>/.claude/rules/**\/*.md
|   <workspace>/.cursor/rules/**\/*.mdc  (and .md)
|
|   ---
|   description: React components in the web console
|   globs: web/**, "*.tsx"        (or a YAML list)
|   alwaysApply: false
|   ---
|   Use signals, never class components ...
|
| A rule with globs reaches the model only after the run has touched a
| matching file (read, written, patched, moved ...): a rule for web/**
| stays out of the context while the agent works in agent/. A rule with
| neither globs nor alwaysApply: false always applies. alwaysApply: false
| without globs is listed by path and description only, for the agent to
| read when it decides the rule is relevant.
|
| Rules travel inside the runtime_context message, which is rewritten on
| every iteration, so a rule appears in the very next request after the
| first matching file is touched. PROJECT_RULES_MAX_CHARS bounds the
| inlined text; whatever does not fit is listed by path.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const settings = require("../config");
const { parseFrontMatter } = require("../tools/skills/MarkdownSkills");

const RULE_DIRECTORIES = [
    { directory: path.join(".agent", "rules"), extensions: [".md"] },
    { directory: path.join(".claude", "rules"), extensions: [".md"] },
    { directory: path.join(".cursor", "rules"), extensions: [".mdc", ".md"] }
];

/* argument names that carry a workspace path in the built-in tools */
const PATH_ARGUMENTS = ["path", "source", "destination", "target", "file", "from", "to"];

const PATH_LIST_ARGUMENTS = ["paths", "files"];

/* cache of parsed rule files: path -> { mtimeMs, size, rule } */
const parsedCache = new Map();


function toPosix(value) {

    return String(value).split(path.sep).join("/").replace(/\\/g, "/");
}


/*
| A glob as a regular expression over a workspace-relative posix path:
| ** any number of directories, * anything but /, ? one character,
| {a,b} alternatives. A pattern without / matches the name at any depth
| (".gitignore style"), so "*.tsx" covers web/app/x.tsx.
*/
function globToRegExp(glob) {

    let pattern = String(glob).trim().replace(/^\.\//, "");

    if (pattern.endsWith("/")) {
        pattern += "**";
    }

    if (!pattern.includes("/")) {
        pattern = `**/${pattern}`;
    }

    let source = "";

    for (let index = 0; index < pattern.length; index++) {

        const char = pattern[index];

        if (char === "*") {

            if (pattern[index + 1] === "*") {

                const slash = pattern[index + 2] === "/";
                source += slash ? "(?:.*/)?" : ".*";
                index += slash ? 2 : 1;

            } else {
                source += "[^/]*";
            }

        } else if (char === "?") {
            source += "[^/]";
        } else if (char === "{") {

            const end = pattern.indexOf("}", index);

            if (end === -1) {
                source += "\\{";
                continue;
            }

            source += `(?:${pattern.slice(index + 1, end).split(",").map(part => part.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`;
            index = end;

        } else {
            source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
        }
    }

    return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "");
}


function globList(value) {

    const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];

    return items
        .map(item => String(item).trim().replace(/^["']|["']$/g, ""))
        .filter(item => item !== "")
        .slice(0, 50);
}


function listRuleFiles(root) {

    const files = [];

    for (const { directory, extensions } of RULE_DIRECTORIES) {

        const queue = [path.join(root, directory)];

        while (queue.length > 0 && files.length < 200) {

            const current = queue.shift();
            let entries = [];

            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {

                const full = path.join(current, entry.name);

                if (entry.isDirectory() && !entry.name.startsWith(".")) {
                    queue.push(full);
                } else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
                    files.push(full);
                }
            }
        }
    }

    return files;
}


function readRule(root, file) {

    let stat;

    try {
        stat = fs.statSync(file);
    } catch {
        return null;
    }

    const cached = parsedCache.get(file);

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.rule;
    }

    let rule = null;

    try {

        const { meta, body } = parseFrontMatter(fs.readFileSync(file, "utf8"));
        const globs = globList(meta.globs ?? meta.paths);
        const always = String(meta.alwaysapply ?? "").toLowerCase();

        rule = {
            path: toPosix(path.relative(root, file)),
            description: typeof meta.description === "string" ? meta.description.slice(0, 300) : "",
            globs,
            matchers: globs.map(globToRegExp),
            mode: globs.length > 0 ? "scoped" : always === "false" ? "listed" : "always",
            content: body
        };

    } catch {
        rule = null;
    }

    parsedCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, rule });

    return rule;
}


function loadRules(root) {

    if (settings.get("PROJECT_RULES_ENABLED") === false || typeof root !== "string" || root === "") {
        return [];
    }

    return listRuleFiles(root).map(file => readRule(root, file)).filter(rule => rule && (rule.content || rule.mode === "listed"));
}


/* workspace-relative posix path, or null for a path outside the workspace */
function workspaceRelative(root, value) {

    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }

    const absolute = path.resolve(root, value);
    const relative = path.relative(root, absolute);

    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }

    return toPosix(relative);
}


/* file names an apply_patch body names (both the *** and the unified forms) */
function patchPaths(patch) {

    const found = [];
    const pattern = /^(?:\*\*\* (?:Add|Update|Delete) File: (.+)|\+\+\+ (?:b\/)?(.+)|--- (?:a\/)?(.+))$/gm;

    for (const match of String(patch || "").matchAll(pattern)) {

        const name = (match[1] || match[2] || match[3] || "").trim();

        if (name && name !== "/dev/null") {
            found.push(name);
        }
    }

    return found;
}


function pathsOfCall(toolName, args) {

    const candidates = [];

    if (!args || typeof args !== "object") {
        return candidates;
    }

    for (const key of PATH_ARGUMENTS) {
        if (typeof args[key] === "string") candidates.push(args[key]);
    }

    for (const key of PATH_LIST_ARGUMENTS) {
        if (Array.isArray(args[key])) candidates.push(...args[key].filter(item => typeof item === "string"));
    }

    if (Array.isArray(args.edits)) {
        for (const edit of args.edits) if (edit && typeof edit.path === "string") candidates.push(edit.path);
    }

    if (toolName === "apply_patch") {
        candidates.push(...patchPaths(args.patch || args.input || args.diff));
    }

    return candidates;
}


/* records the files a tool call works on in the run (run.touchedPaths) */
function noteToolCall(run, root, toolName, args) {

    if (!run || typeof root !== "string" || root === "") {
        return;
    }

    if (!(run.touchedPaths instanceof Set)) {
        run.touchedPaths = new Set();
    }

    for (const candidate of pathsOfCall(toolName, args)) {

        const relative = workspaceRelative(root, candidate);

        if (relative && run.touchedPaths.size < 5000) {
            run.touchedPaths.add(relative);
        }
    }
}


function matches(rule, touched) {

    for (const file of touched) {
        if (rule.matchers.some(matcher => matcher.test(file))) {
            return true;
        }
    }

    return false;
}


/*
| The rules for a run: { rules: [{ path, globs?, content }], listed: [...] }
| or null when there is nothing to say (no message change at all).
*/
function rulesFor(root, touchedPaths) {

    const rules = loadRules(root);

    if (rules.length === 0) {
        return null;
    }

    const touched = touchedPaths instanceof Set ? [...touchedPaths] : [];
    const budget = settings.get("PROJECT_RULES_MAX_CHARS");
    const active = [];
    const listed = [];
    let used = 0;

    for (const rule of rules) {

        const applies = rule.mode === "always" || (rule.mode === "scoped" && matches(rule, touched));

        if (!applies) {

            if (rule.mode === "listed") {
                listed.push({ path: rule.path, description: rule.description });
            }

            continue;
        }

        if (used + rule.content.length > budget) {
            listed.push({ path: rule.path, description: rule.description || "(over PROJECT_RULES_MAX_CHARS; read it with fs_read)" });
            continue;
        }

        used += rule.content.length;

        active.push({
            path: rule.path,
            ...(rule.globs.length > 0 ? { globs: rule.globs } : {}),
            content: rule.content
        });
    }

    if (active.length === 0 && listed.length === 0) {
        return null;
    }

    return {
        note: "Project rules. Scoped rules appear once you work on a file their globs match; follow every rule listed in rules. Read a listed one with fs_read when it is relevant.",
        rules: active,
        ...(listed.length > 0 ? { listed } : {})
    };
}


module.exports = {
    RULE_DIRECTORIES,
    globToRegExp,
    loadRules,
    noteToolCall,
    pathsOfCall,
    rulesFor
};
