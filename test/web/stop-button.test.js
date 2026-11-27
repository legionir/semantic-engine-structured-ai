"use strict";

/*
| The console's Stop button really stops the run.
|
| Regression: with no project selected the console's state.projectId is
| null while the run is tracked under the workspace's default project, so
| POST /api/cancel matched nothing, "cancelled" the idle legacy run and
| answered 200 — the model kept being called and a running terminal_exec
| (a build, a `sleep`) kept going until its own timeout. The tool layer
| never received the run's AbortSignal either.
*/

const assert = require("assert");
const fs = require("fs");
const { removeTempDirs } = require("../helpers/cleanup");
const http = require("http");
const os = require("os");
const path = require("path");

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const WORKSPACE = temp("stop-default-");
const PROJECT_ROOT = temp("stop-prj-");
const DATA_HOME = temp("stop-data-");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "test-model";
process.env.AGENT_APPROVAL = "auto";
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.TERMINAL_CANCEL_GRACE_MS = "500";
process.env.TOOL_CANCEL_WAIT_MS = "300";

const REPO = path.resolve(__dirname, "..", "..");

const PID_FILE = "stop-pid.txt";
/* portable under sh and cmd.exe: records its pid, then idles for a minute */
const LONG_COMMAND =
    `node -e "require('fs').writeFileSync('${PID_FILE}', String(process.pid)); setTimeout(function () {}, 60000)"`;

const SLOW_MODEL_MS = 30000;

const sockets = new Set();
const modelCalls = { slow: 0, open: 0 };


function reply(payload) {

    return {
        role: "assistant",
        content: JSON.stringify({ version: "1.0", delegations: null, data: null, error: null, ...payload })
    };
}

const final = text =>
    reply({ action: "final", tool_calls: null, response: { type: "text", content: text } });

const call = (name, args) =>
    reply({
        action: "tool_call",
        tool_calls: [{ id: `c-${name}-${Date.now()}`, name, arguments: args, depends_on: [] }],
        response: null
    });

const textOf = message =>
    typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");


function decide(body) {

    const all = body.messages || [];
    /* this turn only: the conversation history holds the earlier tasks */
    let at = -1;
    for (let index = all.length - 1; index >= 0 && at === -1; index--) {
        if (all[index].role === "user" && /\[(shell|slow)\]/.test(textOf(all[index]))) at = index;
    }
    const messages = all.slice(Math.max(at, 0));
    const task = at === -1 ? "" : textOf(all[at]);
    const tools = messages.filter(message => message.role === "tool").length;

    if (task.includes("[shell]")) {
        return { delay: 20, message: tools > 0 ? final("the command finished") : call("terminal_exec", { command: LONG_COMMAND, timeout_ms: 60000 }) };
    }

    if (task.includes("[slow]")) {
        return { delay: SLOW_MODEL_MS, message: final("slow answer"), slow: true };
    }

    return { delay: 20, message: final("done") };
}


const model = http.createServer((req, res) => {

    let raw = "";

    req.on("data", chunk => (raw += chunk));

    req.on("end", () => {

        const { delay, message, slow } = decide(JSON.parse(raw || "{}"));

        if (slow) modelCalls.slow++;
        modelCalls.open++;

        const timer = setTimeout(() => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ choices: [{ message }] }));
        }, delay);

        res.on("close", () => {
            clearTimeout(timer);
            modelCalls.open--;
        });
    });
});

model.on("connection", socket => {

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
        console.log(`       ${error.stack}`);
    }
}


function alive(pid) {

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}


async function main() {

    /* ---------------------------------------------------------- units */

    const { raceRunSignal } = require(path.join(REPO, "agent", "runtime", "RunSignalRace.js"));
    const ToolContext = require(path.join(REPO, "agent", "tools", "ToolContext.js"));

    await test("raceRunSignal: without a signal the work is returned untouched", async () => {

        assert.equal(await raceRunSignal(Promise.resolve(7), null), 7);
    });

    await test("raceRunSignal: work that ignores the abort is abandoned after waitMs", async () => {

        const controller = new AbortController();
        const never = new Promise(() => {});
        const startedAt = Date.now();

        setTimeout(() => controller.abort(), 20);

        await assert.rejects(
            raceRunSignal(never, controller.signal, { waitMs: 50, stopError: () => new Error("Run cancelled (test): tool x") }),
            /Run cancelled \(test\): tool x/
        );

        assert.ok(Date.now() - startedAt < 2000);
    });

    await test("raceRunSignal: work that reacts to the abort reports its own result", async () => {

        const controller = new AbortController();
        const work = new Promise(resolve => controller.signal.addEventListener("abort", () => resolve({ cancelled: true })));

        setTimeout(() => controller.abort(), 10);

        assert.deepEqual(await raceRunSignal(work, controller.signal, { waitMs: 1000 }), { cancelled: true });
    });

    await test("raceRunSignal: an already-aborted signal stops at once", async () => {

        const controller = new AbortController();

        controller.abort();

        await assert.rejects(raceRunSignal(new Promise(() => {}), controller.signal, { waitMs: 0 }), /Run cancelled/);
    });

    await test("ToolContext carries the run's AbortSignal and drops anything else", () => {

        const controller = new AbortController();

        assert.equal(ToolContext.from({ agent: "a", signal: controller.signal }).signal, controller.signal);
        assert.equal(ToolContext.from({ agent: "a", signal: "nope" }).signal, null);
        assert.equal(ToolContext.from(undefined).signal, null);
    });

    /* ------------------------------------------------------ the server */

    await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));

    process.env.AGENT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;

    const projects = require(path.join(REPO, "agent", "projects", "index.js"));

    projects.registry().register({ id: "prj-bg", name: "BG", rootPath: PROJECT_ROOT });

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    const web = createServer(runtime, { apiRateLimit: 100000 });
    const address = await web.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { "content-type": "application/json", authorization: `Bearer ${web.token}` };

    const api = async (method, url, body) => {

        const response = await fetch(`${base}${url}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        return { status: response.status, body: await response.json() };
    };

    const waitFor = async (check, label, ms = 15000) => {

        const deadline = Date.now() + ms;

        while (Date.now() < deadline) {

            const value = await check();

            if (value) {
                return value;
            }

            await new Promise(done => setTimeout(done, 50));
        }

        throw new Error(`timed out waiting for ${label}`);
    };

    const foregroundState = async () => (await api("GET", "/api/state")).body;

    const conversation = async projectId =>
        (await api("GET", "/api/conversations")).body.conversations.find(item => item.project_id === projectId);

    try {

        await test("Stop kills a running shell command and ends the run as cancelled", async () => {

            const pidPath = path.join(WORKSPACE, PID_FILE);

            assert.equal((await api("POST", "/api/tasks", { task: "[shell] run the long command" })).status, 202);

            const pid = await waitFor(() => {
                try {
                    return Number(fs.readFileSync(pidPath, "utf8")) || null;
                } catch {
                    return null;
                }
            }, "the command to start");

            assert.ok(alive(pid), "the command runs before Stop");

            const stoppedAt = Date.now();
            const cancel = await api("POST", "/api/cancel");

            assert.equal(cancel.status, 200);
            assert.equal(cancel.body.cancelled, true);

            const settled = await waitFor(async () => {
                const state = await foregroundState();
                return state.status !== "running" ? state : null;
            }, "the run to stop", 10000);

            assert.equal(settled.status, "cancelled", "a stopped run reads cancelled, not failed");
            assert.ok(Date.now() - stoppedAt < 10000, "Stop must not wait for the command's own 60 s timeout");

            await waitFor(() => !alive(pid), "the command's process to exit", 10000);
        });

        await test("Stop aborts a model request in flight", async () => {

            const before = modelCalls.slow;

            assert.equal((await api("POST", "/api/tasks", { task: "[slow] think for a long time" })).status, 202);

            await waitFor(() => modelCalls.slow > before && modelCalls.open > 0, "the model request");

            const stoppedAt = Date.now();

            assert.equal((await api("POST", "/api/cancel")).status, 200);

            const settled = await waitFor(async () => {
                const state = await foregroundState();
                return state.status !== "running" ? state : null;
            }, "the run to stop", 10000);

            assert.equal(settled.status, "cancelled");
            assert.ok(Date.now() - stoppedAt < SLOW_MODEL_MS / 2, "the run did not wait for the model's answer");

            await waitFor(() => modelCalls.open === 0, "the model connection to close", 5000);
        });

        await test("stopping the foreground leaves a background project's run going; its own cancel stops it", async () => {

            assert.equal((await api("POST", "/api/tasks", { task: "[slow] foreground" })).status, 202);
            await waitFor(async () => (await foregroundState()).status === "running", "the foreground run");

            assert.equal((await api("POST", "/api/projects/prj-bg/tasks", { task: "[slow] background" })).status, 202);
            await waitFor(async () => (await conversation("prj-bg"))?.status === "running", "the background run");

            assert.equal((await api("POST", "/api/cancel")).status, 200);

            await waitFor(async () => (await foregroundState()).status === "cancelled", "the foreground to stop", 10000);

            assert.equal((await conversation("prj-bg")).status, "running", "a foreground Stop must not stop another project");

            const cancelled = await api("POST", "/api/projects/prj-bg/cancel");

            assert.equal(cancelled.status, 200);
            assert.equal(cancelled.body.run_ids.length, 1);

            const item = await waitFor(async () => {
                const conv = await conversation("prj-bg");
                return conv && conv.status !== "running" ? conv : null;
            }, "the background run to stop", 10000);

            assert.equal(item.status, "cancelled");
        });

    } finally {

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

        model.close();
    }

    const passed = results.filter(Boolean).length;

    console.log(`\n${passed}/${results.length} passed`);

    await removeTempDirs(runtime, WORKSPACE, PROJECT_ROOT, DATA_HOME);

    process.exit(passed === results.length ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
