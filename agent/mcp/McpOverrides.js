"use strict";

/*
|--------------------------------------------------------------------------
| Operator overrides for MCP servers (roadmap P4-07)
|--------------------------------------------------------------------------
|
| The console's per-tool switches, approval rules and agent / project
| limits apply to a server wherever it was declared — the bundled
| registry, MCP_SERVERS, a repository .mcp.json or the user file — so
| they are kept apart from every one of those, in
| <data home>/mcp-overrides.json:
|
|   { "servers": { "<name>": {
|       "disabled_tools": ["delete_issue"],
|       "approval": { "read": "never", "write": "always" },
|       "agents": ["main_agent"],
|       "projects": ["p_123"]
|   } } }
|
| The file is the operator's (the data home, not the workspace), so its
| approval may loosen a repository server's. apply() folds an override
| into a normalized config; the manager reloads when the file changes
| (McpConfigLoader.changes).
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const CONTROL_FIELDS = ["exclude", "agents", "approval", "scope", "projects"];


function overridesFile() {

    return path.join(require("../projects/ProjectStore").resolveDataHome(), "mcp-overrides.json");
}


function readAll() {

    try {
        const document = JSON.parse(fs.readFileSync(overridesFile(), "utf8"));
        return document && typeof document.servers === "object" && document.servers ? document.servers : {};
    } catch {
        return {};
    }
}


function get(name) {

    const all = readAll();

    return Object.prototype.hasOwnProperty.call(all, name) ? all[name] : null;
}


function listOf(value, field) {

    if (value === undefined || value === null) return undefined;

    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.trim() === "")) {
        throw new Error(`${field} must be a list of names`);
    }

    return [...new Set(value.map(item => item.trim()))];
}


/* a patch from the console: only the fields it names change; null clears one */
function set(name, patch = {}) {

    const validator = require("./McpConfigValidator");

    if (!validator.NAME_PATTERN.test(String(name || ""))) {
        throw new Error(`"${name}" is not a server name`);
    }

    const all = readAll();
    const current = { ...(all[name] || {}) };

    for (const [field, check] of [
        ["disabled_tools", value => listOf(value, "disabled_tools")],
        ["agents", value => listOf(value, "agents")],
        ["projects", value => listOf(value, "projects")],
        ["approval", value => validator.normalizeApproval(value)]
    ]) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;

        if (patch[field] === null) {
            delete current[field];
        } else {
            current[field] = check(patch[field]);
        }
    }

    if (patch.tool !== undefined) {

        /* {tool, enabled}: one switch */
        const tool = String(patch.tool);
        const disabled = new Set(current.disabled_tools || []);

        if (patch.enabled === false) disabled.add(tool);
        else disabled.delete(tool);

        current.disabled_tools = [...disabled].sort();
    }

    for (const field of Object.keys(current)) {
        const value = current[field];
        if (Array.isArray(value) && value.length === 0) delete current[field];
    }

    if (current.approval && current.approval.read === "inherit" && current.approval.write === "inherit") {
        delete current.approval;
    }

    if (Object.keys(current).length === 0) delete all[name];
    else all[name] = current;

    const file = overridesFile();
    const loader = require("./McpConfigLoader");

    fs.mkdirSync(path.dirname(file), { recursive: true });
    loader.writePrivateFile(file, `${JSON.stringify({ servers: all }, null, 2)}\n`);
    loader.changes.emit("change", { file });

    return all[name] || {};
}


function remove(name) {

    const all = readAll();

    if (!Object.prototype.hasOwnProperty.call(all, name)) return false;

    delete all[name];

    const loader = require("./McpConfigLoader");
    loader.writePrivateFile(overridesFile(), `${JSON.stringify({ servers: all }, null, 2)}\n`);
    loader.changes.emit("change", { file: overridesFile() });

    return true;
}


/* the config as the operator narrowed it; never widens include */
function apply(config, override = get(config.name)) {

    if (!override) return config;

    const out = { ...config };

    if (Array.isArray(override.disabled_tools) && override.disabled_tools.length > 0) {
        out.exclude = [...new Set([...(config.exclude || []), ...override.disabled_tools])];
    }

    if (Array.isArray(override.agents) && override.agents.length > 0) {
        out.agents = override.agents;
    }

    if (Array.isArray(override.projects) && override.projects.length > 0) {
        out.scope = "project";
        out.projects = override.projects;
    }

    if (override.approval) {
        out.approval = { ...(config.approval || {}), ...override.approval };
    }

    return out;
}


module.exports = { CONTROL_FIELDS, overridesFile, readAll, get, set, remove, apply };
