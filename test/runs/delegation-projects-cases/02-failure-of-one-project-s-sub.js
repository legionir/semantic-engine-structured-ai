"use strict";

/*
| delegation-projects.test.js: from "failure of one project's Sub-Agent does not block the other"
|
| Runs inside delegation-projects.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function failureOfOneProjectSSubCases(ctx) {

    const {
        MARKER_A,
        MARKER_B,
        action,
        finalAction,
        hasSubResults,
        hasToolResults,
        isSubAgent,
        messageText,
        runtime,
        setModes,
        settings,
        stub,
        subAgentResultsOf,
        test,
        twoProjectRoots
    } = ctx;

    await test("failure of one project's Sub-Agent does not block the other", async () => {

        setModes("modular", "modular", "modular");

        const { rootA, rootB, recordA, recordB } = twoProjectRoots();

        stub.requests = [];

        stub.handler = (parsed) => {

            if (isSubAgent(parsed)) {

                if (!hasToolResults(parsed)) {

                    return {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(
                                action({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "read_ok",
                                            name: "fs_read",
                                            arguments: { path: "marker.txt" },
                                            depends_on: []
                                        }
                                    ]
                                })
                            )
                        }
                    };

                }

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(`survived ${MARKER_A}`)
                        )
                    }
                };

            }

            if (hasSubResults(parsed)) {

                const payload =
                    parsed.messages
                        .filter(message => message.role === "user")
                        .map(message => message.content)
                        .join("\n");

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(`partial ${payload}`)
                        )
                    }
                };

            }

            return {
                message: {
                    role: "assistant",
                    content: JSON.stringify(
                        action({
                            action: "delegate",
                            delegations: [
                                {
                                    id: "good",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Read marker.txt in ${MARKER_A}`,
                                    depends_on: [],
                                    projectId: recordA.id
                                },
                                {
                                    id: "bad",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: "inspect the missing project",
                                    depends_on: [],
                                    projectId: "prj-does-not-exist"
                                }
                            ]
                        })
                    )
                }
            };

        };

        const outcome = await runtime.runAgent({
            task: "one will fail",
            projectId: recordB.id
        });

        assert.match(String(outcome.response.content), /partial/);
        assert.match(String(outcome.response.content), /survived/);

        const labeled = subAgentResultsOf(stub.requests);

        assert.ok(labeled);
        assert.equal(labeled.length, 2);

        const good = labeled.find(item => item.id === "good");
        const bad = labeled.find(item => item.id === "bad");

        assert.equal(good.success, true);
        assert.equal(good.projectId, recordA.id);
        assert.match(good.findings.join(" "), /survived/);

        assert.equal(bad.success, false);
        assert.equal(bad.projectId, "prj-does-not-exist");
        assert.match(bad.error.message, /Unknown project/);
        assert.deepEqual(bad.findings, []);

        fs.rmSync(rootA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        fs.rmSync(rootB, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

        setModes(null, null, null);

    });


    await test("cross-project and multi-project writes issue a separate approval", async () => {

        setModes("modular", "modular", "modular");

        const { rootA, rootB, recordA, recordB } = twoProjectRoots();

        const approvals = [];

        runtime.setApprovalHandler(async (evaluation) => {

            approvals.push({
                tool: evaluation.tool,
                reason: evaluation.reason,
                rule: evaluation.rule,
                project_id: evaluation.project_id
            });

            return true;

        });

        settings.set("AGENT_APPROVAL", "prompt");

        stub.requests = [];

        stub.handler = (parsed) => {

            if (isSubAgent(parsed)) {

                const text = messageText(parsed);
                const writes =
                    text.includes(MARKER_B) ||
                    text.includes("implementation");

                if (writes && !hasToolResults(parsed)) {

                    return {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(
                                action({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "write_b",
                                            name: "fs_write",
                                            arguments: {
                                                path: "from-sub.txt",
                                                content: `written-on-b ${MARKER_B}\n`
                                            },
                                            depends_on: []
                                        }
                                    ]
                                })
                            )
                        }
                    };

                }

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction(
                                writes
                                    ? `wrote on ${recordB.id}`
                                    : `noted ${MARKER_A}`
                            )
                        )
                    }
                };

            }

            const alreadyWrote =
                parsed.messages.some(message => message.role === "tool");

            if (alreadyWrote) {

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            finalAction("wrote after multi-project delegation")
                        )
                    }
                };

            }

            if (hasSubResults(parsed)) {

                return {
                    message: {
                        role: "assistant",
                        content: JSON.stringify(
                            action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "write_multi",
                                        name: "fs_write",
                                        arguments: {
                                            path: "from-main.txt",
                                            content: "after two projects\n"
                                        },
                                        depends_on: []
                                    }
                                ]
                            })
                        )
                    }
                };

            }

            return {
                message: {
                    role: "assistant",
                    content: JSON.stringify(
                        action({
                            action: "delegate",
                            delegations: [
                                {
                                    id: "read-a",
                                    agent: "code_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Note ${MARKER_A}`,
                                    depends_on: [],
                                    projectId: recordA.id
                                },
                                {
                                    id: "write-b",
                                    agent: "implementation",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: `Write a file on ${MARKER_B}`,
                                    depends_on: [],
                                    projectId: recordB.id
                                }
                            ]
                        })
                    )
                }
            };

        };

        try {

            const outcome = await runtime.runAgent({
                task: "cross write then multi write",
                projectId: recordA.id
            });

            assert.match(
                String(outcome.response.content),
                /wrote after multi-project/
            );

        } finally {

            runtime.setApprovalHandler(null);
            settings.set("AGENT_APPROVAL", "auto");
            setModes(null, null, null);

        }

        const cross =
            approvals.filter(item => item.rule === "cross_project_write");

        const multi =
            approvals.filter(item => item.rule === "multi_project_write");

        assert.ok(
            cross.length >= 1,
            `expected a cross-project write approval, got ${JSON.stringify(approvals)}`
        );

        assert.equal(cross[0].tool, "fs_write");
        assert.equal(cross[0].project_id, recordB.id);
        assert.match(cross[0].reason, /cross-project write/);

        assert.ok(
            multi.length >= 1,
            `expected a multi-project write approval, got ${JSON.stringify(approvals)}`
        );

        assert.equal(multi[0].tool, "fs_write");
        assert.match(multi[0].reason, /multi-project task/);

        /* the extra approval is in addition to the ordinary policy one */
        const policyWrites =
            approvals.filter(
                item =>
                    item.tool === "fs_write" &&
                    item.rule !== "cross_project_write" &&
                    item.rule !== "multi_project_write"
            );

        assert.ok(
            policyWrites.length >= 1,
            "ordinary write approval was replaced instead of kept separate"
        );

        assert.equal(
            fs.readFileSync(path.join(rootB, "from-sub.txt"), "utf8"),
            `written-on-b ${MARKER_B}\n`
        );

        assert.equal(
            fs.readFileSync(path.join(rootA, "from-main.txt"), "utf8"),
            "after two projects\n"
        );

        fs.rmSync(rootA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        fs.rmSync(rootB, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

        setModes(null, null, null);

    });


    await test("the canonical runtime validates an explicit delegation project", async () => {

        setModes();
        stub.requests = [];
        stub.handler = parsed => {
            if (isSubAgent(parsed) || hasSubResults(parsed)) {
                return { message: { role: "assistant", content: JSON.stringify(finalAction("done")) } };
            }

            return {
                message: {
                    role: "assistant",
                    content: JSON.stringify(action({
                        action: "delegate",
                        delegations: [{
                            id: "d-canonical-project",
                            agent: "code_analysis",
                            persona: null,
                            skills: null,
                            tools: null,
                            task: "this must not run",
                            depends_on: [],
                            projectId: "prj-removed-mode-test"
                        }]
                    }))
                }
            };
        };

        const output =
            await runtime.runAgent({ task: "canonical delegation project" });

        assert.match(String(output.response.content), /done/);
        assert.equal(
            stub.requests.length,
            2,
            "the invalid delegation should be reported to the parent without starting a child"
        );
        assert.ok(
            !stub.requests[1].messages.some(message =>
                typeof message.content === "string" &&
                message.content.includes("agent_profile")
            ),
            "an unknown project must not start a child agent"
        );

    });
};
