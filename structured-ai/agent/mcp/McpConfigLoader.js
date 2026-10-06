"use strict";

/*
|--------------------------------------------------------------------------
| MCP config loader — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| A server may be declared in four places, and the later one wins:
|
|   1. registry/mcp_servers.json   shipped with the runtime
|   2. <workspace>/.mcp.json       committed with the project
|   3. <workspace>/.agent/mcp.json runtime state of one workspace
|   4. MCP_SERVERS                 a JSON blob in the environment
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const settings = require("../config");

const validator = require("./McpConfigValidator");


function registryFile() {

    return path.join(
        __dirname, "..", "registry", "mcp_servers.json"
    );
}


function projectFile(workspaceRoot) {

    return path.join(workspaceRoot, ".mcp.json");
}


function workspaceFile(workspaceRoot) {

    return path.join(workspaceRoot, ".agent", "mcp.json");
}


function readJsonFile(file) {

    if (!fs.existsSync(file)) {
        return null;
    }

    try {

        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );

    } catch (error) {

        throw new Error(
            `${file} is not readable JSON: ${error.message}`
        );
    }
}


/*
| Every accepted container shape is turned into the same list of
| [name, definition] pairs before anything is validated.
*/

function entriesOf(document) {

    if (!document) {
        return [];
    }

    if (Array.isArray(document)) {

        return document.map(
            entry => [entry && entry.name, entry]
        );
    }

    if (typeof document !== "object") {
        return [];
    }

    const container =
        document.mcpServers ||
        document.mcp_servers ||
        document.servers ||
        document;

    if (Array.isArray(container)) {

        return container.map(
            entry => [entry && entry.name, entry]
        );
    }

    return Object.entries(container).filter(
        ([, value]) =>
            value && typeof value === "object" && !Array.isArray(value)
    );
}


/*
| One layer of configuration: whatever the document held, normalized,
| with the problems collected rather than thrown, because one broken
| entry must not hide the servers that are fine.
*/

function loadDocument(document, context, into, problems) {

    for (const [name, definition] of entriesOf(document)) {

        try {

            const config =
                validator.normalize(name, definition, context);

            into.set(config.name, config);

        } catch (error) {

            problems.push(
                `${context.origin || context.source}: ${
                    name || "(unnamed)"
                } was skipped, ${error.message}`
            );
        }
    }
}


function environmentDocument() {

    const raw =
        settings.get("MCP_SERVERS");

    if (!raw || String(raw).trim() === "") {
        return null;
    }

    try {

        return JSON.parse(raw);

    } catch (error) {

        throw new Error(
            `MCP_SERVERS is not valid JSON: ${error.message}`
        );
    }
}


/*
| The workspace root is REQUIRED (plan phase 6 / step 3). Falling back to
| process.cwd() silently read the first workspace's .mcp.json for every
| project; the caller (McpManager, bound to a project) always knows its root.
*/
function requireRoot(workspaceRoot) {

    if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {

        throw new Error("MCP configuration needs an explicit workspaceRoot");
    }

    return workspaceRoot;
}


function load(workspaceRoot) {

    const root =
        requireRoot(workspaceRoot);

    const servers = new Map();

    const problems = [];

    const layers = [
        {
            source: validator.SOURCES.REGISTRY,
            file: registryFile()
        },
        {
            source: validator.SOURCES.PROJECT,
            file: projectFile(root)
        },
        {
            source: validator.SOURCES.WORKSPACE,
            file: workspaceFile(root)
        }
    ];

    for (const layer of layers) {

        let document;

        try {

            document = readJsonFile(layer.file);

        } catch (error) {

            problems.push(error.message);

            continue;
        }

        if (!document) {
            continue;
        }

        loadDocument(
            document,
            {
                source: layer.source,
                origin: layer.file,
                workspaceRoot: root
            },
            servers,
            problems
        );
    }

    try {

        const fromEnvironment =
            environmentDocument();

        if (fromEnvironment) {

            loadDocument(
                fromEnvironment,
                {
                    source: validator.SOURCES.ENVIRONMENT,
                    origin: "MCP_SERVERS",
                    workspaceRoot: root
                },
                servers,
                problems
            );
        }

    } catch (error) {

        problems.push(error.message);
    }

    return {
        servers: [...servers.values()],
        problems
    };
}


/*
| Writing a server back to disk keeps it for the next run. The workspace
| file is used rather than the project one, because a server added at
| runtime is a local decision until someone commits it.
*/

function persist(workspaceRoot, config) {

    const file =
        workspaceFile(requireRoot(workspaceRoot));

    const document =
        readJsonFile(file) || { mcpServers: {} };

    const container =
        document.mcpServers ||
        document.mcp_servers ||
        document.servers ||
        document;

    const stored = {
        transport: config.transport,
        description: config.description || undefined,
        trust: config.trust === "default" ? undefined : config.trust,
        include: config.include || undefined,
        exclude: config.exclude || undefined
    };

    if (config.transport === "stdio") {

        stored.command = config.command;
        stored.args = config.args && config.args.length ? config.args : undefined;
        stored.cwd = config.cwd || undefined;
        stored.env =
            config.env && Object.keys(config.env).length ? config.env : undefined;

    } else {

        stored.url = config.url;
        stored.headers =
            config.headers && Object.keys(config.headers).length
                ? config.headers
                : undefined;
    }

    container[config.name] =
        JSON.parse(JSON.stringify(stored));

    if (!document.mcpServers && !document.mcp_servers && !document.servers) {

        fs.mkdirSync(path.dirname(file), { recursive: true });

        fs.writeFileSync(
            file,
            `${JSON.stringify({ mcpServers: container }, null, 2)}\n`,
            "utf8"
        );

        return file;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });

    fs.writeFileSync(
        file,
        `${JSON.stringify(document, null, 2)}\n`,
        "utf8"
    );

    return file;
}


function forget(workspaceRoot, name) {

    const file =
        workspaceFile(requireRoot(workspaceRoot));

    const document =
        readJsonFile(file);

    if (!document) {
        return false;
    }

    const container =
        document.mcpServers ||
        document.mcp_servers ||
        document.servers ||
        document;

    if (!Object.prototype.hasOwnProperty.call(container, name)) {
        return false;
    }

    delete container[name];

    fs.writeFileSync(
        file,
        `${JSON.stringify(document, null, 2)}\n`,
        "utf8"
    );

    return true;
}


module.exports = {
    registryFile,
    projectFile,
    workspaceFile,
    readJsonFile,
    entriesOf,
    loadDocument,
    environmentDocument,
    load,
    persist,
    forget
};
