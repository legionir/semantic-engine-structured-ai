"use strict";

/*
|--------------------------------------------------------------------------
| The web API no longer serialises the whole process (plan phase 7 / step 3)
|--------------------------------------------------------------------------
|
| Project A and project B run at the same time; a second run for the SAME
| project is refused; the foreground (default) run does not block a project.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "web-conc-default-"));
const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "web-conc-a-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "web-conc-b-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "web-conc-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "test-model";
process.env.AGENT_APPROVAL = "auto";

const REPO = path.resolve(__dirname, "..", "..");

const overlap = { current: 0, max: 0 };
const sockets = new Set();

const server = http.createServer((req, res) => {

    req.on("data", () => {});

    req.on("end", () => {

        overlap.current++;
        overlap.max = Math.max(overlap.max, overlap.current);

        setTimeout(() => {

            overlap.current--;

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

        }, 500);
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


async function main() {

    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    process.env.AGENT_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;

    const projects = require(path.join(REPO, "agent", "projects", "index.js"));

    projects.registry().register({ id: "prj-a", name: "A", rootPath: ROOT_A });
    projects.registry().register({ id: "prj-b", name: "B", rootPath: ROOT_B });

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    const web = createServer(runtime, {});
    const address = await web.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;

    const api = async (method, url, body) => {

        const response = await fetch(`${base}${url}`, {
            method,
            headers: { "content-type": "application/json", authorization: `Bearer ${web.token}` },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        return { status: response.status, body: await response.json() };
    };

    const waitIdle = async (projectId, ms = 15000) => {

        const deadline = Date.now() + ms;

        while (Date.now() < deadline) {

            const { body } = await api("GET", `/api/projects/${projectId}/run`);

            if (body.status !== "running") {
                return body;
            }

            await new Promise(done => setTimeout(done, 100));
        }

        throw new Error(`project ${projectId} never left running`);
    };

    await test("two different projects run at the same time (no process-wide busy gate)", async () => {

        const a = await api("POST", "/api/projects/prj-a/tasks", { task: "task a" });
        const b = await api("POST", "/api/projects/prj-b/tasks", { task: "task b" });

        assert.strictEqual(a.status, 202);
        assert.strictEqual(b.status, 202, `second project was refused: ${JSON.stringify(b.body)}`);

        const [doneA, doneB] = await Promise.all([waitIdle("prj-a"), waitIdle("prj-b")]);

        assert.strictEqual(doneA.status, "done");
        assert.strictEqual(doneB.status, "done");
        assert.ok(overlap.max >= 2, `the two model calls never overlapped (max ${overlap.max})`);
    });

    await test("a second run for the SAME project is refused while the first runs", async () => {

        const first = await api("POST", "/api/projects/prj-a/tasks", { task: "first" });
        const duplicate = await api("POST", "/api/projects/prj-a/tasks", { task: "duplicate" });

        assert.strictEqual(first.status, 202);
        assert.strictEqual(duplicate.status, 409);
        assert.match(duplicate.body.error, /already has a run/);

        assert.strictEqual((await waitIdle("prj-a")).status, "done");

        const again = await api("POST", "/api/projects/prj-a/tasks", { task: "after" });

        assert.strictEqual(again.status, 202, "the project accepts work again once idle");

        await waitIdle("prj-a");
    });

    await test("the legacy default-project route keeps its single-run gate", async () => {

        const one = await api("POST", "/api/tasks", { task: "default one" });
        const two = await api("POST", "/api/tasks", { task: "default two" });

        assert.strictEqual(one.status, 202);
        assert.strictEqual(two.status, 409);

        /* while the default run is in the foreground a project still starts */
        const project = await api("POST", "/api/projects/prj-b/tasks", { task: "in background" });

        assert.strictEqual(project.status, 202);

        const done = await waitIdle("prj-b");

        assert.strictEqual(done.status, "done");
        assert.strictEqual(done.background, true, "it must have run beside the foreground run");

        const state = await api("GET", "/api/state");

        assert.ok(["running", "done"].includes(state.body.status));
    });

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    try {
        if (typeof web.closeAllConnections === "function") web.closeAllConnections();
        await Promise.race([new Promise(done => web.close(done)), new Promise(done => setTimeout(done, 1000))]);
        await runtime.shutdown?.();
    } catch {
        /* best effort */
    }

    for (const socket of sockets) {
        socket.destroy();
    }

    server.close();

    for (const dir of [WORKSPACE, ROOT_A, ROOT_B, DATA_HOME]) {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
