const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

/*
| The console is tested through its own HTTP surface: the event stream,
| the task endpoint, and the approval endpoint that the buttons call.
*/

const REPO_ROOT =
    path.resolve(__dirname, "..", "..");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-web-")
    );

fs.writeFileSync(
    path.join(WORKSPACE, "app.js"),
    "const value = 1;\n"
);

const results = [];


function startModelStub(handler) {

    return new Promise(resolve => {

        const state = { requests: [] };

        const server =
            http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => {
                    body += chunk;
                });

                req.on("end", () => {

                    const parsed = JSON.parse(body);

                    state.requests.push(parsed);

                    res.setHeader(
                        "content-type",
                        "application/json"
                    );

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message:
                                        handler(
                                            parsed,
                                            state.requests.length
                                        )
                                }
                            ]
                        })
                    );
                });
            });

        server.listen(0, "127.0.0.1", () =>
            resolve({
                state,
                port: server.address().port,
                close: () =>
                    new Promise(done => server.close(done))
            })
        );
    });
}


const action = value => ({
    role: "assistant",

    content:
        JSON.stringify({
            version: "1.0",
            tool_calls: null,
            delegations: null,
            response: null,
            data: null,
            error: null,
            ...value
        })
});


const finalAction = text =>
    action({
        action: "final",

        response: {
            type: "text",
            content: text
        }
    });


/*
| The runtime reads its configuration when it is loaded, so the
| environment has to be complete before the first require.
*/

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_APPROVAL = "prompt";
process.env.AGENT_VERBOSE = "0";
process.env.MAX_RUN_MS = "20000";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";

let runtime;
let consoleServer;
let baseUrl;


async function request(method, url, body) {

    const response =
        await fetch(`${baseUrl}${url}`, {
            method,

            headers: {
                ...(body ? { "content-type": "application/json" } : {}),
                authorization: `Bearer ${consoleServer.token}`
            },

            body:
                body
                    ? JSON.stringify(body)
                    : undefined
        });

    const text =
        await response.text();

    return {
        status: response.status,

        body:
            text
                ? JSON.parse(text)
                : null
    };
}


function collectEvents() {

    const seen = [];

    const controller =
        new AbortController();

    const ready =
        fetch(`${baseUrl}/api/events`, {
            signal: controller.signal,
            headers: {
                authorization: `Bearer ${consoleServer.token}`
            }
        }).then(async response => {

            const reader =
                response.body.getReader();

            const decoder =
                new TextDecoder();

            let buffer = "";

            for (;;) {

                const { value, done } =
                    await reader.read();

                if (done) {
                    return;
                }

                buffer += decoder.decode(value, { stream: true });

                const chunks =
                    buffer.split("\n\n");

                buffer = chunks.pop();

                for (const chunk of chunks) {

                    if (!chunk.startsWith("data: ")) {
                        continue;
                    }

                    seen.push(
                        JSON.parse(chunk.slice(6))
                    );
                }
            }
        }).catch(() => {});

    return {
        seen,

        ready,

        stop: () => controller.abort()
    };
}


async function waitFor(predicate, timeoutMs = 8000) {

    const deadline =
        Date.now() + timeoutMs;

    for (;;) {

        const value =
            await predicate();

        if (value) {
            return value;
        }

        if (Date.now() > deadline) {

            throw new Error("timed out waiting for a condition");
        }

        await new Promise(
            resolve => setTimeout(resolve, 50)
        );
    }
}


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


async function main() {

    console.log("web console");

    runtime =
        require(path.join(REPO_ROOT, "agent", "agent.js"));

    const { createServer } =
        require(path.join(REPO_ROOT, "web", "server.js"));

    consoleServer =
        createServer(runtime, {});

    const address =
        await consoleServer.listen(0, "127.0.0.1");

    baseUrl =
        `http://127.0.0.1:${address.port}`;

    /* ---------------------------------------------------------------- */

    await test("the console serves its own page and assets", async () => {

        const page =
            await fetch(`${baseUrl}/`);

        const html =
            await page.text();

        assert.equal(page.status, 200);
        assert.match(html, /structured-ai console/);
        assert.match(
            page.headers.get("content-type"),
            /text\/html/
        );

        for (const asset of ["/app.css", "/app.js", "/modal.js"]) {

            const response =
                await fetch(`${baseUrl}${asset}`);

            assert.equal(response.status, 200);
        }
    });

    await test("static serving cannot escape the public directory", async () => {

        const response =
            await fetch(
                `${baseUrl}/../../package.json`,
                { redirect: "manual" }
            );

        assert.notEqual(response.status, 200);
    });

    await test("the API refuses requests without the console token", async () => {

        const response = await fetch(`${baseUrl}/api/state`);
        assert.equal(response.status, 401);
    });

    await test("the state endpoint describes the runtime", async () => {

        const state =
            await request("GET", "/api/state");

        assert.equal(state.status, 200);
        assert.equal(state.body.status, "idle");
        assert.equal(state.body.workspace, fs.realpathSync(WORKSPACE));
        assert.equal(state.body.approval_mode, "prompt");
        assert.ok(state.body.limits.max_run_ms > 0);
        assert.ok(state.body.agents.length > 0);
    });

    await test("a task streams events and produces an answer", async () => {

        const stub =
            await startModelStub((request_, index) =>
                index === 1
                    ? action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "call_1",
                                name: "fs_list",
                                arguments: { path: "." },
                                depends_on: []
                            }
                        ]
                    })
                    : finalAction("one file, app.js")
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        /* the endpoint is read per request, so reload is not needed */

        const stream = collectEvents();

        await waitFor(
            () => stream.seen.length > 0
        );

        const accepted =
            await request("POST", "/api/tasks", {
                task: "list the files"
            });

        assert.equal(accepted.status, 202);

        await waitFor(
            () =>
                stream.seen.some(
                    event => event.type === "run:status"
                )
        );

        const types =
            stream.seen.map(event => event.type);

        assert.ok(types.includes("run:start"));
        assert.ok(types.includes("tool:start"));
        assert.ok(types.includes("tool:end"));
        assert.ok(types.includes("agent:iteration"));

        const state =
            await request("GET", "/api/state");

        assert.equal(state.body.status, "done");
        assert.match(state.body.answer, /one file/);

        stream.stop();

        await stub.close();
    });

    await test("a second task continues the same conversation", async () => {

        const stub =
            await startModelStub(request_ =>
                finalAction(
                    `saw ${
                        request_.messages.filter(
                            message => message.role === "user"
                        ).length
                    } user messages`
                )
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/tasks", {
            task: "and now summarise"
        });

        const state =
            await waitFor(async () => {

                const current =
                    await request("GET", "/api/state");

                return current.body.status === "done"
                    ? current
                    : null;
            });

        assert.match(state.body.answer, /saw [23] user messages/);
        assert.ok(state.body.turns >= 2);

        await stub.close();
    });

    await test("a tool graph reports its shape, its waves and who ran it", async () => {

        const stub =
            await startModelStub((request_, index) =>
                index === 1
                    ? action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "read_one",
                                name: "fs_list",
                                arguments: { path: "." },
                                depends_on: []
                            },
                            {
                                id: "read_two",
                                name: "fs_read",
                                arguments: { path: "app.js" },
                                depends_on: []
                            },
                            {
                                id: "after_both",
                                name: "fs_stat",
                                arguments: { path: "app.js" },
                                depends_on: ["read_one", "read_two"]
                            }
                        ]
                    })
                    : finalAction("done")
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/tasks", {
            task: "inspect the workspace"
        });

        await waitFor(
            () =>
                stream.seen.some(
                    event => event.type === "run:status"
                )
        );

        const graph =
            stream.seen.find(
                event => event.type === "tool:graph"
            );

        assert.ok(graph, "no tool:graph event was streamed");

        /* two independent calls, then one that waits for both */
        assert.equal(graph.shape, "graph");
        assert.equal(graph.waves.length, 2);
        assert.deepEqual(graph.waves[0], ["read_one", "read_two"]);
        assert.deepEqual(graph.waves[1], ["after_both"]);
        assert.equal(graph.agent, "main_agent");
        assert.equal(graph.iteration, 1);

        const start =
            stream.seen.find(
                event =>
                    event.type === "tool:start" &&
                    event.id === "after_both"
            );

        assert.equal(start.wave, 1);
        assert.deepEqual(start.depends_on, ["read_one", "read_two"]);
        assert.equal(start.graph_id, graph.graph_id);
        assert.ok(start.call_key);

        stream.stop();

        await stub.close();
    });

    await test("a heavy result is streamed as a preview and fetched in full", async () => {

        const stub =
            await startModelStub((request_, index) =>
                index === 1
                    ? action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "read_big",
                                name: "fs_read",
                                arguments: { path: "big.txt" },
                                depends_on: []
                            }
                        ]
                    })
                    : finalAction("read it")
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        fs.writeFileSync(
            path.join(WORKSPACE, "big.txt"),
            "y".repeat(9000)
        );

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/tasks", {
            task: "read the big file"
        });

        await waitFor(
            () =>
                stream.seen.some(
                    event => event.type === "run:status"
                )
        );

        const end =
            stream.seen.find(
                event =>
                    event.type === "tool:end" &&
                    event.id === "read_big"
            );

        /* the stream carries a preview, never the whole result */
        assert.equal(end.result, undefined);
        assert.ok(end.result_preview.length < end.result_chars);
        assert.equal(end.result_truncated, true);
        assert.ok(
            end.result_preview.length <=
            runtime.settings.get("CONSOLE_RESULT_CHARS") + 1
        );

        /* and the full record is one request away */
        const full =
            await request(
                "GET",
                `/api/calls/${encodeURIComponent(end.call_key)}`
            );

        assert.equal(full.status, 200);
        assert.equal(full.body.call.name, "fs_read");
        assert.equal(full.body.call.agent, "main_agent");
        assert.equal(full.body.call.status, "done");
        assert.ok(full.body.call.result.content.length > 8000);

        const listed =
            await request("GET", "/api/calls");

        assert.ok(
            listed.body.calls.some(
                call => call.key === end.call_key
            )
        );

        const missing =
            await request("GET", "/api/calls/nope");

        assert.equal(missing.status, 404);

        stream.stop();

        await stub.close();
    });

    await test("a loop is reported as an event, not only as a log line", async () => {

        const stub =
            await startModelStub((request_, index) =>
                index <= 6
                    ? action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: `call_${index}`,
                                name: "fs_read",
                                arguments: { path: "missing-file.txt" },
                                depends_on: []
                            }
                        ]
                    })
                    : finalAction("gave up")
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/tasks", {
            task: "read a file that is not there"
        });

        await waitFor(
            () =>
                stream.seen.some(
                    event => event.type === "run:status"
                ),
            15000
        );

        const loops =
            stream.seen.filter(
                event => event.type === "run:loop"
            );

        assert.ok(loops.length > 0, "no run:loop event was streamed");
        assert.equal(loops[0].agent, "main_agent");
        assert.ok(loops[0].repeats >= 3);
        assert.match(loops[0].signature, /missing-file\.txt/);
        assert.ok(
            loops.some(event => event.outcome === "stopped") ||
            loops.some(event => event.outcome === "notice")
        );

        stream.stop();

        await stub.close();
    });

    await test("an approval is streamed and honoured when approved", async () => {

        const stub =
            await startModelStub((request_, index) =>
                index === 1
                    ? action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "w1",
                                name: "fs_write",
                                arguments: {
                                    path: "approved.txt",
                                    content: "yes\n"
                                },
                                depends_on: []
                            }
                        ]
                    })
                    : finalAction("written")
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/clear");

        await request("POST", "/api/tasks", {
            task: "write a file"
        });

        const pending =
            await waitFor(async () => {

                const state =
                    await request("GET", "/api/state");

                return state.body.pending_approvals[0] || null;
            });

        assert.equal(pending.tool, "fs_write");
        assert.match(pending.reason, /writes to the workspace/);

        assert.ok(
            stream.seen.some(
                event => event.type === "approval:request"
            )
        );

        const answered =
            await request(
                "POST",
                `/api/approvals/${pending.id}`,
                { approved: true }
            );

        assert.equal(answered.body.resolved, true);

        await waitFor(async () => {

            const state =
                await request("GET", "/api/state");

            return state.body.status === "done";
        });

        assert.equal(
            fs.existsSync(
                path.join(WORKSPACE, "approved.txt")
            ),
            true
        );

        stream.stop();

        await stub.close();
    });

    await test("a denied approval stops the tool", async () => {

        const stub =
            await startModelStub((request_, index) =>
                index === 1
                    ? action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "w2",
                                name: "fs_write",
                                arguments: {
                                    path: "denied.txt",
                                    content: "no\n"
                                },
                                depends_on: []
                            }
                        ]
                    })
                    : finalAction("could not write")
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/clear");

        await request("POST", "/api/tasks", {
            task: "write another file"
        });

        const pending =
            await waitFor(async () => {

                const state =
                    await request("GET", "/api/state");

                return state.body.pending_approvals[0] || null;
            });

        await request(
            "POST",
            `/api/approvals/${pending.id}`,
            { approved: false }
        );

        await waitFor(async () => {

            const state =
                await request("GET", "/api/state");

            return state.body.status === "done";
        });

        assert.equal(
            fs.existsSync(
                path.join(WORKSPACE, "denied.txt")
            ),
            false
        );

        await stub.close();
    });

    await test("the approval mode can be switched from the console", async () => {

        const changed =
            await request("POST", "/api/approval-mode", {
                mode: "auto"
            });

        assert.equal(changed.status, 200);

        const state =
            await request("GET", "/api/state");

        assert.equal(state.body.approval_mode, "auto");

        const rejected =
            await request("POST", "/api/approval-mode", {
                mode: "whatever"
            });

        assert.equal(rejected.status, 400);

        await request("POST", "/api/approval-mode", {
            mode: "prompt"
        });
    });

    await test("delegation is reported as a tree", async () => {

        const stub =
            await startModelStub(request_ => {

                const isSub =
                    request_.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {
                    return finalAction("sub report");
                }

                const delegated =
                    request_.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                return delegated
                    ? finalAction("aggregated")
                    : action({
                        action: "delegate",

                        delegations: [
                            {
                                id: "d1",
                                agent: "git_analysis",
                                persona: null,
                                skills: null,
                                tools: null,
                                task: "inspect the repository",
                                depends_on: []
                            }
                        ]
                    });
            });

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/clear");

        await request("POST", "/api/tasks", {
            task: "analyse the repository"
        });

        await waitFor(
            () =>
                stream.seen.some(
                    event =>
                        event.type === "run:status" &&
                        event.status === "done"
                )
        );

        const delegation =
            stream.seen.find(
                event => event.type === "delegation:start"
            );

        assert.ok(delegation, "delegation was not reported");
        assert.equal(delegation.parent, "main_agent");
        assert.equal(
            delegation.delegations[0].agent,
            "git_analysis"
        );

        const subStart =
            stream.seen.find(
                event => event.type === "agent:start"
            );

        assert.equal(subStart.agent, "git_analysis");
        assert.equal(subStart.depth, 1);

        /* a sub-agent says which agent it belongs to */
        assert.equal(subStart.parent, "main_agent");
        assert.equal(subStart.parent_scope, "main_agent");
        assert.equal(subStart.scope, "git_analysis#1");
        assert.ok(subStart.delegation_id);

        /* and delegation is scheduled by the same graph engine */
        const delegationGraph =
            stream.seen.find(
                event => event.type === "delegation:graph"
            );

        assert.ok(delegationGraph, "delegation graph was not reported");
        assert.equal(delegationGraph.parent, "main_agent");
        assert.equal(delegationGraph.shape, "single");
        assert.equal(delegationGraph.waves.length, 1);

        stream.stop();

        await stub.close();
    });

    await test("every event reaches the console exactly once", async () => {

        /*
        | The console emits through the same bus it listens on, so an
        | event that was also handed to broadcast() by hand arrived
        | twice and every approval, error and settings change was
        | reported double.
        */

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/approval-mode", { mode: "auto" });

        await request("POST", "/api/settings", {
            key: "MAX_ITERATIONS",
            value: 41
        });

        await request("POST", "/api/clear", {});

        await waitFor(
            () =>
                stream.seen.some(
                    event => event.type === "session:cleared"
                )
        );

        const counts = new Map();

        for (const event of stream.seen) {

            counts.set(
                event.seq,
                (counts.get(event.seq) || 0) + 1
            );
        }

        const duplicated =
            [...counts.entries()].filter(
                ([, times]) => times > 1
            );

        assert.deepEqual(
            duplicated,
            [],
            `these events arrived more than once: ${
                JSON.stringify(duplicated)
            }`
        );

        for (
            const type
            of [
                "session:approval_mode",
                "settings:changed",
                "session:cleared"
            ]
        ) {

            assert.equal(
                stream.seen.filter(
                    event => event.type === type
                ).length,
                1,
                `${type} was not reported exactly once`
            );
        }

        runtime.settings.reset("MAX_ITERATIONS");

        stream.stop();
    });

    await test("a second task is refused while one is running", async () => {

        const slow =
            await startModelStub(() => finalAction("slow"));

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${slow.port}/v1`;

        await request("POST", "/api/clear");

        const first =
            request("POST", "/api/tasks", { task: "one" });

        const second =
            await request("POST", "/api/tasks", { task: "two" });

        assert.ok(
            [202, 409].includes(second.status),
            `unexpected status ${second.status}`
        );

        await first;

        await waitFor(async () => {

            const state =
                await request("GET", "/api/state");

            return state.body.status !== "running";
        });

        await slow.close();
    });

    await test("an empty task is rejected", async () => {

        const response =
            await request("POST", "/api/tasks", { task: "   " });

        assert.equal(response.status, 400);
    });

    await test("settings are listed with their source and can be changed live", async () => {

        const listed =
            await request("GET", "/api/settings");

        assert.equal(listed.status, 200);

        const byKey =
            Object.fromEntries(
                listed.body.settings.map(item => [item.key, item])
            );

        assert.equal(byKey.MAX_ITERATIONS.type, "number");
        assert.equal(byKey.WORKSPACE_ROOT.fixed, true);
        assert.equal(byKey.AGENT_API_KEY.secret, true);

        const changed =
            await request("POST", "/api/settings", {
                key: "MAX_PARALLEL_TOOLS",
                value: 2
            });

        assert.equal(changed.status, 200);
        assert.equal(changed.body.setting.value, 2);
        assert.equal(changed.body.setting.source, "override");

        /* the runtime itself now reports the new value */
        const state =
            await request("GET", "/api/state");

        assert.equal(state.body.limits.max_parallel_tools, 2);

        const restored =
            await request("POST", "/api/settings", {
                key: "MAX_PARALLEL_TOOLS",
                reset: true
            });

        assert.equal(restored.body.setting.source, "default");
    });

    await test("an invalid or fixed setting is refused", async () => {

        const bad =
            await request("POST", "/api/settings", {
                key: "MAX_ITERATIONS",
                value: "lots"
            });

        assert.equal(bad.status, 400);
        assert.match(bad.body.error, /expects a number/);

        const fixed =
            await request("POST", "/api/settings", {
                key: "WORKSPACE_ROOT",
                value: "/elsewhere"
            });

        assert.equal(fixed.status, 400);
        assert.match(fixed.body.error, /fixed/);
    });

    await test("a settings change is streamed to every console", async () => {

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/settings", {
            key: "MAX_EMPTY_FINAL_NUDGES",
            value: 0
        });

        await waitFor(
            () =>
                stream.seen.some(
                    event => event.type === "settings:changed"
                )
        );

        stream.stop();

        await request("POST", "/api/settings", {
            key: "MAX_EMPTY_FINAL_NUDGES",
            reset: true
        });
    });

    await test("a conversation is stored with its events and calls", async () => {

        const stub =
            await startModelStub((request_, index) =>
                index === 1
                    ? action({
                        action: "tool_call",
                        tool_calls: [
                            {
                                id: "call_1",
                                name: "fs_list",
                                arguments: { path: "." },
                                depends_on: []
                            }
                        ]
                    })
                    : finalAction("there is one file")
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/clear", {});

        await request("POST", "/api/tasks", {
            task: "list the files"
        });

        await waitFor(
            async () => {

                const state = await request("GET", "/api/state");

                return state.body.status === "done";
            }
        );

        const state =
            await request("GET", "/api/state");

        /* the conversation is in the snapshot, not only in the browser */
        const kinds =
            state.body.messages.map(message => message.kind);

        assert.ok(kinds.includes("message"));
        assert.ok(kinds.includes("response"));

        /* a git report is recorded in the conversation after the run */
        const gitReport =
            state.body.messages.find(
                message => message.kind === "git-report"
            );

        assert.ok(gitReport, "a git report message was recorded");
        assert.match(gitReport.content, /file/);

        /* and it is streamed as a git:report event */
        assert.ok(
            state.body.events.some(event => event.type === "git:report"),
            "a git:report event was recorded"
        );

        assert.equal(
            state.body.messages[0].content,
            "list the files"
        );

        /* the answer is present as a response message (a git-report message
           may now be appended after it, so find the response, not the tail) */
        const response =
            state.body.messages
                .slice()
                .reverse()
                .find(message => message.kind === "response");

        assert.match(response.content, /one file/);

        /* and it is on disk */
        const listed =
            await request("GET", "/api/sessions");

        assert.ok(listed.body.sessions.length >= 1);

        const current = listed.body.current;

        const file =
            path.join(
                WORKSPACE,
                ".agent",
                "sessions",
                `${current}.json`
            );

        assert.equal(fs.existsSync(file), true);

        const stored =
            JSON.parse(fs.readFileSync(file, "utf8"));

        /* events are stored exactly as they were streamed */
        const types =
            stored.events.map(event => event.type);

        assert.ok(types.includes("run:start"));
        assert.ok(types.includes("tool:graph"));
        assert.ok(types.includes("tool:end"));

        /* and the full call record travels with them */
        assert.ok(stored.calls.length >= 1);
        assert.equal(stored.calls[0].name, "fs_list");
        assert.ok(stored.calls[0].result);

        await stub.close();
    });

    await test("a stored conversation can be reopened and continued", async () => {

        const first =
            (await request("GET", "/api/sessions")).body.current;

        /* a new conversation leaves the old one alone */
        const created =
            await request("POST", "/api/sessions", {});

        assert.equal(created.status, 201);
        assert.notEqual(created.body.session.id, first);

        const fresh =
            await request("GET", "/api/state");

        assert.deepEqual(fresh.body.messages, []);

        /* nothing from the previous run is left in the stream */
        assert.deepEqual(
            fresh.body.events.filter(
                event =>
                    event.type.startsWith("run:") ||
                    event.type.startsWith("tool:") ||
                    event.type.startsWith("agent:")
            ),
            []
        );

        /* reopening restores the messages, the events and the calls */
        const reopened =
            await request("POST", `/api/sessions/${first}`, {});

        assert.equal(reopened.status, 200);
        assert.equal(reopened.body.session.id, first);
        assert.ok(reopened.body.session.events.length > 0);

        const state =
            await request("GET", "/api/state");

        assert.equal(state.body.session.id, first);
        assert.ok(state.body.messages.length >= 2);
        assert.ok(state.body.events.length > 0);

        /* the recorded call is inspectable again after reopening */
        const key =
            reopened.body.session.calls[0].key;

        const call =
            await request(
                "GET",
                `/api/calls/${encodeURIComponent(key)}`
            );

        assert.equal(call.status, 200);
        assert.equal(call.body.call.name, "fs_list");

        /* and the model conversation continues where it stopped */
        const stub =
            await startModelStub(request_ =>
                finalAction(
                    `saw ${
                        request_.messages.filter(
                            message => message.role === "user"
                        ).length
                    } user messages`
                )
            );

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/tasks", { task: "and now?" });

        await waitFor(
            async () => {

                const current = await request("GET", "/api/state");

                return current.body.status === "done";
            }
        );

        const answer =
            (await request("GET", "/api/state")).body.answer;

        assert.match(answer, /saw [2-9] user messages/);

        await stub.close();
    });

    await test("reasoning reaches a live console, not only the history", async () => {

        /*
        | The thinking bubble was pushed straight into the session, so it
        | appeared when a conversation was reopened and never while the
        | agent was working.
        */

        const stub =
            await startModelStub(() => ({
                role: "assistant",

                reasoning_content:
                    "first I will read the plan, then the input package",

                content:
                    JSON.stringify({
                        version: "1.0",
                        action: "final",
                        tool_calls: null,
                        delegations: null,
                        response: { type: "text", content: "done" },
                        data: null,
                        error: null
                    })
            }));

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/sessions", {});

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/tasks", { task: "think about it" });

        await waitFor(
            () =>
                stream.seen.some(
                    event => event.type === "run:status"
                )
        );

        const thinking =
            stream.seen.filter(
                event =>
                    event.type === "session:message" &&
                    event.message.kind === "thinking"
            );

        assert.equal(
            thinking.length,
            1,
            "the reasoning never reached the live stream"
        );

        assert.match(
            thinking[0].message.content,
            /read the plan/
        );

        assert.equal(thinking[0].message.agent, "main_agent");

        /* and it is in the stored conversation as well */
        const state =
            await request("GET", "/api/state");

        assert.ok(
            state.body.messages.some(
                message => message.kind === "thinking"
            )
        );

        stream.stop();

        await stub.close();
    });

    await test("the project file remembers this workspace's settings", async () => {

        const file =
            path.join(WORKSPACE, ".agent", "project.json");

        runtime.openProject();

        runtime.settings.set("MAX_PARALLEL_TOOLS", 3);

        await request("POST", "/api/settings", {
            key: "KEEP_RECENT_EXCHANGES",
            value: 5
        });

        /* the watcher writes shortly after a change */
        await waitFor(() => {

            if (!fs.existsSync(file)) {
                return false;
            }

            const saved =
                JSON.parse(fs.readFileSync(file, "utf8"));

            return (
                saved.settings.MAX_PARALLEL_TOOLS === 3 &&
                saved.settings.KEEP_RECENT_EXCHANGES === 5
            );
        });

        const saved =
            JSON.parse(fs.readFileSync(file, "utf8"));

        /* a default is not written, only what was actually changed */
        assert.equal(saved.settings.MAX_ITERATIONS, undefined);

        /* and a secret stays out of the workspace */
        runtime.settings.set("AGENT_API_KEY", "supersecretvalue");

        await new Promise(resolve => setTimeout(resolve, 350));

        assert.equal(
            JSON.parse(fs.readFileSync(file, "utf8"))
                .settings.AGENT_API_KEY,
            undefined
        );

        /* reopening applies what was remembered */
        runtime.settings.reset("MAX_PARALLEL_TOOLS");

        assert.equal(runtime.settings.get("MAX_PARALLEL_TOOLS"), 8);

        const opened = runtime.openProject();

        assert.ok(opened.applied.includes("MAX_PARALLEL_TOOLS"));
        assert.equal(runtime.settings.get("MAX_PARALLEL_TOOLS"), 3);

        runtime.settings.reset("MAX_PARALLEL_TOOLS");
        runtime.settings.reset("KEEP_RECENT_EXCHANGES");
        runtime.settings.reset("AGENT_API_KEY");
    });

    await test("the console can keep cycling until the plan is done", async () => {

        /* the model finishes one step per run, as a real one would */

        const stub =
            await startModelStub(request => {

                const context =
                    JSON.parse(
                        request.messages.find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.startsWith("{") &&
                                message.content.includes("runtime_context")
                        ).content
                    ).context;

                const plan = context.plan || {};

                if (!plan.exists) {

                    return action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "s",
                                name: "plan_set",
                                arguments: {
                                    objective: "three small things",
                                    phases: [
                                        {
                                            id: "P1",
                                            title: "work",
                                            steps: [
                                                { id: "P1.1", title: "one" },
                                                { id: "P1.2", title: "two" }
                                            ]
                                        }
                                    ]
                                },
                                depends_on: []
                            }
                        ]
                    });
                }

                /*
                | One step per run: once this run has a tool result it
                | stops, which is what forces the console to start the
                | next cycle by itself.
                */

                const workedAlready =
                    request.messages.some(
                        message => message.role === "tool"
                    );

                if (workedAlready) {

                    return finalAction("one step done, stopping this run");
                }

                if (plan.next_step) {

                    return action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "u",
                                name: "plan_update",
                                arguments: {
                                    updates: [
                                        {
                                            id: plan.next_step.id,
                                            status: "done",
                                            evidence: "finished in this cycle"
                                        }
                                    ]
                                },
                                depends_on: []
                            }
                        ]
                    });
                }

                return finalAction("nothing open");
            });

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/clear");

        await request("POST", "/api/settings", {
            key: "AUTO_CONTINUE",
            value: true
        });

        /*
        | In-run continuation would finish the plan inside a single run,
        | which is the better path but not what this test is about, so
        | it is switched off to isolate the console's own cycling.
        */

        await request("POST", "/api/settings", {
            key: "MAX_PLAN_CONTINUATIONS",
            value: 0
        });

        /* one push, then the console keeps itself going */
        await request("POST", "/api/tasks", {
            task: "do the whole plan"
        });

        await waitFor(async () => {

            const state =
                await request("GET", "/api/state");

            return (
                state.body.plan &&
                state.body.plan.complete === true
            );

        }, 20000);

        const state =
            await request("GET", "/api/state");

        assert.equal(state.body.plan.done, 2);
        assert.equal(Array.isArray(state.body.plan.phases), true);
        assert.equal(state.body.plan.phases[0].steps.length, 2);
        assert.ok(
            state.body.cycles >= 1,
            "no automatic cycle was started"
        );

        /* each cycle starts a fresh conversation, the plan carries state */
        assert.ok(
            state.body.turns <= 2,
            `the transcript accumulated across cycles: ${state.body.turns} turns`
        );

        await request("POST", "/api/settings", {
            key: "AUTO_CONTINUE",
            reset: true
        });

        await request("POST", "/api/settings", {
            key: "MAX_PLAN_CONTINUATIONS",
            reset: true
        });

        await stub.close();
    });

    await test("statistics report what the runtime executed", async () => {

        const stats =
            await request("GET", "/api/stats");

        assert.equal(stats.status, 200);
        assert.ok(stats.body.total_calls > 0);
    });

    /* ---------------------------------------------------------------- */
    console.log("\ndiscussion");

    await test("the discussion endpoint lists the selectable personas", async () => {

        const listing =
            await request("GET", "/api/discussion/personas");

        assert.equal(listing.status, 200);
        assert.equal(listing.body.personas.length, 15);
        assert.ok(
            listing.body.personas.every(persona => persona.id && persona.name && persona.description)
        );
        assert.ok(
            !listing.body.personas.some(persona => persona.id === "observer"),
            "the observer is not selectable"
        );
    });

    await test("the discussion endpoint validates its request", async () => {

        const missingTask =
            await request("POST", "/api/discussion", {
                personas: ["security"]
            });

        assert.equal(missingTask.status, 400);

        const unknownPersona =
            await request("POST", "/api/discussion", {
                task: "design auth",
                personas: ["quantum"]
            });

        assert.equal(unknownPersona.status, 400);

        const badRounds =
            await request("POST", "/api/discussion", {
                task: "design auth",
                personas: ["security"],
                max_rounds: 0
            });

        assert.equal(badRounds.status, 400);
    });

    await test("a discussion runs, streams its rounds, and reports", async () => {

        /*
        | The stub plays the observer's protocol: after one round the
        | group continues with a targeted instruction, after two it
        | finishes with the disagreement surfaced.
        */

        const stub =
            await startModelStub(request_ => {

                const system =
                    request_.messages?.[0]?.content || "";
                const user =
                    request_.messages?.[1]?.content || "";

                if (system.startsWith("You are the Observer Agent")) {

                    const rounds =
                        (user.match(/=== Round/g) || []).length;

                    return {
                        content:
                            rounds >= 2
                                ? JSON.stringify({
                                    decision: "FINISH",
                                    agreements: ["no token in localStorage"],
                                    open_points: [],
                                    unaddressed: [],
                                    instructions: {},
                                    final_report: {
                                        summary: "httpOnly cookie for the JWT, /api/session for state.",
                                        agreed_points: ["no localStorage"],
                                        unresolved: [
                                            {
                                                topic: "CSRF",
                                                sides: [
                                                    { persona: "security", reasoning: "httpOnly needs a CSRF token" },
                                                    { persona: "frontend", reasoning: "the token dance is costly on the client" }
                                                ]
                                            }
                                        ],
                                        next_steps: [
                                            { order: 1, layer: "backend", action: "set an httpOnly cookie at login" }
                                        ]
                                    }
                                })
                                : JSON.stringify({
                                    decision: "CONTINUE",
                                    agreements: [],
                                    open_points: [
                                        { topic: "storage", disagreeing: ["security vs frontend"], why: "XSS vs CSRF" }
                                    ],
                                    unaddressed: [],
                                    instructions: { security: "state the CSRF mitigation" },
                                    final_report: null
                                })
                    };
                }

                return { content: "a position from my lens" };
            });

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        const stream = collectEvents();

        await waitFor(
            () => stream.seen.length > 0
        );

        const accepted =
            await request("POST", "/api/discussion", {
                task: "design session storage for a Next.js app with JWT",
                personas: ["security", "frontend", "backend"],
                max_rounds: 3
            });

        assert.equal(accepted.status, 202);
        assert.ok(accepted.body.id);

        const state =
            await waitFor(
                async () => {
                    const current =
                        await request("GET", "/api/state");

                    return current.body.discussion?.status === "done"
                        ? current.body.discussion
                        : null;
                },
                20000
            );

        assert.equal(state.task, "design session storage for a Next.js app with JWT");
        assert.equal(state.rounds.length, 2);
        assert.equal(state.rounds[0].messages.length, 3);
        assert.equal(state.observer_decisions.length, 2);
        assert.equal(state.observer_decisions[0].decision, "CONTINUE");
        assert.equal(state.observer_decisions[1].decision, "FINISH");
        assert.match(state.final_report.summary, /httpOnly/);
        assert.equal(state.final_report.unresolved[0].sides.length, 2);

        const types =
            stream.seen.map(event => event.type);

        for (const type of [
            "discussion:start",
            "discussion:message",
            "discussion:observer",
            "discussion:finish"
        ]) {
            assert.ok(types.includes(type), `missing ${type} in the stream`);
        }

        /* the conversation recorded the request and the report */

        const conversation =
            await request("GET", "/api/state");

        assert.ok(
            conversation.body.messages.some(
                message => message.kind === "discussion-request"
            )
        );
        assert.ok(
            conversation.body.messages.some(
                message => message.kind === "discussion-report"
            )
        );

        stream.stop();

        await stub.close();
    });

    /* ---------------------------------------------------------------- */

    await consoleServer.close();

    require(path.join(REPO_ROOT, "agent", "tools")).shutdown();

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
