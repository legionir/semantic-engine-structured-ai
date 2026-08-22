const fs = require("fs");
const path = require("path");

const settings = require("../lib/storage");


/*
|--------------------------------------------------------------------------
| MCP Server Configuration
|--------------------------------------------------------------------------
|
| A server may be declared in four places, and the later one wins:
|
|   1. registry/mcp_servers.json   shipped with the runtime
|   2. <workspace>/.mcp.json       committed with the project
|   3. <workspace>/.agent/mcp.json runtime state of one workspace
|   4. MCP_SERVERS                 a JSON blob in the environment
|
| The shapes people actually have on disk differ: the Claude ecosystem
| writes {"mcpServers": {...}}, some tools write a plain object, others
| write an array. All three are accepted, because rejecting a file for
| its punctuation helps nobody.
|
| The transport is usually implied rather than stated: a command means
| stdio, a ws:// url means websocket, a url ending in /sse means the
| legacy SSE transport, and any other url means Streamable HTTP.
|--------------------------------------------------------------------------
*/

const TRANSPORT_ALIASES = {
    stdio: "stdio",
    process: "stdio",
    local: "stdio",
    http: "http",
    "streamable-http": "http",
    streamablehttp: "http",
    "http-stream": "http",
    rest: "http",
    sse: "sse",
    "http+sse": "sse",
    eventsource: "sse",
    ws: "websocket",
    wss: "websocket",
    websocket: "websocket"
};

const SOURCES = {
    REGISTRY: "registry",
    PROJECT: "project",
    WORKSPACE: "workspace",
    ENVIRONMENT: "environment",
    RUNTIME: "runtime"
};


const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;


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


function inferTransport(definition) {

    const declared =
        definition.transport ||
        definition.type ||
        definition.protocol;

    if (declared) {

        const resolved =
            TRANSPORT_ALIASES[String(declared).toLowerCase()];

        if (!resolved) {

            throw new Error(
                `unknown transport "${declared}"; use one of: ${
                    [...new Set(Object.values(TRANSPORT_ALIASES))].join(", ")
                }`
            );
        }

        return resolved;
    }

    if (definition.command) {
        return "stdio";
    }

    const url =
        definition.url || definition.endpoint || definition.serverUrl;

    if (!url) {

        throw new Error(
            "needs either a command (stdio) or a url (http, sse, websocket)"
        );
    }

    let parsed;

    try {

        parsed = new URL(url);

    } catch {

        throw new Error(`url "${url}" is not a valid URL`);
    }

    if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
        return "websocket";
    }

    if (/(^|\/)sse\/?$/.test(parsed.pathname)) {
        return "sse";
    }

    return "http";
}


/*
| A value like "${env:GITHUB_TOKEN}" or "${GITHUB_TOKEN}" is read from
| the environment when the configuration is loaded, so a token never has
| to be written into a file that lives in a repository.
*/

function expand(value) {

    if (typeof value !== "string") {
        return value;
    }

    return value.replace(
        /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g,
        (whole, name) => {

            const found = process.env[name];

            return found === undefined ? whole : found;
        }
    );
}


function expandDeep(value) {

    if (typeof value === "string") {
        return expand(value);
    }

    if (Array.isArray(value)) {
        return value.map(expandDeep);
    }

    if (value && typeof value === "object") {

        return Object.fromEntries(
            Object.entries(value).map(
                ([key, item]) => [key, expandDeep(item)]
            )
        );
    }

    return value;
}


function normalizeStringList(value) {

    if (!value) {
        return null;
    }

    const list =
        Array.isArray(value)
            ? value
            : String(value).split(",");

    const cleaned =
        list
            .map(item => String(item).trim())
            .filter(item => item.length > 0);

    return cleaned.length > 0 ? cleaned : null;
}


function normalize(name, rawDefinition, context) {

    const definition =
        expandDeep(rawDefinition || {});

    const serverName =
        String(name || definition.name || "").trim();

    if (!NAME_PATTERN.test(serverName)) {

        throw new Error(
            `"${serverName}" is not a usable server name; use letters, digits, dot, dash or underscore`
        );
    }

    const transport =
        inferTransport(definition);

    const url =
        definition.url || definition.endpoint || definition.serverUrl || null;

    const config = {
        name: serverName,

        transport,

        enabled:
            definition.enabled !== false && definition.disabled !== true,

        source:
            context.source,

        origin:
            context.origin || null,

        builtin:
            Boolean(definition.builtin),

        description:
            definition.description || null,

        /*
        | An approval policy per server, because a server that only
        | reads a code index and one that can post to an issue tracker
        | do not deserve the same trust.
        */

        trust:
            definition.trust === "trusted" || definition.trusted === true
                ? "trusted"
                : definition.trust === "restricted"
                    ? "restricted"
                    : "default",

        /*
        | A server may expose fifty tools when the run needs three, so
        | the catalogue can be narrowed before the model ever sees it.
        */

        include:
            normalizeStringList(definition.include || definition.tools),

        exclude:
            normalizeStringList(definition.exclude),

        timeouts: {
            connect:
                Number(definition.connectTimeoutMs) ||
                Number(definition.connect_timeout_ms) ||
                undefined,

            list:
                Number(definition.listTimeoutMs) ||
                Number(definition.list_timeout_ms) ||
                undefined,

            call:
                Number(definition.callTimeoutMs) ||
                Number(definition.call_timeout_ms) ||
                Number(definition.timeout) ||
                undefined
        }
    };

    if (transport === "stdio") {

        config.command = definition.command;

        config.args =
            Array.isArray(definition.args)
                ? definition.args.map(String)
                : [];

        config.cwd =
            definition.cwd || context.workspaceRoot || process.cwd();

        config.env =
            definition.env && typeof definition.env === "object"
                ? Object.fromEntries(
                    Object.entries(definition.env).map(
                        ([key, value]) => [key, String(value)]
                    )
                )
                : {};

        if (!config.command) {

            throw new Error(
                "a stdio server needs a command"
            );
        }

    } else {

        if (!url) {

            throw new Error(
                `a ${transport} server needs a url`
            );
        }

        config.url = url;

        config.headers =
            definition.headers && typeof definition.headers === "object"
                ? Object.fromEntries(
                    Object.entries(definition.headers).map(
                        ([key, value]) => [String(key).toLowerCase(), String(value)]
                    )
                )
                : {};

        config.token =
            definition.token || definition.apiKey || definition.api_key || null;
    }

    return config;
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
                normalize(name, definition, context);

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


function load(workspaceRoot) {

    const root =
        workspaceRoot || process.cwd();

    const servers = new Map();

    const problems = [];

    const layers = [
        {
            source: SOURCES.REGISTRY,
            file: registryFile()
        },
        {
            source: SOURCES.PROJECT,
            file: projectFile(root)
        },
        {
            source: SOURCES.WORKSPACE,
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
                    source: SOURCES.ENVIRONMENT,
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
| Used by mcp_add and by the console when a server is declared at
| runtime rather than in a file.
*/

function normalizeOne(name, definition, workspaceRoot) {

    return normalize(
        name,
        definition,
        {
            source: SOURCES.RUNTIME,
            origin: "runtime",
            workspaceRoot: workspaceRoot || process.cwd()
        }
    );
}


/*
| Writing a server back to disk keeps it for the next run. The workspace
| file is used rather than the project one, because a server added at
| runtime is a local decision until someone commits it.
*/

function persist(workspaceRoot, config) {

    const file =
        workspaceFile(workspaceRoot || process.cwd());

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
        workspaceFile(workspaceRoot || process.cwd());

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
    SOURCES,
    TRANSPORT_ALIASES,
    load,
    normalizeOne,
    persist,
    forget,
    registryFile,
    projectFile,
    workspaceFile,
    expand
};
