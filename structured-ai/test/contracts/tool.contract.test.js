"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
|--------------------------------------------------------------------------
| Tool Contract Tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| Locks the tool subsystem contract: schema specifications, parameter bounds,
| execution signatures, and ToolContext security boundaries.
|--------------------------------------------------------------------------
*/

const ROOT = path.resolve(__dirname, "..", "..");

const ToolRegistryAdapter =
    require(path.join(ROOT, "agent", "tools", "ToolRegistryAdapter.js"));

const { ToolContext, assertNoIdentityArguments } =
    require(path.join(ROOT, "agent", "tools", "ToolContext.js"));

const toolRuntime =
    require(path.join(ROOT, "agent", "tools"));

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

    console.log("tool contract tests");

    await test("all registered tools satisfy the function schema contract", () => {

        const tools = ToolRegistryAdapter.schemas();

        assert.ok(Array.isArray(tools) && tools.length >= 30);

        for (const tool of tools) {

            assert.equal(tool.type, "function", `${tool?.function?.name} is not type: function`);

            const fn = tool.function;
            assert.ok(typeof fn.name === "string" && fn.name.length > 0);
            assert.ok(typeof fn.description === "string" && fn.description.length > 0);
            assert.ok(fn.parameters && fn.parameters.type === "object");
        }
    });

    await test("declarations parity between tools.json and tool-schemas/*.json holds", () => {

        const parity = ToolRegistryAdapter.parity();

        assert.equal(parity.equal, true, "tools.json and tool-schemas drifted");
        assert.equal(parity.missing.length, 0);
        assert.equal(parity.extra.length, 0);
    });

    await test("all callable tools have matching implementations", () => {

        const callable = toolRuntime.callableToolNames();

        assert.ok(callable.length >= 30);

        for (const name of callable) {

            assert.equal(toolRuntime.hasTool(name), true, `tool ${name} is not implemented`);
        }
    });

    await test("ToolContext enforces identity security boundary (rule 9)", () => {

        const rawForbiddenArgs = [
            { projectId: "fake-project" },
            { project_id: "fake-project" },
            { root: "/escaped/root" },
            { projectRoot: "/escaped/root" }
        ];

        for (const args of rawForbiddenArgs) {

            assert.throws(
                () => assertNoIdentityArguments(args),
                /Tool argument/,
                `expected ${JSON.stringify(args)} to be rejected`
            );
        }
    });

    await test("ToolContext provides bound workspace helpers matching effective root", () => {

        const wsRoot = fs.realpathSync(os.tmpdir());

        const ctx = new ToolContext({
            agent: "test_agent",
            runId: "run-contract",
            project: {
                projectId: "prj-contract",
                workspaceRoot: wsRoot
            }
        });

        assert.equal(ctx.root, wsRoot);
        assert.equal(ctx.isInside(path.join(wsRoot, "sample.txt")), true);
        assert.equal(ctx.isInside(path.join("/etc", "passwd")), false);
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
