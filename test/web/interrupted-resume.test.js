"use strict";

/*
|--------------------------------------------------------------------------
| Continuing after a restart (roadmap P1-06)
|--------------------------------------------------------------------------
|
| The acceptance test of the roadmap item, end to end with real processes:
|
|   1. a console server starts a turn; the agent writes a file, and the
|      model then stalls on its next step;
|   2. the turn is checkpointed while it runs, so the session file holds
|      the tool call and its result with status "running";
|   3. the server is killed (SIGKILL: no shutdown hook runs);
|   4. a new server on the same data home lists the conversation as
|      interrupted, and the session file now says so;
|   5. Continue starts a turn whose model request carries the earlier
|      context (the task, the tool call, its result) and the restart
|      notice; the conversation ends "done";
|   6. Dismiss marks another interrupted conversation as stopped;
|   7. `agent resume` continues a cut-off conversation from the CLI.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { removeTempDirs } = require("../helpers/cleanup");

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const WORKSPACE = temp("resume-ws-");
const DATA_HOME = temp("resume-data-");
const TOKEN = "resume-test-token-0123456789abcdef";
const REPO = path.resolve(__dirname, "..", "..");
const BIN = path.join(REPO, "bin", "agent.js");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";

const RESTART_NOTICE = "The server restarted while you were working";

const requests = [];
const sockets = new Set();
let stalled = 0;


function reply(payload) {

    return {
        role: "assistant",
        content: JSON.stringify({ version: "1.0", delegations: null, data: null, error: null, ...payload })
    };
}

const final = text =>
    reply({ action: "final", tool_calls: null, response: { type: "text", content: text } });

const textOf = message =>
    typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");


/*
| [restart] writes step-one.txt, then never answers the next step (the
| server is killed while it waits). Continued, it answers with what it can
| see of the earlier turn. [cli] answers the CLI's continuation.
*/
function decide(body, res) {

    const messages = body.messages || [];
    const all = messages.map(textOf).join("\n");
    const resumed = messages.some(message => message.role === "user" && textOf(message).includes(RESTART_NOTICE));

    if (all.includes("[cli]")) {
        return final(resumed ? "cli continued" : "cli without notice");
    }

    if (all.includes("[dismiss]")) {
        return final("should not run");
    }

    if (resumed) {

        const sawTool = messages.some(message => message.role === "tool" && textOf(message).includes("step-one.txt"));

        return final(sawTool ? "continued with context" : "continued without context");
    }

    if (messages.some(message => message.role === "tool")) {

        /* the first step is done: hang until the server is killed */
        stalled++;
        res.on("close", () => {});
        return null;
    }

    return reply({
        action: "tool_call",
        tool_calls: [{ id: "c-write-1", name: "fs_write", arguments: { path: "step-one.txt", content: "one\n" }, depends_on: [] }],
        response: null
    });
}


const model = http.createServer((req, res) => {

    let raw = "";

    req.on("data", chunk => (raw += chunk));

    req.on("end", () => {

        const body = JSON.parse(raw || "{}");

        requests.push(body);

        const message = decide(body, res);

        if (!message) {
            return;
        }

        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message }] }));
    });
});

model.on("connection", socket => {

    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
});


function freePort() {

    return new Promise(resolve => {

        const probe = net.createServer();

        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}


function childEnv(extra = {}) {

    return {
        ...process.env,
        WORKSPACE_ROOT: WORKSPACE,
        STRUCTURED_AI_DATA_HOME: DATA_HOME,
        AGENT_CONSOLE_TOKEN: TOKEN,
        AGENT_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
        AGENT_API_KEY: "test",
        AGENT_MODEL: "test-model",
        AGENT_APPROVAL: "auto",
        AGENT_VERBOSE: "0",
        AGENT_PRINT_FINAL: "0",
        MAX_EMPTY_FINAL_NUDGES: "0",
        SESSION_CHECKPOINT_MS: "100",
        RESOURCE_MONITOR_INTERVAL_MS: "0",
        PROCESS_SANDBOX_MODE: "deny",
        ...extra
    };
}


async function startServer() {

    const port = await freePort();
    const child = spawn(process.execPath, [BIN, "-s", String(port), "--host", "127.0.0.1", "-w", WORKSPACE], {
        cwd: REPO,
        env: childEnv(),
        stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", chunk => (output += chunk));
    child.stderr.on("data", chunk => (output += chunk));

    const exited = new Promise(resolve => child.once("exit", resolve));
    const base = `http://127.0.0.1:${port}`;

    await waitFor(async () => {

        if (child.exitCode !== null) {
            throw new Error(`server exited early:\n${output}`);
        }

        try {
            return (await fetch(`${base}/auth/status`)).ok;
        } catch {
            return false;
        }
    }, "the server to listen", 30000);

    const api = async (method, url, body) => {

        const response = await fetch(`${base}${url}`, {
            method,
            headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        return { status: response.status, body: await response.json().catch(() => null) };
    };

    return { child, exited, api, base, output: () => output };
}


async function waitFor(check, label, ms = 20000) {

    const deadline = Date.now() + ms;

    while (Date.now() < deadline) {

        const value = await check();

        if (value) {
            return value;
        }

        await new Promise(done => setTimeout(done, 150));
    }

    throw new Error(`timed out waiting for ${label}`);
}


function sessionFiles() {

    const found = [];

    const walk = folder => {

        let entries = [];

        try {
            entries = fs.readdirSync(folder, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {

            const full = path.join(folder, entry.name);

            if (entry.isDirectory()) {
                walk(full);
            } else if (/^s-.*\.json$/.test(entry.name) && path.basename(folder) === "sessions") {
                found.push(full);
            }
        }
    };

    walk(DATA_HOME);
    walk(WORKSPACE);

    return found;
}


function readSession(file) {

    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}


function findSession(predicate) {

    for (const file of sessionFiles()) {

        const session = readSession(file);

        if (session && predicate(session)) {
            return { file, session };
        }
    }

    return null;
}


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


async function main() {

    await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));

    let first = null;
    let second = null;
    let restartId = null;
    let dismissId = null;

    try {

        await test("a running turn is checkpointed, so a killed server leaves its progress on disk", async () => {

            first = await startServer();

            const started = await first.api("POST", "/api/tasks", { task: "write the first step [restart]" });
            assert.equal(started.status, 202, JSON.stringify(started.body));

            await waitFor(() => stalled > 0, "the model to stall after the first step");

            const saved = await waitFor(() => findSession(session =>
                session.status === "running" &&
                session.task === "write the first step [restart]" &&
                Array.isArray(session.history) &&
                session.history.some(message => message.role === "tool" && textOf(message).includes("step-one.txt"))
            ), "the checkpoint with the tool result");

            restartId = saved.session.id;
            assert.ok(fs.existsSync(path.join(WORKSPACE, "step-one.txt")), "the first step really ran");

            first.child.kill("SIGKILL");
            await first.exited;
        });

        await test("after a restart the conversation is listed as interrupted", async () => {

            /* a second conversation cut off by the same crash, to dismiss */
            const sessions = require(path.join(REPO, "agent", "persistence", "SessionRepository.js"));
            const other = sessions.emptySession();
            other.status = "running";
            other.task = "something else [dismiss]";
            other.messages.push({ at: Date.now() - 1000, role: "user", kind: "message", content: other.task });
            sessions.saveSession(other);
            dismissId = other.id;

            second = await startServer();

            const listed = await second.api("GET", "/api/interrupted");
            assert.equal(listed.status, 200);

            const ids = listed.body.sessions.map(item => item.id);
            assert.ok(ids.includes(restartId), `listed: ${JSON.stringify(listed.body)}`);
            assert.ok(ids.includes(dismissId));

            const entry = listed.body.sessions.find(item => item.id === restartId);
            assert.equal(entry.task, "write the first step [restart]");
            assert.equal(entry.project_id, null);
            assert.ok(entry.interrupted_at);
            assert.equal(entry.root, undefined, "the storage path is not shown");

            assert.equal(readSession(findSession(session => session.id === restartId).file).status, "interrupted");
        });

        await test("Continue resumes the turn with the same context", async () => {

            const before = requests.length;
            const resumed = await second.api("POST", `/api/interrupted/${encodeURIComponent(restartId)}/resume`, {});

            assert.equal(resumed.status, 202, JSON.stringify(resumed.body));
            assert.equal(resumed.body.where, "foreground");

            const done = await waitFor(() => findSession(session => session.id === restartId && session.status === "done"), "the continued turn");

            const request = requests.slice(before).find(body =>
                (body.messages || []).some(message => message.role === "user" && textOf(message).includes(RESTART_NOTICE))
            );

            assert.ok(request, "the model was asked to continue");
            assert.ok(request.messages.some(message => textOf(message).includes("write the first step [restart]")), "the original task is in the context");
            assert.ok(request.messages.some(message => message.role === "tool" && textOf(message).includes("step-one.txt")), "the earlier tool result is in the context");

            assert.ok(
                done.session.messages.some(message => message.role === "assistant" && message.content === "continued with context"),
                JSON.stringify(done.session.messages.slice(-3))
            );

            const listed = await second.api("GET", "/api/interrupted");
            assert.ok(!listed.body.sessions.some(item => item.id === restartId), "no longer interrupted");

            assert.equal((await second.api("POST", `/api/interrupted/${encodeURIComponent(restartId)}/resume`, {})).status, 404);
        });

        await test("Dismiss marks an interrupted conversation as stopped", async () => {

            const dismissed = await second.api("DELETE", `/api/interrupted/${encodeURIComponent(dismissId)}`);
            assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));

            assert.equal(readSession(findSession(session => session.id === dismissId).file).status, "cancelled");
            assert.ok(!(await second.api("GET", "/api/interrupted")).body.sessions.some(item => item.id === dismissId));
            assert.ok(!requests.some(body => (body.messages || []).some(message => textOf(message).includes("[dismiss]"))));
        });

        await test("an unknown conversation is 404 and the routes need a token", async () => {

            assert.equal((await second.api("POST", "/api/interrupted/s-nope/resume", {})).status, 404);
            assert.equal((await second.api("DELETE", "/api/interrupted/s-nope")).status, 404);

            const anonymous = await fetch(`${second.base}/api/interrupted`);
            assert.equal(anonymous.status, 401);
        });

        second.child.kill("SIGTERM");
        await Promise.race([second.exited, new Promise(done => setTimeout(done, 5000))]);
        second = null;

        await test("agent resume continues the newest cut-off conversation from the CLI", async () => {

            const sessions = require(path.join(REPO, "agent", "persistence", "SessionRepository.js"));
            const cut = sessions.emptySession();
            cut.status = "running";
            cut.task = "the cli task [cli]";
            cut.history = [
                { role: "system", content: "You are a test agent." },
                { role: "user", content: "the cli task [cli]" }
            ];
            cut.messages.push({ at: Date.now(), role: "user", kind: "message", content: cut.task });
            sessions.saveSession(cut);

            const run = await new Promise(resolve => {

                const child = spawn(process.execPath, [BIN, "resume", "-w", WORKSPACE], {
                    cwd: REPO,
                    env: childEnv(),
                    stdio: ["ignore", "pipe", "pipe"]
                });

                let stdout = "";
                let stderr = "";
                child.stdout.on("data", chunk => (stdout += chunk));
                child.stderr.on("data", chunk => (stderr += chunk));
                child.on("exit", code => resolve({ code, stdout, stderr }));
            });

            assert.equal(run.code, 0, run.stderr);
            assert.match(run.stdout, /cli continued/);
            assert.match(run.stderr, new RegExp(cut.id));

            const saved = readSession(findSession(session => session.id === cut.id).file);
            assert.equal(saved.status, "done");
            assert.ok(saved.messages.some(message => message.kind === "resume"));
            assert.ok(saved.messages.some(message => message.content === "cli continued"));

            /* a finished conversation needs a message */
            const again = await new Promise(resolve => {

                const child = spawn(process.execPath, [BIN, "resume", cut.id, "-w", WORKSPACE], {
                    cwd: REPO,
                    env: childEnv(),
                    stdio: ["ignore", "pipe", "pipe"]
                });

                let stderr = "";
                child.stderr.on("data", chunk => (stderr += chunk));
                child.on("exit", code => resolve({ code, stderr }));
            });

            assert.notEqual(again.code, 0);
            assert.match(again.stderr, /give a message to continue it/);
        });

    } finally {

        for (const server of [first, second]) {

            if (server && server.child.exitCode === null) {
                server.child.kill("SIGKILL");
                await server.exited;
            }
        }

        for (const socket of sockets) {
            socket.destroy();
        }

        model.close();
    }

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    await removeTempDirs(null, WORKSPACE, DATA_HOME);

    process.exit(failed === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
