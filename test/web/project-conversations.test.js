"use strict";

/*
|--------------------------------------------------------------------------
| Parallel project conversations, the message queue and corrections
|--------------------------------------------------------------------------
|
| Roadmap P1-03 / P1-04: three projects run at once beside the foreground,
| each in its own conversation (transcript, status, events, approvals); a
| message to a busy project waits in an editable queue; a cancel pauses the
| queue instead of emptying it; a course correction reaches the running
| turn at its next iteration.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const { removeTempDirs } = require("../helpers/cleanup");
const http = require("http");
const os = require("os");
const path = require("path");

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const WORKSPACE = temp("conv-default-");
const ROOTS = { a: temp("conv-a-"), b: temp("conv-b-"), c: temp("conv-c-") };
const DATA_HOME = temp("conv-data-");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "test-model";
process.env.AGENT_APPROVAL = "auto";

const REPO = path.resolve(__dirname, "..", "..");

const CORRECTION_PREFIX = "Course correction from the operator";

const overlap = { current: 0, max: 0 };
const requests = [];
const sockets = new Set();


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


/* the operator's message of this turn: the last user message that is not
   runtime context or a correction */
function taskIndex(messages) {

    for (let index = messages.length - 1; index >= 0; index--) {

        const message = messages[index];
        const text = textOf(message);

        if (message.role === "user" && !text.startsWith("{") && !text.startsWith(CORRECTION_PREFIX)) {
            return index;
        }
    }

    return -1;
}


function decide(body) {

    const all = body.messages || [];
    const at = taskIndex(all);
    const task = at === -1 ? "" : textOf(all[at]);
    /* only this turn's messages: a conversation's history holds earlier turns */
    const messages = all.slice(Math.max(at, 0));
    const tools = messages.filter(message => message.role === "tool").length;

    if (task.includes("[approve]")) {
        return { delay: 100, message: tools > 0 ? final("written") : call("fs_write", { path: "approved.txt", content: "yes\n" }) };
    }

    if (task.includes("[correct]")) {

        if (messages.some(message => message.role === "user" && textOf(message).includes("use plan B"))) {
            return { delay: 50, message: final("corrected") };
        }

        return { delay: 700, message: tools >= 3 ? final("no correction arrived") : call("fs_list", { path: "." }) };
    }

    return { delay: task.includes("[slow]") ? 1200 : 150, message: final(`done: ${task.slice(-40)}`) };
}


const model = http.createServer((req, res) => {

    let raw = "";

    req.on("data", chunk => (raw += chunk));

    req.on("end", () => {

        const body = JSON.parse(raw || "{}");
        const { delay, message } = decide(body);

        requests.push(body);
        overlap.current++;
        overlap.max = Math.max(overlap.max, overlap.current);

        setTimeout(() => {

            overlap.current--;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ choices: [{ message }] }));
        }, delay);
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


async function main() {

    await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));

    process.env.AGENT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;

    const projects = require(path.join(REPO, "agent", "projects", "index.js"));

    for (const [key, root] of Object.entries(ROOTS)) {
        projects.registry().register({ id: `prj-${key}`, name: key.toUpperCase(), rootPath: root });
    }

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

    const waitFor = async (check, label, ms = 20000) => {

        const deadline = Date.now() + ms;

        while (Date.now() < deadline) {

            const value = await check();

            if (value) {
                return value;
            }

            await new Promise(done => setTimeout(done, 80));
        }

        throw new Error(`timed out waiting for ${label}`);
    };

    const conversation = async projectId =>
        (await api("GET", "/api/conversations")).body.conversations
            .find(item => item.project_id === projectId);

    /* settled: not running and nothing left to start from its queue */
    const settled = projectId =>
        waitFor(async () => {

            const item = await conversation(projectId);

            return item && item.status !== "running" && (item.queue_length === 0 || item.queue_paused)
                ? item
                : null;
        }, `${projectId} to settle`);

    const foregroundIdle = () =>
        waitFor(async () => (await api("GET", "/api/state")).body.status !== "running", "the foreground");

    /* the snapshot a project's stream starts from */
    const streamSnapshot = async projectId => {

        const controller = new AbortController();
        const response = await fetch(`${base}/api/events?projectId=${encodeURIComponent(projectId)}`, {
            headers,
            signal: controller.signal
        });

        const decoder = new TextDecoder();
        let buffer = "";

        try {

            for await (const chunk of response.body) {

                buffer += decoder.decode(chunk, { stream: true });

                const end = buffer.indexOf("\n\n");

                if (end !== -1) {

                    const line = buffer.slice(0, end).split("\n").find(entry => entry.startsWith("data: "));
                    const payload = JSON.parse(line.slice("data: ".length));

                    assert.equal(payload.type, "snapshot");
                    return payload.snapshot;
                }
            }

        } finally {

            controller.abort();
        }

        throw new Error("the stream closed before its snapshot");
    };

    const userTexts = snapshot =>
        snapshot.messages.filter(message => message.role === "user").map(message => message.content);

    await test("three projects run at once beside the foreground, each in its own conversation", async () => {

        overlap.max = 0;

        assert.equal((await api("POST", "/api/tasks", { task: "[slow] default work" })).status, 202);

        for (const key of ["a", "b", "c"]) {

            const started = await api("POST", `/api/projects/prj-${key}/tasks`, { task: `[slow] task-${key}` });

            assert.equal(started.status, 202, JSON.stringify(started.body));
        }

        const running = await waitFor(async () => {

            const list = (await api("GET", "/api/conversations")).body.conversations;
            const busy = list.filter(item => item.project_id && item.status === "running");

            return busy.length === 3 ? busy : null;
        }, "three running conversations");

        assert.ok(running.every(item => item.background === true), "the foreground was taken, so all three run in the background");

        for (const key of ["a", "b", "c"]) {
            assert.equal((await settled(`prj-${key}`)).status, "done");
        }

        await foregroundIdle();

        assert.ok(overlap.max >= 4, `the foreground and three projects should overlap (max ${overlap.max})`);

        for (const key of ["a", "b", "c"]) {

            const snapshot = await streamSnapshot(`prj-${key}`);

            assert.equal(snapshot.status, "done");
            assert.equal(snapshot.conversation, "background");
            assert.deepStrictEqual(userTexts(snapshot), [`[slow] task-${key}`]);
            assert.ok(
                snapshot.messages.some(message => message.kind === "response" && message.content.includes(`task-${key}`)),
                "the project's answer is in its own transcript"
            );
            assert.ok(snapshot.messages.some(message => message.kind === "git-report"), "a background turn reports git too");
            assert.ok(snapshot.events.some(event => event.type === "run:start" && event.project_id === `prj-${key}`));
            assert.ok(
                snapshot.events.some(event => event.type === "run:status" && event.project_id === `prj-${key}` && event.status === "done"),
                "the project's stream sees its own run:status"
            );
            assert.ok(
                !snapshot.events.some(event => event.project_id && event.project_id !== `prj-${key}`),
                "no other project's event reaches this stream"
            );
        }

        /* the foreground conversation holds none of the projects' messages */
        const state = (await api("GET", "/api/state")).body;

        assert.deepStrictEqual(
            state.messages.filter(message => message.role === "user").map(message => message.content),
            ["[slow] default work"]
        );
    });

    await test("a message to a busy project waits in its editable queue and runs next", async () => {

        assert.equal((await api("POST", "/api/projects/prj-a/tasks", { task: "[slow] q-first" })).status, 202);

        await waitFor(async () => (await conversation("prj-a")).status === "running", "prj-a running");

        const second = await api("POST", "/api/projects/prj-a/tasks", { task: "q-second" });
        const third = await api("POST", "/api/projects/prj-a/chat", { message: "q-third" });

        assert.equal(second.status, 202);
        assert.equal(second.body.queued, true);
        assert.equal(second.body.queued_message.text, "q-second");
        assert.equal(third.body.queue_length, 2);

        const refused = await api("POST", "/api/projects/prj-a/tasks", { task: "no queue", queue: false });

        assert.equal(refused.status, 409, "queue:false keeps the historical refusal");

        const listed = await api("GET", "/api/projects/prj-a/queue");

        assert.deepStrictEqual(listed.body.items.map(item => item.text), ["q-second", "q-third"]);

        const edited = await api("PATCH", `/api/projects/prj-a/queue/${listed.body.items[0].id}`, { text: "q-second-edited" });

        assert.equal(edited.status, 200);
        assert.equal(edited.body.item.text, "q-second-edited");

        assert.equal((await api("DELETE", `/api/projects/prj-a/queue/${listed.body.items[1].id}`)).status, 200);
        assert.equal((await api("DELETE", "/api/projects/prj-a/queue/missing")).status, 404);
        assert.equal((await api("PATCH", `/api/projects/prj-a/queue/${listed.body.items[0].id}`, { text: "  " })).status, 400);

        await waitFor(async () => {

            const snapshot = await streamSnapshot("prj-a");

            return snapshot.status === "done" && userTexts(snapshot).includes("q-second-edited");
        }, "the queued message to run");

        const snapshot = await streamSnapshot("prj-a");

        assert.ok(!userTexts(snapshot).includes("q-third"), "a deleted message never runs");
        assert.equal(snapshot.queue.items.length, 0);
        assert.ok(
            snapshot.events.some(event => event.type === "queue:changed" && event.project_id === "prj-a"),
            "queue changes are streamed"
        );
    });

    await test("a cancelled run pauses the queue instead of emptying it", async () => {

        assert.equal((await api("POST", "/api/projects/prj-b/tasks", { task: "[slow] c-first" })).status, 202);

        await waitFor(async () => (await conversation("prj-b")).status === "running", "prj-b running");

        assert.equal((await api("POST", "/api/projects/prj-b/tasks", { task: "c-next" })).body.queued, true);

        const cancelled = await api("POST", "/api/projects/prj-b/cancel");

        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.queue_cleared, 0);

        const after = await settled("prj-b");

        assert.equal(after.status, "cancelled");
        assert.equal(after.queue_paused, true);
        assert.equal(after.queue_length, 1);

        assert.ok(!userTexts(await streamSnapshot("prj-b")).includes("c-next"), "a paused queue starts nothing");

        const resumed = await api("POST", "/api/projects/prj-b/queue/resume");

        assert.equal(resumed.body.started, true);

        await waitFor(async () => {

            const snapshot = await streamSnapshot("prj-b");

            return snapshot.status === "done" && userTexts(snapshot).includes("c-next");
        }, "the resumed message to run");

        /* clear_queue: true empties it */
        assert.equal((await api("POST", "/api/projects/prj-b/tasks", { task: "[slow] c-again" })).status, 202);
        await waitFor(async () => (await conversation("prj-b")).status === "running", "prj-b running again");
        await api("POST", "/api/projects/prj-b/tasks", { task: "c-dropped" });

        const dropped = await api("POST", "/api/projects/prj-b/cancel", { clear_queue: true });

        assert.equal(dropped.body.queue_cleared, 1);

        const emptied = await settled("prj-b");

        assert.equal(emptied.queue_length, 0);
        assert.equal(emptied.queue_paused, false);
    });

    await test("a course correction reaches the running turn at its next iteration", async () => {

        const before = requests.length;

        assert.equal((await api("POST", "/api/projects/prj-c/tasks", { task: "[correct] tidy the module" })).status, 202);

        await waitFor(async () => (await conversation("prj-c")).status === "running", "prj-c running");

        const sent = await api("POST", "/api/projects/prj-c/correction", { text: "use plan B" });

        assert.equal(sent.status, 202);
        assert.equal(sent.body.injected, true);

        await settled("prj-c");

        const snapshot = await streamSnapshot("prj-c");

        assert.equal(snapshot.answer, "corrected");
        assert.ok(
            requests.slice(before).some(body =>
                (body.messages || []).some(message => message.role === "user" && textOf(message).startsWith(CORRECTION_PREFIX))
            ),
            "the model read the correction"
        );
        assert.ok(snapshot.events.some(event => event.type === "run:correction" && event.text === "use plan B"));
        assert.ok(snapshot.messages.some(message => message.kind === "correction" && message.content === "use plan B"));

        /* nothing running: the correction is simply the next message */
        const idle = await api("POST", "/api/projects/prj-c/correction", { text: "plain follow-up" });

        assert.equal(idle.body.started, true);
        await settled("prj-c");
        assert.equal((await api("POST", "/api/projects/prj-c/correction", { text: " " })).status, 400);
    });

    await test("a background project's approval belongs to its turn and survives a foreground stop", async () => {

        assert.equal((await api("POST", "/api/approval-mode", { mode: "prompt" })).status, 200);

        try {

            assert.equal((await api("POST", "/api/tasks", { task: "[slow] foreground again" })).status, 202);
            assert.equal((await api("POST", "/api/projects/prj-c/tasks", { task: "[approve] write it" })).status, 202);

            const pending = await waitFor(async () => {

                const state = (await api("GET", "/api/state")).body;

                return state.pending_approvals.find(item => item.project_id === "prj-c") || null;
            }, "prj-c's approval");

            const run = (await api("GET", "/api/projects/prj-c/run")).body;

            assert.equal(run.background, true);
            assert.equal(run.pending_approvals, 1);

            const snapshot = await streamSnapshot("prj-c");
            const request = snapshot.events.find(event => event.type === "approval:request" && event.id === pending.id);

            assert.ok(request, "the approval reaches the project's own stream");
            assert.equal(request.turn_id, run.turn_id, "the approval is owned by the project's turn, not the foreground's");
            assert.ok(snapshot.pending_approvals.some(item => item.id === pending.id));

            /* stopping the foreground leaves the project's question alone */
            await api("POST", "/api/cancel");
            await foregroundIdle();

            const still = (await api("GET", "/api/state")).body.pending_approvals;

            assert.ok(still.some(item => item.id === pending.id), "a foreground stop must not deny a background approval");

            assert.equal((await api("POST", `/api/approvals/${pending.id}`, { approved: true })).body.resolved, true);
            assert.equal((await settled("prj-c")).status, "done");
            assert.ok(fs.existsSync(path.join(ROOTS.c, "approved.txt")), "the approved write ran in the project");

        } finally {

            await api("POST", "/api/approval-mode", { mode: "auto" });
        }
    });

    await test("a project's conversation can start afresh and the queue validates input", async () => {

        assert.equal((await api("POST", "/api/projects/prj-a/queue", { text: "" })).status, 400);
        assert.equal((await api("POST", "/api/projects/prj-ghost/queue", { text: "x" })).status, 404);

        const cleared = await api("POST", "/api/projects/prj-a/clear");

        assert.equal(cleared.status, 200);

        const snapshot = await streamSnapshot("prj-a");

        assert.deepStrictEqual(snapshot.messages, []);
        assert.equal((await conversation("prj-a")).messages, 0);

        /* idle and nothing queued: a queued message starts right away */
        const queued = await api("POST", "/api/projects/prj-a/queue", { text: "from the queue" });

        assert.equal(queued.status, 201);
        assert.equal(queued.body.started, true);

        await settled("prj-a");

        assert.deepStrictEqual(userTexts(await streamSnapshot("prj-a")), ["from the queue"]);
    });

    await test("every stream gets a summary of all conversations when one changes state", async () => {

        const controller = new AbortController();
        const response = await fetch(`${base}/api/events?projectId=prj-b`, { headers, signal: controller.signal });
        const decoder = new TextDecoder();
        const payloads = [];
        let buffer = "";

        const reading = (async () => {
            try {
                for await (const chunk of response.body) {
                    buffer += decoder.decode(chunk, { stream: true });
                    let end;
                    while ((end = buffer.indexOf("\n\n")) !== -1) {
                        const line = buffer.slice(0, end).split("\n").find(entry => entry.startsWith("data: "));
                        buffer = buffer.slice(end + 2);
                        if (line) payloads.push(JSON.parse(line.slice("data: ".length)));
                    }
                }
            } catch {
                /* aborted */
            }
        })();

        try {

            await waitFor(() => payloads.length > 0, "the snapshot");

            assert.equal(payloads[0].type, "snapshot");
            assert.ok(Array.isArray(payloads[0].snapshot.conversations), "the snapshot lists the conversations");

            /* a run in another project still reaches prj-b's stream as a summary */
            assert.equal((await api("POST", "/api/projects/prj-c/tasks", { task: "summary-run" })).status, 202);
            await settled("prj-c");

            const summaries = await waitFor(() => {
                const list = payloads.filter(item => item.type === "conversations");
                return list.some(item => item.conversations.some(line => line.project_id === "prj-c" && line.status === "done"))
                    ? list
                    : null;
            }, "a summary with prj-c done");

            assert.ok(
                summaries.some(item => item.conversations.some(line => line.project_id === "prj-c" && line.status === "running")),
                "the start is summarised too"
            );
            assert.ok(
                payloads.every(item => item.type !== "session:message" || item.project_id === "prj-b" || item.aggregate),
                "another project's transcript never reaches this stream"
            );

        } finally {

            controller.abort();
            await reading;
        }
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

    model.close();

    await removeTempDirs(runtime, WORKSPACE, ROOTS.a, ROOTS.b, ROOTS.c, DATA_HOME);

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
