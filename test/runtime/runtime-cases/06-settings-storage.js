"use strict";

/*
| runtime.test.js: settings storage
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function settingsStorageCases(ctx) {

    const {
        buildConversation,
        conversationSize,
        runtime,
        settings,
        test,
        throws
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nsettings storage");

    await test("a value resolves override, then environment, then default", async () => {

        assert.equal(settings.get("MAX_PARALLEL_TOOLS"), 8);
        assert.equal(settings.sourceOf("MAX_PARALLEL_TOOLS"), "default");

        process.env.MAX_PARALLEL_TOOLS = "5";

        assert.equal(settings.get("MAX_PARALLEL_TOOLS"), 5);
        assert.equal(settings.sourceOf("MAX_PARALLEL_TOOLS"), "environment");

        settings.set("MAX_PARALLEL_TOOLS", 3);

        assert.equal(settings.get("MAX_PARALLEL_TOOLS"), 3);
        assert.equal(settings.sourceOf("MAX_PARALLEL_TOOLS"), "override");

        settings.reset("MAX_PARALLEL_TOOLS");

        assert.equal(settings.get("MAX_PARALLEL_TOOLS"), 5);

        delete process.env.MAX_PARALLEL_TOOLS;

        assert.equal(settings.get("MAX_PARALLEL_TOOLS"), 8);
    });

    await test("values are validated on the way in", async () => {

        throws(
            () => settings.set("MAX_PARALLEL_TOOLS", "many"),
            /expects a number/
        );

        throws(
            () => settings.set("MAX_PARALLEL_TOOLS", 0),
            /at least 1/
        );

        throws(
            () => settings.set("AGENT_APPROVAL", "sometimes"),
            /must be one of/
        );

        throws(
            () => settings.set("NOPE", 1),
            /Unknown setting/
        );
    });

    await test("the workspace cannot be changed while the process runs", async () => {

        throws(
            () => settings.set("WORKSPACE_ROOT", "/elsewhere"),
            /fixed for the lifetime/
        );
    });

    await test("a change is visible to the very next read, with no restart", async () => {

        /* the endpoint is the value that used to be frozen at load */

        const before = runtime.currentEndpoint();

        settings.set("AGENT_BASE_URL", "http://changed.example/v1");

        assert.notEqual(runtime.currentEndpoint(), before);
        assert.match(runtime.currentEndpoint(), /changed\.example/);

        settings.reset("AGENT_BASE_URL");

        assert.equal(runtime.currentEndpoint(), before);
    });

    await test("limits reported to the model follow the store", async () => {

        settings.set("MAX_TOTAL_AGENTS", 42);

        const context =
            runtime.createRuntimeContext();

        assert.equal(context.runtime.max_total_agents, 42);
        assert.equal(context.runtime.agents_remaining, 42);

        settings.reset("MAX_TOTAL_AGENTS");
    });

    await test("a secret is never echoed in full", async () => {

        settings.set("AGENT_API_KEY", "supersecretvalue");

        const described =
            settings.all().find(
                item => item.key === "AGENT_API_KEY"
            );

        assert.notEqual(described.value, "supersecretvalue");
        assert.match(described.value, /…/);

        /* the runtime still uses the real one */
        assert.equal(settings.get("AGENT_API_KEY"), "supersecretvalue");

        settings.reset("AGENT_API_KEY");
    });

    await test("every environment variable in the code has a definition", async () => {

        const fs = require("fs");
        const path = require("path");

        const roots = ["agent", "bin", "web"];

        const files = [];

        const walk = directory => {

            for (
                const entry
                of fs.readdirSync(directory, { withFileTypes: true })
            ) {

                const full = path.join(directory, entry.name);

                if (entry.isDirectory()) {

                    walk(full);

                } else if (entry.name.endsWith(".js")) {

                    files.push(full);
                }
            }
        };

        for (const root of roots) {
            walk(path.join(__dirname, "..", "..", "..", root));
        }

        const known =
            new Set(settings.definitions.map(item => item.key));

        /* variables that belong to the process, not to the runtime */
        const external =
            new Set([
                "COMSPEC", "SHELL", "NO_COLOR",
                "AGENT_TASK", "AGENT_LOG_STREAM", "AGENT_PRINT_FINAL",
                "npm_config_workspace"
            ]);

        const missing = new Set();

        for (const file of files) {

            const source =
                fs.readFileSync(file, "utf8");

            for (
                const match
                of source.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)
            ) {

                if (
                    !known.has(match[1]) &&
                    !external.has(match[1])
                ) {
                    missing.add(`${match[1]} in ${path.basename(file)}`);
                }
            }
        }

        assert.deepEqual(
            [...missing],
            [],
            "these values are read straight from the environment instead of the store"
        );
    });

    await test("the run deadline follows the setting while a run is in flight", async () => {

        settings.set("MAX_RUN_MS", 60000);

        runtime.startRun();

        const generous =
            runtime.runRemainingMs();

        assert.ok(generous > 50000);

        /* the operator shortens the budget from the console */
        settings.set("MAX_RUN_MS", 5000);

        const tightened =
            runtime.runRemainingMs();

        assert.ok(
            tightened < 6000,
            `the deadline did not move: ${tightened}`
        );

        /* and can extend it again */
        settings.set("MAX_RUN_MS", 120000);

        assert.ok(runtime.runRemainingMs() > 100000);

        settings.reset("MAX_RUN_MS");
    });

    await test("temperature and model overrides outrank a profile", async () => {

        const profile = { model: "profile-model", temperature: 0.9 };

        assert.equal(runtime.activeModel(profile), "profile-model");
        assert.equal(runtime.activeTemperature(profile), 0.9);

        settings.set("AGENT_MODEL", "chosen-model");
        settings.set("AGENT_TEMPERATURE", 0.1);

        assert.equal(runtime.activeModel(profile), "chosen-model");
        assert.equal(runtime.activeTemperature(profile), 0.1);

        settings.reset("AGENT_MODEL");
        settings.reset("AGENT_TEMPERATURE");

        assert.equal(runtime.activeModel(profile), "profile-model");
        assert.equal(runtime.activeTemperature(profile), 0.9);
    });

    await test("context is maintained at a share of the budget, before the ceiling", async () => {

        settings.set("CONTEXT_SUMMARY", false);
        settings.set("MAX_CONTEXT_CHARS", 60000);
        settings.set("CONTEXT_COMPACT_AT", 0.7);

        /* below the trigger, nothing happens */
        const small =
            buildConversation(4, 2000);

        assert.equal(
            await runtime.maintainContext(small, "test"),
            null
        );

        /* above the trigger but still under the ceiling */
        const busy =
            buildConversation(20, 2500);

        const size =
            conversationSize(busy);

        assert.ok(
            size > 60000 * 0.7 && size < 60000 * 1.4,
            `the fixture should sit above the trigger: ${size}`
        );

        const report =
            await runtime.maintainContext(busy, "test");

        assert.ok(report && report.compacted);

        assert.ok(
            conversationSize(busy) <= 60000 * 0.7,
            "compaction should reach the trigger, not just the ceiling"
        );

        settings.reset("MAX_CONTEXT_CHARS");
        settings.reset("CONTEXT_COMPACT_AT");
        settings.reset("CONTEXT_SUMMARY");
    });

    await test("the compaction trigger itself is tunable at runtime", async () => {

        settings.set("CONTEXT_SUMMARY", false);
        settings.set("MAX_CONTEXT_CHARS", 60000);
        settings.set("CONTEXT_COMPACT_AT", 0.95);

        const messages =
            buildConversation(16, 2500);

        assert.equal(
            await runtime.maintainContext(messages, "test"),
            null,
            "a high trigger should leave the transcript alone"
        );

        settings.set("CONTEXT_COMPACT_AT", 0.5);

        assert.ok(
            (await runtime.maintainContext(messages, "test")).compacted,
            "lowering the trigger should compact immediately"
        );

        settings.reset("MAX_CONTEXT_CHARS");
        settings.reset("CONTEXT_COMPACT_AT");
        settings.reset("CONTEXT_SUMMARY");
    });
};
