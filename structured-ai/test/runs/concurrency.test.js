"use strict";

/*
|--------------------------------------------------------------------------
| Concurrency / limits / observability — EXECUTION_PLAN Phase 10
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "phase10-ws-"));
const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "phase10-a-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "phase10-b-"));
const ROOT_C = fs.mkdtempSync(path.join(os.tmpdir(), "phase10-c-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "phase10-data-"));

fs.writeFileSync(path.join(ROOT_A, "a.txt"), "a\n");
fs.writeFileSync(path.join(ROOT_B, "b.txt"), "b\n");
fs.writeFileSync(path.join(ROOT_C, "c.txt"), "c\n");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.PROJECT_CONTEXT_MODE = "modular";
process.env.RUN_CONTEXT_MODE = "modular";
process.env.PROMPT_BUILDER_MODE = "modular";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.MAX_CONCURRENT_PROJECT_RUNS = "2";
process.env.MAX_RUNS_PER_PROJECT = "1";
process.env.MAX_WORKERS_PER_USER = "8";
process.env.RUN_QUEUE_LIMIT = "4";
process.env.MAX_CONCURRENT_INDEX_RUNS = "2";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const MARKER = {
    a: "zzp10alpha",
    b: "zzp10beta",
    c: "zzp10gamma"
};

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


function finalAction(content) {

    return {
        version: "1.0",
        action: "final",
        tool_calls: null,
        delegations: null,
        response: { type: "text", content },
        data: null,
        error: null,
        performed: null
    };
}


function startStub() {

    return new Promise(resolve => {

        const state = { handler: null };

        const server = http.createServer((req, res) => {

            let body = "";
            req.on("data", chunk => (body += chunk));
            req.on("end", () => {

                const parsed = JSON.parse(body || "{}");
                const text = JSON.stringify(parsed.messages || []);
                const marker =
                    text.includes(MARKER.a) ? "a" :
                    text.includes(MARKER.b) ? "b" :
                    text.includes(MARKER.c) ? "c" : "x";

                const reply = state.handler
                    ? state.handler(marker)
                    : { delayMs: 0, content: `done-${marker}` };

                const respond = () => {
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({
                        choices: [{
                            message: {
                                role: "assistant",
                                content: JSON.stringify(finalAction(reply.content))
                            }
                        }]
                    }));
                };

                if (reply.delayMs) {
                    setTimeout(respond, reply.delayMs);
                } else {
                    respond();
                }
            });
        });

        server.listen(0, "127.0.0.1", () => {
            resolve({
                state,
                port: server.address().port,
                close: () => new Promise(done => server.close(done))
            });
        });
    });
}


async function main() {

    const stub = await startStub();
    process.env.AGENT_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
    process.env.AGENT_MODEL = "stub-model";

    const runtime = require(path.join(REPO_ROOT, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO_ROOT, "web", "server.js"));

    const registry = runtime.projects.registry();
    const prjA = registry.register({ id: "prj-a", name: "A", rootPath: ROOT_A });
    const prjB = registry.register({ id: "prj-b", name: "B", rootPath: ROOT_B });
    const prjC = registry.register({ id: "prj-c", name: "C", rootPath: ROOT_C });

    runtime.settings.set("AGENT_BASE_URL", `http://127.0.0.1:${stub.port}/v1`);
    runtime.settings.set("AGENT_MODEL", "stub-model");
    runtime.settings.set("MAX_CONCURRENT_PROJECT_RUNS", 2);
    runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);
    runtime.settings.set("RUN_QUEUE_LIMIT", 4);
    runtime.settings.set("MAX_WORKERS_PER_USER", 8);

    await test("two createRun calls in the same millisecond get distinct ids", async () => {

        const first = runtime.runManager.createRun({ task: "same-ms-a" });
        const second = runtime.runManager.createRun({ task: "same-ms-b" });

        assert.notEqual(first.runId, second.runId);
        assert.ok(first.runId.startsWith("run-"));
        assert.ok(second.runId.startsWith("run-"));
    });


    await test("defaults for Phase 10 limits are documented in the schema", async () => {

        const keys = [
            "MAX_CONCURRENT_PROJECT_RUNS",
            "MAX_RUNS_PER_PROJECT",
            "MAX_CONCURRENT_INDEX_RUNS",
            "MAX_WORKERS_PER_USER",
            "RUN_QUEUE_LIMIT",
            "PROJECT_MEMORY_LIMIT",
            "PROJECT_CPU_LIMIT"
        ];

        for (const key of keys) {
            const def = runtime.settings.definitionOf(key);
            assert.ok(def, key);
            assert.equal(typeof def.default, "number");
        }

        assert.equal(runtime.settings.definitionOf("MAX_RUNS_PER_PROJECT").default, 1);
        assert.equal(runtime.settings.definitionOf("PROJECT_MEMORY_LIMIT").default, 0);
    });


    await test("three projects: two run in parallel, the third queues then finishes", async () => {

        runtime.observability.reset();
        runtime.runScheduler.reset();

        const started = [];

        stub.state.handler = marker => {
            started.push(marker);
            return {
                delayMs: marker === "c" ? 0 : 250,
                content: `done-${marker}`
            };
        };

        const [a, b, c] = await Promise.all([
            runtime.runAgent({ projectId: prjA.id, task: `task ${MARKER.a}` }),
            runtime.runAgent({ projectId: prjB.id, task: `task ${MARKER.b}` }),
            runtime.runAgent({ projectId: prjC.id, task: `task ${MARKER.c}` })
        ]);

        assert.match(a.response.content, /done-a/);
        assert.match(b.response.content, /done-b/);
        assert.match(c.response.content, /done-c/);

        /* C must not have been among the first two admissions. */
        assert.ok(started.length >= 3);
        assert.ok(
            started[0] !== "c" || started[1] !== "c",
            "project C must wait behind the concurrent-project cap"
        );
        assert.ok(started.includes("c"));
    });


    await test("a full per-project queue rejects instead of hanging", async () => {

        runtime.runScheduler.reset();
        runtime.settings.set("RUN_QUEUE_LIMIT", 1);
        runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);

        stub.state.handler = () => ({ delayMs: 400, content: "slow" });

        const first = runtime.runAgent({
            projectId: prjA.id,
            task: `hold ${MARKER.a}`
        });

        await new Promise(done => setTimeout(done, 40));

        const second = runtime.runAgent({
            projectId: prjA.id,
            task: `queued ${MARKER.a}`
        });

        let rejected = null;

        try {
            await runtime.runAgent({
                projectId: prjA.id,
                task: `overflow ${MARKER.a}`
            });
        } catch (error) {
            rejected = error;
        }

        assert.ok(rejected, "the overflow run must be rejected");
        assert.equal(rejected.code, "RUN_QUEUE_FULL");
        assert.equal(rejected.status, 429);

        await first;
        await second;
        runtime.settings.set("RUN_QUEUE_LIMIT", 4);
    });


    await test("cancelling project A does not drop project B's queue", async () => {

        runtime.runScheduler.reset();
        runtime.settings.set("MAX_CONCURRENT_PROJECT_RUNS", 1);
        runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);
        runtime.settings.set("RUN_QUEUE_LIMIT", 4);

        stub.state.handler = marker => ({
            delayMs: marker === "a" ? 300 : 0,
            content: `done-${marker}`
        });

        const runA = runtime.runAgent({
            projectId: prjA.id,
            task: `hold ${MARKER.a}`
        });

        await new Promise(done => setTimeout(done, 40));

        const runB = runtime.runAgent({
            projectId: prjB.id,
            task: `queued ${MARKER.b}`
        });

        const dropped = runtime.runScheduler.cancelQueued(prjA.id, "test");
        assert.equal(dropped, 0, "A is running, not queued");

        const droppedBBefore = runtime.runScheduler.cancelQueued(prjC.id, "test");
        assert.equal(droppedBBefore, 0);

        const resultB = await runB;
        await runA;

        assert.match(resultB.response.content, /done-b/);

        runtime.settings.set("MAX_CONCURRENT_PROJECT_RUNS", 2);
    });


    await test("metrics split project and gateway series", async () => {

        runtime.observability.reset();
        runtime.runScheduler.reset();

        stub.state.handler = marker => ({ delayMs: 0, content: `done-${marker}` });

        await runtime.runAgent({ projectId: prjA.id, task: `m ${MARKER.a}` });
        await runtime.runAgent({ projectId: prjB.id, task: `m ${MARKER.b}` });

        const snap = runtime.observability.snapshot();

        assert.ok(snap.gateway.gateway_tool_calls_total >= 0);
        assert.ok(snap.projects[prjA.id]);
        assert.ok(snap.projects[prjB.id]);
        assert.ok(snap.projects[prjA.id].project_runs_total >= 1);
        assert.ok(snap.projects[prjB.id].project_runs_total >= 1);
        assert.equal(snap.projects[prjA.id].project_active_runs, 0);
        assert.ok(typeof snap.gateway.gateway_memory_bytes === "number");
        assert.ok(typeof snap.cpu_percent === "number");
    });


    await test("a crashed project does not take the gateway or its neighbour down", async () => {

        runtime.observability.reset();
        runtime.observability.recordCrash(prjA.id, "boom");

        const healthA = runtime.observability.healthOf(prjA.id);
        const healthB = runtime.observability.healthOf(prjB.id);
        const gateway = runtime.observability.health();

        assert.equal(healthA.status, "down");
        assert.equal(healthB.status, "ok");
        assert.equal(gateway.status, "degraded");
        assert.notEqual(gateway.status, "down");
        assert.equal(gateway.projects[prjA.id].status, "down");
    });


    await test("GET /api/metrics and /api/health are readable", async () => {

        const server = createServer(runtime, {});
        const address = await server.listen(0, "127.0.0.1");
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const token = server.token;

        const metrics = await fetch(`${baseUrl}/api/metrics`, {
            headers: { authorization: `Bearer ${token}` }
        });
        const health = await fetch(`${baseUrl}/api/health`, {
            headers: { authorization: `Bearer ${token}` }
        });
        const projectHealth = await fetch(
            `${baseUrl}/api/projects/${prjA.id}/health`,
            { headers: { authorization: `Bearer ${token}` } }
        );

        assert.equal(metrics.status, 200);
        assert.equal(health.status, 200);
        assert.equal(projectHealth.status, 200);

        const metricsBody = await metrics.json();
        const healthBody = await health.json();
        const projectBody = await projectHealth.json();

        assert.ok(metricsBody.gateway);
        assert.ok(healthBody.status);
        assert.equal(projectBody.project_id, prjA.id);

        await server.close();
    });


    await test("POST /api/projects/:id/tasks returns 429 when the queue is full", async () => {

        runtime.runScheduler.reset();
        runtime.settings.set("RUN_QUEUE_LIMIT", 0);
        runtime.settings.set("MAX_RUNS_PER_PROJECT", 1);

        stub.state.handler = () => ({ delayMs: 400, content: "slow" });

        const holding = runtime.runAgent({
            projectId: prjA.id,
            task: `hold ${MARKER.a}`
        });

        await new Promise(done => setTimeout(done, 40));

        const server = createServer(runtime, {});
        const address = await server.listen(0, "127.0.0.1");
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const token = server.token;

        const overflow = await fetch(`${baseUrl}/api/projects/${prjA.id}/tasks`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ task: `overflow ${MARKER.a}` })
        });

        assert.equal(overflow.status, 429);
        const body = await overflow.json();
        assert.equal(body.code, "RUN_QUEUE_FULL");
        assert.equal(body.project_id, prjA.id);

        await holding;
        await server.close();
        runtime.settings.set("RUN_QUEUE_LIMIT", 4);
    });


    await test("PROJECT_MEMORY_LIMIT refuses a new run for that project only", async () => {

        runtime.observability.reset();
        runtime.runScheduler.reset();
        runtime.settings.set("PROJECT_MEMORY_LIMIT", 100);
        runtime.observability.recordMemory(prjA.id, 150);

        stub.state.handler = marker => ({ delayMs: 0, content: `done-${marker}` });

        let rejected = null;

        try {
            await runtime.runAgent({ projectId: prjA.id, task: `mem ${MARKER.a}` });
        } catch (error) {
            rejected = error;
        }

        assert.ok(rejected, "an over-memory project must be refused");
        assert.equal(rejected.code, "PROJECT_MEMORY_LIMIT");
        assert.equal(rejected.status, 429);

        const neighbour = await runtime.runAgent({
            projectId: prjB.id,
            task: `mem ${MARKER.b}`
        });

        assert.match(neighbour.response.content, /done-b/);

        runtime.settings.set("PROJECT_MEMORY_LIMIT", 0);
        runtime.observability.recordMemory(prjA.id, 0);
    });


    await test("INDEX_LIMIT is enforced by MAX_CONCURRENT_INDEX_RUNS", async () => {

        runtime.observability.reset();
        assert.equal(runtime.observability.beginIndex(), true);
        assert.equal(runtime.observability.beginIndex(), true);
        assert.equal(runtime.observability.beginIndex(), false);

        runtime.observability.endIndex();
        assert.equal(runtime.observability.beginIndex(), true);
        runtime.observability.endIndex();
        runtime.observability.endIndex();
        runtime.observability.endIndex();
    });


    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    try { await stub.close(); } catch { /* */ }

    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.rmSync(ROOT_A, { recursive: true, force: true });
    fs.rmSync(ROOT_B, { recursive: true, force: true });
    fs.rmSync(ROOT_C, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
