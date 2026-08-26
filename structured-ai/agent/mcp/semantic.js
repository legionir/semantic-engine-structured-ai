const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const settings = require("../config");
const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");

const { manager } = require("./McpManager");


/*
|--------------------------------------------------------------------------
| Semantic Engine over MCP
|--------------------------------------------------------------------------
|
| The semantic engine used to have its own client: its own sidecar
| supervision, its own Content-Length framing, its own HTTP path, its
| own timeout handling. Every one of those is now something the MCP
| layer does for every server, so the engine keeps only what is actually
| specific to it:
|
|   - where the binary is, when it was not configured
|   - whether it is worth talking to at all
|   - how fresh the index on disk is
|   - the index sessions the code_index_* tools hand out
|
| The connection itself is a built-in MCP server named "semantic-engine"
| that is registered from here, which means a project may override it in
| .mcp.json exactly like any other server, and the four transports are
| available to it for free.
|--------------------------------------------------------------------------
*/

const SERVER_NAME = "semantic-engine";

const activeIndexSessions = new Map();

let cachedDefinition = null;


settings.bus.on("change", event => {

    if (
        event.key === "SEMANTIC_ENGINE_BIN" ||
        event.key === "SEMANTIC_ENABLED" ||
        event.key === "SEMANTIC_ENGINE_URL" ||
        event.key === "SEMANTIC_TRANSPORT"
    ) {

        cachedDefinition = null;

        void detach();
    }
});


function binaryPath() {

    const configured =
        settings.get("SEMANTIC_ENGINE_BIN");

    if (configured && configured.trim().length > 0) {
        return configured.trim();
    }

    const localBin =
        path.join(
            __dirname, "..", "..", "..", "semantic-engine", "bin", "semantic-engine.js"
        );

    if (fs.existsSync(localBin)) {
        return localBin;
    }

    try {

        execSync(
            process.platform === "win32"
                ? "where semantic-engine"
                : "which semantic-engine",
            { stdio: "ignore" }
        );

        return "semantic-engine";

    } catch {
        /* not on PATH */
    }

    return null;
}


function normalizeWorkspaceRoot(input) {

    let root = path.resolve(input);
    const base = path.basename(root).toLowerCase();
    const parent = path.basename(path.dirname(root)).toLowerCase();

    /* The semantic-engine CLI expects the actual project root. Never start
       it with Structured AI's runtime directory or with an artifact folder,
       otherwise it appends another output directory to that path. */
    if (base === ".agent" || base === ".semantic-engine") {
        root = path.dirname(root);
    } else if (base === "semantic" && parent === ".agent") {
        root = path.dirname(path.dirname(root));
    } else if (
        base === "semantic" &&
        fs.existsSync(path.join(root, "project-index.json"))
    ) {
        root = path.dirname(root);
    }

    return root;
}


function workspaceRoot() {

    return normalizeWorkspaceRoot(WORKSPACE_ROOT || process.cwd());
}


/*
| A URL means a server that is already running, which may be reached
| over any of the remote transports; without one the engine is started
| as a stdio sidecar.
*/

function definition() {

    if (cachedDefinition) {
        return cachedDefinition;
    }

    const remoteUrl =
        String(settings.get("SEMANTIC_ENGINE_URL") || "").trim();

    const declared =
        settings.get("SEMANTIC_TRANSPORT");

    if (remoteUrl.length > 0) {

        cachedDefinition = {
            name: SERVER_NAME,
            builtin: true,
            trust: "trusted",
            description:
                "Semantic code index, dependency graph and language server operations.",
            url: remoteUrl,
            transport:
                declared && declared !== "auto" ? declared : undefined,
            callTimeoutMs:
                settings.get("SEMANTIC_CALL_TIMEOUT_MS")
        };

        return cachedDefinition;
    }

    const bin = binaryPath();

    if (!bin) {
        return null;
    }

    cachedDefinition = {
        name: SERVER_NAME,
        builtin: true,
        trust: "trusted",
        transport: "stdio",
        description:
            "Semantic code index, dependency graph and language server operations.",
        command: bin,
        args: ["serve", "--stdio", "--root", workspaceRoot()],
        cwd: workspaceRoot(),
        env: { NODE_ENV: "production" },
        callTimeoutMs:
            settings.get("SEMANTIC_CALL_TIMEOUT_MS")
    };

    return cachedDefinition;
}


function isAvailable() {

    if (!settings.get("SEMANTIC_ENABLED")) {
        return false;
    }

    if (settings.get("MCP_ENABLED") === false) {
        return false;
    }

    /*
    | A project that redefined the server in .mcp.json is authoritative:
    | it may point at a build this runtime cannot autodetect.
    */

    const configured =
        manager.client(SERVER_NAME);

    if (configured && !configured.config.builtin) {
        return configured.config.enabled !== false;
    }

    return definition() !== null;
}


/*
| The engine is registered as a server the first time something asks for
| it, unless the workspace already declared one under the same name.
*/

function ensureRegistered() {

    manager.load();

    const existing =
        manager.client(SERVER_NAME);

    if (existing && !existing.config.builtin) {
        return existing;
    }

    const spec = definition();

    if (!spec) {
        return null;
    }

    if (
        existing &&
        existing.config.builtin &&
        sameShape(existing.config, spec)
    ) {
        return existing;
    }

    const { McpClient } = require("./McpConnection");

    const config = require("./McpConfig");

    const normalized =
        config.normalizeOne(
            SERVER_NAME,
            spec,
            workspaceRoot()
        );

    if (existing) {

        void existing.close().catch(() => {});
    }

    const client =
        new McpClient(normalized);

    manager.clients.set(SERVER_NAME, client);

    return client;
}


function sameShape(current, spec) {

    if (spec.transport && current.transport !== spec.transport) {
        return false;
    }

    if (spec.command) {

        return (
            current.command === spec.command &&
            JSON.stringify(current.args || []) === JSON.stringify(spec.args || [])
        );
    }

    return current.url === spec.url;
}


async function detach() {

    const client =
        manager.clients.get(SERVER_NAME);

    if (!client || !client.config.builtin) {
        return;
    }

    manager.clients.delete(SERVER_NAME);

    manager.invalidate();

    await client.close().catch(() => {});
}


/*
| The one entry point the code tools use. Every semantic operation is a
| tool call on the engine's MCP server, which is why this function is
| four lines and used to be ninety.
*/

async function call(method, params, options = {}) {

    if (!settings.get("SEMANTIC_ENABLED")) {

        throw new Error(
            "Semantic engine is disabled via SEMANTIC_ENABLED=false."
        );
    }

    const client =
        ensureRegistered();

    if (!client) {

        throw new Error(
            "Semantic engine binary not found. Install @aicoder/semantic-engine or configure SEMANTIC_ENGINE_BIN."
        );
    }

    return manager.call(
        SERVER_NAME,
        method,
        params,
        {
            timeoutMs:
                options.timeoutMs ||
                settings.get("SEMANTIC_CALL_TIMEOUT_MS") ||
                15000
        }
    );
}


function checkStaleness(root) {

    const base =
        normalizeWorkspaceRoot(root || workspaceRoot());

    const candidates = [
        path.join(base, ".semantic-engine", "project-index.json"),
        /* Compatibility with indexes created by older Structured AI builds. */
        path.join(base, ".agent", "semantic", "project-index.json"),
        path.join(base, "semantic", "project-index.json")
    ];

    const indexPath =
        candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];

    const missing = {
        state: "missing",
        path: indexPath,
        age_seconds: null,
        file_count: 0,
        symbol_count: 0
    };

    if (!fs.existsSync(indexPath)) {
        return missing;
    }

    try {

        const stats =
            fs.statSync(indexPath);

        const ageSeconds =
            Math.round((Date.now() - stats.mtimeMs) / 1000);

        let fileCount = 0;

        let symbolCount = 0;

        try {

            const content =
                JSON.parse(fs.readFileSync(indexPath, "utf8"));

            fileCount =
                content.files
                    ? Array.isArray(content.files)
                        ? content.files.length
                        : Object.keys(content.files).length
                    : 0;

            symbolCount =
                content.symbols ? content.symbols.length : 0;

        } catch {
            /* a partially written index still has an age */
        }

        return {
            state:
                ageSeconds > 3600 ? "stale" : "fresh",

            path: indexPath,

            age_seconds: ageSeconds,

            file_count: fileCount,

            symbol_count: symbolCount
        };

    } catch {

        return missing;
    }
}


function startIndexSession(sessionId, sessionData) {

    activeIndexSessions.set(sessionId, sessionData);
}


function getIndexSession(sessionId) {

    return activeIndexSessions.get(sessionId);
}


function stopIndexSession(sessionId) {

    activeIndexSessions.delete(sessionId);
}


function diagnostics() {

    const client =
        manager.clients.get(SERVER_NAME);

    return client ? client.diagnosticsTail(50) : [];
}


function pendingCount() {

    const client =
        manager.clients.get(SERVER_NAME);

    if (!client) {
        return 0;
    }

    const transport = client.transport;

    return transport && transport.pending ? transport.pending.size : 0;
}


function shutdown() {

    const client =
        manager.clients.get(SERVER_NAME);

    if (!client) {
        return;
    }

    manager.clients.delete(SERVER_NAME);

    manager.invalidate();

    void client.close().catch(() => {});
}


function startRunScope() {

    cachedDefinition = null;

    return {
        semantic_available:
            isAvailable(),

        index_status:
            checkStaleness().state
    };
}


module.exports = {
    SERVER_NAME,
    binaryPath,
    isAvailable,
    call,
    checkStaleness,
    shutdown,
    startRunScope,
    startIndexSession,
    getIndexSession,
    stopIndexSession,
    definition,
    ensureRegistered,
    _getDiagnostics: () => diagnostics().map(item => ({
        time: item.at,
        text: item.text
    })),
    _pendingCount: pendingCount
};
