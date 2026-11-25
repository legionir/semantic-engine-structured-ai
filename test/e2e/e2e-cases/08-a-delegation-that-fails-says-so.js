"use strict";

/*
| e2e.test.js: end to end, from "a delegation that fails says so instead of vanishing"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function aDelegationThatFailsSaysSoCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

    await test("a delegation that fails says so instead of vanishing", async () => {

        /*
        | In a real run an ad-hoc delegation failed before its agent
        | started: no agent:start, no agent:end, nothing in the log
        | between delegation:graph and the parent's next iteration.
        */

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "delegate",

                            delegations: [
                                {
                                    id: "doomed",
                                    agent: null,
                                    persona: "general_engineer",
                                    skills: ["file_management"],

                                    /* a tool the parent does not have */
                                    tools: ["nonexistent_tool"],

                                    task: "do something",
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return { message: finalAction("carried on alone") };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /Delegation "doomed" to .* failed/);

        /* the parent was told, in the results it reads */
        const results =
            stub.state.requests[1].messages
                .filter(message => message.role === "user")
                .map(message => message.content)
                .join("\n");

        assert.match(results, /sub_agent_results/);
        assert.match(results, /doomed/);

        run.cleanup();
    });

    await test("a command that exits non-zero is not reported as ok", async () => {

        /*
        | In a real run "cd /workspace && npx tsc --build" produced
        | "terminal_exec ok 112 ms" in the console, and the build had
        | never run at all.
        */

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "build",
                                    name: "terminal_exec",
                                    arguments: {
                                        command: "exit 3",
                                        timeout_ms: 5000
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return { message: finalAction("saw the exit code") };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        const result =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(message => message.role === "tool")[0]
                    .content
            );

        /* the model still receives it as data, not as a failure */
        assert.equal(result.success, true);
        assert.equal(result.result.exit_code, 3);

        run.cleanup();
    });

    await test("an overwrite that removes most of a file says so", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "shrink",
                                    name: "fs_write",
                                    arguments: {
                                        path: "bulk.txt",
                                        content: "x"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return { message: finalAction("rewrote it") };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        const result =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(message => message.role === "tool")[0]
                    .content
            ).result;

        assert.equal(result.replaced.previous_bytes, 40000);
        assert.equal(result.bytes_written, 1);
        assert.match(result.warning, /removed 100% of bulk\.txt/);

        run.cleanup();
    });

    await test("an ad-hoc sub-agent composed the way the prompt shows it works", async () => {

        /*
        | The run that started all of this delegated once, to an ad-hoc
        | agent, and lost it instantly. This is that delegation, written
        | exactly the way the system prompt teaches it.
        */

        const stub =
            await startStub((request, index, state) => {

                /* only a sub-agent is given the agent runtime rules */
                const isChild =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_runtime_rules")
                    );

                if (isChild) {

                    state.child = (state.child || 0) + 1;

                    if (state.child === 1) {

                        return {
                            message: action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "look",
                                        name: "search_start",
                                        arguments: {
                                            path: ".",
                                            query: "*.txt",
                                            mode: "files",
                                            wait_ms: 2000
                                        },
                                        depends_on: []
                                    }
                                ]
                            })
                        };
                    }

                    return {
                        message: finalAction("the loader is in notes.txt")
                    };
                }

                if (!state.delegated) {

                    state.delegated = true;

                    return {
                        message: action({
                            action: "delegate",

                            delegations: [
                                {
                                    id: "analysis_2",
                                    agent: null,
                                    persona: "general_engineer",
                                    skills: ["file_management"],
                                    tools: ["fs_read", "search_start", "search_get"],
                                    task: "Locate the configuration loader.",
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("the sub-agent reported back")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        /* the sub-agent really ran, and its report reached the parent */
        assert.match(run.stdout, /adhoc:general_engineer/);
        assert.match(run.stdout, /the loader is in notes\.txt/);
        assert.match(run.stdout, /the sub-agent reported back/);

        /* the glob search inside the sub-agent found the file */
        assert.match(run.stdout, /notes\.txt/);

        run.cleanup();
    });

    await test("an agent working alone with a full agent budget is reminded", async () => {

        /*
        | A real run spent 28 iterations implementing alone while all 15
        | sub-agents went unused. Saying so in the prompt did not work,
        | so the runtime says it at the moment it is true.
        */

        let hinted = false;
        let hintNotice = null;

        const stub =
            await startStub((request, index, state) => {

                const notice =
                    [...request.messages]
                        .reverse()
                        .find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.includes("delegation_available")
                        );

                if (notice) {

                    hinted = true;
                    hintNotice = JSON.parse(notice.content);

                    return {
                        message: finalAction("noted, carrying on alone")
                    };
                }

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "plan",
                                    name: "plan_set",
                                    arguments: {
                                        objective: "three independent things",
                                        phases: [
                                            {
                                                id: "P1",
                                                title: "work",
                                                steps: [
                                                    { id: "P1.1", title: "one", agent: "implementation" },
                                                    { id: "P1.2", title: "two", agent: "testing" },
                                                    { id: "P1.3", title: "three", agent: null }
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

                state.calls = (state.calls || 0) + 1;

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
                { DELEGATION_NUDGE_AFTER: "3" }
            );

        await stub.close();

        assert.equal(hinted, true, "the agent was never reminded");
        assert.deepEqual(
            hintNotice.assigned_steps.map(step => `${step.id}:${step.agent}`),
            ["P1.1:implementation", "P1.2:testing"]
        );
        assert.match(hintNotice.instruction, /P1\.1 → implementation/);
        assert.equal(run.code, 0);
        assert.match(run.stdout, /suggesting delegation/);
        assert.match(run.stdout, /agents unused/);

        run.cleanup();
    });
};
