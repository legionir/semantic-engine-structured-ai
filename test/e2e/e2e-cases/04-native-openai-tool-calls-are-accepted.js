"use strict";

/*
| e2e.test.js: end to end, from "native OpenAI tool calls are accepted"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function nativeOpenaiToolCallsAreAcceptedCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

    await test("native OpenAI tool calls are accepted", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "native_1",
                                    type: "function",
                                    function: {
                                        name: "fs_list",
                                        arguments: "{\"path\":\".\"}"
                                    }
                                }
                            ]
                        }
                    };
                }

                return {
                    message: finalAction("listed")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        const toolMessage =
            stub.state.requests[1].messages.find(
                message => message.role === "tool"
            );

        assert.equal(
            toolMessage.tool_call_id,
            "native_1"
        );

        run.cleanup();
    });

    await test("delegation runs a sub-agent and returns its report", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {

                    return {
                        message: finalAction("sub-agent report")
                    };
                }

                const alreadyDelegated =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                if (alreadyDelegated) {

                    return {
                        message: finalAction("aggregated")
                    };
                }

                return {
                    message: action({
                        action: "delegate",

                        delegations: [
                            {
                                id: "task_1",
                                agent: "git_analysis",
                                persona: null,
                                skills: null,
                                tools: null,
                                task: "inspect the repository",
                                depends_on: []
                            }
                        ]
                    })
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /git_analysis#1/);
        assert.match(run.stdout, /aggregated/);

        run.cleanup();
    });

    await test("a tool outside the profile is refused", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {

                    const asked =
                        request.messages.some(
                            message => message.role === "tool"
                        );

                    if (!asked) {

                        return {
                            message: action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "call_1",
                                        name: "fs_delete",
                                        arguments: { path: "notes.txt" },
                                        depends_on: []
                                    }
                                ]
                            })
                        };
                    }

                    return {
                        message: finalAction("could not delete")
                    };
                }

                const done =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                return {
                    message:
                        done
                            ? finalAction("reported")
                            : action({
                                action: "delegate",

                                delegations: [
                                    {
                                        id: "task_1",
                                        agent: "git_analysis",
                                        persona: null,
                                        skills: null,
                                        tools: null,
                                        task: "try to delete a file",
                                        depends_on: []
                                    }
                                ]
                            })
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.match(
            run.stdout,
            /is not allowed for this agent/
        );

        /* the file must still be there */
        assert.equal(
            fs.existsSync(
                path.join(run.workspace, "notes.txt")
            ),
            true
        );

        run.cleanup();
    });

    await test("policy denies a destructive shell command", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "terminal_exec",
                                    arguments: {
                                        command: "rm -rf /"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("denied as expected")
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
        assert.match(
            toolMessage.error.message,
            /denied by policy/
        );

        run.cleanup();
    });

    await test("unattended approval mode blocks tools that need approval", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_write",
                                    arguments: {
                                        path: "new.txt",
                                        content: "x"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("could not write")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {
                    AGENT_APPROVAL: "deny"
                }
            );

        await stub.close();

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        assert.match(
            toolMessage.error.message,
            /requires approval/
        );

        assert.equal(
            fs.existsSync(
                path.join(run.workspace, "new.txt")
            ),
            false
        );

        run.cleanup();
    });

    await test("a transient server error is retried", async () => {

        let failures = 0;

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    failures++;

                    return {
                        status: 503,
                        body: { error: "upstream unavailable" }
                    };
                }

                return {
                    message: finalAction("recovered")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {
                    RETRY_BASE_MS: "50"
                }
            );

        await stub.close();

        assert.equal(failures, 1);
        assert.equal(run.code, 0);
        assert.match(run.stdout, /retrying in/);
        assert.match(run.stdout, /recovered/);

        run.cleanup();
    });

    await test("a permanent client error is not retried", async () => {

        const stub =
            await startStub(() => ({
                status: 400,
                body: { error: "bad request" }
            }));

        const run =
            await runAgent(
                stub.port,
                {
                    RETRY_BASE_MS: "50"
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.equal(stub.state.requests.length, 1);
        assert.match(run.stderr, /API Error 400/);

        run.cleanup();
    });

    await test("the run deadline stops a slow endpoint", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("too late"),

                /* slower than the deadline below */
                delayMs: 5000
            }));

        const run =
            await runAgent(
                stub.port,
                {
                    MAX_RUN_MS: "1500",
                    MAX_REQUEST_MS: "60000",
                    MAX_REQUEST_RETRIES: "0"
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.match(
            run.stderr,
            /run budget of 1500 ms \(MAX_RUN_MS\)/i
        );

        run.cleanup();
    });
};
