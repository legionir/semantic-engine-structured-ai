"use strict";

/*
| e2e.test.js: end to end
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function endToEndCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

    console.log("end to end");

    await test("a direct final answer completes the run", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("nothing to do")
            }));

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /FINAL RESPONSE/);
        assert.match(run.stdout, /nothing to do/);

        run.cleanup();
    });

    await test("a tool graph runs in dependency order and feeds the model", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_list",
                                    arguments: { path: "." },
                                    depends_on: []
                                },
                                {
                                    id: "call_2",
                                    name: "fs_read",
                                    arguments: {
                                        /* journal creates .agent; entries are .agent, bulk.txt, notes.txt */
                                        path: "${call_1.result.entries.2.name}"
                                    },
                                    depends_on: ["call_1"]
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("read the file")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        const toolMessages =
            stub.state.requests[1].messages.filter(
                message => message.role === "tool"
            );

        assert.equal(toolMessages.length, 2);

        const second =
            JSON.parse(toolMessages[1].content);

        /* the reference resolved to the file created by the harness */
        assert.equal(second.success, true);
        assert.equal(second.name, "fs_read");
        assert.match(second.result.content, /alpha/);

        run.cleanup();
    });

    await test("independent tools in one action run in parallel", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [1, 2, 3].map(number => ({
                                id: `call_${number}`,
                                name: "terminal_exec",
                                arguments: {
                                    command: `"${process.execPath}" -e "setTimeout(() => {}, 600)"`
                                },
                                depends_on: []
                            }))
                        })
                    };
                }

                return {
                    message: finalAction("all three finished")
                };
            });

        const startedAt = Date.now();

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        const elapsed =
            Date.now() - startedAt;

        await stub.close();

        assert.equal(run.code, 0);

        const toolMessages =
            stub.state.requests[1].messages.filter(
                message => message.role === "tool"
            );

        assert.equal(toolMessages.length, 3);

        for (const message of toolMessages) {

            assert.equal(
                JSON.parse(message.content).success,
                true
            );
        }

        /* three sleeps of 600 ms in sequence could not finish this fast */
        assert.ok(
            elapsed < 1600,
            `three parallel sleeps took ${elapsed} ms, they were not parallel`
        );

        run.cleanup();
    });

    await test("a dependency chain is executed in order", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "make_dir",
                                    name: "fs_mkdir",
                                    arguments: { path: "generated" },
                                    depends_on: []
                                },
                                {
                                    id: "write_file",
                                    name: "fs_write",
                                    arguments: {
                                        path: "generated/report.txt",
                                        content: "step two\n"
                                    },
                                    depends_on: ["make_dir"]
                                },
                                {
                                    id: "read_back",
                                    name: "fs_read",
                                    arguments: {
                                        path: "${write_file.result.path}"
                                    },
                                    depends_on: ["write_file"]
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("chain complete")
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        const toolMessages =
            stub.state.requests[1].messages
                .filter(message => message.role === "tool")
                .map(message => JSON.parse(message.content));

        assert.deepEqual(
            toolMessages.map(result => result.id),
            ["make_dir", "write_file", "read_back"]
        );

        for (const result of toolMessages) {

            assert.equal(
                result.success,
                true,
                `${result.id} failed: ${
                    result.error && result.error.message
                }`
            );
        }

        /* the third call read what the second wrote, through a reference */
        assert.match(
            toolMessages[2].result.content,
            /step two/
        );

        run.cleanup();
    });

    await test("a sub-agent can also run a parallel tool graph", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {

                    const answered =
                        request.messages.some(
                            message => message.role === "tool"
                        );

                    if (!answered) {

                        return {
                            message: action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "s1",
                                        name: "git_status",
                                        arguments: { cwd: "." },
                                        depends_on: []
                                    },
                                    {
                                        id: "s2",
                                        name: "git_log",
                                        arguments: { cwd: ".", limit: 1 },
                                        depends_on: []
                                    }
                                ]
                            })
                        };
                    }

                    return {
                        message: finalAction("two inspections done")
                    };
                }

                const delegated =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                return {
                    message:
                        delegated
                            ? finalAction("reported")
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
                            })
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        assert.equal(run.code, 0);

        /* the sub-agent's second request carries both tool answers */
        const subFollowUp =
            stub.state.requests.find(
                request =>
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    ) &&
                    request.messages.filter(
                        message => message.role === "tool"
                    ).length === 2
            );

        assert.ok(
            subFollowUp,
            "the sub-agent did not receive two tool results in one exchange"
        );

        run.cleanup();
    });

    await test("every agent is told how the tool graph works", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {
                    return { message: finalAction("sub done") };
                }

                const delegated =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                return {
                    message:
                        delegated
                            ? finalAction("done")
                            : action({
                                action: "delegate",

                                delegations: [
                                    {
                                        id: "d1",
                                        agent: "git_analysis",
                                        persona: null,
                                        skills: null,
                                        tools: null,
                                        task: "look at the repository",
                                        depends_on: []
                                    }
                                ]
                            })
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        for (const request of stub.state.requests) {

            const system =
                request.messages
                    .filter(message => message.role === "system")
                    .map(message => message.content)
                    .join("\n");

            assert.match(
                system,
                /TOOL EXECUTION IS A GRAPH/,
                "an agent was not told that tool calls form a graph"
            );

            assert.match(
                system,
                /depends_on/,
                "an agent was not told about depends_on"
            );

            assert.match(
                system,
                /\$\{call_id/,
                "an agent was not told about dependency references"
            );
        }

        run.cleanup();
    });
};
