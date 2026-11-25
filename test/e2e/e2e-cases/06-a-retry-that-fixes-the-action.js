"use strict";

/*
| e2e.test.js: end to end, from "a retry that fixes the action but still omits version can proceed"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function aRetryThatFixesTheActionCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

    await test("a retry that fixes the action but still omits version can proceed", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "delegate",
                                    data: null,
                                    delegations: null,
                                    error: null,
                                    performed: null,
                                    response: null,
                                    tool_calls: null
                                })
                        }
                    };
                }

                if (index === 2) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    data: null,
                                    delegations: null,
                                    error: null,
                                    performed: null,
                                    response: null,
                                    tool_calls: [
                                        {
                                            id: "read_plan",
                                            name: "fs_read",
                                            arguments: { path: "IMPLEMENTATION_PLAN.md" },
                                            depends_on: []
                                        }
                                    ]
                                })
                        }
                    };
                }

                return {
                    message: finalAction("continued after one correction")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {},
                workspace => {
                    fs.writeFileSync(
                        path.join(workspace, "IMPLEMENTATION_PLAN.md"),
                        "phase one\n"
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(
            (run.stdout.match(/Unreadable answer/g) || []).length,
            1
        );
        assert.match(run.stdout, /delegations must contain at least one/);
        assert.equal(
            /missing required top-level field "version"/.test(run.stdout),
            false
        );
        assert.equal(/Repaired the action envelope/.test(run.stdout), false);
        assert.match(run.stdout, /continued after one correction/);

        run.cleanup();
    });

    await test("omitted fixed envelope fields do not spend a retry", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "read_plan",
                                            name: "fs_read",
                                            arguments: {
                                                path: "IMPLEMENTATION_PLAN.md"
                                            },
                                            depends_on: []
                                        }
                                    ]
                                })
                        }
                    };
                }

                return {
                    message: finalAction("read with fixed defaults")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {},
                workspace => {
                    fs.writeFileSync(
                        path.join(workspace, "IMPLEMENTATION_PLAN.md"),
                        "phase one\n"
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(stub.state.requests.length, 2);
        assert.equal(/Unreadable answer/.test(run.stdout), false);
        assert.equal(/Repaired the action envelope/.test(run.stdout), false);
        assert.match(run.stdout, /read with fixed defaults/);

        const result =
            JSON.parse(
                stub.state.requests[1].messages.find(
                    message => message.role === "tool"
                ).content
            );

        assert.equal(result.success, true);

        run.cleanup();
    });

    await test("a truncated write receives a bounded-payload correction", async () => {

        let notice;

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "write_big",
                                            name: "fs_write"
                                        }
                                    ]
                                })
                        }
                    };
                }

                if (index === 2) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    tool_calls: ["fs_write"]
                                })
                        }
                    };
                }

                if (index === 3) {

                    return {
                        finish_reason: "length",
                        usage: { completion_tokens: 2048 },
                        message: {
                            role: "assistant",
                            content:
                                '{"action":"tool_call","tool_calls":[{' +
                                '"id":"write_big","name":"fs_write",' +
                                '"arguments":{"path":"BIG.test.ts","content":"import'
                        }
                    };
                }

                if (index === 4) {

                    notice =
                        JSON.parse(
                            request.messages[request.messages.length - 1].content
                        );

                    return {
                        message:
                            action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "write_small",
                                        name: "fs_write",
                                        arguments: {
                                            path: "SMALL.test.ts",
                                            content: "export const ok = true;\n",
                                            mode: "overwrite"
                                        },
                                        depends_on: []
                                    }
                                ]
                            })
                    };
                }

                return {
                    message: finalAction("recovered from truncation")
                };
            });

        const run = await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(stub.state.requests.length, 5);
        assert.equal(notice.error.code, "TRUNCATED_RESPONSE");
        assert.equal(notice.correction_attempt.attempt, 1);
        assert.match(notice.error.message, /2048 completion tokens/);
        assert.equal(notice.response_diagnostics.finish_reason, "length");
        assert.equal(notice.response_diagnostics.completion_tokens, 2048);
        assert.equal(notice.detected_action, "tool_call");
        assert.match(notice.repair.issue_specific, /much smaller complete action/);
        assert.match(notice.repair.issue_specific, /temporary path/);
        assert.equal(/neither structured JSON/.test(run.stdout), false);
        assert.equal(
            fs.readFileSync(
                path.join(run.workspace, "SMALL.test.ts"),
                "utf8"
            ),
            "export const ok = true;\n"
        );

        run.cleanup();
    });

    await test("a successful correction resets the malformed retry budget", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1 || index === 3) {

                    return {
                        message: {
                            role: "assistant",
                            content: `not json ${index}`
                        }
                    };
                }

                if (index === 2) {

                    return {
                        message:
                            action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "list_root",
                                        name: "fs_list",
                                        arguments: { path: "." },
                                        depends_on: []
                                    }
                                ]
                            })
                    };
                }

                return {
                    message: finalAction("two independent corrections succeeded")
                };
            });

        const run =
            await runAgent(
                stub.port,
                { MAX_MALFORMED_RESPONSES: "1" }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(stub.state.requests.length, 4);
        assert.equal(
            (run.stdout.match(/Unreadable answer/g) || []).length,
            2
        );
        assert.match(run.stdout, /two independent corrections succeeded/);

        run.cleanup();
    });

    await test("a badly serialised tool call does not end the run", async () => {

        /*
        | Reproduces a real failure: a 20B model appended the shape of
        | the previous tool result to the arguments of the next call.
        | The run used to die on the spot.
        */

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "call_write",
                                    type: "function",
                                    function: {
                                        name: "fs_write",
                                        arguments:
                                            '{"path":"NOTES.md","content":"# notes\\n","mode":"overwrite","created":false,"bytes_written":8,"size_bytes":8},"name":"fs_write"}'
                                    }
                                }
                            ]
                        }
                    };
                }

                if (index === 2) {

                    /* this one cannot be salvaged at all */
                    return {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "call_broken",
                                    type: "function",
                                    function: {
                                        name: "fs_write",
                                        arguments: '{"path":"X.md","content":"unter'
                                    }
                                }
                            ]
                        }
                    };
                }

                return {
                    message: finalAction("wrote the notes and recovered")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        /* the salvaged call really ran */
        assert.equal(
            fs.readFileSync(
                path.join(run.workspace, "NOTES.md"),
                "utf8"
            ),
            "# notes\n"
        );

        /* the unsalvageable one was handed back, not fatal */
        assert.match(run.stdout, /Unreadable answer/);
        assert.match(run.stdout, /wrote the notes and recovered/);

        run.cleanup();
    });
};
