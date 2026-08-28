"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

/*
|--------------------------------------------------------------------------
| CLI and Interactive Layer Tests — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Tests the modular agent/cli and agent/interactive subsystems directly:
| parsing, environment application, command routing, formatting, readline
| queuing, approval prompt handling, and slash command execution.
|--------------------------------------------------------------------------
*/

const REPO_ROOT =
    path.resolve(__dirname, "..", "..");

const cli =
    require(path.join(REPO_ROOT, "agent", "cli"));

const interactive =
    require(path.join(REPO_ROOT, "agent", "interactive"));

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

    console.log("cli and interactive layer");

    await test("ArgParser parses options, numbers, and positional arguments", () => {

        const parsed = cli.parseArguments([
            "--workspace", "/tmp/ws",
            "--model", "gpt-test",
            "--temperature", "0.7",
            "--timeout", "15",
            "--max-iterations", "25",
            "--max-agents", "3",
            "--json",
            "--quiet",
            "do", "something"
        ]);

        assert.equal(parsed.workspace, "/tmp/ws");
        assert.equal(parsed.model, "gpt-test");
        assert.equal(parsed.temperature, 0.7);
        assert.equal(parsed.timeoutSeconds, 15);
        assert.equal(parsed.maxIterations, 25);
        assert.equal(parsed.maxAgents, 3);
        assert.equal(parsed.json, true);
        assert.equal(parsed.quiet, true);
        assert.deepEqual(parsed.positional, ["do", "something"]);
    });

    await test("ArgParser parses discussion and serve flags", () => {

        const parsed = cli.parseArguments([
            "--discussion",
            "--personas", "security, frontend , backend",
            "--max-rounds", "4",
            "-s", "8888",
            "--host", "0.0.0.0"
        ]);

        assert.equal(parsed.discussion, true);
        assert.deepEqual(parsed.personas, ["security", "frontend", "backend"]);
        assert.equal(parsed.maxRounds, 4);
        assert.equal(parsed.serve, true);
        assert.equal(parsed.port, 8888);
        assert.equal(parsed.host, "0.0.0.0");
    });

    await test("OutputFormatter formats durations accurately", () => {

        assert.equal(cli.formatDuration(500), "500 ms");
        assert.equal(cli.formatDuration(1500), "1.5 s");
        assert.equal(cli.formatDuration(3200), "3.2 s");
    });

    await test("OutputFormatter formats error actions for --json", () => {

        const errAction = JSON.parse(
            cli.formatErrorAction(new Error("sample failure"))
        );

        assert.equal(errAction.version, "1.0");
        assert.equal(errAction.action, "final");
        assert.equal(errAction.error.message, "sample failure");
    });

    await test("OutputFormatter prints catalogue without throwing", () => {

        let written = "";
        const mockOut = {
            write: chunk => {
                written += chunk;
            }
        };

        const mockRuntime = {
            registries: {
                TOOLS: [
                    { function: { name: "test_tool", description: "A test tool. Details here." } }
                ],
                TOOL_GROUPS: {
                    testing: { destructive: false, description: "Testing group", tools: ["test_tool"] }
                },
                AGENTS: [
                    { name: "test_agent", description: "Agent desc", persona: "tester", skills: [], tools: "*" }
                ],
                POLICY: {
                    default_action: "allow",
                    rules: [
                        { action: "require_approval", tools: ["test_tool"], reason: "test reason" }
                    ]
                }
            },
            policyEngine: {
                summary: () => ({ mode: "prompt" })
            }
        };

        cli.printCatalogue(mockRuntime, { listTools: true, listAgents: true, listPolicy: true }, mockOut);

        assert.match(written, /testing/);
        assert.match(written, /test_tool/);
        assert.match(written, /test_agent/);
        assert.match(written, /require_approval/);
    });

    await test("HelpCommand handles help and version flags", () => {

        let written = "";
        const mockOut = {
            write: chunk => {
                written += chunk;
            }
        };

        const helpCode = cli.HelpCommand.execute({ help: true }, mockOut);
        assert.equal(helpCode, cli.EXIT.SUCCESS);
        assert.match(written, /Usage/);

        written = "";
        const versionCode = cli.HelpCommand.execute({ version: true }, mockOut);
        assert.equal(versionCode, cli.EXIT.SUCCESS);
        assert.match(written, /^\d+\.\d+\.\d+/);

        const noneCode = cli.HelpCommand.execute({}, mockOut);
        assert.equal(noneCode, null);
    });

    await test("CommandRegistry resolves command types correctly", () => {

        const registry = new cli.CommandRegistry();

        assert.equal(registry.resolve({ help: true }), "help");
        assert.equal(registry.resolve({ version: true }), "help");
        assert.equal(registry.resolve({ migrate: "prj-1" }), "migrate");
        assert.equal(registry.resolve({ listTools: true }), "catalogue");
        assert.equal(registry.resolve({ listAgents: true }), "catalogue");
        assert.equal(registry.resolve({ listPolicy: true }), "catalogue");
        assert.equal(registry.resolve({ serve: true }), "serve");
        assert.equal(registry.resolve({ interactive: true }), "interactive");
        assert.equal(registry.resolve({ discussion: true }), "discussion");
        assert.equal(registry.resolve({ positional: ["do something"] }), "run");
    });

    await test("CommandRegistry dispatches to registered handlers", async () => {

        const registry = new cli.CommandRegistry();
        let called = false;

        registry.register("custom", async (runtime, options) => {
            called = true;
            return 42;
        });

        registry.resolve = () => "custom";

        const code = await registry.dispatch({}, {});
        assert.equal(called, true);
        assert.equal(code, 42);
    });

    await test("OutputRenderer formats banner, history, and results", () => {

        let written = "";
        const mockOut = {
            write: chunk => {
                written += chunk;
            }
        };

        const mockRuntime = {
            createRuntimeContext: () => ({
                runtime: { workspace_root: "/test/ws" }
            }),
            activeModel: () => "test-model",
            getApprovalMode: () => "auto"
        };

        interactive.OutputRenderer.renderBanner(mockRuntime, mockOut);
        assert.match(written, /structured-ai/);
        assert.match(written, /\/test\/ws/);

        written = "";
        const session = {
            history: [
                { role: "user", content: "hello agent" },
                { role: "assistant", content: "hello user" }
            ],
            tasks: 1
        };

        interactive.OutputRenderer.renderHistory(session, mockOut);
        assert.match(written, /hello agent/);
        assert.match(written, /hello user/);

        written = "";
        interactive.OutputRenderer.renderTaskResult(
            { response: { content: "answer text" } },
            Date.now() - 120,
            mockOut
        );
        assert.match(written, /answer text/);

        written = "";
        interactive.OutputRenderer.renderExit(session, mockOut);
        assert.match(written, /1 task in this session, goodbye/);
    });

    await test("ApprovalPrompt formats prompt and resolves input", async () => {

        let written = "";
        const mockOut = {
            write: chunk => {
                written += chunk;
            }
        };

        const mockReader = {
            readAnswer: async () => "yes"
        };

        const allowed = await interactive.ApprovalPrompt.promptApproval(
            { agent: "main_agent", tool: "fs_write", reason: "write test" },
            { path: "test.txt" },
            mockReader,
            mockOut
        );

        assert.equal(allowed, true);
        assert.match(written, /approval required/);
        assert.match(written, /approved/);
    });

    await test("ApprovalPrompt handles refusal", async () => {

        let written = "";
        const mockOut = {
            write: chunk => {
                written += chunk;
            }
        };

        const mockReader = {
            readAnswer: async () => "n"
        };

        const allowed = await interactive.ApprovalPrompt.promptApproval(
            { agent: "main_agent", tool: "fs_delete", reason: "delete test" },
            { path: "test.txt" },
            mockReader,
            mockOut
        );

        assert.equal(allowed, false);
        assert.match(written, /refused/);
    });

    await test("ReplCommands executes /help, /clear, /approve, and /workspace", async () => {

        let written = "";
        const mockOut = {
            write: chunk => {
                written += chunk;
            }
        };

        const session = {
            history: [{ role: "user", content: "hi" }],
            lastAnswer: "prev"
        };

        let currentMode = "prompt";
        const mockRuntime = {
            getApprovalMode: () => currentMode,
            setApprovalMode: mode => {
                currentMode = mode;
            }
        };

        const context = {
            runtime: { workspace_root: "/mock/workspace" }
        };

        const mockReader = {
            requestExit: () => {}
        };

        await interactive.ReplCommands.execute("/help", { out: mockOut });
        assert.match(written, /Commands/);

        written = "";
        await interactive.ReplCommands.execute("/clear", { session, out: mockOut });
        assert.equal(session.history.length, 0);
        assert.equal(session.lastAnswer, null);
        assert.match(written, /conversation cleared/);

        written = "";
        await interactive.ReplCommands.execute("/approve auto", {
            runtime: mockRuntime,
            out: mockOut
        });
        assert.equal(currentMode, "auto");
        assert.match(written, /approval mode: auto/);

        written = "";
        await interactive.ReplCommands.execute("/workspace", { context, out: mockOut });
        assert.match(written, /\/mock\/workspace/);
    });

    await test("bin/interactive wrapper re-exports startSession", () => {

        const legacyInteractive =
            require(path.join(REPO_ROOT, "bin", "interactive.js"));

        assert.equal(typeof legacyInteractive.startSession, "function");
        assert.equal(legacyInteractive.startSession, interactive.startSession);
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
