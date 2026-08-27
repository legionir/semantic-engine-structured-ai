"use strict";

const fs = require("fs");
const path = require("path");


/*
|--------------------------------------------------------------------------
| Registry Loader — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
|
| Live-reload (mtime + size) of the declarative registries. Tool schemas
| are split under tool-schemas/ and concatenated into the same array
| tools.json used to be; the other files stay where they were.
|--------------------------------------------------------------------------
*/

const ROOT = path.join(__dirname, "..");
const REGISTRY_DIR = __dirname;
const SCHEMA_DIR = path.join(ROOT, "schema");
const RUNTIME_DIR = path.join(ROOT, "runtime");
const TOOL_SCHEMA_DIR = path.join(REGISTRY_DIR, "tool-schemas");

const TOOL_SCHEMA_FILES = [
    "filesystem.json",
    "search.json",
    "process.json",
    "git.json",
    "network.json",
    "introspection.json",
    "planning.json",
    "memory.json",
    "knowledge.json",
    "code.json",
    "mcp.json",
    "discussion.json"
];


function toolSchemaPaths() {

    return TOOL_SCHEMA_FILES.map(name => path.join(TOOL_SCHEMA_DIR, name));

}


function registryFiles(schemaFileName) {

    return {
        PERSONAS: path.join(REGISTRY_DIR, "personas.json"),
        SKILLS: path.join(REGISTRY_DIR, "skills.json"),
        TOOL_GROUPS: path.join(REGISTRY_DIR, "tool_groups.json"),
        POLICY: path.join(REGISTRY_DIR, "policy.json"),
        AGENTS: path.join(REGISTRY_DIR, "agents.json"),
        RESPONSE_FORMAT: path.join(SCHEMA_DIR, schemaFileName),
        CONFIGURED_RUNTIME: path.join(RUNTIME_DIR, "runtime_context.json")
    };

}


function stampOf(file) {

    try {

        const stats = fs.statSync(file);

        return `${file}:${stats.mtimeMs}:${stats.size}`;

    } catch {

        return `${file}:missing`;

    }

}


function signatureOf(schemaFileName) {

    const files = [
        ...Object.values(registryFiles(schemaFileName)),
        ...toolSchemaPaths()
    ];

    return files.map(stampOf).join("|");

}


function readJSON(file) {

    let text;

    try {

        text = fs.readFileSync(file, "utf8");

    } catch (error) {

        throw new Error(
            `Registry file ${file} could not be read: ${error.message}`
        );

    }

    try {

        return JSON.parse(text);

    } catch (error) {

        throw new Error(
            `Registry file ${file} is invalid JSON: ${error.message}`
        );

    }

}


function loadToolSchemas() {

    const tools = [];

    for (const file of toolSchemaPaths()) {

        const parsed = readJSON(file);

        if (!Array.isArray(parsed)) {

            throw new Error(
                `Registry file ${file} must be a JSON array of tool schemas.`
            );

        }

        tools.push(...parsed);

    }

    return tools;

}


function load(schemaFileName) {

    const files = registryFiles(schemaFileName);
    const data = {};

    for (const [name, file] of Object.entries(files)) {

        data[name] = readJSON(file);

    }

    data.TOOLS = loadToolSchemas();

    return data;

}


module.exports = {
    TOOL_SCHEMA_FILES,
    TOOL_SCHEMA_DIR,
    registryFiles,
    toolSchemaPaths,
    signatureOf,
    loadToolSchemas,
    load,
    readJSON
};
