const settings = require("../lib/storage");

const SemanticClient = require("./SemanticClient");


/*
|--------------------------------------------------------------------------|
| Semantic Client Pool                                                     |
|--------------------------------------------------------------------------|
|
| Phase 6 of EXECUTION_PLAN (گام ۲): one SemanticClient per project, keyed
| by projectId. Every project's worker connection lives and dies on its
| own — connecting, disconnecting or reloading project A never disturbs
| project B's client, and a degraded worker surfaces through that
| project's client alone.
|
| The pool is consulted only in SEMANTIC_POOL_MODE=modular; in legacy
| mode the resolver never reaches for it and the process keeps the
| single historical client from mcp/semantic.js.
|
| Endpoints come from the project records in the registry
| (ProjectRegistry record → ProjectContext.semanticEndpoint), so moving
| from the test stub to the real Semantic Gateway is a data change —
| PATCH the registry entry — not a code change (گام ۴ / acceptance).
|
|--------------------------------------------------------------------------
*/


class SemanticClientPool {

    constructor() {

        this.clients = new Map();

    }


    /* The client currently bound to this project, or null when none has
       been connected yet. */
    get(projectId) {

        return this.clients.get(projectId) || null;

    }


    /* project-shaped object: { projectId, workspaceRoot, semanticEndpoint
       } — the same fields a Phase-2 ProjectContext carries. Reconnecting
       an already-connected project is free; a changed endpoint or root
       rebuilds the client so stale connections never linger. */
    connect(project) {

        if (!project || !project.projectId) {

            throw new Error(
                "Semantic pool connect requires a project with a projectId."
            );

        }

        const existing = this.clients.get(project.projectId);

        if (existing) {

            if (existing.matches(project)) {
                return existing;
            }

            void existing.disconnect().catch(() => {});

            this.clients.delete(project.projectId);

        }

        const client =

            new SemanticClient({
                projectId: project.projectId,
                workspaceRoot: project.workspaceRoot,
                semanticEndpoint: project.semanticEndpoint
            });

        this.clients.set(project.projectId, client);

        return client;

    }


    async disconnect(projectId) {

        const client = this.clients.get(projectId);

        if (!client) {
            return false;
        }

        this.clients.delete(projectId);

        await client.shutdown();

        return true;

    }


    /* Re-reads the registry record and rebuilds the client; this is the
       one-call answer to "the gateway moved" — nothing in the client
       code needs to change (endpoint swap is data). Without a registry
       record the client is simply dropped. */
    async reload(projectId) {

        const { registry } = require("../projects");

        await this.disconnect(projectId);

        const record = registry().get(projectId);

        if (!record) {
            return null;
        }

        const { createProjectContext } = require("../projects");

        return this.connect(createProjectContext(record));

    }


    async disconnectAll() {

        const closing = [...this.clients.values()];

        this.clients.clear();

        await Promise.all(
            closing.map(client => client.shutdown().catch(() => {}))
        );

    }


    projectIds() {

        return [...this.clients.keys()].sort();

    }


    /* Diagnostics for one project or the whole pool; additive surface
       for the console and tests, never consumed by the legacy path. */
    health(projectId) {

        if (projectId !== undefined) {

            const client = this.get(projectId);

            return client ? client.health() : null;

        }

        return this.projectIds().map(
            id => this.clients.get(id).health()
        );

    }


}


const pool = new SemanticClientPool();


/* Keep the pool in step with the same settings that re-tune the legacy
   client: a changed timeout/transport/disabled engine must not keep
   serving through connections negotiated under old settings. */
settings.bus.on("change", event => {

    if (
        event.key === "SEMANTIC_POOL_MODE" ||
        event.key === "SEMANTIC_TRANSPORT" ||
        event.key === "SEMANTIC_CALL_TIMEOUT_MS" ||
        event.key === "SEMANTIC_ENABLED"
    ) {

        void pool.disconnectAll();

    }

});


module.exports = {
    SemanticClientPool,
    pool
};
