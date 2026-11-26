"use strict";

/*
| e2e.test.js: end to end, from "an agent that delegates is never reminded"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function anAgentThatDelegatesIsNeverCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

    await test("an agent that delegates is never reminded", async () => {

        let hinted = false;

        const stub =
            await startStub((request, index, state) => {

                if (
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("delegation_available")
                    )
                ) {
                    hinted = true;
                }

                const isChild =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_runtime_rules")
                    );

                if (isChild) {
                    return { message: finalAction("child done") };
                }

                if (index === 1) {

                    return {
                        message: action({
                            action: "delegate",

                            delegations: [
                                {
                                    id: "d1",
                                    agent: "git_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: "report the repository state",
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                state.calls = (state.calls || 0) + 1;

                if (state.calls > 6) {
                    return { message: finalAction("done") };
                }

                return {
                    message: action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: `read_${state.calls}`,
                                name: "fs_read",
                                arguments: { path: "notes.txt" },
                                depends_on: []
                            }
                        ]
                    })
                };
            });

        const run =
            await runAgent(
                stub.port,
                { DELEGATION_NUDGE_AFTER: "2" }
            );

        await stub.close();

        assert.equal(hinted, false, "an agent that delegated was still nagged");

        run.cleanup();
    });

    await test("the runtime journals endpoint thinking and tools per agent", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            ...action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "journal_read",
                                        name: "fs_read",
                                        arguments: { path: "notes.txt" },
                                        depends_on: []
                                    }
                                ]
                            }),
                            reasoning_content:
                                "I should inspect notes.txt before answering."
                        }
                    };
                }

                return {
                    message: finalAction("journalled")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);

        const root =
            path.join(run.workspace, ".agent", "journal");
        const day = fs.readdirSync(root)[0];
        const records =
            fs.readFileSync(
                path.join(root, day, "main_agent.jsonl"),
                "utf8"
            )
                .trim()
                .split("\n")
                .map(line => JSON.parse(line));

        assert.ok(
            records.some(
                item =>
                    item.kind === "thinking" &&
                    String(item.thinking).includes("inspect notes.txt")
            )
        );
        assert.ok(
            records.some(
                item =>
                    item.kind === "tool" &&
                    item.tools[0].name === "fs_read" &&
                    item.tools[0].success === true
            )
        );

        run.cleanup();
    });

    await test("a required before_task hook stops the model loop", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("model should not be called")
            }));

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [
                                    {
                                        id: "precondition",
                                        type: "tool",
                                        tool: "fs_read",
                                        arguments: { path: "missing-precondition.txt" },
                                        on_failure: "stop"
                                    }
                                ],
                                after_task: []
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.equal(stub.state.requests.length, 0);
        assert.match(run.stderr, /Required before_task hook "precondition" failed/);

        run.cleanup();
    });

    await test("after_task tool hooks run only after files changed", async () => {

        const stub =
            await startStub((request, index) => ({
                message:
                    index === 1
                        ? action({
                            action: "tool_call",
                            tool_calls: [
                                {
                                    id: "write",
                                    name: "fs_write",
                                    arguments: {
                                        path: "hooked.txt",
                                        content: "changed\n"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                        : finalAction("main work finished")
            }));

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "inspect_change",
                                        type: "tool",
                                        tool: "fs_info",
                                        when: "files_changed",
                                        arguments: { path: "hooked.txt" },
                                        on_failure: "stop"
                                    }
                                ]
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /Automated routine/);
        assert.match(run.stdout, /inspect_change: ok/);
        assert.match(run.stdout, /hooked\.txt/);

        run.cleanup();
    });

    await test("a required after_task hook marks the final answer incomplete", async () => {

        const stub =
            await startStub((request, index) => ({
                message:
                    index === 1
                        ? action({
                            action: "tool_call",
                            tool_calls: [
                                {
                                    id: "write",
                                    name: "fs_write",
                                    arguments: {
                                        path: "changed.txt",
                                        content: "changed\n"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                        : finalAction("claimed success")
            }));

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "required_check",
                                        type: "tool",
                                        tool: "fs_read",
                                        when: "files_changed",
                                        arguments: { path: "does-not-exist.txt" },
                                        on_failure: "stop"
                                    }
                                ]
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.match(run.stdout + run.stderr, /HOOK_FAILED/);
        assert.match(run.stdout + run.stderr, /required_check: failed/);

        run.cleanup();
    });

    await test("after_task hooks still report when the main run throws", async () => {

        const stub =
            await startStub(() => ({
                message:
                    action({
                        action: "final",
                        response: null
                    })
            }));

        const run =
            await runAgent(
                stub.port,
                {
                    HOOKS_ENABLED: "true",
                    MAX_MALFORMED_RESPONSES: "0"
                },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "failure_diagnostic",
                                        type: "tool",
                                        tool: "fs_list",
                                        arguments: { path: "." },
                                        on_failure: "report"
                                    }
                                ]
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.match(run.stderr, /Final response is missing/);
        assert.match(run.stderr, /Automated routine/);
        assert.match(run.stderr, /failure_diagnostic: ok/);

        run.cleanup();
    });
};
