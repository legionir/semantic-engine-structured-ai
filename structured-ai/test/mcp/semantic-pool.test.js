"use strict";

/*
|--------------------------------------------------------------------------
| Semantic Pool Tests — EXECUTION_PLAN Phase 6
|--------------------------------------------------------------------------
|
| Locks the phase-6 acceptance criteria against the stub Semantic
| Gateway (گام ۴; the engine-side gateway is not implemented yet —
| recorded decision 2026-08-25 — so contract tests run against the
| documented /mcp/:projectId shape and a registry endpoint swap is the
| ONLY thing a real gateway will ever need):
|
|   1. SEMANTIC_POOL_MODE defaults to legacy, which routes every context
|      through the historical single client (bit-identical behaviour)
|   2. in modular mode each project's code tools talk to that project's
|      own worker — code_search on A never returns B's symbols
|   3. a worker outage degrades only its own project: controlled
|      ok:false results, never a runtime crash, never a neighbour's
|   4. query-result caching is keyed by projectId + index generation:
|      memoized within a generation, invalidated on a reported
|      generation change, never shared between ids (not even two ids
|      pointing at the same root)
|   5. index sessions and the semantic-engine skill gate are per-project
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "semantic-pool-ws-")
    );

const DATA_HOME =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "semantic-pool-data-")
    );

const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-pool-a-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-pool-b-"));
const ROOT_MISSING =
    fs.mkdtempSync(path.join(os.tmpdir(), "semantic-pool-missing-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.SEMANTIC_CALL_TIMEOUT_MS = "2000";

const ROOT = path.resolve(__dirname, "..", "..");

const resolver =
    require(path.join(ROOT, "agent", "mcp", "ProjectSemanticResolver.js"));

const legacySemantic =
    require(path.join(ROOT, "agent", "lib", "semantic.js"));

const { pool } =
    require(path.join(ROOT, "agent", "mcp", "SemanticClientPool.js"));

const tools = require(path.join(ROOT, "agent", "tools", "index.js"));
const skills = require(path.join(ROOT, "agent", "tools", "skills.js"));
const code = require(path.join(ROOT, "agent", "tools", "code.js"));
const codeTools = code;

const settings = require(path.join(ROOT, "agent", "lib", "storage.js"));

const { runManager } =
    require(path.join(ROOT, "agent", "runtime", "index.js"));

const projects =
    require(path.join(ROOT, "agent", "projects", "index.js"));

const ToolContext =
    require(path.join(ROOT, "agent", "tools", "ToolContext.js"));

const {
    createStubSemanticGateway
} = require(path.join(ROOT, "test", "helpers", "stubSemanticGateway.js"));


const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}\n${error.stack}`);

    }
}


/* settings reads process.env live; flip per test and always restore. */
async function withEnv(patch, fn) {

    const saved = {};

    for (const [key, value] of Object.entries(patch)) {

        saved[key] = process.env[key];

        if (value === null || value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }

    }

    try {

        return await fn();

    } finally {

        for (const key of Object.keys(patch)) {

            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }

        }

    }
}


function projectContextFor(projectId, root, endpoint) {

    return {
        projectId,
        projectName: projectId,
        workspaceRoot: root,
        dataRoot: path.join(DATA_HOME, "projects", projectId),
        semanticEndpoint: endpoint ?? null,
        permissions: {},
        synthetic: false
    };

}


function toolContextFor(projectId, root, endpoint) {

    return {
        agent: "test",
        runId: `run-${projectId}`,
        projectId,
        projectContext: projectContextFor(projectId, root, endpoint)
    };

}


/* Distinctive answer markers: routing bugs show as the wrong marker. */
const MARKER_A = "zzpoolalpha9c1e7";
const MARKER_B = "zzpoolbeta52d4f";
const MARKER_Z = "zzpoolzeta88b03";


const gateway =

    createStubSemanticGateway({
        "prj-a": {
            tools: [{ name: "alpha_specific_tool" }],
            handlers: {
                find_symbol: params => ({
                    total: 1,
                    items: [
                        {
                            name: `${MARKER_A}:${params.name}`,
                            kind: "class",
                            path: "src/alpha.ts",
                            line: 10,
                            signature: "class Alpha"
                        }
                    ]
                }),
                semantic_search: params => ({
                    total: 1,
                    items: [
                        {
                            name: `${MARKER_A}:${params.query}`,
                            path: "src/alpha.ts",
                            score: 0.9,
                            kind: "class",
                            excerpt: "alpha hit"
                        }
                    ]
                }),
                index_workspace: () => ({
                    ok: true,
                    indexed_files: 7
                })
            }
        },
        "prj-b": {
            tools: [{ name: "beta_specific_tool" }],
            handlers: {
                find_symbol: params => ({
                    total: 1,
                    items: [
                        {
                            name: `${MARKER_B}:${params.name}`,
                            kind: "class",
                            path: "src/beta.ts",
                            line: 20,
                            signature: "class Beta"
                        }
                    ]
                }),
                semantic_search: params => ({
                    total: 1,
                    items: [
                        {
                            name: `${MARKER_B}:${params.query}`,
                            path: "src/beta.ts",
                            score: 0.8,
                            kind: "class",
                            excerpt: "beta hit"
                        }
                    ]
                })
            }
        },
        /* prj-twin points at the SAME workspace root as prj-a on disk:
           identical root, different projectId — the cache and client
           must still never mix (acceptance: «root/ID مشابه»). */
        "prj-twin": {
            tools: [{ name: "twin_specific_tool" }],
            handlers: {
                semantic_search: params => ({
                    total: 1,
                    items: [
                        {
                            name: `zzpooltwin:${params.query}`,
                            path: "src/alpha.ts",
                            score: 0.5,
                            kind: "class",
                            excerpt: "twin hit"
                        }
                    ]
                })
            }
        }
    });


/* Second gateway: proves that moving a project between endpoints is a
   registry data edit, not a client code change. */
const gatewayTwo =

    createStubSemanticGateway({
        "prj-z": {
            tools: [{ name: "zeta_specific_tool" }],
            handlers: {
                semantic_search: params => ({
                    total: 1,
                    items: [
                        {
                            name: `${MARKER_Z}:${params.query}`,
                            path: "src/zeta.ts",
                            score: 0.7,
                            kind: "class",
                            excerpt: "zeta hit"
                        }
                    ]
                })
            }
        }
    });


async function main() {

    await gateway.listen();
    await gatewayTwo.listen();

    const endpointA = gateway.endpointFor("prj-a");
    const endpointB = gateway.endpointFor("prj-b");
    const endpointTwin = gateway.endpointFor("prj-twin");
    const endpointZ = gatewayTwo.endpointFor("prj-z");

    /* A port nothing listens on: the degraded worker. */
    const endpointDead = "http://127.0.0.1:9/mcp/prj-dead";


    await test("SEMANTIC_POOL_MODE defaults to legacy routing", async () => {

        assert.equal(settings.get("SEMANTIC_POOL_MODE"), "legacy");
        assert.equal(resolver.poolMode(), "legacy");

        /* every context shape resolves to THE historical client object */

        const unscoped = ToolContext.from({ agent: "test" });

        assert.strictEqual(
            resolver.semanticFor(unscoped),
            legacySemantic,
            "unscoped context must keep the process-wide client"
        );

        const workspaceScoped =
            ToolContext.from(
                toolContextFor("default-ws", WORKSPACE, endpointA)
            );

        assert.strictEqual(
            resolver.semanticFor(workspaceScoped),
            legacySemantic,
            "a workspace-rooted project in legacy mode keeps the same client"
        );

        /* a foreign root in legacy mode must stay a loud error, not a
           silent answer from the wrong index (Phase-4 gate semantics,
           now owned by the resolver) */

        assert.throws(
            () =>
                resolver.semanticFor(
                    ToolContext.from(
                        toolContextFor("prj-b", ROOT_B, endpointB)
                    )
                ),
            /not yet project-aware/,
            "foreign root without SEMANTIC_POOL_MODE=modular"
        );

    });


    await test("stub gateway serves the /mcp/:projectId contract distinctly", async () => {

        await withEnv({ SEMANTIC_POOL_MODE: "modular" }, async () => {

            const clientA =
                pool.connect({
                    projectId: "prj-a",
                    workspaceRoot: ROOT_A,
                    semanticEndpoint: endpointA
                });

            const clientB =
                pool.connect({
                    projectId: "prj-b",
                    workspaceRoot: ROOT_B,
                    semanticEndpoint: endpointB
                });

            /* listTools is served per project with distinct catalogues */

            const listedA = await clientA.ensureClient().listTools();
            const listedB = await clientB.ensureClient().listTools();

            assert.deepEqual(
                listedA.map(tool => tool.name),
                ["alpha_specific_tool"]
            );
            assert.deepEqual(
                listedB.map(tool => tool.name),
                ["beta_specific_tool"]
            );

        });

    });


    await test("modular pool: code tools route to the context's project only", async () => {

        await withEnv({ SEMANTIC_POOL_MODE: "modular" }, async () => {

            const ctxA = toolContextFor("prj-a", ROOT_A, endpointA);
            const ctxB = toolContextFor("prj-b", ROOT_B, endpointB);

            const searchA =
                await tools.executeTool(
                    "code_search",
                    { query: "auth" },
                    ctxA
                );

            assert.ok(searchA.total >= 1);
            assert.ok(
                searchA.results.some(item => item.name.startsWith(MARKER_A)),
                "project A must see its own symbols"
            );
            assert.ok(
                !searchA.results.some(item => item.name.includes(MARKER_B)),
                "project A must never see B's symbols"
            );

            const searchB =
                await tools.executeTool(
                    "code_search",
                    { query: "auth" },
                    ctxB
                );

            assert.ok(
                searchB.results.some(item => item.name.startsWith(MARKER_B)),
                "project B must see its own symbols"
            );
            assert.ok(
                !searchB.results.some(item => item.name.includes(MARKER_A)),
                "project B must never see A's symbols"
            );

            const symbolA =
                await tools.executeTool(
                    "code_find_symbol",
                    { name: "Alpha" },
                    ctxA
                );

            assert.ok(
                symbolA.symbols.every(item => item.name.startsWith(MARKER_A)),
                "find_symbol must be routed the same way"
            );

            /* telemetry/scopes untouched: pool kept separate clients */

            assert.deepEqual(
                pool.projectIds().includes("prj-a") &&
                    pool.projectIds().includes("prj-b"),
                true
            );

        });

    });


    await test("a down worker degrades only its own project", async () => {

        await withEnv({ SEMANTIC_POOL_MODE: "modular" }, async () => {

            const ctxDead =
                toolContextFor("prj-dead", ROOT_MISSING, endpointDead);

            const degraded =

                await tools.executeTool(
                    "code_search",
                    { query: "auth" },
                    ctxDead
                );

            /* controlled failure: ok:false result, not an exception and
               definitely not a crash of the run */

            assert.equal(degraded.ok, false);
            assert.match(degraded.error, /unreachable|ECONNREFUSED|timed out/i);

            /* the neighbour keeps answering */

            const alive =

                await tools.executeTool(
                    "code_search",
                    { query: "auth" },
                    toolContextFor("prj-a", ROOT_A, endpointA)
                );

            assert.ok(
                alive.results.some(item => item.name.startsWith(MARKER_A))
            );

            const healthDead = pool.health("prj-dead");
            const healthAlive = pool.health("prj-a");

            assert.equal(healthDead.degraded, true);
            assert.match(healthDead.last_error, /unreachable|ECONNREFUSED|timed out/i);
            assert.equal(healthAlive.degraded, false);

        });

    });


    await test("missing endpoint matrix in modular mode", async () => {

        await withEnv({ SEMANTIC_POOL_MODE: "modular" }, async () => {

            /* foreign root, no endpoint: per-project controlled
               unavailability, never a detour to another index */

            const missing =

                await tools.executeTool(
                    "code_search",
                    { query: "auth" },
                    toolContextFor("prj-missing", ROOT_MISSING, null)
                );

            assert.equal(missing.ok, false);
            assert.match(missing.hint, /Semantic engine is not available/);

            const client = pool.get("prj-missing");

            assert.ok(client, "the pool pins a client for the project");
            assert.equal(client.isAvailable(), false);

            /* workspace-rooted project, no endpoint: the local engine
               indexes exactly this tree, so the legacy client answers —
               isolation is vacuous when both roots are one directory */

            const workspaceScoped =

                ToolContext.from(
                    toolContextFor("default-ws", WORKSPACE, null)
                );

            assert.strictEqual(
                resolver.semanticFor(workspaceScoped),
                legacySemantic
            );

            assert.equal(
                resolver.isEndpointActiveFor(
                    projectContextFor("prj-missing", ROOT_MISSING, null)
                ),
                false
            );

            assert.equal(
                resolver.isEndpointActiveFor(
                    projectContextFor("default-ws", WORKSPACE, null)
                ),
                legacySemantic.isAvailable() === true
            );

            assert.equal(
                resolver.isEndpointActiveFor(
                    projectContextFor("prj-a", ROOT_A, endpointA)
                ),
                true
            );

        });

    });


    await test("index sessions and run scope are pinned to their project", async () => {

        await withEnv({ SEMANTIC_POOL_MODE: "modular" }, async () => {

            const ctxA = toolContextFor("prj-a", ROOT_A, endpointA);
            const ctxB = toolContextFor("prj-b", ROOT_B, endpointB);

            const started =

                await tools.executeTool(
                    "code_index_start",
                    { incremental: true },
                    ctxA
                );

            assert.equal(started.status, "started");
            assert.match(started.session_id, /^idx-/);

            const own =

                await tools.executeTool(
                    "code_index_get",
                    { session_id: started.session_id },
                    ctxA
                );

            assert.ok(
                ["running", "completed"].includes(own.status),
                `own session must be live, got ${own.status}`
            );

            const foreign =

                await tools.executeTool(
                    "code_index_get",
                    { session_id: started.session_id },
                    ctxB
                );

            assert.equal(
                foreign.status,
                "unknown",
                "B must never see A's index session (isolation)"
            );

            /* the run:started scope snapshot describes the run's OWN
               project (endpoint project: available; endpoint-less
               foreign project: not) rather than the process-wide engine */

            const runA =

                runManager.createRun({
                    task: "scope snapshot",
                    project: projectContextFor("prj-a", ROOT_A, endpointA)
                });

            await runManager.execute(runA, async () => {

                const scope = codeTools._startRunScope(runA.runId);

                assert.equal(scope.semantic_available, true);
                assert.ok(typeof scope.index_status === "string");

            });

            const runMissing =

                runManager.createRun({
                    task: "scope snapshot",
                    project:
                        projectContextFor("prj-missing", ROOT_MISSING, null)
                });

            await runManager.execute(runMissing, async () => {

                const scope =
                    codeTools._startRunScope(runMissing.runId);

                assert.equal(scope.semantic_available, false);

            });

            /* legacy flag keeps the historical process-wide snapshot */

        });

        const legacyScope = codeTools._startRunScope(undefined);

        assert.equal(
            legacyScope.semantic_available,
            legacySemantic.isAvailable()
        );

    });


    await test("result caching is keyed by projectId and index generation", async () => {

        await withEnv({ SEMANTIC_POOL_MODE: "modular" }, async () => {

            const ctxA = toolContextFor("prj-a", ROOT_A, endpointA);
            const ctxTwin =
                toolContextFor("prj-twin", ROOT_A, endpointTwin);

            const query = { query: "cache-probe" };

            const beforeA = gateway.callCount("prj-a", "semantic_search");
            const beforeTwin =
                gateway.callCount("prj-twin", "semantic_search");

            const first = await tools.executeTool("code_search", query, ctxA);
            assert.ok(first.results.length >= 1);

            /* a fresh query always reaches the worker; the response
               (with generation) is memoized by the time it returns */

            assert.equal(
                gateway.callCount("prj-a", "semantic_search"),
                beforeA + 1
            );

            await tools.executeTool("code_search", query, ctxA);
            await tools.executeTool("code_search", query, ctxA);

            assert.equal(
                gateway.callCount("prj-a", "semantic_search"),
                beforeA + 1,
                "identical calls inside one index generation are memoized"
            );

            /* same root, different project id: no cache sharing */

            await tools.executeTool("code_search", query, ctxTwin);

            assert.equal(
                gateway.callCount("prj-twin", "semantic_search"),
                beforeTwin + 1,
                "the twin project has its own client and cache"
            );

            /* the worker reindexes: the reported generation bump must
               invalidate the project's cache */

            gateway.bumpIndexGeneration("prj-a");

            await pool
                .get("prj-a")
                .call("index_workspace", { incremental: true });

            await tools.executeTool("code_search", query, ctxA);

            assert.equal(
                gateway.callCount("prj-a", "semantic_search"),
                beforeA + 2,
                "generation change invalidates the memoized results"
            );

        });

    });


    await test("endpoint swap via registry + pool.reload suffices", async () => {

        await withEnv({ SEMANTIC_POOL_MODE: "modular" }, async () => {

            const id = "prj-d";

            projects.registry().register({
                id,
                name: "swap-candidate",
                rootPath: ROOT_B,
                semanticEndpoint: endpointA
            });

            const first =

                await tools.executeTool(
                    "code_search",
                    { query: "swap-probe" },
                    toolContextFor(id, ROOT_B, endpointA)
                );

            assert.ok(
                first.results.some(item => item.name.startsWith(MARKER_A)),
                "before the swap the old endpoint answers"
            );

            /* the move: registry data edit + pool.reload — nothing in
               the client code changes (گام ۴ acceptance) */

            projects.registry().update(id, { semanticEndpoint: endpointZ });

            await pool.reload(id);

            const client = pool.get(id);

            assert.equal(client.endpoint, endpointZ);

            const second =

                await tools.executeTool(
                    "code_search",
                    { query: "swap-probe-2" },
                    /* the runtime re-reads the registry when it builds
                       the context; simulate by using the fresh record */
                    toolContextFor(id, ROOT_B, endpointZ)
                );

            assert.ok(
                second.results.some(item => item.name.startsWith(MARKER_Z)),
                "after the swap the new endpoint answers"
            );

            projects.registry().remove(id);

        });

    });


    await test("the semantic-engine skill gate follows the active project", async () => {

        const conditionalSkill = { requires: { mcp_server: "semantic-engine" } };

        /* legacy mode: the historical workspace-wide probe */

        assert.equal(
            skills._isActiveSkill(conditionalSkill),
            legacySemantic.isAvailable() === true
        );

        await withEnv(
            {
                SEMANTIC_POOL_MODE: "modular",
                RUN_CONTEXT_MODE: "modular"
            },
            async () => {

                const withEndpoint =

                    runManager.createRun({
                        task: "gate probe",
                        project:
                            projectContextFor("prj-a", ROOT_A, endpointA)
                    });

                await runManager.execute(withEndpoint, async () => {

                    assert.equal(
                        skills._isActiveSkill(conditionalSkill),
                        true,
                        "endpoint ready → skill visible for this run"
                    );

                });

                const withoutEndpoint =

                    runManager.createRun({
                        task: "gate probe",
                        project:
                            projectContextFor(
                                "prj-missing",
                                ROOT_MISSING,
                                null
                            )
                    });

                await runManager.execute(withoutEndpoint, async () => {

                    assert.equal(
                        skills._isActiveSkill(conditionalSkill),
                        false,
                        "no worker for a foreign project → skill hidden"
                    );

                });

                /* outside any run scope the probe degrades to the
                   legacy global answer instead of guessing a project */

                assert.equal(
                    skills._isActiveSkill(conditionalSkill),
                    legacySemantic.isAvailable() === true
                );

            }
        );

    });


    const failed = results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    await pool.disconnectAll();
    await gateway.close();
    await gatewayTwo.close();

    for (const dir of [WORKSPACE, DATA_HOME, ROOT_A, ROOT_B, ROOT_MISSING]) {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    process.exit(failed.length === 0 ? 0 : 1);

}

main();
