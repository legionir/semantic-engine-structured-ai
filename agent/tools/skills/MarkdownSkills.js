"use strict";

/*
|--------------------------------------------------------------------------
| SKILL.md skills (roadmap P3-02)
|--------------------------------------------------------------------------
|
| The open SKILL.md layout many agents share: a directory per skill with
| a SKILL.md whose YAML front matter names and describes it, a Markdown
| body that is the procedure, and any other files as resources.
|
|   ---
|   name: pdf-forms
|   description: Fill and inspect PDF forms.
|   triggers: [pdf, form]          (optional: words that suggest it)
|   mcp_server: browser            (optional: shown only while that
|                                   MCP server is configured)
|   ---
|   # How to ...
|   Current branch: !`git branch --show-current`
|
| !`command` in the body is replaced by the command's output when the
| skill is loaded with skill_get (see renderCommands for the policy).
|
| Looked up, highest precedence first, in
|
|   <workspace>/.agent/skills/<dir>/SKILL.md    this project
|   <workspace>/.claude/skills/<dir>/SKILL.md   this project, the layout
|                                                other agents write
|   <data home>/skills/<dir>/SKILL.md           every project on this host
|   agent/skills/<dir>/SKILL.md                 shipped with the runtime
|   agent/skill-library/<lib>/<dir>/SKILL.md    shipped third-party libraries
|                                                (SkillLibrary.js)
|
| A name already taken by a registry skill (skills.json, skill.json) is
| skipped, so a repository cannot replace a built-in procedure under its
| own name. Directories are scanned on every call, which is what makes an
| edited or added skill visible without a restart; the scan is a handful
| of readdir/stat calls.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const settings = require("../../config");
const { isInsideRoot } = require("../../context/WorkspaceBoundary");
const { logs } = require("../../runtime/LogStore");

const SKILL_FILE = "SKILL.md";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const reported = new Set();


function reportOnce(key, message, details) {

    if (reported.has(key)) return;

    reported.add(key);
    logs.warn("skills", message, details);

}


const DOUBLE_QUOTE_ESCAPES = { "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };


/* `[a, b]`, `"a"`, `a` -> string or string[] */
function scalar(raw) {

    const value = raw.trim();

    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).split(",").map(item => scalar(item)).filter(item => item !== "");
    }

    /* YAML double quotes take backslash escapes, single quotes double themselves */
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
        return value.slice(1, -1).replace(/\\(["\\/bfnrt])/g, (whole, char) => DOUBLE_QUOTE_ESCAPES[char]);
    }

    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }

    return value;

}


/*
| The front matter subset skills use: `key: value`, `key: [a, b]`, a key
| followed by `- item` lines, `>`/`|` blocks folded into one line, and a
| key followed by indented `key: value` lines (one level, e.g. metadata).
| Nothing here evaluates YAML.
*/
function parseFrontMatter(text) {

    const source = String(text).replace(/^\uFEFF/, "");
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);

    if (!match) {
        return { meta: {}, body: source.trim() };
    }

    const meta = {};
    let current = null;
    /* a key with nothing after the colon may open a list or a nested map */
    let opened = false;

    for (const line of match[1].split(/\r?\n/)) {

        const item = /^\s+-\s+(.*)$/.exec(line);

        if (item && current) {
            meta[current] = [...(Array.isArray(meta[current]) ? meta[current] : []), scalar(item[1])];
            continue;
        }

        const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);

        if (pair) {
            current = pair[1].toLowerCase();
            const value = pair[2].trim();
            opened = value === "";
            meta[current] = value === "" || value === ">" || value === "|" ? "" : scalar(value);
            continue;
        }

        const nested = /^\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);

        if (nested && current && (opened || isPlainObject(meta[current]))) {
            meta[current] = { ...(isPlainObject(meta[current]) ? meta[current] : {}), [nested[1].toLowerCase()]: scalar(nested[2]) };
            opened = false;
            continue;
        }

        if (current && /^\s+\S/.test(line) && typeof meta[current] === "string") {
            meta[current] = `${meta[current]} ${line.trim()}`.trim();
        }
    }

    return { meta, body: source.slice(match[0].length).trim() };

}


function isPlainObject(value) {

    return Boolean(value) && typeof value === "object" && !Array.isArray(value);

}


function listResources(root, limit = 50) {

    const found = [];
    const queue = [{ directory: root, depth: 0 }];

    while (queue.length > 0 && found.length < limit) {

        const { directory, depth } = queue.shift();
        let entries = [];

        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {

            const full = path.join(directory, entry.name);

            if (entry.isDirectory() && depth < 3 && !entry.name.startsWith(".")) {
                queue.push({ directory: full, depth: depth + 1 });
            } else if (entry.isFile() && !(depth === 0 && entry.name === SKILL_FILE)) {
                const id = path.relative(root, full).split(path.sep).join("/");
                found.push({ id, title: id, file: id });
            }

            if (found.length >= limit) break;
        }
    }

    return found;

}


function readSkill(directory, origin) {

    const file = path.join(directory, SKILL_FILE);
    let text;

    try {
        if (!fs.statSync(file).isFile()) return null;
        text = fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }

    const { meta, body } = parseFrontMatter(text);
    const name = typeof meta.name === "string" && meta.name !== "" ? meta.name : path.basename(directory);
    const description = typeof meta.description === "string" ? meta.description.trim() : "";

    if (!NAME_PATTERN.test(name) || description === "") {
        reportOnce(`invalid:${file}`, `${file} is skipped: a skill needs a name (letters, digits, _ . -) and a description in its front matter`, { file });
        return null;
    }

    const triggers = (Array.isArray(meta.triggers) ? meta.triggers : typeof meta.triggers === "string" && meta.triggers ? meta.triggers.split(",") : [])
        .map(item => String(item).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20);

    const server = typeof meta.mcp_server === "string" && meta.mcp_server !== "" ? meta.mcp_server : null;

    /* e.g. metadata.type: SUPERVISOR / EXECUTOR / COMPOSITE (persona library) */
    const kind = isPlainObject(meta.metadata) && typeof meta.metadata.type === "string" && meta.metadata.type !== ""
        ? meta.metadata.type.toLowerCase()
        : null;

    return {
        name,
        description: description.slice(0, 500),
        format: "SKILL.md",
        origin,
        ...(triggers.length > 0 ? { triggers } : {}),
        ...(server ? { requires: { mcp_server: server } } : {}),
        ...(kind ? { kind } : {}),
        markdown: body,
        resources: listResources(directory),
        root: directory
    };

}


function activeWorkspaceRoot() {

    try {
        const { effectiveProject } = require("../../runtime/ProjectOverride");
        const project = effectiveProject();
        if (project && (project.workspaceRoot || project.rootPath)) return project.workspaceRoot || project.rootPath;
    } catch {
        /* outside a run */
    }

    return require("../../context/WorkspaceBoundary").WORKSPACE_ROOT;

}


function skillRoots(workspaceRoot = activeWorkspaceRoot()) {

    const roots = [];

    if (typeof workspaceRoot === "string" && workspaceRoot !== "") {
        roots.push({ dir: path.join(workspaceRoot, ".agent", "skills"), origin: "project", boundary: workspaceRoot });
        roots.push({ dir: path.join(workspaceRoot, ".claude", "skills"), origin: "project", boundary: workspaceRoot });
    }

    try {
        const { resolveDataHome } = require("../../projects/ProjectStore");
        roots.push({ dir: path.join(resolveDataHome(), "skills"), origin: "user", boundary: null });
    } catch {
        /* no data home */
    }

    roots.push({ dir: path.join(__dirname, "..", "..", "skills"), origin: "builtin", boundary: null });

    return roots;

}


/* Every SKILL.md skill visible to the active workspace, deduplicated by name. */
function loadMarkdownSkills({ takenNames = new Set(), workspaceRoot } = {}) {

    if (settings.get("SKILLS_MARKDOWN_ENABLED") === false) {
        return [];
    }

    const skills = [];
    const names = new Set();

    for (const { dir, origin, boundary } of skillRoots(workspaceRoot)) {

        let entries = [];

        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        const realBoundary = boundary ? fs.realpathSync(boundary) : null;

        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {

            if (!entry.isDirectory()) continue;

            const directory = path.join(dir, entry.name);
            let real;

            try {
                real = fs.realpathSync(directory);
            } catch {
                continue;
            }

            if (realBoundary && !isInsideRoot(realBoundary, real)) continue;

            const skill = readSkill(real, origin);

            if (!skill || names.has(skill.name)) continue;

            if (takenNames.has(skill.name)) {
                reportOnce(`taken:${real}`, `${skill.name} (${path.join(directory, SKILL_FILE)}) is skipped: a registry skill already has that name`, { skill: skill.name });
                continue;
            }

            names.add(skill.name);
            skills.push(skill);
        }
    }

    /* shipped third-party libraries come last: anything above wins a name */
    for (const skill of require("./SkillLibrary").loadLibrarySkills()) {

        if (names.has(skill.name) || takenNames.has(skill.name)) continue;

        names.add(skill.name);
        skills.push(skill);
    }

    return skills;

}


/* Names of the skills whose triggers occur in the task as whole words. */
function matchTriggers(skills, task) {

    const text = String(task || "").toLowerCase();

    if (text === "") return [];

    return skills
        .filter(skill => Array.isArray(skill.triggers) && skill.triggers.some(trigger => {
            const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "u").test(text);
        }))
        .map(skill => skill.name);

}


/*
| !`command` runs only when
|   - SKILL_COMMANDS is "read-only" (the default; "off" never runs any),
|   - the skill is shipped or installed by the operator, or comes from a
|     workspace the operator has trusted (a cloned repository cannot run
|     commands just by being opened), and
|   - CommandRisk rates the line low: it only reads.
| It runs through terminal_exec, so the sandbox, the project cwd, the
| scrubbed environment and the tool telemetry all apply. Anything else is
| replaced by a note saying why it did not run.
*/
const COMMAND_TOKEN = /!`([^`\n]{1,400})`/g;

async function renderCommands(skill, toolContext) {

    const text = String(skill.markdown || "");

    if (!COMMAND_TOKEN.test(text)) return text;

    COMMAND_TOKEN.lastIndex = 0;

    const mode = settings.get("SKILL_COMMANDS");
    const trusted = skill.origin !== "project" || (() => {
        try {
            return require("../../projects/WorkspaceTrust").isTrusted(toolContext && toolContext.root ? toolContext.root : activeWorkspaceRoot());
        } catch {
            return false;
        }
    })();

    const outputs = [];

    for (const match of text.matchAll(COMMAND_TOKEN)) {

        const command = match[1].trim();
        let replacement;

        if (mode === "off") {
            replacement = "(command not run: SKILL_COMMANDS is off)";
        } else if (!trusted) {
            replacement = "(command not run: this workspace is not trusted)";
        } else if (require("../../policy/CommandRisk").classify(command).risk !== "low") {
            replacement = "(command not run: only read-only commands run in a skill)";
        } else {
            try {
                const { executeTool } = require("../ToolRuntime");
                const result = await executeTool("terminal_exec", { command, timeout_ms: 10000 }, toolContext);
                const output = String(result.stdout || "").trim() || String(result.stderr || "").trim();
                replacement = output.length > 2000 ? `${output.slice(0, 2000)}…` : output;
            } catch (error) {
                replacement = `(command failed: ${String(error.message || error).slice(0, 200)})`;
            }
        }

        outputs.push(replacement);
    }

    let index = 0;

    return text.replace(COMMAND_TOKEN, () => outputs[index++]);

}


module.exports = {
    SKILL_FILE,
    renderCommands,
    parseFrontMatter,
    readSkill,
    skillRoots,
    loadMarkdownSkills,
    matchTriggers
};
