"use strict";

/*
|--------------------------------------------------------------------------
| Queued runs are tracked, cancellable by id, and reached by signals
| (plan phase 7 / step 2)
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const { removeTempDirs } = require("../helpers/cleanup");
const http = require("http");
const os = require("os");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "queued-cancel-"));
const PROJECT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "queued-cancel-a-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "queued-cancel-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "test-model";
process.env.MODEL_MAX_RETRIES = "0";
process.env.MAX_RUNS_PER_PROJECT = "1";

const REPO = path.resolve(__dirname, "..", "..");

let modelDelayMs = 400;

const sockets = new Set();

const server = http.createServer((req, res) => {

    req.on("data", () => {});

    req.on("end", () => {

        setTimeout(() => {

            if (res.destroyed) {
                return;
            }

            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                choices: [{
                    message: {
                        role: "assistant",
                        content: JSON.stringify({
                            version: "1.0", action: "final", tool_calls: null, delegations: null,
                            response: { type: "text", content: "done" }, data: null, error: null
                        })
                    }
                }]
            }));

        }, modelDelayMs);
    });
});

server.on("connection", socket => {

    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
});

const results = [];

async function test(name, fn) {

    try {

        await fn();
        results.push(true);
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push(false);
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

const settle = promise =>
    promise.then(
        value => ({ ok: true, value }),
        error => ({ ok: false, error })
    );


async function main() {

    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    process.env.AGENT_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;

    const runtime = require(path.join(REPO, "agent", "agent.js"));

    runtime.projects.registry().register({ id: "prj-q", name: "Q", rootPath: PROJECT_ROOT });

    const { runManager, runScheduler } = runtime;

    async function startTwo() {

        const first = settle(runtime.runAgent({ task: "first", projectId: "prj-q" }));

        await tick(100);

        const second = settle(runtime.runAgent({ task: "second", projectId: "prj-q" }));

        await tick(100);

        return { first, second };
    }

    await test("a waiting run is tracked as queued and is visible by id", async () => {

        modelDelayMs = 400;

        const { first, second } = await startTwo();

        const queued = runManager.queuedRuns();

        assert.strictEqual(queued.length, 1);
        assert.strictEqual(queued[0].status, "queued");
        assert.ok(runManager.get(queued[0].runId));
        assert.strictEqual(runManager.activeRuns().length, 1);

        const a = await first;
        const b = await second;

        assert.ok(a.ok && b.ok, "both runs eventually complete");
        assert.strictEqual(runManager.queuedRuns().length, 0);
        assert.strictEqual(runManager.activeRuns().length, 0);
    });

    await test("cancel by id removes a queued run: RUN_CANCELLED, no stale queue/active/handle", async () => {

        modelDelayMs = 400;

        const { first, second } = await startTwo();

        const queuedId = runManager.queuedRuns()[0].runId;

        assert.strictEqual(runtime.cancelRunById(queuedId, "test-cancel") !== false, true);

        const b = await second;

        assert.strictEqual(b.ok, false);
        assert.strictEqual(b.error.code, "RUN_CANCELLED");

        assert.strictEqual(runManager.queuedRuns().length, 0);
        assert.strictEqual(runManager.get(queuedId).status, "cancelled");
        assert.deepStrictEqual(runScheduler.snapshot().queues, {});

        const a = await first;

        assert.ok(a.ok, "the running run is untouched by cancelling the queued one");
        assert.strictEqual(runManager.activeRuns().length, 0);

        const third = await settle(runtime.runAgent({ task: "third", projectId: "prj-q" }));

        assert.ok(third.ok, "the project keeps working after a queued cancellation");
    });

    await test("a full queue rejects and leaves no stale run behind", async () => {

        modelDelayMs = 400;

        runtime.settings.set("RUN_QUEUE_LIMIT", 0);

        try {

            const first = settle(runtime.runAgent({ task: "first", projectId: "prj-q" }));

            await tick(100);

            const overflow = await settle(runtime.runAgent({ task: "overflow", projectId: "prj-q" }));

            assert.strictEqual(overflow.ok, false);
            assert.strictEqual(overflow.error.code, "RUN_QUEUE_FULL");
            assert.strictEqual(runManager.queuedRuns().length, 0);

            await first;

        } finally {

            runtime.settings.reset("RUN_QUEUE_LIMIT");
        }
    });

    await test("the signal path (cancelAllRuns) cancels active AND queued runs", async () => {

        modelDelayMs = 2000;

        const { first, second } = await startTwo();

        assert.strictEqual(runManager.activeRuns().length, 1);
        assert.strictEqual(runManager.queuedRuns().length, 1);

        runtime.cancelAllRuns("sigterm");

        const a = await first;
        const b = await second;

        assert.strictEqual(a.ok, false, "the active run must be cancelled");
        assert.strictEqual(b.ok, false, "the queued run must be cancelled");
        assert.strictEqual(b.error.code, "RUN_CANCELLED");
        assert.strictEqual(runManager.activeRuns().length, 0);
        assert.strictEqual(runManager.queuedRuns().length, 0);
    });

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    for (const socket of sockets) {
        socket.destroy();
    }

    server.close();

    await removeTempDirs(runtime, WORKSPACE, PROJECT_ROOT, DATA_HOME);

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
