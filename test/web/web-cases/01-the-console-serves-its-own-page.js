"use strict";

/*
| web.test.js: from "the console serves its own page and assets"
|
| Runs inside web.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function theConsoleServesItsOwnPageCases(ctx) {

    const {
        ProcessOutputBus,
        WORKSPACE,
        action,
        baseUrl,
        collectEvents,
        finalAction,
        request,
        runtime,
        startModelStub,
        test,
        waitFor,
        waitForRunEnd
    } = ctx;

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

        for (const asset of ["/app.css", "/console-login.css", "/app/main.js", "/modal.js", "/auth-gate.js"]) {

            const response =
                await fetch(`${baseUrl}${asset}`);

            assert.equal(response.status, 200);
        }

        /* the stylesheet is split over several files; each one linked must load as CSS */
        const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]);

        assert.ok(sheets.length >= 3, "index.html links its stylesheets");

        for (const sheet of sheets) {

            const response =
                await fetch(`${baseUrl}${sheet}`);

            assert.equal(response.status, 200, sheet);
            assert.match(response.headers.get("content-type"), /text\/css/, sheet);
        }
    });

    await test("every module the browser imports is served as JavaScript", async () => {

        /* walk the import graph from the entry the auth gate loads */
        const seen = new Set();
        const queue = ["/app/main.js"];

        while (queue.length > 0) {

            const url = queue.shift();

            if (seen.has(url)) continue;
            seen.add(url);

            const response = await fetch(`${baseUrl}${url}`);

            assert.equal(response.status, 200, url);
            assert.match(response.headers.get("content-type"), /javascript/, url);

            const text = await response.text();

            for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"|(?:^|\n)\s*import\s+"(\.{1,2}\/[^"]+)"/g)) {
                queue.push(new URL(match[1] || match[2], `http://x${url}`).pathname);
            }
        }

        assert.ok(seen.has("/vendor/preact.module.js"), "the vendored renderer is reachable");
        assert.ok(seen.has("/app/console.js"), "the controller is reachable");
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

    await test("interactive PTY output reaches the live event stream without entering persisted runtime events", async () => {

        const stream = collectEvents();
        await waitFor(() => stream.seen.some(event => event.type === "snapshot"));

        const durableSequence = runtime.events.eventBus.sequence;
        ProcessOutputBus.emit("output", {
            process_id: "pty-live-test",
            run_id: "run-live-test",
            project_id: null,
            stream: "stdout",
            text: "live terminal byte",
            at: Date.now()
        });

        const output = await waitFor(() =>
            stream.seen.find(event => event.type === "process:output" && event.process_id === "pty-live-test")
        );

        assert.equal(output.text, "live terminal byte");
        assert.equal(
            runtime.events.eventBus.sequence,
            durableSequence,
            "ephemeral terminal bytes must not enter the durable event journal"
        );

        stream.stop();
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
                    : finalAction("one file, console renderer")
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

        /* wait for the run to end, not for its first beat */
        await waitForRunEnd(stream);

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

        /* wait for the run to end, not for its first beat */
        await waitForRunEnd(stream);

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

        /* wait for the run to end, not for its first beat */
        await waitForRunEnd(stream);

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
};
