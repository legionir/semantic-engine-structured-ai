"use strict";

/*
|--------------------------------------------------------------------------
| Every started run ends with exactly one terminal event (plan phase 7 / 1)
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "run-terminal-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "run-terminal-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "test-model";
process.env.MODEL_MAX_RETRIES = "0";

const REPO = path.resolve(__dirname, "..", "..");

let mode = "ok";
let failedRunId = null;

const server = http.createServer((req, res) => {

    req.on("data", () => {});

    req.on("end", () => {

        if (mode === "fail") {

            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { message: "boom from model" } }));
            return;
        }

        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
            choices: [{
                message: {
                    role: "assistant",
                    content: JSON.stringify({
                        version: "1.0", action: "final", tool_calls: null, delegations: null,
                        response: { type: "text", content: "fine" }, data: null, error: null
                    })
                }
            }]
        }));
    });
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


async function main() {

    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    process.env.AGENT_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;

    const runtime = require(path.join(REPO, "agent", "agent.js"));

    const seen = [];

    runtime.events.bus.on("event", event => {

        if (["run:start", "run:end", "run:error"].includes(event.type)) {
            seen.push(event);
        }
    });

    const snapshot = () => {

        const gateway = runtime.observability.gateway;

        return { active: gateway.gateway_active_runs, failed: gateway.gateway_failed_runs };
    };

    await test("a successful run emits run:start then exactly one run:end", async () => {

        seen.length = 0;
        mode = "ok";

        const before = snapshot();

        await runtime.runAgent({ task: "say fine" });

        assert.deepStrictEqual(seen.map(event => event.type), ["run:start", "run:end"]);
        assert.strictEqual(runtime.runManager.get(seen[0].run_id).status, "completed");
        assert.strictEqual(snapshot().active, before.active);
        assert.strictEqual(snapshot().failed, before.failed);
    });

    await test("a model failure ends the run with exactly one run:error and a consistent metric", async () => {

        seen.length = 0;
        mode = "fail";

        const before = snapshot();

        let thrown = null;

        try {
            await runtime.runAgent({ task: "this will fail" });
        } catch (error) {
            thrown = error;
        }

        assert.ok(thrown, "the failure must reach the caller");
        assert.strictEqual(thrown.runTerminalEmitted, true);

        assert.deepStrictEqual(seen.map(event => event.type), ["run:start", "run:error"]);
        assert.ok(seen[1].message, "run:error must carry the message");
        assert.strictEqual(runtime.runManager.get(seen[0].run_id).status, "failed", "terminal state must be failed, never overwritten by completed");
        failedRunId = seen[0].run_id;
        assert.strictEqual(snapshot().active, before.active, "active-run gauge must not stay incremented");
        assert.strictEqual(snapshot().failed, before.failed + 1);
    });

    await test("the next run after a failure starts clean", async () => {

        seen.length = 0;
        mode = "ok";

        await runtime.runAgent({ task: "say fine again" });

        assert.deepStrictEqual(seen.map(event => event.type), ["run:start", "run:end"]);
        assert.notStrictEqual(seen[0].run_id, failedRunId, "a retry gets a new run id / context, it never reuses the failed one");
        assert.strictEqual(runtime.runManager.get(failedRunId).status, "failed");
    });

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    server.close();
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
