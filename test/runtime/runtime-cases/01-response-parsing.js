"use strict";

/*
| runtime.test.js: response parsing
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function responseParsingCases(ctx) {

    const {
        asMessage,
        runtime,
        test,
        throws
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("response parsing");

    await test("structured JSON content is parsed", async () => {

        const parsed =
            runtime.parseStructuredResponse(
                asMessage({
                    role: "assistant",
                    content: JSON.stringify({
                        version: "1.0",
                        action: "final",
                        tool_calls: null,
                        delegations: null,
                        response: { type: "text", content: "hi" },
                        data: null,
                        error: null
                    })
                })
            );

        assert.equal(parsed.source, "structured_content");
        assert.equal(parsed.structured.action, "final");
    });

    await test("content wrapped in a markdown fence is unwrapped", async () => {

        const parsed =
            runtime.parseStructuredResponse(
                asMessage({
                    role: "assistant",
                    content:
                        "```json\n{\"version\":\"1.0\",\"action\":\"final\"," +
                        "\"tool_calls\":null,\"delegations\":null," +
                        "\"response\":{\"type\":\"text\",\"content\":\"x\"}," +
                        "\"data\":null,\"error\":null}\n```"
                })
            );

        assert.equal(parsed.structured.action, "final");
    });

    await test("native OpenAI tool_calls are adapted to the action contract", async () => {

        const parsed =
            runtime.parseStructuredResponse(
                asMessage({
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            id: "call_abc",
                            type: "function",
                            function: {
                                name: "fs_list",
                                arguments: "{\"path\":\".\"}"
                            }
                        },
                        {
                            type: "function",
                            function: {
                                name: "git_status",
                                arguments: ""
                            }
                        }
                    ]
                })
            );

        assert.equal(parsed.source, "native_tool_calls");
        assert.equal(parsed.structured.action, "tool_call");
        assert.equal(parsed.structured.tool_calls.length, 2);
        assert.equal(parsed.structured.tool_calls[0].id, "call_abc");
        assert.deepEqual(
            parsed.structured.tool_calls[0].arguments,
            { path: "." }
        );

        /* a missing id is filled in so tool messages can be correlated */
        assert.equal(parsed.structured.tool_calls[1].id, "call_2");
        assert.deepEqual(
            parsed.structured.tool_calls[1].arguments,
            {}
        );

        /* the adapted action must satisfy the normal validator */
        runtime.validateAction(parsed.structured);
    });

    await test("native tool calls with invalid argument JSON are rejected", async () => {

        throws(
            () =>
                runtime.parseStructuredResponse(
                    asMessage({
                        role: "assistant",
                        content: null,
                        tool_calls: [
                            {
                                id: "c1",
                                function: {
                                    name: "fs_list",
                                    arguments: "{not json"
                                }
                            }
                        ]
                    })
                ),
            /not valid JSON/
        );
    });

    await test("plain prose without tool calls still fails loudly", async () => {

        throws(
            () =>
                runtime.parseStructuredResponse(
                    asMessage({
                        role: "assistant",
                        content: "I will now inspect the project."
                    })
                ),
            /neither structured JSON nor a native tool call/
        );
    });

    await test("a length-capped partial action is reported as truncation", async () => {

        const partial =
            '{"action":"tool_call","tool_calls":[{"id":"write_test",' +
            '"name":"fs_write","arguments":{"path":"test.ts","content":"import';

        const error =
            throws(
                () =>
                    runtime.readModelAction({
                        choices: [
                            {
                                finish_reason: "length",
                                message: {
                                    role: "assistant",
                                    content: partial
                                }
                            }
                        ],
                        usage: {
                            completion_tokens: 2048
                        }
                    }),
                /truncated.*2048 completion tokens/i
            );

        assert.equal(error.code, "TRUNCATED_RESPONSE");
        assert.equal(error.details.truncated, true);
        assert.equal(error.details.finish_reason, "length");
        assert.equal(error.details.detected_action, "tool_call");
        assert.equal(error.details.tool, "fs_write");
        assert.equal(error.details.output_chars, partial.length);
    });
};
