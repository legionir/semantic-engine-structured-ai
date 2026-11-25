"use strict";

/*
| web.test.js: from "a loop is reported as an event, not only as a log line"
|
| Runs inside web.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function aLoopIsReportedAsAnCases(ctx) {

    const {
        WORKSPACE,
        action,
        collectEvents,
        finalAction,
        request,
        runtime,
        startModelStub,
        test,
        waitFor,
        waitForRunEnd
    } = ctx;

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

        await waitForRunEnd(stream, 20000);

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

        await waitForRunEnd(stream);

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
};
