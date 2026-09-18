"use strict";

/*
|--------------------------------------------------------------------------
| Project Registry & Context Tests — EXECUTION_PLAN Phase 2
|--------------------------------------------------------------------------
|
| Locks the multi-project foundation: canonical id identity, duplicate-root
| detection, rename stability, store durability, default-project
| compatibility and canonical project resolution on runAgent.
|
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-projects-ws-")
    );

const OTHER_ROOT =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-projects-other-")
    );

const DATA_HOME =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-projects-data-")
    );

fs.mkdirSync(path.join(WORKSPACE, "sub"), { recursive: true });

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.MAX_RUN_MS = "10000";
process.env.MAX_REQUEST_MS = "8000";
process.env.AGENT_VERBOSE = "0";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));
const { ProjectRegistry, canonicalizeRoot } = require(
    path.join(ROOT, "agent", "projects", "ProjectRegistry.js")
);
const ProjectStore = require(path.join(ROOT, "agent", "projects", "ProjectStore.js"));

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);

    }
}


function freshRegistry() {

    /* A registry bound to a throwaway store file each time, so tests
       never leak records into each other. */

    const file =
        path.join(
            fs.mkdtempSync(path.join(DATA_HOME, "reg-")),
            "registry.json"
        );

    return new ProjectRegistry({ registryPath: file });

}


function finalAnswerServer() {

    return new Promise(resolve => {

        const server =
            http.createServer((req, res) => {

                let raw = "";

                req.on("data", chunk => { raw += chunk; });

                req.on("end", () => {

                    res.setHeader("content-type", "application/json");

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message: {
                                        role: "assistant",
                                        content: JSON.stringify({
                                            version: "1.0",
                                            tool_calls: null,
                                            delegations: null,
                                            response: {
                                                type: "text",
                                                content: "projects phase probe"
                                            },
                                            data: null,
                                            error: null,
                                            action: "final",
                                            performed: null
                                        })
                                    }
                                }
                            ]
                        })
                    );
                });
            });

        server.listen(0, "127.0.0.1", () =>
            resolve({
                port: server.address().port,
                close: () => new Promise(done => server.close(done))
            })
        );
    });

}


function withStubbedModel(server, fn) {

    return (async () => {

        const previousUrl = runtime.settings.get("AGENT_BASE_URL");
        const previousModel = runtime.settings.get("AGENT_MODEL");

        runtime.settings.set(
            "AGENT_BASE_URL",
            `http://127.0.0.1:${server.port}/v1`
        );

        runtime.settings.set("AGENT_MODEL", "projects-probe");

        try {

            return await fn();

        } finally {

            if (previousUrl == null) {

                runtime.settings.reset("AGENT_BASE_URL");

            } else {

                runtime.settings.set("AGENT_BASE_URL", previousUrl);

            }

            if (previousModel == null) {

                runtime.settings.reset("AGENT_MODEL");

            } else {

                runtime.settings.set("AGENT_MODEL", previousModel);

            }
        }
    })();

}


async function main() {

    /* ------------------------- registry unit tests ------------------------- */

    await test("register + get + list round-trip with documented defaults", async () => {

        const registry = freshRegistry();

        const record =
            registry.register({
                name: "Engine Core",
                rootPath: WORKSPACE,
                semanticEndpoint: "http://localhost:4000/mcp/prj"
            });

        assert.match(record.id, /^prj-engine-core-[0-9a-f]{8}$/);
        assert.equal(record.rootPath, canonicalizeRoot(WORKSPACE));
        assert.equal(record.semanticEndpoint, "http://localhost:4000/mcp/prj");
        assert.equal(record.enabled, true);
        assert.equal(record.autoStart, true);
        assert.deepStrictEqual(record.permissions, {
            read: true,
            write: true,
            terminal: true,
            git: true
        });

        const fetched = registry.get(record.id);

        assert.deepStrictEqual(fetched, record);
        assert.equal(registry.list().length, 1);

    });

    await test("two projects with the same basename get different ids", async () => {

        const registry = freshRegistry();

        const first =
            registry.register({ name: "Engine Core", rootPath: WORKSPACE });

        const second =
            registry.register({ name: "Engine Core", rootPath: OTHER_ROOT });

        assert.notEqual(first.id, second.id);
        assert.equal(registry.list().length, 2);

    });

    await test("re-registering a root returns the existing project (spelling variants included)", async () => {

        const registry = freshRegistry();

        const first = registry.register({ name: "Core", rootPath: WORKSPACE });

        const variant = path.join(WORKSPACE, "sub", "..");

        const second = registry.register({ name: "Renamed Attempt", rootPath: variant });

        assert.equal(second.id, first.id);
        assert.equal(second.name, first.name, "re-registration must not rename");
        assert.equal(registry.list().length, 1);

    });

    await test("a symlinked path spelling identifies the same root", async () => {

        const registry = freshRegistry();

        const link = path.join(DATA_HOME, "ws-link");

        fs.symlinkSync(WORKSPACE, link);

        const viaLink = registry.register({ name: "Core", rootPath: link });
        const viaReal = registry.register({ name: "Core", rootPath: WORKSPACE });

        assert.equal(viaLink.id, viaReal.id);
        assert.equal(viaLink.rootPath, fs.realpathSync(WORKSPACE));

    });

    await test("ids persist to disk and come back through a fresh registry", async () => {

        const dir = fs.mkdtempSync(path.join(DATA_HOME, "persist-"));
        const file = path.join(dir, "registry.json");

        const writer = new ProjectRegistry({ registryPath: file });
        const written = writer.register({ name: "Durable", rootPath: WORKSPACE });

        const reader = new ProjectRegistry({ registryPath: file });

        assert.deepStrictEqual(reader.get(written.id).rootPath, written.rootPath);

        /* and the ids are name-slug plus hash of the CANONICAL root,
           not of the raw string a caller typed */

        const messy = writer.register({ name: "Durable", rootPath: path.join(WORKSPACE, "sub", "..") });
        assert.equal(messy.id, written.id);

    });

    await test("rename keeps the id; update merges permissions", async () => {

        const registry = freshRegistry();

        const record = registry.register({ name: "Old", rootPath: WORKSPACE });

        const renamed = registry.update(record.id, { name: "New", permissions: { terminal: false } });

        assert.equal(renamed.id, record.id);
        assert.equal(renamed.name, "New");
        assert.equal(renamed.permissions.terminal, false);
        assert.equal(renamed.permissions.read, true);

    });

    await test("identity fields are immutable via update", async () => {

        const registry = freshRegistry();

        const record = registry.register({ name: "Fixed", rootPath: WORKSPACE });

        assert.throws(
            () => registry.update(record.id, { id: "prj-hijack-00000000" }),
            /immutable/
        );

        assert.throws(
            () => registry.update(record.id, { rootPath: OTHER_ROOT }),
            /immutable/
        );

    });

    await test("remove targets only its own project", async () => {

        const registry = freshRegistry();

        const first = registry.register({ name: "One", rootPath: WORKSPACE });
        const second = registry.register({ name: "Two", rootPath: OTHER_ROOT });

        registry.remove(first.id);

        assert.equal(registry.list().length, 1);
        assert.equal(registry.list()[0].id, second.id);
        assert.throws(() => registry.get(first.id), /Unknown project/);

    });

    await test("registering a missing or non-directory root fails clearly", async () => {

        const registry = freshRegistry();

        assert.throws(
            () => registry.register({ name: "Ghost", rootPath: path.join(WORKSPACE, "nope") }),
            /does not exist/
        );

        const filePath = path.join(WORKSPACE, "file.txt");
        fs.writeFileSync(filePath, "x");

        assert.throws(
            () => registry.register({ name: "File", rootPath: filePath }),
            /not a directory/
        );

    });

    /* ----------------------- context & default project ----------------------- */

    await test("registered project context points at the central dataRoot", async () => {

        const registry = freshRegistry();

        const record = registry.register({ name: "Central", rootPath: WORKSPACE });

        const context =
            runtime.projects.resolveProjectForRun(
                { projectId: record.id },
                { registry }
            );

        assert.equal(context.projectId, record.id);
        assert.equal(context.projectName, "Central");
        assert.equal(context.workspaceRoot, record.rootPath);
        assert.ok(
            context.dataRoot.startsWith(ProjectStore.resolveDataHome() + path.sep),
            `dataRoot ${context.dataRoot} escaped the data home`
        );
        assert.equal(context.synthetic, false);

    });

    await test("default project: registered workspace resolves the record, else a synthetic legacy context", async () => {

        const registry = freshRegistry();

        /* unregistered workspace: synthetic, .agent dataRoot (legacy layout) */

        const synthetic =
            runtime.projects.resolveProjectForRun({}, { registry, workspaceRoot: WORKSPACE });

        assert.equal(synthetic.synthetic, true);
        assert.equal(synthetic.dataRoot, path.join(canonicalizeRoot(WORKSPACE), ".agent"));
        assert.match(synthetic.projectId, /^prj-/);

        /* after registering the very same root, default resolves the record
           and keeps the central dataRoot */

        const record = registry.register({ name: "Registered", rootPath: WORKSPACE });

        const resolved =
            runtime.projects.resolveProjectForRun({}, { registry, workspaceRoot: WORKSPACE });

        assert.equal(resolved.projectId, record.id);
        assert.equal(resolved.synthetic, false);
        assert.ok(resolved.dataRoot.startsWith(ProjectStore.resolveDataHome() + path.sep));

    });

    await test("the synthetic default writes nothing to the registry file", async () => {

        const dir = fs.mkdtempSync(path.join(DATA_HOME, "nobleed-"));
        const file = path.join(dir, "registry.json");

        const registry = new ProjectRegistry({ registryPath: file });

        runtime.projects.resolveProjectForRun({}, { registry, workspaceRoot: WORKSPACE });

        assert.ok(!fs.existsSync(file), "synthetic default leaked into the store");

    });

    await test("a corrupt registry file fails loudly, never silently resets", async () => {

        const dir = fs.mkdtempSync(path.join(DATA_HOME, "corrupt-"));
        const file = path.join(dir, "registry.json");

        fs.writeFileSync(file, "{ definitely not json");

        const registry = new ProjectRegistry({ registryPath: file });

        assert.throws(() => registry.list(), /corrupt/);

    });

    /* -------------- normalized project contract (Phase 6, گام ۱) -------------- */

    await test("resolveProjectForRun accepts a record AND an already-built context", async () => {

        /* API-016: the documented contract names both shapes; before the
           Phase-6 normalization only { id, rootPath } was accepted. */

        const registry = freshRegistry();

        const record =
            registry.register({ name: "Normalized", rootPath: OTHER_ROOT });

        const fromRecord =
            runtime.projects.resolveProjectForRun({ project: record }, { registry });

        const fromContext =
            runtime.projects.resolveProjectForRun({ project: fromRecord }, { registry });

        assert.deepEqual(fromContext, fromRecord);
        assert.equal(fromContext.projectId, record.id);
        assert.equal(fromContext.workspaceRoot, record.rootPath);

    });

    await test("createProjectContext is idempotent on a context", async () => {

        const registry = freshRegistry();

        const record =
            registry.register({ name: "Idempotent", rootPath: OTHER_ROOT });

        const once = runtime.projects.createProjectContext(record);
        const twice = runtime.projects.createProjectContext(once);

        assert.deepEqual(twice, once);

        /* A synthetic context keeps its legacy .agent dataRoot on a round
           trip instead of being relocated into the central store. */

        const synthetic =
            runtime.projects.createProjectContext(
                registry.resolveDefault(WORKSPACE)
            );

        assert.equal(synthetic.synthetic, true);
        assert.equal(
            runtime.projects.createProjectContext(synthetic).dataRoot,
            path.join(canonicalizeRoot(WORKSPACE), ".agent")
        );

    });

    await test("normalizeProjectInput maps both shapes and rejects anything else", async () => {

        const fromRecord =
            runtime.projects.normalizeProjectInput({ id: "prj-a", rootPath: "/tmp" });

        const fromContext =
            runtime.projects.normalizeProjectInput({
                projectId: "prj-a",
                workspaceRoot: "/tmp"
            });

        assert.equal(fromRecord.id, "prj-a");
        assert.equal(fromRecord.rootPath, "/tmp");
        assert.equal(fromContext.id, "prj-a");
        assert.equal(fromContext.rootPath, "/tmp");

        for (const bad of [null, undefined, "prj-a", 7, {}, { id: "prj-a" }]) {

            assert.equal(
                runtime.projects.normalizeProjectInput(bad),
                null,
                `expected ${JSON.stringify(bad)} to normalize to null`
            );

        }

    });

    await test("an explicit project is ownership-validated, not taken on faith", async () => {

        /* F-008: the explicit project option used to skip every check. */

        const registry = freshRegistry();

        const record =
            registry.register({ name: "Owned", rootPath: OTHER_ROOT });

        /* a registered id may not re-point itself at another root */

        assert.throws(
            () =>
                runtime.projects.resolveProjectForRun(
                    { project: { id: record.id, rootPath: WORKSPACE } },
                    { registry }
                ),
            /is registered at .* but the supplied project claims/
        );

        /* a root that does not exist fails loudly */

        assert.throws(
            () =>
                runtime.projects.resolveProjectForRun(
                    { project: { id: "prj-ghost-00000000", rootPath: path.join(WORKSPACE, "no-such-dir") } },
                    { registry }
                ),
            /Project root does not exist/
        );

        /* a hand-assembled synthetic default may not claim a foreign root */

        assert.throws(
            () =>
                runtime.projects.resolveProjectForRun(
                    {
                        project: {
                            id: "prj-forged-deadbeef",
                            rootPath: WORKSPACE,
                            synthetic: true
                        }
                    },
                    { registry }
                ),
            /was not derived from/
        );

        /* the genuine synthetic default for that root still resolves */

        const genuine = registry.resolveDefault(WORKSPACE);

        const resolved =
            runtime.projects.resolveProjectForRun(
                { project: genuine },
                { registry }
            );

        assert.equal(resolved.projectId, genuine.id);
        assert.equal(resolved.synthetic, true);

        /* the registry stays authoritative for a registered record's
           mutable fields, even when the caller passes a stale copy */

        registry.update(record.id, { name: "Renamed" });

        const authoritative =
            runtime.projects.resolveProjectForRun(
                { project: { ...record, name: "Stale" } },
                { registry }
            );

        assert.equal(authoritative.projectName, "Renamed");

    });

    await test("a project option of the wrong shape names both accepted shapes", async () => {

        const registry = freshRegistry();

        assert.throws(
            () =>
                runtime.projects.resolveProjectForRun(
                    { project: { name: "no identity" } },
                    { registry }
                ),
            /projectId and workspaceRoot/
        );

    });

    /* ----------------------- canonical run integration ----------------------- */

    await test("the canonical runtime validates an explicit project id", async () => {

        await assert.rejects(
            () => runtime.runAgent({ task: "Answer and stop.", projectId: "prj-does-not-exist" }),
            /Unknown project: prj-does-not-exist/
        );

    });

    await test("removed rollout environment variables cannot bypass project validation", async () => {

        assert.equal(typeof runtime.projects.resolveProjectForRun, "function");
        await assert.rejects(
            () => runtime.runAgent({ task: "Answer and stop.", projectId: "prj-unknown-00000000" }),
            /Unknown project: prj-unknown-00000000/
        );

    });

    await test("the canonical default project runs and scopes its Run context", async () => {

        const stub = await finalAnswerServer();

        try {
            await withStubbedModel(stub, async () => {
                const output = await runtime.runAgent({ task: "Answer and stop." });
                assert.ok(output);
                assert.equal(runtime.runManager.activeRuns().length, 0);
            });
        } finally {
            await stub.close();
        }

    });

    await test("a registered project rooted elsewhere runs through its own context", async () => {

        const registry = runtime.projects.registry();
        const existing = registry.findByRoot(OTHER_ROOT);
        const record = existing || registry.register({ name: "Elsewhere", rootPath: OTHER_ROOT });
        const stub = await finalAnswerServer();

        try {
            await withStubbedModel(stub, async () => {
                const output = await runtime.runAgent({ task: "Answer and stop.", projectId: record.id });
                assert.ok(output);
                assert.equal(output.error, null);
            });
        } finally {
            await stub.close();
        }

    });

    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.rmSync(OTHER_ROOT, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
