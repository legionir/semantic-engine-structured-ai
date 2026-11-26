"use strict";

/*
| e2e.test.js: end to end, from "a final answer is refused while the plan has open steps"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function aFinalAnswerIsRefusedWhileCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

    await test("a final answer is refused while the plan has open steps", async () => {

        const stub =
            await startStub((request, index) => {

                const nudges =
                    request.messages.filter(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("plan_incomplete")
                    ).length;

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "s",
                                    name: "plan_set",
                                    arguments: {
                                        objective: "two things",
                                        phases: [
                                            {
                                                id: "P1",
                                                title: "work",
                                                steps: [
                                                    { id: "P1.1", title: "a" },
                                                    { id: "P1.2", title: "b" }
                                                ]
                                            }
                                        ]
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                /* the model tries to stop after writing the plan */
                if (index === 2) {

                    return {
                        message: finalAction("the plan is written, the rest is a lot of work")
                    };
                }

                if (nudges > 0 && index === 3) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "u1",
                                    name: "plan_update",
                                    arguments: {
                                        updates: [
                                            {
                                                id: "P1.1",
                                                status: "done",
                                                evidence: "did a"
                                            }
                                        ]
                                    },
                                    depends_on: []
                                },
                                {
                                    id: "u2",
                                    name: "plan_update",
                                    arguments: {
                                        updates: [
                                            {
                                                id: "P1.2",
                                                status: "done",
                                                evidence: "did b"
                                            }
                                        ]
                                    },
                                    depends_on: ["u1"]
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("both steps are done")
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        assert.match(run.stdout, /Plan still has 2 open step\(s\)/);
        assert.match(run.stdout, /both steps are done/);
        assert.equal(run.code, 0);

        /* the notice carried the next step, not just a complaint */
        const notice =
            JSON.parse(
                stub.state.requests[2].messages
                    .filter(message => message.role === "user")
                    .pop().content
            );

        assert.equal(notice.notice, "plan_incomplete");
        assert.equal(notice.next_step.id, "P1.1");
        assert.equal(notice.progress.open, 2);

        run.cleanup();
    });

    await test("a completed plan lets the run finish", async () => {

        const stub =
            await startStub((request, index) =>
                index === 1
                    ? {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "s",
                                    name: "plan_set",
                                    arguments: {
                                        objective: "one thing",
                                        phases: [
                                            {
                                                id: "P1",
                                                title: "work",
                                                steps: [
                                                    {
                                                        id: "P1.1",
                                                        title: "a",
                                                        status: "done",
                                                        evidence: "already done"
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    }
                    : { message: finalAction("nothing left to do") }
            );

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        assert.equal(
            run.stdout.includes("Plan still has"),
            false
        );

        assert.equal(run.code, 0);

        run.cleanup();
    });

    await test("the runtime context is refreshed every iteration", async () => {

        const stub =
            await startStub((request, index) =>
                index < 3
                    ? {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: `c${index}`,
                                    name: "fs_list",
                                    arguments: { path: "." },
                                    depends_on: []
                                }
                            ]
                        })
                    }
                    : { message: finalAction("done") }
            );

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        const remaining =
            stub.state.requests.map(request => {

                const context =
                    JSON.parse(
                        request.messages.find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.startsWith("{") &&
                                message.content.includes("runtime_context")
                        ).content
                    ).context;

                return context.runtime.run_remaining_ms;
            });

        assert.ok(
            remaining[1] < remaining[0],
            "the deadline in the context never moved"
        );

        run.cleanup();
    });

    await test("a long run compacts before the ceiling and keeps going", async () => {

        /* every answer reads a big file, so the transcript grows fast */

        const stub =
            await startStub((request, index) =>
                index <= 8
                    ? {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: `c${index}`,
                                    name: "fs_read",
                                    arguments: { path: "bulk.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    }
                    : { message: finalAction("read enough") }
            );

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto",
                MAX_CONTEXT_CHARS: "80000",
                CONTEXT_COMPACT_AT: "0.7",
                MAX_TOOL_RESULT_CHARS: "20000"
            });

        await stub.close();

        assert.equal(run.code, 0);

        const sizes =
            stub.state.requests.map(
                request =>
                    JSON.stringify(request.messages).length
            );

        /*
        | The static prompt is about 26k on its own, so the test is not
        | about an absolute number: it is that growth stops. Without
        | maintenance each read would add 20k for ever.
        */

        const early = sizes[2];
        const late = sizes[sizes.length - 1];

        assert.ok(
            late < early * 1.4,
            `the conversation kept growing: ${sizes.join(" then ")}`
        );

        assert.ok(
            Math.max(...sizes) < 140000,
            `the conversation reached ${Math.max(...sizes)} chars`
        );

        assert.match(run.stdout, /Context \d+k of 80k, compacted/);

        run.cleanup();
    });

    await test("raising the timeout from the store extends a running deadline", async () => {

        const stub =
            await startStub((request, index) => {

                const context =
                    JSON.parse(
                        request.messages.find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.startsWith("{") &&
                                message.content.includes("runtime_context")
                        ).content
                    ).context;

                /* the model can see the budget move */
                return {
                    message:
                        index === 1
                            ? action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "c1",
                                        name: "fs_list",
                                        arguments: { path: "." },
                                        depends_on: []
                                    }
                                ]
                            })
                            : finalAction(
                                `remaining ${context.runtime.run_remaining_ms}`
                            )
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto",
                MAX_RUN_MS: "30000"
            });

        await stub.close();

        const first =
            JSON.parse(
                stub.state.requests[0].messages.find(
                    message =>
                        typeof message.content === "string" &&
                        message.content.startsWith("{") &&
                        message.content.includes("runtime_context")
                ).content
            ).context.runtime;

        assert.equal(first.max_run_ms, 30000);
        assert.ok(first.run_remaining_ms <= 30000);

        assert.equal(run.code, 0);

        run.cleanup();
    });

    await test("a failing tool is reported without ending the run", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_read",
                                    arguments: { path: "missing.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("handled the failure")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        assert.equal(toolMessage.success, false);
        assert.match(toolMessage.error.message, /does not exist/);
        assert.equal(run.code, 0);

        run.cleanup();
    });
};
