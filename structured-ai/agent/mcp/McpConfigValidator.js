"use strict";

/*
|--------------------------------------------------------------------------
| MCP config validator / normalizer — EXECUTION_PLAN Phase 20
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


/*
| P0-5: a configuration committed with a repository is written by
| whoever controls the repository, so it must not be able to pull the
| runtime's secrets into a URL, header or token it chose. Placeholders
| are expanded only for configuration the user wrote themselves
| (registry, .agent/mcp.json, MCP_SERVERS, runtime).
*/

const placeholderPattern =
    /\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}/;


function containsPlaceholder(value) {

    if (typeof value === "string") {
        return placeholderPattern.test(value);
    }

    if (Array.isArray(value)) {
        return value.some(containsPlaceholder);
    }

    if (value && typeof value === "object") {
        return Object.values(value).some(containsPlaceholder);
    }

    return false;
}


function expandsEnvironment(context) {

    return !(context && context.source === SOURCES.PROJECT);
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

    if (
        !expandsEnvironment(context) &&
        containsPlaceholder(rawDefinition || {})
    ) {

        throw new Error(
            "environment placeholders like ${NAME} are not allowed in a repository .mcp.json, " +
            "because they would hand the runtime's secrets to a server the repository chose; " +
            "declare this server in .agent/mcp.json or MCP_SERVERS instead"
        );
    }

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

        /*
        | Phase 9: a server is either global (visible to every project,
        | default — today's behaviour) or project-scoped to an explicit
        | list of project ids. tools/list and tools/call honour this.
        */
        scope:
            definition.scope === "project"
                ? "project"
                : "global",

        projects:
            normalizeStringList(definition.projects),

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


module.exports = {
    TRANSPORT_ALIASES,
    SOURCES,
    NAME_PATTERN,
    inferTransport,
    expand,
    expandDeep,
    containsPlaceholder,
    expandsEnvironment,
    normalizeStringList,
    normalize,
    normalizeOne
};
