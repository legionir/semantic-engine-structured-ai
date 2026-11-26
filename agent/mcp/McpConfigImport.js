"use strict";

/*
|--------------------------------------------------------------------------
| Importing another client's MCP configuration (roadmap P4-05)
|--------------------------------------------------------------------------
|
| The JSON other clients keep their servers in, pasted or uploaded:
|
|   Claude Desktop, Cursor, Windsurf, Cline   { "mcpServers": { … } }
|   VS Code (.vscode/mcp.json)                { "servers": { … }, "inputs": [ … ] }
|   VS Code settings.json                     { "mcp": { "servers": { … } } }
|   Zed                                       { "context_servers": { … } }
|   a single server                           { "command": …, "args": … } with ?name=
|
| preview() reads it and says, per server, what merging would do: new,
| identical to what is configured, a conflict (the same name, another
| definition) or invalid (the validator's exact reason). merge() writes
| the chosen ones into the user or the workspace file; a conflict without
| a resolution (skip, replace, or rename to a free name) stops the merge,
| so a duplicate is always the operator's decision.
|
| Comments and trailing commas (JSONC, as VS Code writes) are accepted;
| any other syntax error names the line and column.
|--------------------------------------------------------------------------
*/

const validator = require("./McpConfigValidator");
const loader = require("./McpConfigLoader");


/* JSONC → JSON: comments and trailing commas outside strings */
function stripJsonc(text) {

    let out = "";
    let inString = false;

    for (let index = 0; index < text.length; index++) {

        const char = text[index];
        const next = text[index + 1];

        if (inString) {
            out += char;
            if (char === "\\") {
                out += next || "";
                index++;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            out += char;
            continue;
        }

        if (char === "/" && next === "/") {
            while (index < text.length && text[index] !== "\n") index++;
            out += "\n";
            continue;
        }

        if (char === "/" && next === "*") {
            index += 2;
            while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
                out += text[index] === "\n" ? "\n" : " ";
                index++;
            }
            index++;
            continue;
        }

        out += char;
    }

    /* a comma before } or ] — outside strings, since strings are intact */
    return out.replace(/,(\s*[}\]])/g, "$1");
}


function position(text, offset) {

    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");

    return { line, column };
}


function parseText(text) {

    if (typeof text !== "string" || text.trim() === "") {
        throw Object.assign(new Error("the configuration is empty; paste the JSON of another client's MCP config"), { status: 400 });
    }

    const cleaned = stripJsonc(text.replace(/^\uFEFF/, ""));

    try {
        return JSON.parse(cleaned);
    } catch (error) {
        const match = /position (\d+)/.exec(error.message);
        const where = match ? position(cleaned, Number(match[1])) : null;
        const lineMatch = /line (\d+) column (\d+)/.exec(error.message);
        const at = where
            ? ` at line ${where.line}, column ${where.column}`
            : lineMatch ? ` at line ${lineMatch[1]}, column ${lineMatch[2]}` : "";
        throw Object.assign(
            new Error(`not valid JSON${at}: ${error.message.replace(/ in JSON at position \d+.*$/, "").replace(/^Unexpected/, "unexpected")}`),
            { status: 400 }
        );
    }
}


/* which client wrote it, and where its servers are */
function containerOf(document, name) {

    if (!document || typeof document !== "object" || Array.isArray(document)) {
        throw Object.assign(new Error("the configuration must be a JSON object"), { status: 400 });
    }

    const candidates = [
        ["mcpServers", document.mcpServers, "Claude Desktop / Cursor"],
        ["servers", document.servers, "VS Code"],
        ["mcp_servers", document.mcp_servers, "structured-ai"],
        ["context_servers", document.context_servers, "Zed"],
        ["mcp.servers", document.mcp && document.mcp.servers, "VS Code settings"]
    ];

    for (const [key, value, client] of candidates) {
        if (value === undefined) continue;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw Object.assign(new Error(`"${key}" must be an object of servers by name, not ${Array.isArray(value) ? "an array" : typeof value}`), { status: 400 });
        }
        return { key, client, servers: value };
    }

    if (typeof document.command === "string" || typeof document.url === "string") {
        if (!name) {
            throw Object.assign(new Error("this is a single server definition; give it a name to import it"), { status: 400 });
        }
        return { key: null, client: "single server", servers: { [name]: document } };
    }

    throw Object.assign(
        new Error('no MCP servers found: expected an object under "mcpServers", "servers", "context_servers" or "mcp.servers"'),
        { status: 400 }
    );
}


/* another client's spelling of a definition → this runtime's */
function translate(definition) {

    const out = { ...definition };

    /* Zed: {"command": {"path": "npx", "args": [...], "env": {...}}} */
    if (out.command && typeof out.command === "object" && !Array.isArray(out.command)) {
        const command = out.command;
        out.command = command.path || command.command;
        if (command.args && !out.args) out.args = command.args;
        if (command.env && !out.env) out.env = command.env;
    }

    /* VS Code / Cursor: "type": "http" | "sse" | "stdio"; Windsurf: serverUrl */
    if (out.type && !out.transport) {
        out.transport = out.type === "streamable-http" || out.type === "streamableHttp" ? "http" : out.type;
    }
    delete out.type;

    if (out.serverUrl && !out.url) {
        out.url = out.serverUrl;
    }
    delete out.serverUrl;

    /* Claude Desktop: "disabled": true; Cline: "disabled", "autoApprove" */
    if (out.disabled === true) out.enabled = false;
    delete out.disabled;
    delete out.autoApprove;
    delete out.alwaysAllow;

    return out;
}


/* ${input:id} (VS Code) has no value here: such a server needs editing */
function inputPlaceholders(definition) {

    const found = new Set();
    const text = JSON.stringify(definition);
    const pattern = /\$\{input:([^}]+)\}/g;
    let match;

    while ((match = pattern.exec(text))) found.add(match[1]);

    return [...found];
}


function describe(config) {

    return config.transport === "stdio"
        ? [config.command, ...(config.args || [])].join(" ")
        : config.url;
}


function existingDefinitions(manager) {

    const existing = new Map();

    try {
        manager.load();
        for (const client of manager.clients.values()) {
            existing.set(client.name, client.config);
        }
    } catch {
        /* nothing configured yet */
    }

    return existing;
}


function comparable(config) {

    const copy = { ...config };
    for (const field of ["source", "origin", "cwd", "description"]) delete copy[field];
    return JSON.stringify(copy);
}


/*
| What merging would do, server by server. Nothing is written and nothing
| is started; a server's command is shown so the operator sees what would run.
*/
function preview(text, { manager, name = null, workspaceRoot = null } = {}) {

    const document = parseText(text);
    const { client, servers, key } = containerOf(document, name);
    const existing = existingDefinitions(manager);
    const root = workspaceRoot || (manager && (manager.workspaceRoot || manager.boundRoot)) || process.cwd();

    const entries = Object.entries(servers).map(([serverName, raw]) => {

        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return { name: serverName, status: "invalid", error: `"${serverName}" must be an object, not ${Array.isArray(raw) ? "an array" : typeof raw}` };
        }

        const definition = translate(raw);
        const inputs = inputPlaceholders(definition);
        let config;

        try {
            /* checked as the operator would save it: ${secret:…} kept as written */
            config = validator.normalizeOne(serverName, definition, root, { secrets: true, expandSecrets: false });
        } catch (error) {
            return { name: serverName, status: "invalid", error: `${serverName}: ${error.message}`, definition };
        }

        const current = existing.get(config.name);
        const status = !current
            ? "new"
            : comparable(current) === comparable({ ...config, enabled: current.enabled })
                ? "identical"
                : "conflict";

        return {
            name: config.name,
            status,
            transport: config.transport,
            runs: describe(config),
            enabled: config.enabled,
            existing: current ? { source: current.source, transport: current.transport, runs: describe(current) } : null,
            needs_input: inputs.length ? inputs : undefined,
            definition
        };
    });

    return {
        client,
        key,
        count: entries.length,
        taken: [...existing.keys()],
        entries,
        summary: {
            new: entries.filter(entry => entry.status === "new").length,
            identical: entries.filter(entry => entry.status === "identical").length,
            conflict: entries.filter(entry => entry.status === "conflict").length,
            invalid: entries.filter(entry => entry.status === "invalid").length
        }
    };
}


/*
| resolutions: { name: "skip" | "replace" | "rename:<new name>" }. A new
| server is added unless skipped; an identical one is left alone; a
| conflict needs a resolution, and without one nothing is written (409).
| An invalid server stops the merge unless it is skipped.
*/
function plan(previewed, resolutions = {}, { only = null } = {}) {

    const writes = [];
    const unresolved = [];
    const invalid = [];
    const skipped = [];
    const names = new Set(previewed.entries.map(entry => entry.name));

    for (const entry of previewed.entries) {

        if (Array.isArray(only) && !only.includes(entry.name)) {
            skipped.push(entry.name);
            continue;
        }

        const resolution = resolutions[entry.name];

        if (resolution === "skip") {
            skipped.push(entry.name);
            continue;
        }

        if (entry.status === "invalid") {
            invalid.push({ name: entry.name, error: entry.error });
            continue;
        }

        if (entry.status === "identical") {
            skipped.push(entry.name);
            continue;
        }

        if (entry.status === "new") {
            writes.push({ name: entry.name, definition: entry.definition });
            continue;
        }

        /* conflict */
        if (resolution === "replace") {
            writes.push({ name: entry.name, definition: entry.definition, replaced: true });
            continue;
        }

        if (typeof resolution === "string" && resolution.startsWith("rename:")) {

            const target = resolution.slice("rename:".length).trim();

            if (!validator.NAME_PATTERN.test(target)) {
                invalid.push({ name: entry.name, error: `"${target}" is not a usable server name` });
                continue;
            }

            if (names.has(target) || (previewed.taken || []).includes(target)) {
                invalid.push({ name: entry.name, error: `"${target}" is already taken` });
                continue;
            }

            names.add(target);
            writes.push({ name: target, definition: entry.definition, renamed_from: entry.name });
            continue;
        }

        unresolved.push({ name: entry.name, existing: entry.existing, incoming: { transport: entry.transport, runs: entry.runs } });
    }

    return { writes, unresolved, invalid, skipped };
}


/* writes the planned servers into one file, kept as written (placeholders too) */
function write(target, workspaceRoot, writes) {

    const fs = require("fs");
    const path = require("path");

    const file = target === "user" ? loader.userFile() : loader.workspaceFile(workspaceRoot);

    if (target !== "user") {
        const references = require("../secrets/SecretStore").referencesIn(writes.map(item => item.definition));
        if (references.size > 0) {
            throw Object.assign(
                new Error("${secret:NAME} references are not allowed in the workspace file (.agent/mcp.json); import into the user config instead"),
                { status: 400 }
            );
        }
    }

    const document = loader.readJsonFile(file) || { mcpServers: {} };
    const container = document.mcpServers || document.mcp_servers || document.servers || (document.mcpServers = {});

    for (const item of writes) {
        container[item.name] = JSON.parse(JSON.stringify(item.definition));
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    loader.writePrivateFile(file, `${JSON.stringify(document, null, 2)}\n`);

    if (target === "user") {
        loader.changes.emit("change", { file });
    }

    return file;
}


module.exports = { stripJsonc, parseText, containerOf, translate, inputPlaceholders, preview, plan, write };
