"use strict";

/*
|--------------------------------------------------------------------------
| Tool contract tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| The model-facing tool surface has two sources of truth: the declarative
| registry and the executable runtime. These tests deliberately exercise the
| public adapter rather than reaching into ToolRuntime's implementation map.
| A schema may grow additively, but a declared tool may not disappear and an
| implementation may not become callable without a declaration.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "phase29-tool-contract-"));
fs.writeFileSync(path.join(WORKSPACE, "contract.txt"), "tool contract\n", "utf8");
process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.AGENT_VERBOSE = "0";

const ROOT = path.resolve(__dirname, "..", "..");
const loader = require(path.join(ROOT, "agent", "registry", "RegistryLoader"));
const tools = require(path.join(ROOT, "agent", "tools"));
const ToolContext = require(path.join(ROOT, "agent", "tools", "ToolContext"));

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

function registryData() {
    return {
        tools: loader.loadToolSchemas(),
        groups: require(path.join(ROOT, "agent", "registry", "tool_groups.json")),
        skills: require(path.join(ROOT, "agent", "registry", "skills.json")),
        agents: require(path.join(ROOT, "agent", "registry", "agents.json")),
        personas: require(path.join(ROOT, "agent", "registry", "personas.json")),
        policy: require(path.join(ROOT, "agent", "registry", "policy.json"))
    };
}

async function main() {
    await test("canonical tool schemas preserve the legacy snapshot and stable names", async () => {
        const canonical = loader.loadToolSchemas();
        const snapshot = require(path.join(ROOT, "agent", "registry", "tools.json"));
        assert.deepStrictEqual(canonical, snapshot);

        const names = canonical.map(item => item.function?.name);
        assert.equal(names.length, 67);
        assert.equal(new Set(names).size, names.length);
        assert.ok(names.includes("fs_read"));
        assert.ok(names.includes("checkpoint_undo"));
        assert.ok(names.includes("discussion_start"));
    });

    await test("every declaration has the model function contract", async () => {
        for (const declaration of loader.loadToolSchemas()) {
            assert.equal(declaration.type, "function");
            assert.ok(declaration.function);
            assert.match(declaration.function.name, /^[a-z][a-z0-9_]*$/);
            assert.equal(typeof declaration.function.description, "string");
            assert.ok(declaration.function.parameters || declaration.function.input_schema);
        }
    });

    await test("registry validation and executable parity agree", async () => {
        const adapter = tools.ToolRegistryAdapter;
        assert.equal(adapter.assertParity(), true);
        const report = adapter.parity();
        assert.deepStrictEqual(report.missing, []);
        assert.deepStrictEqual(report.extra, []);
        assert.equal(adapter.validateAgainst(registryData()), true);
    });

    await test("the public facade exposes callable names without leaking private helpers", async () => {
        assert.equal(typeof tools.executeTool, "function");
        assert.equal(typeof tools.hasTool, "function");
        assert.equal(typeof tools.implementedToolNames, "function");
        assert.equal(typeof tools.callableToolNames, "function");
        assert.equal(tools.hasTool("fs_read"), true);
        assert.equal(tools.hasTool("__not_a_tool__"), false);
        assert.equal(tools.implementedToolNames().some(name => name.startsWith("_")), false);
        await assert.rejects(
            () => tools.executeTool("__not_a_tool__", {}),
            /Tool is not implemented/
        );
    });

    await test("tool execution keeps identity in context and returns the legacy result shape", async () => {
        const result = await tools.executeTool(
            "fs_read",
            { path: "contract.txt" },
            { agent: "contract-test", runId: "run-contract" }
        );
        assert.equal(result.path, "contract.txt");
        assert.equal(result.binary, false);
        assert.equal(result.content, "tool contract\n");
        assert.equal(typeof result.total_lines, "number");

        assert.throws(
            () => ToolContext.assertNoIdentityArguments({ path: "contract.txt", project_id: "forged" }),
            /project identity is supplied by the run context/
        );
    });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    try {
        tools.shutdown();
    } catch {
        /* no background tool is part of this contract */
    }
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
