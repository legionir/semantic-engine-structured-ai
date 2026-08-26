"use strict";

/*
|--------------------------------------------------------------------------
| Prompt Contract Tests — EXECUTION_PLAN Phase 1
|--------------------------------------------------------------------------
|
| Locks the dynamic prompt pipeline (structure, roles, JSON payloads,
| request shape and live-reload behavior) so the Phase-5 Prompt Builder
| extraction can be verified by comparison instead of by reading code.
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-contract-prompt-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_RUN_MS = "2000";
process.env.MAX_REQUEST_MS = "1000";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));
const { normalize } = require(path.join(ROOT, "test", "helpers", "normalize.js"));

const fixture =
    JSON.parse(
        fs.readFileSync(
            path.join(ROOT, "test", "fixtures", "prompt.fixture.json"),
            "utf8"
        )
    );

const SYSTEM_PROMPT_PATH =
    path.join(ROOT, "agent", "config", "system_prompt.txt");

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


function classify(message) {

    if (typeof message.content !== "string") {

        return { kind: "non-string" };

    }

    const text = message.content.trim();

    if (text.startsWith("{")) {

        try {

            return { kind: "json", json: JSON.parse(text) };

        } catch (error) {

            return { kind: "invalid-json" };

        }
    }

    return { kind: "text" };

}


async function main() {

    await test("main agent messages match the captured structure", async () => {

        const messages = runtime.createMainAgentMessages("Contract probe task");

        assert.equal(messages.length, fixture.main.message_count);

        for (const spec of fixture.main.structure) {

            const message = messages[spec.index];

            assert.equal(
                message.role,
                spec.role,
                `message ${spec.index} role drifted`
            );

            const info = classify(message);

            assert.equal(
                info.kind,
                spec.kind,
                `message ${spec.index} kind drifted (got ${info.kind})`
            );

            if (spec.starts_with) {

                assert.ok(
                    message.content.startsWith(spec.starts_with),
                    `message ${spec.index} no longer starts with the documented anchor`
                );

            }

            if (spec.json_type) {

                assert.equal(
                    info.json.type,
                    spec.json_type,
                    `message ${spec.index} JSON type drifted`
                );

            }

            if (spec.context_keys) {

                assert.deepStrictEqual(
                    Object.keys(info.json.context).sort(),
                    spec.context_keys.slice().sort(),
                    "runtime_context top-level keys drifted"
                );

            }

            if (spec.equals_task) {

                assert.equal(message.content, "Contract probe task");

            }
        }
    });

    await test("sub-agent messages match the captured structure", async () => {

        const agents = require(path.join(ROOT, "agent", "registry", "agents.json"));
        const profile =
            agents.find(item => item.name === fixture.sub_agent.profile_used) ||
            agents[0];

        const messages =
            runtime.createSubAgentMessages(

                profile,
                "Sub-agent contract probe",

                "parent context probe"
            );

        assert.equal(messages.length, fixture.sub_agent.message_count);

        for (const spec of fixture.sub_agent.structure) {

            const message = messages[spec.index];

            assert.equal(
                message.role,
                spec.role,
                `sub message ${spec.index} role drifted`
            );

            const info = classify(message);

            assert.equal(
                info.kind,
                spec.kind,
                `sub message ${spec.index} kind drifted (got ${info.kind})`
            );

            if (spec.contains) {

                assert.ok(
                    message.content.includes(spec.contains),
                    `sub message ${spec.index} lost its ${spec.contains} section`
                );

            }

            if (spec.json_type) {

                assert.equal(
                    info.json.type,
                    spec.json_type,
                    `sub message ${spec.index} JSON type drifted`
                );

            }

            if (spec.required_keys) {

                for (const key of spec.required_keys) {

                    assert.ok(
                        Object.prototype.hasOwnProperty.call(info.json, key),
                        `sub message ${spec.index} JSON lost key ${key}`
                    );

                }
            }
        }
    });

    await test("normalized main prompt is deterministic across rebuilds", async () => {

        const options = { workspace: WORKSPACE };

        const first =
            normalize(runtime.createMainAgentMessages("Repeatable task"), options);

        const second =
            normalize(runtime.createMainAgentMessages("Repeatable task"), options);

        assert.deepStrictEqual(first, second);

        /* and the workspace path must not leak raw into the snapshot */

        assert.ok(
            !JSON.stringify(first).includes(WORKSPACE),
            "workspace path leaked past the normalizer"
        );

    });

    await test("the request body keeps its contract shape", async () => {

        /* The true request contract is what the endpoint receives. Capture
           the first POST body from a stubbed model serving a final answer,
           then compare its normalized shape against the fixture. */

        const http = require("http");

        const captured = [];

        const server =
            http.createServer((req, res) => {

                let raw = "";

                req.on("data", chunk => { raw += chunk; });

                req.on("end", () => {

                    captured.push(JSON.parse(raw));

                    res.setHeader("content-type", "application/json");

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message: {
                                        role: "assistant",
                                        content: JSON.stringify({
                                            version: "1.0",
                                            tool_calls: null,
                                            delegations: null,
                                            response: {
                                                type: "text",
                                                content: "contract capture"
                                            },
                                            data: null,
                                            error: null,
                                            action: "final",
                                            performed: null
                                        })
                                    }
                                }
                            ]
                        })
                    );
                });
            });

        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

        const previousUrl = runtime.settings.get("AGENT_BASE_URL");
        const previousModel = runtime.settings.get("AGENT_MODEL");

        runtime.settings.set(
            "AGENT_BASE_URL",
            `http://127.0.0.1:${server.address().port}/v1`
        );

        runtime.settings.set("AGENT_MODEL", "contract-model");

        try {

            runtime.startRun();

            await runtime.runAgent({ task: "Answer and stop." });

        } finally {

            if (previousUrl === undefined || previousUrl === null) {

                runtime.settings.reset("AGENT_BASE_URL");

            } else {

                runtime.settings.set("AGENT_BASE_URL", previousUrl);

            }

            if (previousModel === undefined || previousModel === null) {

                runtime.settings.reset("AGENT_MODEL");

            } else {

                runtime.settings.set("AGENT_MODEL", previousModel);

            }

            await new Promise(done => server.close(done));

        }

        assert.ok(captured.length > 0, "no request reached the stub endpoint");

        const body = captured[0];

        assert.deepStrictEqual(
            Object.keys(body).sort(),
            fixture.request.top_level_keys.slice().sort(),
            "request top-level keys drifted"
        );

        const value = fixture.request.values;

        assert.equal(body.model, "contract-model");
        assert.equal(body.parallel_tool_calls, value["parallel_tool_calls"]);
        assert.equal(typeof body.temperature, "number");

        assert.equal(
            body.response_format.type,
            value["response_format.type"]
        );

        assert.equal(
            body.response_format.json_schema.name,
            value["response_format.json_schema.name"]
        );

        assert.equal(
            body.response_format.json_schema.strict,
            value["response_format.json_schema.strict"]
        );

        assert.ok(Array.isArray(body.tools), "tools must travel in the request's tools field");
        assert.ok(body.tools.length > 0);

        assert.deepStrictEqual(
            body.messages.map(message => message.role),
            (fixture.request.message_roles || fixture.main.structure.map(item => item.role)),
            "request message roles drifted from the prompt contract"
        );

        /*
        | Every tool declaration must expose the OpenAI function-calling
        | triple: type/function.name/(parameters|input_schema). No broken
        | parameter schema may reach the wire.
        */

        for (const tool of body.tools) {

            assert.equal(tool.type, "function", `tool ${tool.function?.name} lost its type`);

            assert.ok(tool.function && typeof tool.function.name === "string");

            const schema =
                tool.function.parameters || tool.function.input_schema;

            assert.ok(
                schema,
                `tool ${tool.function.name} has no parameter schema`
            );

        }
    });

    await test("system prompt edits reach the next rebuild (live reload)", async () => {

        const original = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf8");

        const marker = "CONTRACT RELOAD MARKER 8f2c1d";

        try {

            fs.writeFileSync(SYSTEM_PROMPT_PATH, `${original}\n\n${marker}\n`);

            const messages = runtime.createMainAgentMessages("Reload probe");

            assert.ok(
                messages[0].content.includes(marker),
                "edited system_prompt.txt did not reach the rebuilt prompt"
            );

        } finally {

            fs.writeFileSync(SYSTEM_PROMPT_PATH, original);

        }

        /* confirm the restore itself is live too */

        const restored = runtime.createMainAgentMessages("Reload probe");

        assert.ok(!restored[0].content.includes(marker));

    });

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
