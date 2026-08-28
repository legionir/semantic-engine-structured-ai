"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
|--------------------------------------------------------------------------
| Discussion Contract & Multi-Project Isolation Tests — EXECUTION_PLAN Ph 28
|--------------------------------------------------------------------------
|
| Locks the multi-agent discussion contracts across:
|   1. Tool schema and execution output shape
|   2. Personas catalogue and delegation prompt filtering
|   3. Event lifecycle emissions and envelope correlation
|   4. Per-project persistence and cross-project transcript isolation
|   5. Clean directional dependencies (no circular require to agent.js)
|--------------------------------------------------------------------------
*/

const ROOT = path.resolve(__dirname, "..", "..");

const discussion =
    require(path.join(ROOT, "agent", "discussion"));

const discussionTool =
    require(path.join(ROOT, "agent", "tools", "discussion.js"));

const events =
    require(path.join(ROOT, "agent", "events"));

const projects =
    require(path.join(ROOT, "agent", "projects"));

const dataRoot =
    require(path.join(ROOT, "agent", "lib", "dataRoot"));

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

    console.log("discussion contract and isolation");

    await test("tool declaration and schema conform to contract", () => {

        const declaration = discussionTool.tools?.discussion_start;
        assert.ok(declaration, "discussion_start is not declared");

        const params = declaration.parameters;
        assert.equal(params.type, "object");
        assert.deepEqual(params.required.sort(), ["personas", "task"]);
        assert.equal(params.additionalProperties, false);

        assert.equal(params.properties.task.type, "string");
        assert.equal(params.properties.personas.type, "array");
        assert.equal(params.properties.max_rounds.type, "integer");
        assert.equal(params.properties.max_rounds.minimum, 1);
        assert.equal(params.properties.max_rounds.maximum, 10);
    });

    await test("personas catalogue contains 15 selectable personas with required fields", () => {

        const list = discussion.listPersonas();
        assert.equal(list.length, 15);

        for (const persona of list) {

            assert.ok(typeof persona.id === "string" && persona.id.length > 0);
            assert.ok(typeof persona.name === "string" && persona.name.length > 0);
            assert.ok(typeof persona.description === "string" && persona.description.length > 0);
            assert.ok(typeof persona.model_role === "string" && persona.model_role.length > 0);
        }

        assert.ok(discussion.OBSERVER, "OBSERVER definition is missing");
        assert.equal(discussion.OBSERVER.id, "observer");
    });

    await test("discussion module has clean directional dependencies without loading agent.js", () => {

        /* Verify that requiring agent/discussion does not require agent/agent.js */
        const cachedModules = Object.keys(require.cache);

        const loadedAgentMonolith = cachedModules.some(modPath =>
            modPath.endsWith(path.join("agent", "agent.js"))
        );

        /* agent/agent.js must not be pulled in by agent/discussion */
        assert.equal(
            loadedAgentMonolith,
            false,
            "agent/discussion has a circular or unneeded require to agent/agent.js"
        );
    });

    await test("discussion events carry correlation envelopes and match documented inventory", async () => {

        const captured = [];
        const listen = event => captured.push(event);

        events.bus.on("event", listen);

        try {

            await discussionTool.discussion_start(
                {
                    task: "Contract event probe",
                    personas: ["security", "backend"],
                    max_rounds: 2,
                    mock: true
                },
                {
                    projectId: "prj-probe",
                    runId: "run-probe-123"
                }
            );

        } finally {

            events.bus.off("event", listen);
        }

        assert.ok(captured.length >= 4, "expected at least 4 discussion events");

        const types = captured.map(e => e.type);

        assert.ok(types.includes("discussion:start"));
        assert.ok(types.includes("discussion:message"));
        assert.ok(types.includes("discussion:round"));
        assert.ok(types.includes("discussion:observer"));
        assert.ok(types.includes("discussion:finish"));

        for (const event of captured) {

            assert.ok(typeof event.seq === "number");
            assert.ok(typeof event.at === "number");
            assert.equal(event.project_id, "prj-probe");
            assert.equal(event.run_id, "run-probe-123");
        }
    });

    await test("discussion transcript is persisted in dataRoot and isolated per project", async () => {

        const testDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "disc-persist-"));
        process.env.STRUCTURED_AI_DATA_HOME = testDataHome;
        process.env.PROJECT_CONTEXT_MODE = "modular";

        try {

            const registry = projects.registry();

            const wsA = fs.mkdtempSync(path.join(os.tmpdir(), "ws-a-"));
            const wsB = fs.mkdtempSync(path.join(os.tmpdir(), "ws-b-"));

            const prjA = registry.register({ id: "proj-alpha", name: "Alpha", rootPath: wsA });
            const prjB = registry.register({ id: "proj-beta", name: "Beta", rootPath: wsB });

            const ctxA = projects.createProjectContext(prjA);
            const ctxB = projects.createProjectContext(prjB);

            /* Run discussion on Project A */
            const resultA = await discussionTool.discussion_start(
                {
                    task: "Design database architecture for Alpha",
                    personas: ["database", "backend"],
                    max_rounds: 2,
                    mock: true
                },
                {
                    projectId: ctxA.projectId,
                    projectContext: ctxA,
                    runId: "run-alpha-disc"
                }
            );

            assert.equal(resultA.ok, true);

            /* Verify persisted in Project A dataRoot */
            const listA = discussion.listDiscussions(ctxA);
            assert.equal(listA.length, 1);
            assert.equal(listA[0].id, resultA.id);
            assert.equal(listA[0].project_id, "proj-alpha");

            /* Verify Project B cannot see Project A's discussion (isolation) */
            const listB = discussion.listDiscussions(ctxB);
            assert.equal(listB.length, 0, "Project B leaked Project A's discussion!");

            const docInB = discussion.getDiscussion(resultA.id, ctxB);
            assert.equal(docInB, null, "Project B was able to fetch Project A's discussion!");

            /* Fetch directly from Project A */
            const docInA = discussion.getDiscussion(resultA.id, ctxA);
            assert.ok(docInA, "Project A failed to load its own discussion document");
            assert.equal(docInA.id, resultA.id);
            assert.equal(docInA.project_id, "proj-alpha");
            assert.ok(Array.isArray(docInA.rounds));

            fs.rmSync(wsA, { recursive: true, force: true });
            fs.rmSync(wsB, { recursive: true, force: true });

        } finally {

            delete process.env.STRUCTURED_AI_DATA_HOME;
            delete process.env.PROJECT_CONTEXT_MODE;
            fs.rmSync(testDataHome, { recursive: true, force: true });
        }
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
