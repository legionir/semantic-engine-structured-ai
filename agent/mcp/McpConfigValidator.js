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
    RUNTIME: "runtime",
    /* P4-01/P4-02: the operator's own file in the data home, written by
       the console's catalogue; may reference the secret store */
    USER: "user"
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
|
| P4-01: "${secret:GITHUB_PAT}" is read from the encrypted secret store.
| Only operator configuration may do that (options.secrets): a model can
| write .mcp.json or call mcp_add, and a server it chose must never be
| handed a stored token. A reference to a secret that is not stored is an
| error, not a literal string sent to the server.
*/

function expand(value, options = {}) {

    if (typeof value !== "string") {
        return value;
    }

    return value.replace(
        /\$\{(?:(env|secret):)?([A-Za-z_][A-Za-z0-9_]*)\}/g,
        (whole, kind, name) => {

            if (kind === "secret") {

                if (options.secrets !== true) {
                    throw new Error(
                        `\${secret:${name}} may only be used in operator MCP configuration ` +
                        "(the console's catalogue, the user MCP config in the data home, the registry or MCP_SERVERS), " +
                        "never in a repository file or a server the agent adds"
                    );
                }

                if (options.expandSecrets === false) {
                    return whole;
                }

                const found = require("../secrets/SecretStore").resolve(name);

                if (found === undefined) {
                    throw new Error(
                        `secret "${name}" is not in the secret store; add it in the console (MCP → Secrets)`
                    );
                }

                return found;
            }

            const found = process.env[name];

            return found === undefined ? whole : found;
        }
    );
}


function expandDeep(value, options = {}) {

    if (typeof value === "string") {
        return expand(value, options);
    }

    if (Array.isArray(value)) {
        return value.map(item => expandDeep(item, options));
    }

    if (value && typeof value === "object") {

        return Object.fromEntries(
            Object.entries(value).map(
                ([key, item]) => [key, expandDeep(item, options)]
            )
        );
    }

    return value;
}


/*
| P0-5 / P0-8: a configuration committed with a repository is written by
| whoever controls the repository, so it must not be able to pull the
| runtime's secrets into a URL, header, argument or token it chose. Both
| repository files (.mcp.json and .agent/mcp.json) expand placeholders
| only once the operator has trusted the workspace (agent --trust);
| operator configuration (registry, MCP_SERVERS, runtime) always may.
*/

const placeholderPattern =
    /\$\{(?:env:|secret:)?[A-Za-z_][A-Za-z0-9_]*\}/;


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


function mayDeclareTrusted(context) {

    const source = context && context.source;

    if (source !== SOURCES.PROJECT && source !== SOURCES.WORKSPACE) {
        return true;
    }

    try {
        return require("../config").get("MCP_TRUST_PROJECT_CONFIG") === true;
    } catch {
        return false;
    }
}


function isRepositorySource(context) {

    const source = context && context.source;

    return source === SOURCES.PROJECT || source === SOURCES.WORKSPACE;
}


/* The trust store is the operator's; a folder it does not list (or an
   unreadable store) is untrusted. Required lazily: WorkspaceTrust loads
   the settings store, which must not load this module first. */
function workspaceTrusted(context) {

    const root = context && context.workspaceRoot;

    if (!root) {
        return false;
    }

    try {
        return require("../projects/WorkspaceTrust").isTrusted(root) === true;
    } catch {
        return false;
    }
}


function expandsEnvironment(context) {

    return !isRepositorySource(context) || workspaceTrusted(context);
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


const APPROVAL_VALUES = new Set(["inherit", "always", "never"]);

function normalizeApproval(value) {

    if (value === undefined || value === null) {
        return { read: "inherit", write: "inherit" };
    }

    if (typeof value === "string") {
        if (!APPROVAL_VALUES.has(value)) {
            throw new Error(`approval must be inherit, always or never, or {read, write}: ${value}`);
        }
        return { read: value, write: value };
    }

    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("approval must be inherit, always or never, or {read, write}");
    }

    const pick = key => {
        const item = value[key] === undefined ? "inherit" : value[key];
        if (!APPROVAL_VALUES.has(item)) {
            throw new Error(`approval.${key} must be inherit, always or never: ${item}`);
        }
        return item;
    };

    return { read: pick("read"), write: pick("write") };
}


function loosenOnlyIf(approval, allowed) {

    if (allowed) return approval;

    return {
        read: approval.read === "never" ? "inherit" : approval.read,
        write: approval.write === "never" ? "inherit" : approval.write
    };
}


function normalizeOAuth(value) {

    if (value === undefined || value === null || value === false) {
        return null;
    }

    if (value === true) {
        return {};
    }

    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("oauth must be true or an object {client_id?, client_secret?, scopes?}");
    }

    const out = {};

    for (const key of ["client_id", "client_secret", "authorization_server"]) {
        if (value[key] !== undefined) {
            if (typeof value[key] !== "string" || value[key] === "") throw new Error(`oauth.${key} must be a non-empty string`);
            out[key] = value[key];
        }
    }

    if (value.scopes !== undefined) {
        const scopes = Array.isArray(value.scopes) ? value.scopes : String(value.scopes).split(/[\s,]+/);
        out.scopes = scopes.map(String).filter(Boolean);
    }

    return out;
}


function normalize(name, rawDefinition, context) {

    if (
        !expandsEnvironment(context) &&
        containsPlaceholder(rawDefinition || {})
    ) {

        throw new Error(
            "environment placeholders like ${NAME} are not allowed in a repository MCP configuration " +
            "(.mcp.json, .agent/mcp.json) of an untrusted workspace, because they would hand the " +
            "runtime's secrets to a server the repository chose; trust the workspace " +
            "(agent --trust) or declare this server in MCP_SERVERS instead"
        );
    }

    /*
    | Secrets: operator sources may reference them; a repository file
    | never may, trusted or not, because the agent can write it. The
    | caller can narrow this further (mcp_add passes secrets: false) and
    | ask for the references to be kept (expandSecrets: false) when the
    | definition is about to be written back to disk.
    */
    const definition =
        expandDeep(rawDefinition || {}, {
            secrets:
                context.secrets === undefined
                    ? !isRepositorySource(context)
                    : context.secrets === true && !isRepositorySource(context),
            expandSecrets: context.expandSecrets !== false
        });

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

        /* P4-02: the catalogue entry this server was activated from */
        catalog:
            typeof definition.catalog === "string" ? definition.catalog : null,

        /*
        | An approval policy per server, because a server that only
        | reads a code index and one that can post to an issue tracker
        | do not deserve the same trust.
        */

        /*
        | P0-2: a repository file (.mcp.json, .agent/mcp.json) may make a
        | server stricter but never mark it trusted; that is the
        | operator's call (registry, MCP_SERVERS, or MCP_TRUST_PROJECT_CONFIG).
        */

        trust:
            (definition.trust === "trusted" || definition.trusted === true) &&
            mayDeclareTrusted(context)
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

        /*
        | P4-07: the agents that may see and call this server's tools (empty:
        | every agent), and an approval rule per kind of tool — read for a
        | tool annotated readOnlyHint, write for every other one — each
        | inherit (the policy rules and trust), always or never.
        */
        agents:
            normalizeStringList(definition.agents),

        /* like trust, a repository file may ask for more approval, never less */
        approval:
            loosenOnlyIf(normalizeApproval(definition.approval), mayDeclareTrusted(context)),

        /* P4-08: OAuth 2.1 sign-in for a remote server (true, or settings) */
        oauth:
            normalizeOAuth(definition.oauth),

        /* P4-10: the server may ask the model for completions (sampling) */
        sampling:
            definition.sampling === true,

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


function normalizeOne(name, definition, workspaceRoot, options = {}) {

    return normalize(
        name,
        definition,
        {
            source: SOURCES.RUNTIME,
            origin: "runtime",
            workspaceRoot: workspaceRoot || process.cwd(),
            secrets: options.secrets,
            expandSecrets: options.expandSecrets
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
    isRepositorySource,
    workspaceTrusted,
    expandsEnvironment,
    normalizeStringList,
    normalizeApproval,
    normalizeOAuth,
    normalize,
    normalizeOne
};
