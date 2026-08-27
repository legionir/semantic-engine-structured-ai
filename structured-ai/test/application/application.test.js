"use strict";

/*
|--------------------------------------------------------------------------
| Application / Config / Registry — EXECUTION_PLAN Phase 14
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase14-app-"));

process.env.WORKSPACE_ROOT = WORKSPACE;

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


async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const storage = require(path.join(REPO, "agent", "lib", "storage.js"));
    const config = require(path.join(REPO, "agent", "config"));
    const loader = require(path.join(REPO, "agent", "registry", "RegistryLoader.js"));
    const validator = require(path.join(REPO, "agent", "registry", "RegistryValidator.js"));


    await test("require('./agent/agent') keeps the documented export surface", async () => {

        const required = [
            "runAgent", "main", "callAI",
            "parseStructuredResponse", "adaptNativeToolCalls",
            "validateAction", "executeDependencyGraph", "resolveTools",
            "createRuntimeContext", "maintainContext", "refreshRuntimeContext",
            "memoryStore", "project", "sessions", "eventstore",
            "openProject", "persistProject", "mcp",
            "loadRegistries", "settings", "application"
        ];

        for (const name of required) {

            assert.ok(
                runtime[name] !== undefined,
                `missing export ${name}`
            );

        }

        assert.equal(typeof runtime.runAgent, "function");
        assert.equal(typeof runtime.main, "function");
        assert.equal(runtime.runAgent, runtime.application.runAgent);

    });


    await test("storage.js is the legacy wrapper over agent/config", async () => {

        assert.equal(storage.get, config.get);
        assert.equal(storage.set, config.set);
        assert.equal(storage.reset, config.reset);
        assert.equal(storage.sourceOf, config.sourceOf);
        assert.equal(storage.snapshot, config.snapshot);
        assert.deepEqual(
            storage.definitions.map(item => item.key),
            config.definitions.map(item => item.key)
        );

    });


    await test("settings defaults, types and snapshot masking are unchanged", async () => {

        assert.equal(storage.get("MAX_PARALLEL_TOOLS"), 8);
        assert.equal(storage.sourceOf("MAX_PARALLEL_TOOLS"), "default");
        assert.equal(storage.definitionOf("PROJECT_CONTEXT_MODE").default, "legacy");
        assert.equal(storage.definitionOf("RUN_CONTEXT_MODE").default, "legacy");

        storage.set("AGENT_API_KEY", "supersecretvalue");

        const snap = storage.snapshot();

        assert.equal(Object.prototype.hasOwnProperty.call(snap, "AGENT_API_KEY"), false);
        assert.equal(storage.get("AGENT_API_KEY"), "supersecretvalue");

        const described =
            storage.all().find(item => item.key === "AGENT_API_KEY");

        assert.notEqual(described.value, "supersecretvalue");
        assert.match(described.value, /…/);

        storage.reset("AGENT_API_KEY");

    });


    await test("loader concatenates tool-schemas into the historical tools.json array", async () => {

        const fromFile =
            require(path.join(REPO, "agent", "registry", "tools.json"));

        const fromLoader = loader.loadToolSchemas();

        assert.deepEqual(
            fromLoader.map(item => item.function.name),
            fromFile.map(item => item.function.name)
        );

        assert.equal(fromLoader.length, fromFile.length);
        assert.deepEqual(fromLoader, fromFile);

        const resolved =
            runtime.resolveTools("*").map(tool => tool.function.name);

        assert.deepEqual(
            resolved.filter(name => !name.startsWith("mcp__")),
            fromFile.map(item => item.function.name)
        );

    });


    await test("a corrupt registry file fails with a clear error, not a bare SyntaxError", async () => {

        const file = loader.toolSchemaPaths()[0];
        const original = fs.readFileSync(file, "utf8");

        try {

            fs.writeFileSync(file, "{ not json");

            let thrown = null;

            try {

                loader.loadToolSchemas();

            } catch (error) {

                thrown = error;

            }

            assert.ok(thrown);
            assert.match(thrown.message, /invalid JSON/);
            assert.match(thrown.message, /filesystem\.json/);
            assert.equal(thrown.name === "SyntaxError", false);

        } finally {

            fs.writeFileSync(file, original);

        }

    });


    await test("validateRegistries still accepts the shipped catalogues", async () => {

        runtime.validateRegistries();

        validator.validate({
            tools: require(path.join(REPO, "agent", "registry", "tools.json")),
            groups: require(path.join(REPO, "agent", "registry", "tool_groups.json")),
            skills: require(path.join(REPO, "agent", "registry", "skills.json")),
            agents: require(path.join(REPO, "agent", "registry", "agents.json")),
            personas: require(path.join(REPO, "agent", "registry", "personas.json")),
            policy: require(path.join(REPO, "agent", "registry", "policy.json")),
            hasTool: name => runtime.resolveTools("*").some(tool => tool.function.name === name) ||
                require(path.join(REPO, "agent", "tools")).hasTool(name),
            implementedToolNames: () =>
                require(path.join(REPO, "agent", "tools")).implementedToolNames()
        });

    });


    await test("runSession delegates to runAgent with a shared history", async () => {

        const seen = [];

        const result = await runtime.application.runSession({
            runAgent: async options => {

                seen.push(options);
                return { ok: true, task: options.task };

            },
            history: [{ role: "user", content: "hi" }],
            task: "next",
            projectId: "prj-a"
        });

        assert.equal(result.ok, true);
        assert.equal(seen[0].task, "next");
        assert.equal(seen[0].history.length, 1);
        assert.equal(seen[0].projectId, "prj-a");

    });


    await test("lifecycle.shutdown is safe with missing deps and flushes when present", async () => {

        await runtime.application.lifecycle.shutdown();

        let toolsDown = false;
        let flushed = false;

        await runtime.application.lifecycle.shutdown({
            tools: { shutdown: () => { toolsDown = true; } },
            eventstore: { flush: async () => { flushed = true; } }
        });

        assert.equal(toolsDown, true);
        assert.equal(flushed, true);

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
