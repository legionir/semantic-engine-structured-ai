"use strict";

/*
| project-stores.test.js: from "migration copies legacy state, stays idempotent, survives corruption"
|
| Runs inside project-stores.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");


module.exports = async function migrationCopiesLegacyStateStaysIdempotentCases(ctx) {

    const {
        centralRoot,
        planTools,
        projects,
        runCli,
        sessions,
        test,
        writeJson
    } = ctx;

    await test("migration copies legacy state, stays idempotent, survives corruption", async () => {


        try {

            /* craft the single-project era: a workspace with state in
               .agent/ of every store family, one entry un-copyable
               (memory.json made a directory) */

            const LEGACY = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p8-legacy-"));

            const legacyAgent = path.join(LEGACY, ".agent");

            writeJson(path.join(legacyAgent, "plan.json"), {
                objective: "legacy objective",
                phases: [{ id: "phase_1", title: "P", steps: [] }]
            });

            writeJson(path.join(legacyAgent, "project.json"), {
                version: "1",
                name: "legacy",
                settings: { AGENT_VERBOSE: "0" }
            });

            writeJson(path.join(legacyAgent, "sessions", "index.json"), {
                sessions: [{ id: "s-old", title: "old" }]
            });

            writeJson(path.join(legacyAgent, "sessions", "s-old.json"), {
                id: "s-old",
                messages: [{ role: "user", content: "old hello" }]
            });

            writeJson(path.join(legacyAgent, "archive", "index.json"), {
                version: "1",
                records: []
            });

            fs.mkdirSync(
                path.join(legacyAgent, "journal", "2026-08-24"),
                { recursive: true }
            );

            fs.writeFileSync(
                path.join(legacyAgent, "journal", "2026-08-24", "main_agent.jsonl"),
                `${JSON.stringify({ kind: "run_start", run_id: "old-run" })}\n`
            );

            fs.mkdirSync(
                path.join(legacyAgent, "eventstore"),
                { recursive: true }
            );

            fs.writeFileSync(
                path.join(legacyAgent, "eventstore", "2026-08-24.jsonl"),
                `${JSON.stringify({ type: "run:start", run_id: "old-run" })}\n`
            );

            /* legacy discussion transcript (plan phase 2 / step 3) */

            fs.mkdirSync(path.join(legacyAgent, "discussion"), { recursive: true });

            fs.writeFileSync(
                path.join(legacyAgent, "discussion", "d-old.json"),
                JSON.stringify({ id: "d-old", turns: [] })
            );

            /* the corrupt entry: memory.json as a DIRECTORY — copying
               it must fail without stopping the rest */

            fs.mkdirSync(path.join(legacyAgent, "memory.json"), { recursive: true });

            fs.writeFileSync(
                path.join(legacyAgent, "memory.json", "stray.txt"),
                "stray\n"
            );

            projects.registry().register({
                id: "prj-mig",
                name: "Migrated",
                rootPath: LEGACY
            });

            const record = projects.registry().get("prj-mig");

            const first = projects.ProjectMigration.migrateProject(record);

            assert.equal(first.project_id, "prj-mig");
            assert.equal(first.source_present, true);
            assert.equal(first.errors.length, 1, "one corrupt file, one error");
            assert.equal(first.errors[0].file, "memory.json");

            assert.ok(first.copied.includes("plan.json"));
            assert.ok(first.copied.includes(path.join("sessions", "index.json")));
            assert.ok(first.copied.includes(path.join("sessions", "s-old.json")));
            assert.ok(first.copied.includes(path.join("archive", "index.json")));
            assert.ok(
                first.copied.includes(
                    path.join("journal", "2026-08-24", "main_agent.jsonl")
                )
            );
            assert.ok(
                first.copied.includes(path.join("eventstore", "2026-08-24.jsonl"))
            );

            assert.ok(
                first.copied.includes(path.join("discussion", "d-old.json")),
                "legacy discussion transcript must be migrated"
            );

            assert.ok(
                fs.existsSync(path.join(centralRoot("prj-mig"), "discussion", "d-old.json"))
            );

            /* old files are never deleted */

            assert.ok(fs.existsSync(path.join(legacyAgent, "plan.json")));
            assert.ok(fs.existsSync(path.join(legacyAgent, "sessions", "s-old.json")));

            /* migrated state loads intact from the central store */

            const migratedPlan =

                planTools._loadPlan(centralRoot("prj-mig"));

            assert.equal(migratedPlan.objective, "legacy objective");

            const migratedSession =

                sessions.loadSession("s-old", centralRoot("prj-mig"));

            assert.equal(migratedSession.messages[0].content, "old hello");

            /* restart loses nothing: a fresh registry object over the
               same data home sees the same project and files */

            const fresh = new projects.ProjectRegistry();

            assert.equal(fresh.get("prj-mig").rootPath, record.rootPath);

            assert.ok(
                fs.existsSync(
                    path.join(centralRoot("prj-mig"), "plan.json")
                )
            );

            /* re-running migration neither duplicates nor overwrites:
               the corrupt entry reports the same error, everything
               else is skipped */

            const second = projects.ProjectMigration.migrateProject(record);

            assert.equal(second.copied.length, 0);
            assert.equal(second.errors.length, 1);
            assert.equal(second.errors[0].file, "memory.json");
            assert.ok(second.skipped.length >= first.copied.length);

            const centralPlan =

                fs.readFileSync(
                    path.join(centralRoot("prj-mig"), "plan.json"),
                    "utf8"
                );

            assert.equal(

                centralPlan,
                fs.readFileSync(
                    path.join(legacyAgent, "plan.json"),
                    "utf8"
                )
            );

            fs.rmSync(LEGACY, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

        } finally {


        }

    });


    await test("CLI --migrate reports unknown projects and adopts with -w", async () => {

        const unknown = await runCli(["--migrate", "prj-ghost"]);

        assert.notEqual(unknown.code, 0);
        assert.match(unknown.stderr, /Unknown project: prj-ghost/);

        /* adoption: -w registers the id at that directory and migrates */

        const ADOPT = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p8-adopt-"));

        writeJson(path.join(ADOPT, ".agent", "plan.json"), {
            objective: "adopt me",
            phases: []
        });

        const adopted = await runCli(["--migrate", "prj-cli", "-w", ADOPT]);

        assert.equal(adopted.code, 0, `stderr was: ${adopted.stderr}`);
        assert.match(adopted.stderr, /registered project prj-cli/);
        assert.match(adopted.stderr, /copied : 1 file/);

        assert.ok(
            fs.existsSync(
                path.join(centralRoot("prj-cli"), "plan.json")
            )
        );

        /* idempotent at the CLI level too */

        const again = await runCli(["--migrate", "prj-cli", "-w", ADOPT]);

        assert.equal(again.code, 0);
        assert.match(again.stderr, /nothing new to migrate/);

        /* conflicting uses are usage errors */

        const conflict = await runCli(["--migrate", "prj-cli", "--project", "prj-a"]);

        assert.equal(conflict.code, 2);

        fs.rmSync(ADOPT, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    });
};
