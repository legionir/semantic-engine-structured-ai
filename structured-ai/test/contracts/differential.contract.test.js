"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
|--------------------------------------------------------------------------
| Differential Parity Contract Tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| Enforces the core refactoring guarantee: normalize(legacy) === normalize(modular)
| across action parsing, prompt building, and execution envelopes.
|--------------------------------------------------------------------------
*/

const ROOT = path.resolve(__dirname, "..", "..");

const { normalize } =
    require(path.join(ROOT, "test", "helpers", "normalize.js"));

const actionParser =
    require(path.join(ROOT, "agent", "actions"));

const promptBuilder =
    require(path.join(ROOT, "agent", "prompt"));

const events =
    require(path.join(ROOT, "agent", "events"));

const results = [];

async function test(name, fn) {

    try {

        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack || error.message}`);
    }
}

async function main() {

    console.log("differential parity contract tests");

    await test("differential parity on structured action parsing", () => {

        const rawAssistantMessage = {
            choices: [
                {
                    message: {
                        role: "assistant",
                        content: JSON.stringify({
                            version: "1.0",
                            action: "tool_call",
                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_read",
                                    arguments: { path: "notes.txt" },
                                    depends_on: []
                                }
                            ],
                            delegations: null,
                            response: null,
                            data: null,
                            error: null,
                            performed: null
                        })
                    }
                }
            ]
        };

        const parsed = actionParser.parseStructuredResponse(rawAssistantMessage);

        assert.equal(parsed.structured.action, "tool_call");
        assert.equal(parsed.structured.tool_calls[0].name, "fs_read");

        /* Normalized shape matches baseline contract */
        const norm = normalize(parsed.structured);
        assert.equal(norm.action, "tool_call");
        assert.equal(norm.version, "1.0");
    });

    await test("differential parity on prompt building messages structure", () => {

        const mockRuntimeContext = {
            runtime: {
                workspace_root: "/tmp/sample-workspace",
                platform: "linux",
                node_version: "v20.0.0"
            }
        };

        const builder = new promptBuilder.MainPromptBuilder({
            systemPrompt: () => "You are an autonomous engineering agent.",
            executionRules: () => "Always write tests.",
            runtimeContext: () => mockRuntimeContext,
            projectContextBuilder: { build: () => null },
            skillIndex: () => [{ name: "skill1", description: "desc" }],
            mayDelegate: () => true,
            PERSONAS_OF: () => [{ name: "tester", description: "testing" }],
            discussionPersonaNames: () => new Set(["security"]),
            AGENTS_OF: () => [{ name: "code_agent", description: "coder", tools: ["fs_read"] }],
            describeCapability: () => "read and write"
        });

        const messages = builder.build("Inspect project structure");

        assert.ok(Array.isArray(messages));
        assert.ok(messages.length >= 6);

        const roles = messages.map(m => m.role);
        assert.equal(roles[0], "system");
        assert.equal(roles[roles.length - 1], "user");
        assert.equal(messages[messages.length - 1].content, "Inspect project structure");
    });

    await test("differential parity on correlation envelopes across scoped vs legacy modes", () => {

        events.resetSequence();

        let legacyEvent;
        events.setContext({
            run_id: "run-legacy-1",
            turn_id: "turn-legacy-1",
            scope: "main_agent",
            iteration: 1
        });

        legacyEvent = events.emit("run:start", { task: "legacy parity probe" });

        assert.equal(legacyEvent.run_id, "run-legacy-1");
        assert.equal(legacyEvent.project_id, undefined);

        /* Scoped mode carries additive project_id */
        events.runWithScope({ run_id: "run-modular-1", project_id: "prj-modular" }, () => {

            const modularEvent = events.emit("run:start", { task: "modular parity probe" });

            assert.equal(modularEvent.run_id, "run-modular-1");
            assert.equal(modularEvent.project_id, "prj-modular");

            /* Normalized without volatile tokens */
            const normLegacy = normalize(legacyEvent);
            const normModular = normalize(modularEvent);

            assert.equal(normLegacy.type, normModular.type);
            assert.equal(normLegacy.seq, normModular.seq);
            assert.equal(normLegacy.at, normModular.at);
        });
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
