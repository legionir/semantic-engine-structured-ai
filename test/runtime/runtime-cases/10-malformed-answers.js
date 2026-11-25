"use strict";

/*
| runtime.test.js: malformed answers
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function malformedAnswersCases(ctx) {

    const {
        runtime,
        test,
        throws
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nmalformed answers");

    await test("arguments with a tool result appended are read, not lost", async () => {

        /*
        | The exact shape a 20B model returned in a real run: a complete
        | arguments object followed by the tail of the previous tool
        | RESULT envelope.
        */

        const adapted =
            runtime.adaptNativeToolCalls({
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: "call_1",
                        type: "function",
                        function: {
                            name: "fs_write",
                            arguments:
                                '{"path":"PROJECT_STATUS.md","content":"# hello\\n","mode":"overwrite","created":false,"bytes_written":5998,"size_bytes":5998},"name":"fs_write"}'
                        }
                    }
                ]
            });

        assert.equal(adapted.action, "tool_call");
        assert.equal(adapted.tool_calls[0].name, "fs_write");

        assert.deepEqual(
            adapted.tool_calls[0].arguments,
            {
                path: "PROJECT_STATUS.md",
                content: "# hello\n",
                mode: "overwrite"
            },
            "keys the tool does not declare must be dropped"
        );
    });

    await test("arguments wrapped in prose or a fence are still read", async () => {

        const { parseToolArguments } = runtime;

        assert.deepEqual(
            parseToolArguments('```json\n{"path":"a.ts"}\n```').arguments,
            { path: "a.ts" }
        );

        assert.deepEqual(
            parseToolArguments('{"path":"a.ts"} and that is the call').arguments,
            { path: "a.ts" }
        );

        /* a brace inside a string is not the end of the object */
        assert.deepEqual(
            parseToolArguments('{"content":"function f() { return 1; }"}trailing')
                .arguments,
            { content: "function f() { return 1; }" }
        );
    });

    await test("arguments that cannot be read are refused, never guessed", async () => {

        const { parseToolArguments } = runtime;

        assert.ok(parseToolArguments('{"path":"a.ts","content":"unter').failed);
        assert.ok(parseToolArguments("no json here at all").failed);
        assert.ok(parseToolArguments('["a","b"]').failed);
    });

    await test("a misplaced version suffix is repaired without a retry", async () => {

        const malformed = {
            action: "tool_call",
            data: null,
            delegations: null,
            error: null,
            performed: null,
            response: null,
            tool_calls: [
                {
                    id: "list_root",
                    name: "fs_list",
                    arguments: { path: "." },
                    depends_on: []
                },
                {
                    id: "search_plan",
                    name: "search_start",
                    arguments: {
                        path: ".",
                        query: "IMPLEMENTATION_PLAN.md",
                        mode: "files"
                    },
                    depends_on: []
                },
                "version",
                "1.0"
            ]
        };

        const repaired =
            runtime.repairStructuredAction(malformed);

        assert.equal(repaired.repaired, true);
        assert.deepEqual(repaired.moved_fields, ["version"]);
        assert.equal(repaired.action.version, "1.0");
        assert.equal(repaired.action.tool_calls.length, 2);

        const parsed =
            runtime.readModelAction({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(malformed)
                        }
                    }
                ]
            });

        assert.equal(parsed.structured.version, "1.0");
        assert.equal(parsed.structured.tool_calls.length, 2);
        assert.equal(
            JSON.parse(parsed.message.content).version,
            "1.0",
            "the repaired envelope must replace malformed session content"
        );
    });

    await test("fixed null envelope fields are defaulted without a retry", async () => {

        const repairs = [];
        const collectRepair = event => repairs.push(event);

        runtime.events.bus.on("response:repaired", collectRepair);

        try {

            const toolAction =
                runtime.readModelAction({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: JSON.stringify({
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
                            }
                        }
                    ]
                });

            assert.equal(toolAction.structured.version, "1.0");
            assert.equal(toolAction.structured.data, null);
            assert.equal(toolAction.structured.delegations, null);
            assert.equal(toolAction.structured.response, null);
            assert.equal(toolAction.structured.error, null);
            assert.equal(toolAction.structured.performed, null);

            const finalAction =
                runtime.readModelAction({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: JSON.stringify({
                                    version: "1.0",
                                    action: "final",
                                    response: {
                                        type: "text",
                                        content: "done"
                                    }
                                })
                            }
                        }
                    ]
                });

            assert.equal(finalAction.structured.tool_calls, null);
            assert.equal(finalAction.structured.delegations, null);
            assert.equal(finalAction.structured.data, null);
            assert.equal(finalAction.structured.error, null);
            assert.equal(finalAction.structured.performed, null);
            assert.equal(repairs.length, 0);

        } finally {
            runtime.events.bus.off("response:repaired", collectRepair);
        }
    });

    await test("model-owned tool call content is rejected rather than guessed", async () => {

        const read = structured =>
            runtime.readModelAction({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(structured)
                        }
                    }
                ]
            });

        const base = {
            version: "1.0",
            action: "tool_call",
            tool_calls: [],
            delegations: null,
            response: null,
            data: null,
            error: null,
            performed: null
        };

        const missingArguments = {
            id: "read_plan",
            name: "fs_read",
            depends_on: []
        };

        throws(
            () => read({ ...base, tool_calls: [missingArguments] }),
            /missing required field\(s\): arguments/
        );

        /* depends_on is fixed protocol metadata with a single legal default
           for an independent call ([]), so a model omitting it is repaired,
           not rejected, just like version. Model-owned content such as a
           non-object item in tool_calls is still refused. */
        const missingDependency = {
            id: "read_plan",
            name: "fs_read",
            arguments: { path: "IMPLEMENTATION_PLAN.md" }
        };

        const repairedDependency =
            read({ ...base, tool_calls: [missingDependency] });

        assert.deepEqual(
            repairedDependency.structured.tool_calls[0].depends_on,
            []
        );

        throws(
            () => read({ ...base, tool_calls: ["fs_read"] }),
            /Each tool call must be an object/
        );
    });

    await test("a delegation missing depends_on is repaired, not rejected", async () => {

        const read = structured =>
            runtime.readModelAction({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(structured)
                        }
                    }
                ]
            });

        const repaired = read({
            version: "1.0",
            action: "delegate",
            tool_calls: null,
            delegations: [
                {
                    id: "d1",
                    agent: "implementation",
                    persona: null,
                    skills: null,
                    tools: null,
                    task: "do the work"
                }
            ],
            response: null,
            data: null,
            error: null,
            performed: null
        });

        assert.deepEqual(
            repaired.structured.delegations[0].depends_on,
            []
        );

        /* A malformed (non-array) depends_on is model-owned intent and must
           still be rejected rather than silently reset. */
        throws(
            () => read({
                version: "1.0",
                action: "delegate",
                tool_calls: null,
                delegations: [
                    {
                        id: "d1",
                        agent: "implementation",
                        persona: null,
                        skills: null,
                        tools: null,
                        task: "do the work",
                        depends_on: "d2"
                    }
                ],
                response: null,
                data: null,
                error: null,
                performed: null
            }),
            /depends_on must be an array/
        );
    });

    await test("delegation policy violations are model-response errors, not run killers", async () => {

        const policyError = () =>
            runtime.validateDelegationPolicy(
                {
                    name: "main_agent",
                    delegation: {
                        enabled: true,
                        max_depth: 3,
                        max_children: 1
                    }
                },
                3,
                [
                    { id: "a", task: "t", depends_on: [] },
                    { id: "b", task: "t", depends_on: [] }
                ]
            );

        const error =
            throws(policyError, /exceeded max_children/);

        assert.equal(
            runtime.isModelResponseError(error),
            true,
            "a delegation policy violation must be retryable, not kill the run"
        );
        assert.equal(error.code, "INVALID_DELEGATION");

        /* A disabled-delegation profile is likewise a model-response error. */
        const disabled = () =>
            runtime.validateDelegationPolicy(
                {
                    name: "no_delegate",
                    delegation: {
                        enabled: false,
                        max_depth: 0,
                        max_children: 0
                    }
                },
                0,
                [{ id: "a", task: "t", depends_on: [] }]
            );

        assert.equal(
            runtime.isModelResponseError(
                throws(disabled, /is not allowed to delegate/)
            ),
            true
        );
    });
};
