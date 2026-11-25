"use strict";

/*
|--------------------------------------------------------------------------
| Action Contract Tests — EXECUTION_PLAN Phase 1
|--------------------------------------------------------------------------
|
| Locks the action envelope contract (tool_call / delegate / final) and the
| documented error behaviors by replaying the captured fixtures through the
| live parser and validator.
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-contract-actions-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_RUN_MS = "2000";
process.env.MAX_REQUEST_MS = "1000";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));

const fixture =
    JSON.parse(
        fs.readFileSync(
            path.join(ROOT, "test", "fixtures", "actions.json"),
            "utf8"
        )
    );

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


const envelopeOf = content => ({

    choices: [
        {
            message: {
                role: "assistant",
                content: typeof content === "string" ? content : JSON.stringify(content)
            }
        }
    ]

});


async function main() {

    await test("action envelope keeps its top-level keys and version", async () => {

        const expected = fixture.envelope.top_level_keys.slice().sort();

        for (const item of fixture.cases) {

            assert.deepStrictEqual(
                Object.keys(item.input).sort(),
                expected,
                `case ${item.name} envelope keys drifted`
            );

            assert.equal(item.input.version, fixture.envelope.version_value);

        }
    });

    await test("valid tool_call, delegate and final actions parse and validate", async () => {

        for (const item of fixture.cases) {

            const env = envelopeOf(item.input);

            const parsed = runtime.parseStructuredResponse(env);

            assert.equal(parsed.source, item.expected.parse_source, `${item.name}: parse source drifted`);

            const action = runtime.readModelAction(env);

            assert.equal(
                action.structured.action,
                item.expected.action,
                `${item.name}: action type drifted`
            );

            if (item.expected.tool_call_depends_on_injected) {

                assert.deepStrictEqual(
                    action.structured.tool_calls[0].depends_on,
                    item.expected.tool_call_depends_on_injected,
                    `${item.name}: depends_on injection drifted`
                );

            }

            /* validation accepts the action without throwing */

            runtime.validateAction(action.structured);

        }
    });

    await test("malformed text raises the documented model-response error", async () => {

        const item = fixture.error_cases.find(entry => entry.name === "malformed_text");

        let thrown = null;

        try {

            runtime.readModelAction(envelopeOf(item.input_content));

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown, "malformed text was silently accepted");

        assert.ok(
            thrown.message.startsWith(item.expected.message_prefix),
            `malformed error message drifted: ${thrown.message.slice(0, 80)}`
        );

        assert.equal(
            runtime.isModelResponseError(thrown),
            item.expected.is_model_response_error,
            "malformed error lost its model-response classification"
        );

    });

    await test("a tool call without id is rejected with the documented message", async () => {

        const item = fixture.error_cases.find(entry => entry.name === "tool_call_missing_id");

        /* The runtime may reject during parse-repair or validation — the
           contract is the message, not the stage. */

        let thrown = null;

        try {

            const action = runtime.readModelAction(envelopeOf(item.input));

            runtime.validateAction(action.structured);

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown, "id-less tool call was silently accepted");

        assert.ok(
            thrown.message.startsWith(item.expected.message_prefix),
            `missing-id message drifted: ${thrown.message.slice(0, 80)}`
        );

    });

    await test("registered-agent delegation rejects empty persona/skills/tools arrays", async () => {

        const item =
            fixture.error_cases.find(
                entry => entry.name === "delegate_registered_agent_empty_arrays"
            );

        let thrown = null;

        try {

            const action = runtime.readModelAction(envelopeOf(item.input));

            runtime.validateAction(action.structured);

        } catch (error) {

            thrown = error;

        }

        assert.ok(thrown, "empty-array delegation was silently accepted");

        assert.ok(
            thrown.message.startsWith(item.expected.validate_throws_prefix),
            `registered-agent null message drifted: ${thrown.message.slice(0, 90)}`
        );

    });

    await test("required-field matrix from the fixture still matches the validator", async () => {

        /*
        | Rather than duplicating the matrix in code, probe it: for each
        | required field of a tool call, drop it and expect a throw naming
        | that field.
        */

        const base = {
            id: "call_1",
            name: "fs_read",
            arguments: { path: "x.txt" },
            depends_on: []
        };

        for (const field of fixture.required_fields.tool_call_item) {

            const broken = { ...base };

            delete broken[field];

            const input = {
                version: "1.0",
                tool_calls: [broken],
                delegations: null,
                response: null,
                data: null,
                error: null,
                action: "tool_call",
                performed: null
            };

            let thrown = null;

            try {

                runtime.validateAction(
                    runtime.readModelAction(envelopeOf(input)).structured
                );

            } catch (error) {

                thrown = error;

            }

            if (field === "depends_on") {

                /* readModelAction injects depends_on: [] — documented rule */

                assert.equal(thrown, null, "depends_on was not auto-injected");

                continue;

            }

            assert.ok(thrown, `dropping ${field} was silently accepted`);

            assert.ok(
                thrown.message.includes(field),
                `missing-field message lost the field name ${field}`
            );

        }
    });

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
