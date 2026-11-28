"use strict";

/*
| web.test.js: from "a second task is refused while one is running"
|
| Runs inside web.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function aSecondTaskIsRefusedWhileCases(ctx) {

    const {
        WORKSPACE,
        action,
        collectEvents,
        finalAction,
        request,
        runtime,
        startModelStub,
        test,
        waitFor
    } = ctx;

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
        assert.equal(byKey.AGENT_PROXY_URL.secret, false, "the proxy URL is a plain field");

        const proxyValue = "socks5h://proxy-user:proxy-pass-123@proxy.example:1080";
        const proxyChange = await request("POST", "/api/settings", {
            key: "AGENT_PROXY_URL",
            value: proxyValue
        });
        assert.equal(proxyChange.status, 200);
        assert.equal(runtime.settings.get("AGENT_PROXY_URL"), proxyValue);
        assert.equal(proxyChange.body.setting.value, "socks5h://proxy-user:****@proxy.example:1080", "only its password is masked");
        const proxyKept = await request("POST", "/api/settings", { key: "AGENT_PROXY_URL", value: proxyChange.body.setting.value });
        assert.equal(proxyKept.status, 200);
        assert.equal(runtime.settings.get("AGENT_PROXY_URL"), proxyValue, "saving the mask back keeps the password");
        await request("POST", "/api/settings", { key: "AGENT_PROXY_URL", reset: true });

        /* Clear in the console: a secret saved as empty */
        const cleared = await request("POST", "/api/settings", { key: "AGENT_API_KEY", value: "" });
        assert.equal(cleared.status, 200);
        assert.equal(runtime.settings.get("AGENT_API_KEY"), "");
        await request("POST", "/api/settings", { key: "AGENT_API_KEY", reset: true });

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

        const invalidProxy = await request("POST", "/api/settings", {
            key: "AGENT_PROXY_URL",
            value: "ftp://proxy.example"
        });
        assert.equal(invalidProxy.status, 400);
        assert.match(invalidProxy.body.error, /supports only/);
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

                /* `done` is published before the asynchronous git report
                   in the server's finally block. Wait for the artifacts
                   this test asserts, not just the model's terminal state. */
                return state.body.status === "done" &&
                    state.body.messages.some(
                        message => message.kind === "git-report"
                    ) &&
                    state.body.events.some(
                        event => event.type === "git:report"
                    );
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
};
