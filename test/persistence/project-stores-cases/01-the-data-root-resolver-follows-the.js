"use strict";

/*
| project-stores.test.js: from "the data root resolver follows the گام ۱ order"
|
| Runs inside project-stores.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function theDataRootResolverFollowsTheCases(ctx) {

    const {
        WORKSPACE,
        centralRoot,
        ctxA,
        ctxB,
        dataRoot,
        eventstore,
        expectThrow,
        journal,
        legacyRoot,
        memoryStore,
        settings,
        test,
        tools
    } = ctx;

    await test("the data root resolver follows the گام ۱ order", async () => {

        /* Canonical routing keeps the unscoped compatibility root while
           an explicit project context resolves to its central root. */

        assert.throws(() => settings.definitionOf("PROJECT_CONTEXT_MODE"), /Unknown setting/);
        assert.equal(dataRoot.resolveRoot(), legacyRoot());
        assert.equal(dataRoot.resolveRoot(ctxA), centralRoot("prj-a"));
        assert.equal(dataRoot.dataRootForProjectId("prj-a"), centralRoot("prj-a"));


        try {

            /* explicit string wins, then the context's project, then
               the ambient (out-of-run) legacy root */

            const explicit = path.join(WORKSPACE, "explicit-root");

            assert.equal(dataRoot.resolveRoot(explicit), explicit);

            assert.equal(
                dataRoot.resolveRoot(ctxA),
                centralRoot("prj-a")
            );

            assert.equal(
                dataRoot.dataRootForProjectId("prj-a"),
                centralRoot("prj-a")
            );

            assert.equal(dataRoot.dataRootForProjectId("prj-ghost"), null);

            /* outside any run scope there is no project to route to */
            assert.equal(dataRoot.currentRoot(), legacyRoot());

            /* the central scaffold is materialised on demand */

            dataRoot.ensureRoot(centralRoot("prj-b"));

            for (const dir of dataRoot.SCAFFOLD_DIRS) {

                assert.ok(
                    fs.existsSync(path.join(centralRoot("prj-b"), dir)),
                    `scaffold directory missing: ${dir}`
                );

            }

        } finally {


        }

    });


    await test("plan and memory live per project and never cross", async () => {


        try {

            await tools.executeTool(

                "plan_set",
                {
                    objective: "objective a",
                    phases: [
                        { title: "Phase one", steps: ["first step"] }
                    ]
                },
                ctxA
            );

            assert.ok(
                fs.existsSync(
                    path.join(centralRoot("prj-a"), "plan.json")
                ),
                "the plan must be written to prj-a's central store"
            );

            await tools.executeTool(
                "plan_update",
                { id: "phase_1.1", status: "done", evidence: "proved" },
                ctxA
            );

            const readA = await tools.executeTool("plan_get", {}, ctxA);

            assert.equal(readA.summary.done, 1);

            const readB = await tools.executeTool("plan_get", {}, ctxB);

            assert.equal(
                readB.phases.length,
                0,
                "project B must not see project A's plan"
            );

            await expectThrow(
                tools.executeTool(
                    "plan_update",
                    { id: "phase_1.1", status: "done" },
                    ctxB
                ),
                /no plan yet/i,
                "project B plan_update"
            );

            /* memory: same rule, driven through the store directly and
               through the tool both ways */

            const memoryA = memoryStore.emptyMemory();

            memoryA.decisions.push("decision only a knows");

            memoryStore.saveMemory(memoryA, ctxA);

            assert.deepEqual(
                memoryStore.loadMemory(ctxA).decisions,
                ["decision only a knows"]
            );

            assert.deepEqual(
                memoryStore.loadMemory(ctxB).decisions,
                [],
                "project B must not read project A's memory"
            );

            const view = await tools.executeTool("memory_get", {}, ctxB);

            assert.deepEqual(view.memory.decisions, []);

            /* the legacy workspace files were never created — a
               modular project run leaves the legacy stores untouched */

            assert.ok(!fs.existsSync(path.join(legacyRoot(), "plan.json")));
            assert.ok(!fs.existsSync(path.join(legacyRoot(), "memory.json")));

        } finally {


        }

    });


    await test("the project-awareness gate lifted for stores, kept for runtime_stats", async () => {


        try {

            /* search resolves inside the run's project tree now */

            const searched = await tools.executeTool(

                "search_start",
                { query: "beta", mode: "files", wait_ms: 5000 },
                ctxB
            );

            assert.ok(
                searched.results.some(hit => hit.path === "beta.txt"),
                `search must walk prj-b's tree: ${JSON.stringify(searched.results)}`
            );

            assert.equal(searched.path, ".");

            /* runtime_stats is process-global: still loudly refused on
               a foreign root instead of silently mis-scoped */

            await expectThrow(
                tools.executeTool("runtime_stats", {}, ctxA),
                /process-scoped/,
                "runtime_stats on a foreign root"
            );

        } finally {


        }

    });


    await test("events route to the registered project's central store", async () => {


        try {

            assert.equal(

                eventstore.append({
                    type: "run:start",
                    run_id: "run-p8-central",
                    project_id: "prj-a",
                    at: Date.parse("2026-08-25T10:00:00Z")
                }),
                true
            );

            assert.equal(

                eventstore.append({
                    type: "run:start",
                    run_id: "run-p8-legacy",
                    at: Date.parse("2026-08-25T10:00:00Z")
                }),
                true
            );

            /* scoped → central, unscoped → legacy; never mixed */

            const central =

                eventstore.query({
                    run_id: "run-p8-central",
                    root: centralRoot("prj-a")
                });

            assert.equal(central.length, 1);

            assert.deepEqual(

                eventstore.query({
                    run_id: "run-p8-central",
                    root: legacyRoot()
                }),
                [],
                "the legacy store must not hold prj-a's scoped events"
            );

            const legacy =

                eventstore.query({
                    run_id: "run-p8-legacy",
                    root: legacyRoot()
                });

            assert.equal(legacy.length, 1);

            assert.ok(

                eventstore.listDays(centralRoot("prj-a"))
                    .includes("2026-08-25")
            );

        } finally {


        }

    });


    await test("the journal separates runs per project and per run", async () => {


        try {

            /* two concurrent runs on two different projects */

            journal.onEvent({
                type: "run:start",
                run_id: "run-p8-a",
                project_id: "prj-a",
                task: "task of a",
                at: Date.parse("2026-08-25T11:00:00Z")
            });

            journal.onEvent({
                type: "run:start",
                run_id: "run-p8-b",
                project_id: "prj-b",
                task: "task of b",
                at: Date.parse("2026-08-25T11:00:01Z")
            });

            journal.onEvent({
                type: "agent:thinking",
                run_id: "run-p8-b",
                project_id: "prj-b",
                agent: "main_agent",
                scope: "main_agent",
                content: "thinking inside b",
                at: Date.parse("2026-08-25T11:00:02Z")
            });

            journal.onEvent({
                type: "agent:thinking",
                run_id: "run-p8-a",
                project_id: "prj-a",
                agent: "main_agent",
                scope: "main_agent",
                content: "thinking inside a",
                at: Date.parse("2026-08-25T11:00:03Z")
            });

            journal.onEvent({
                type: "run:end",
                run_id: "run-p8-a",
                project_id: "prj-a",
                status: "done",
                at: Date.parse("2026-08-25T11:00:04Z")
            });

            await journal.flush();

            const fileA =
                path.join(
                    centralRoot("prj-a"),
                    "journal",
                    "2026-08-25",
                    "main_agent.jsonl"
                );

            const fileB =
                path.join(
                    centralRoot("prj-b"),
                    "journal",
                    "2026-08-25",
                    "main_agent.jsonl"
                );

            assert.ok(fs.existsSync(fileA), "prj-a journal must exist");
            assert.ok(fs.existsSync(fileB), "prj-b journal must exist");

            const readRecords = file =>

                fs.readFileSync(file, "utf8")
                    .split("\n")
                    .filter(line => line.trim() !== "")
                    .map(line => JSON.parse(line));

            const recordsA = readRecords(fileA);
            const recordsB = readRecords(fileB);

            /* attribution: each record carries its own run's id+task —
               run-bucket isolation, not the last-single-writer STATE */

            assert.ok(
                recordsA.every(
                    record =>
                        record.run_id === "run-p8-a" &&
                        record.task === "task of a"
                )
            );

            assert.ok(
                recordsB.every(
                    record =>
                        record.run_id === "run-p8-b" &&
                        record.task === "task of b"
                )
            );

            assert.ok(
                recordsA.some(
                    record =>
                        record.kind === "thinking" &&
                        record.thinking === "thinking inside a"
                )
            );

            assert.ok(
                !recordsA.some(
                    record =>
                        record.kind === "thinking" &&
                        record.thinking === "thinking inside b"
                ),
                "run b's thinking must never land in run a's journal"
            );

            /* nothing was routed to the legacy journal dir */

            assert.ok(
                !fs.existsSync(path.join(legacyRoot(), "journal"))
            );

        } finally {


        }

    });
};
