const fs = require("fs");

const settings = require("../lib/storage");
const events = require("../events");
const { realpath } = require("../lib/workspace");

const legacy = require("./semantic");

const { McpClient } = require("./client");
const config = require("./config");


/*
|--------------------------------------------------------------------------|
| Per-project Semantic client                                              |
|--------------------------------------------------------------------------|
|
| Phase 6 of EXECUTION_PLAN: in SEMANTIC_POOL_MODE=modular every project
| talks to its own Semantic worker through one of these clients. The
| client owns the whole lifecycle (definition, connection, call,
| disconnect) plus the two per-project pieces of state the legacy module
| keeps process-wide: index sessions and the staleness probe root.
|
| Isolation rules enforced here:
|
|   - the endpoint comes from the project record (registry), never from
|     an argument a model could shape (rule 9);
|   - a project with no endpoint answers "unavailable" with a controlled
|     error — its work must never fall through to another project's
|     worker (or to the workspace engine) by accident;
|   - query results are cached per client keyed by method+arguments and
|     only while the server reports an index generation; a reported
|     generation change invalidates the cache, which is exactly the
|     "projectId + index generation" cache keying the plan asks for;
|   - a failed call degrades THIS client (lastError is recorded and the
|     error propagates to the caller's controlled failure path); every
|     other project's client in the pool is untouched.
|
| The module deliberately mirrors the public surface of mcp/semantic.js
| (call, isAvailable, checkStaleness, index sessions, shutdown) so the
| code tools consume both through one resolver.
|--------------------------------------------------------------------------
*/

/* Read-only query methods whose results are pure functions of the index.
   Mutations and live LSP probes are never cached. Kept as a list of
   strings so the storage-store audit (no bare module constants) stays
   happy for the same reason PROJECT_VERSION is a string. */
const QUERY_METHODS =
    new Set([
        "find_symbol",
        "semantic_search",
        "get_file_summary",
        "get_dependencies",
        "impact_analysis",
        "find_tests",
        "get_config_usage",
        "assemble_context"
    ]);

/* The cache bound is a setting (SEMANTIC_POOL_CACHE_LIMIT, declared in
   the storage schema) read at the moment of enforcement — the runtime
   audit forbids module-level constants for exactly this reason. */


function canonicalRoot(root) {

    if (!root) {
        return root;
    }

    try {

        if (fs.existsSync(root)) {
            return realpath(root);
        }

    } catch {
        /* fall through to the textual root */
    }

    return root;

}


class SemanticClient {

    constructor({ projectId, workspaceRoot, semanticEndpoint }) {

        this.projectId = projectId || null;

        this.root = canonicalRoot(workspaceRoot) || null;

        this.endpoint =
            (semanticEndpoint && String(semanticEndpoint).trim()) || null;

        /* MCP server names accept letters, digits, dot, dash and
           underscore only (config.normalize), hence the dot join. */
        this.serverName =
            `semantic-engine.project.${this.projectId || "unknown"}`;

        this.cachedDefinition = null;

        this.client = null;

        /* Per-project degradation state: the last transport failure and
           when it happened. Cleared by the next successful call. */
        this.lastError = null;

        this.failedAt = 0;

        /* Index generation as last reported by the worker; null when the
           endpoint does not take part in the generation protocol (then
           nothing is cached at all, matching legacy freshness). */
        this.indexGeneration = null;

        this.resultCache = new Map();

        this.indexSessions = new Map();

    }


    /* A client can be reconnected to the same endpoint without churn; a
       changed endpoint or root means a different worker and forces a
       rebuild through the pool. */
    matches({ workspaceRoot, semanticEndpoint }) {

        return (
            canonicalRoot(workspaceRoot) === this.root &&
            ((semanticEndpoint && String(semanticEndpoint).trim()) || null) ===
                this.endpoint
        );

    }


    /*
    | The MCP server definition for this project's worker. URL transport
    | inference stays inside the normalizer, exactly as it does for the
    | legacy single client.
    */
    definition() {

        if (this.cachedDefinition) {
            return this.cachedDefinition;
        }

        if (!this.endpoint) {
            return null;
        }

        const declared =
            settings.get("SEMANTIC_TRANSPORT");

        this.cachedDefinition = {
            name: this.serverName,
            builtin: true,
            trust: "trusted",
            description:
                "Semantic code index, dependency graph and language server operations.",
            url: this.endpoint,
            transport:
                declared && declared !== "auto" ? declared : undefined,
            callTimeoutMs:
                settings.get("SEMANTIC_CALL_TIMEOUT_MS")
        };

        return this.cachedDefinition;

    }


    isAvailable() {

        if (!settings.get("SEMANTIC_ENABLED")) {
            return false;
        }

        if (settings.get("MCP_ENABLED") === false) {
            return false;
        }

        return this.definition() !== null;

    }


    ensureClient() {

        const spec = this.definition();

        if (!spec) {
            return null;
        }

        if (
            this.client &&
            this.client.config.url === spec.url &&
            (!spec.transport || this.client.config.transport === spec.transport)
        ) {
            return this.client;
        }

        if (this.client) {

            void this.client.close().catch(() => {});

            this.client = null;

        }

        const normalized =
            config.normalizeOne(
                this.serverName,
                spec,
                this.root || process.cwd()
            );

        this.client = new McpClient(normalized);

        return this.client;

    }


    /* Eagerly establishes the MCP handshake; optional — the first call
       connects lazily through McpClient.ensureReady, which is what the
       legacy path does today. */
    async connect() {

        const client = this.ensureClient();

        if (!client) {

            throw new Error(
                `Semantic engine is not configured for project "${this.projectId}" ` +
                "(the registry entry has no semanticEndpoint)."
            );

        }

        await client.ensureReady();

        return this;

    }


    trackGeneration(result) {

        if (!result || typeof result !== "object") {
            return;
        }

        const reported =

            result.indexGeneration ??
            result.index_generation ??
            null;

        if (
            reported === null ||
            reported === undefined ||
            reported === this.indexGeneration
        ) {
            return;
        }

        /* The worker reindexed under our feet: every cached answer and
           the tool catalogue now belong to an older index. */
        this.indexGeneration = reported;

        this.resultCache.clear();

        if (this.client) {
            this.client.toolsLoadedAt = null;
        }

    }


    async call(method, params, options = {}) {

        if (!settings.get("SEMANTIC_ENABLED")) {

            throw new Error(
                "Semantic engine is disabled via SEMANTIC_ENABLED=false."
            );

        }

        const client = this.ensureClient();

        if (!client) {

            throw new Error(
                `Semantic engine is not configured for project "${this.projectId}" ` +
                "(the registry entry has no semanticEndpoint)."
            );

        }

        /* Results are only memoized while the endpoint reports index
           generations: with no generation protocol there is no way to
           know when the index moved, and fresh beats fast. */
        const cacheKey =

            QUERY_METHODS.has(method) && this.indexGeneration !== null
                ? `${this.projectId}:${this.indexGeneration}:${method}:${JSON.stringify(params || {})}`
                : null;

        if (cacheKey && this.resultCache.has(cacheKey)) {
            return this.resultCache.get(cacheKey);
        }

        const startedAt = Date.now();

        events.emit("mcp:call", {
            server: this.serverName,
            tool: method
        });

        try {

            const result =
                await client.callTool(method, params, {
                    timeoutMs:
                        options.timeoutMs ||
                        settings.get("SEMANTIC_CALL_TIMEOUT_MS") ||
                        15000
                });

            this.lastError = null;

            this.failedAt = 0;

            this.trackGeneration(result);

            if (cacheKey) {

                const limit =
                    settings.get("SEMANTIC_POOL_CACHE_LIMIT");

                while (
                    this.resultCache.size >= limit &&
                    this.resultCache.size > 0
                ) {

                    const oldest =
                        this.resultCache.keys().next().value;

                    this.resultCache.delete(oldest);

                }

                if (limit > 0) {
                    this.resultCache.set(cacheKey, result);
                }

            }

            events.emit("mcp:result", {
                server: this.serverName,
                tool: method,
                duration_ms: Date.now() - startedAt,
                ok: true
            });

            return result;

        } catch (error) {

            this.lastError = error.message;

            this.failedAt = Date.now();

            events.emit("mcp:result", {
                server: this.serverName,
                tool: method,
                duration_ms: Date.now() - startedAt,
                ok: false,
                error: error.message
            });

            throw error;

        }

    }


    /* The staleness probe reads the index file under THIS project's
       root; the heuristics are the legacy module's, only the root
       differs. */
    checkStaleness() {

        return (
            this.root
                ? legacy.checkStaleness(this.root)
                : legacy.checkStaleness()
        );

    }


    startIndexSession(sessionId, sessionData) {

        this.indexSessions.set(sessionId, sessionData);

    }


    getIndexSession(sessionId) {

        return this.indexSessions.get(sessionId);

    }


    stopIndexSession(sessionId) {

        this.indexSessions.delete(sessionId);

    }


    /* One project's outage must be observable without touching its
       neighbours: the pool reports lifecycle state per client. */
    health() {

        return {
            project_id: this.projectId,
            endpoint: this.endpoint,
            available: this.isAvailable(),
            connected:
                Boolean(this.client) && this.client.state === "ready",
            degraded: this.lastError !== null,
            last_error: this.lastError,
            failed_at: this.failedAt || null,
            index_generation: this.indexGeneration,
            index_status: this.checkStaleness().state
        };

    }


    diagnostics() {

        return (
            this.client
                ? this.client.diagnosticsTail(50)
                : []
        );

    }


    async disconnect() {

        if (!this.client) {
            return;
        }

        const client = this.client;

        this.client = null;

        await client.close().catch(() => {});

    }


    /* Full reset: connection, definition and per-project caches. Index
       sessions survive a reload (they represent work already handed to
       the worker, like background processes survive run scopes). */
    async reload(project) {

        await this.disconnect();

        this.cachedDefinition = null;

        this.resultCache.clear();

        if (project) {

            this.root = canonicalRoot(project.workspaceRoot) || this.root;

            this.endpoint =

                (project.semanticEndpoint &&
                    String(project.semanticEndpoint).trim()) || null;

        }

        this.indexGeneration = null;

    }


    async shutdown() {

        await this.disconnect();

        this.cachedDefinition = null;

        this.resultCache.clear();

    }


}


module.exports = SemanticClient;
