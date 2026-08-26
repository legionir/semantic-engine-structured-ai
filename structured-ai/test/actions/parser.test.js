"use strict";

/*
|--------------------------------------------------------------------------
| Action Parser / Response Normalizer — EXECUTION_PLAN Phase 15
|--------------------------------------------------------------------------
|
| Locks the extracted kit against the historical parser/validator: valid
| actions stay valid, native tool calls produce the same envelope, error
| codes and response_diagnostics are unchanged, and strict/non-strict
| response_format still only changes the documented argument wording.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase15-actions-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_RUN_MS = "2000";
process.env.MAX_REQUEST_MS = "1000";

const REPO = path.resolve(__dirname, "..", "..");

const results = [];


async function test(name, fn) {

    try {

        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);

    }

}


function envelopeOf(content, extra = {}) {

    return {
        choices: [
            {
                message: {
                    role: "assistant",
                    content:
                        typeof content === "string"
                            ? content
                            : JSON.stringify(content),
                    ...extra
                }
            }
        ]
    };

}


async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const actions = require(path.join(REPO, "agent", "actions"));
    const settings = require(path.join(REPO, "agent", "lib", "storage.js"));

    const fixture =
        JSON.parse(
            fs.readFileSync(
                path.join(REPO, "test", "fixtures", "actions.json"),
                "utf8"
            )
        );


    await test("agent.js keeps the historical wrappers and exposes the actions kit", async () => {

        assert.equal(runtime.actions, actions);

        for (const name of [
            "parseStructuredResponse",
            "adaptNativeToolCalls",
            "parseToolArguments",
            "repairStructuredAction",
            "readModelAction",
            "isModelResponseError",
            "validateAction"
        ]) {

            assert.equal(typeof runtime[name], "function", `missing wrapper ${name}`);
            assert.equal(typeof actions[name], "function", `missing kit export ${name}`);
            assert.notEqual(
                runtime[name],
                actions[name],
                `${name} should stay a facade wrapper (Phase 15 / law 7)`
            );

        }

        const env = envelopeOf({
            version: "1.0",
            action: "final",
            tool_calls: null,
            delegations: null,
            response: { type: "text", content: "same" },
            data: null,
            error: null,
            performed: null
        });

        assert.deepEqual(
            runtime.parseStructuredResponse(env).structured,
            actions.parseStructuredResponse(env).structured
        );

    });


    await test("valid tool_call, delegate and final actions parse and validate through the kit", async () => {

        for (const item of fixture.cases) {

            const env = envelopeOf(item.input);

            const parsed = actions.parseStructuredResponse(env);

            assert.equal(parsed.source, item.expected.parse_source);

            const action = actions.readModelAction(env);

            assert.equal(action.structured.action, item.expected.action);

            if (item.expected.tool_call_depends_on_injected) {

                assert.deepStrictEqual(
                    action.structured.tool_calls[0].depends_on,
                    item.expected.tool_call_depends_on_injected
                );

            }

            actions.validateAction(action.structured);

        }

    });


    await test("native tool calls produce the historical internal action", async () => {

        const message = {
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
        };

        const adapted = actions.adaptNativeToolCalls(message);

        assert.equal(adapted.action, "tool_call");
        assert.equal(adapted.version, "1.0");
        assert.equal(adapted.tool_calls[0].id, "call_abc");
        assert.deepEqual(adapted.tool_calls[0].arguments, { path: "." });
        assert.equal(adapted.tool_calls[1].id, "call_2");
        assert.deepEqual(adapted.tool_calls[1].arguments, {});
        assert.equal(adapted.delegations, null);
        assert.equal(adapted.response, null);

        const parsed = actions.parseStructuredResponse({
            choices: [{ message }]
        });

        assert.equal(parsed.source, "native_tool_calls");
        actions.validateAction(parsed.structured);

    });


    await test("malformed text, missing id and empty-array delegation keep their error messages", async () => {

        const malformed = fixture.error_cases.find(entry => entry.name === "malformed_text");

        let thrown = null;

        try {

            actions.readModelAction(envelopeOf(malformed.input_content));

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown);
        assert.ok(thrown.message.startsWith(malformed.expected.message_prefix));
        assert.equal(actions.isModelResponseError(thrown), true);
        assert.equal(thrown.code, "UNREADABLE_RESPONSE");

        const missingId = fixture.error_cases.find(entry => entry.name === "tool_call_missing_id");

        thrown = null;

        try {

            const action = actions.readModelAction(envelopeOf(missingId.input));

            actions.validateAction(action.structured);

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown);
        assert.ok(thrown.message.startsWith(missingId.expected.message_prefix));
        assert.equal(thrown.code, "INVALID_ACTION");

        const emptyArrays =
            fixture.error_cases.find(
                entry => entry.name === "delegate_registered_agent_empty_arrays"
            );

        thrown = null;

        try {

            const action = actions.readModelAction(envelopeOf(emptyArrays.input));

            actions.validateAction(action.structured);

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown);
        assert.ok(
            thrown.message.startsWith(emptyArrays.expected.validate_throws_prefix)
        );

    });


    await test("truncated answers keep TRUNCATED_RESPONSE and response_diagnostics", async () => {

        const partial =
            '{"action":"tool_call","tool_calls":[{"id":"write_test",' +
            '"name":"fs_write","arguments":{"path":"test.ts","content":"import';

        let thrown = null;

        try {

            actions.readModelAction({
                choices: [
                    {
                        finish_reason: "length",
                        message: {
                            role: "assistant",
                            content: partial
                        }
                    }
                ],
                usage: { completion_tokens: 2048 }
            });

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown);
        assert.equal(thrown.code, "TRUNCATED_RESPONSE");
        assert.equal(thrown.details.truncated, true);
        assert.equal(thrown.details.finish_reason, "length");
        assert.equal(thrown.details.detected_action, "tool_call");
        assert.equal(thrown.details.tool, "fs_write");

        const notice =
            actions.malformedNoticeMessage(thrown, 1, 2);

        const body = JSON.parse(notice.content);

        assert.equal(body.notice, "malformed_response");
        assert.equal(body.error.code, "TRUNCATED_RESPONSE");
        assert.deepEqual(
            body.response_diagnostics,
            {
                finish_reason: "length",
                completion_tokens: 2048,
                output_chars: thrown.details.output_chars
            }
        );
        assert.equal(body.correction_attempt.maximum_attempts, 3);
        assert.equal(body.correction_attempt.attempts_left, 2);

    });


    await test("strict and non-strict response_format stay distinct; AGENT_SCHEMA is process-fixed", async () => {

        assert.equal(settings.get("AGENT_SCHEMA"), "default");
        assert.equal(settings.definitionOf("AGENT_SCHEMA").fixed, true);
        assert.deepEqual(
            settings.definitionOf("AGENT_SCHEMA").values,
            ["default", "strict"]
        );

        const relaxedSchema =
            require(path.join(REPO, "agent", "schema", "response_format.json"));
        const strictSchema =
            require(path.join(REPO, "agent", "schema", "response_format.strict.json"));

        assert.equal(relaxedSchema.json_schema.strict, false);
        assert.equal(strictSchema.json_schema.strict, true);

        const strictArguments =
            strictSchema.json_schema.schema.properties
                .tool_calls.anyOf[0].items.properties.arguments;

        assert.equal(strictArguments.type, "string");

        const examples = actions.canonicalActionExamples();

        assert.equal(
            typeof examples.tool_call.tool_calls[0].arguments,
            "object"
        );

        const schemaHint =
            actions.compactToolParameterSchema("fs_read");

        assert.equal(schemaHint.arguments_must_be, "one JSON object");

        const invalid = {
            version: "1.0",
            action: "tool_call",
            tool_calls: [
                {
                    id: "c1",
                    name: "fs_read",
                    arguments: ["not", "an", "object"],
                    depends_on: []
                }
            ],
            delegations: null,
            response: null,
            data: null,
            error: null,
            performed: null
        };

        let message = "";

        try {

            actions.validateAction(invalid);

        } catch (error) {

            message = error.message;

        }

        assert.match(message, /must be one JSON object/);
        assert.equal(/encoded as a string/.test(message), false);

        const validatorSource =
            fs.readFileSync(
                path.join(REPO, "agent", "actions", "ActionValidator.js"),
                "utf8"
            );

        assert.match(
            validatorSource,
            /AGENT_SCHEMA\"\) === \"strict\"[\s\S]*encoded as a string/
        );

        const repairSource =
            fs.readFileSync(
                path.join(REPO, "agent", "actions", "ResponseRepair.js"),
                "utf8"
            );

        assert.match(
            repairSource,
            /AGENT_SCHEMA\"\) === \"strict\"[\s\S]*one JSON object encoded as a string/
        );

    });


    await test("fenced JSON unwraps and native argument salvage still drops undeclared keys", async () => {

        const fenced = actions.parseStructuredResponse(
            envelopeOf(
                "```json\n" +
                JSON.stringify({
                    version: "1.0",
                    action: "final",
                    tool_calls: null,
                    delegations: null,
                    response: { type: "text", content: "ok" },
                    data: null,
                    error: null,
                    performed: null
                }) +
                "\n```"
            )
        );

        assert.equal(fenced.source, "structured_content");
        assert.equal(fenced.structured.action, "final");

        const salvaged =
            actions.adaptNativeToolCalls({
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: "call_1",
                        type: "function",
                        function: {
                            name: "fs_write",
                            arguments:
                                '{"path":"PROJECT_STATUS.md","content":"# hello\\n","mode":"overwrite","created":false,"bytes_written":5998},"name":"fs_write"}'
                        }
                    }
                ]
            });

        assert.deepEqual(
            salvaged.tool_calls[0].arguments,
            {
                path: "PROJECT_STATUS.md",
                content: "# hello\n",
                mode: "overwrite"
            }
        );

    });


    await test("the actions kit has no require cycle back to agent.js", async () => {

        const source = fs.readFileSync(
            path.join(REPO, "agent", "actions", "index.js"),
            "utf8"
        );

        assert.equal(
            /require\(["']\.\.\/agent["']\)/.test(source),
            false
        );

        const dir = path.join(REPO, "agent", "actions");

        for (const name of fs.readdirSync(dir)) {

            if (!name.endsWith(".js")) {
                continue;
            }

            const body = fs.readFileSync(path.join(dir, name), "utf8");

            assert.equal(
                /require\(["']\.\.\/agent(?:\.js)?["']\)/.test(body),
                false,
                `${name} requires agent.js`
            );

        }

        assert.equal(typeof actions.bind, "function");
        assert.equal(typeof actions.parseStructuredResponse, "function");

    });


    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
