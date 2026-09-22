"use strict";

/*
|--------------------------------------------------------------------------
| Per-Project Persistence Tests — EXECUTION_PLAN Phase 8
|--------------------------------------------------------------------------
|
| Locks the phase-8 acceptance criteria:
|
|   1. one resolver (lib/dataRoot.js) decides where every persisted
|      byte lives: explicit root, then the run's project from the
|      ToolContext/registry, then the legacy workspace .agent root —
|      and an unscoped call uses the compatibility default root
|   2. full per-project separation of memory / plan / sessions /
|      archive / journal / eventstore: project A's state is invisible
|      from project B, and an unscoped (legacy) flow never touches a
|      central store
|   3. the plan/memory/search families lost their "not yet
|      project-aware" gate (runtime_stats deliberately keeps it —
|      process-global telemetry has no project root)
|   4. the settings overlay (گام ۲): the workspace .agent/project.json
|      stays the read floor, the central project.json the cap, and new
|      writes only flow to the central target
|   5. migration (گام ۳): copies legacy .agent state into the central
|      store, never deletes the legacy files, is idempotent on re-run,
|      and one corrupt file cannot stop the rest
|
| Environment must be set BEFORE the first require so the modules pin
| this test's workspace and data home.
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p8-ws-"));
const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p8-rootA-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p8-rootB-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p8-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;

const ROOT = path.resolve(__dirname, "..", "..");
const BIN = path.join(ROOT, "bin", "agent.js");

const settings = require(path.join(ROOT, "agent", "config"));
const dataRoot = require(path.join(ROOT, "agent", "persistence", "DataRoot"));
const memoryStore = require(path.join(ROOT, "agent", "context", "Memory"));
const sessions = require(path.join(ROOT, "agent", "persistence", "SessionRepository"));
const archive = require(path.join(ROOT, "agent", "persistence", "ArchiveRepository"));
const journal = require(path.join(ROOT, "agent", "persistence", "JournalRepository"));
const eventstore = require(path.join(ROOT, "agent", "persistence", "EventStoreRepository"));
const projectFile = require(path.join(ROOT, "agent", "projects", "WorkspaceProfile"));
const planTools = require(path.join(ROOT, "agent", "tools", "planning"));
const tools = require(path.join(ROOT, "agent", "tools", "index.js"));
const projects = require(path.join(ROOT, "agent", "projects", "index.js"));

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}\n${error.stack}`);

    }
}


/* The raw context shape executeTool receives in a run. */
function contextFor(record) {

    return {
        agent: "main_agent",
        runId: `run-p8-${record.id}`,
        projectId: record.id,
        projectContext: projects.createProjectContext(record)
    };

}


function centralRoot(id) {

    return path.join(DATA_HOME, "projects", id);

}


function legacyRoot() {

    return path.join(WORKSPACE, ".agent");

}


async function expectThrow(promise, pattern, what) {

    let thrown = null;

    try {
        await promise;
    } catch (error) {
        thrown = error;
    }

    assert.ok(thrown, `${what}: expected an error, got success`);

    assert.match(
        thrown.message,
        pattern,
        `${what}: "${thrown.message}" does not match ${pattern}`
    );

}


function runCli(args, env = {}) {

    return new Promise((resolve, reject) => {

        const child = spawn(

            process.execPath,
            [BIN, ...args],
            {
                env: {
                    ...process.env,
                    WORKSPACE_ROOT: WORKSPACE,
                    STRUCTURED_AI_DATA_HOME: DATA_HOME,
                    ...env
                },
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => (stdout += chunk));
        child.stderr.on("data", chunk => (stderr += chunk));

        child.on("error", reject);
        child.on("close", code => resolve({ code, stdout, stderr }));

    });

}


function writeJson(file, value) {

    fs.mkdirSync(path.dirname(file), { recursive: true });

    fs.writeFileSync(
        file,
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8"
    );

}


async function main() {

    const recordA =
        projects.registry().register({
            id: "prj-a",
            name: "Project A",
            rootPath: ROOT_A
        });

    const recordB =
        projects.registry().register({
            id: "prj-b",
            name: "Project B",
            rootPath: ROOT_B
        });

    const ctxA = contextFor(recordA);
    const ctxB = contextFor(recordB);

    fs.writeFileSync(path.join(ROOT_A, "alpha.txt"), "alpha\n");
    fs.writeFileSync(path.join(ROOT_B, "beta.txt"), "beta\n");


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
                /not yet project-aware/,
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


    await test("sessions and the archive are separated per project", async () => {


        try {

            /* sessions */

            const sessionA = sessions.emptySession("s-p8-a");

            sessionA.messages.push({ role: "user", content: "hello a" });

            sessions.saveSession(sessionA, centralRoot("prj-a"));

            const listedA = sessions.listSessions(centralRoot("prj-a"));
            const listedB = sessions.listSessions(centralRoot("prj-b"));

            assert.equal(listedA.length, 1);
            assert.equal(listedA[0].id, "s-p8-a");
            assert.equal(listedB.length, 0, "B must not list A's session");

            /* replay of A's session is per project too */

            const replayed = sessions.loadSession("s-p8-a", centralRoot("prj-a"));

            assert.equal(replayed.messages[0].content, "hello a");

            assert.equal(
                sessions.loadSession("s-p8-a", centralRoot("prj-b")),
                null
            );

            /* archive: write to A, prove B's index and bodies are empty */

            const report = archive.archiveEvents(
                [
                    {
                        tool: "fs_read",
                        title: "read alpha into memory",
                        body: "the archived body of prj-a"
                    }
                ],
                { root: centralRoot("prj-a") }
            );

            assert.equal(report.added, 1);

            assert.equal(archive.stats({ root: centralRoot("prj-a") }).records, 1);
            assert.equal(archive.stats({ root: centralRoot("prj-b") }).records, 0);

            const foundA = archive.searchArchive("alpha", { root: centralRoot("prj-a") });
            const foundB = archive.searchArchive("alpha", { root: centralRoot("prj-b") });

            assert.equal(foundA.matches, 1);
            assert.equal(foundB.matches, 0, "B's archive must not match A's record");

            const records = archive.getRecords(
                [foundA.results[0].id],
                { root: centralRoot("prj-a") }
            );

            assert.equal(records.records[0].body, "the archived body of prj-a");

            const sameFromB = archive.getRecords(
                [foundA.results[0].id],
                { root: centralRoot("prj-b") }
            );

            assert.deepEqual(sameFromB.records, []);
            assert.deepEqual(sameFromB.missing, [foundA.results[0].id]);

        } finally {


        }

    });


    await test("the settings overlay reads floor-with-cap and writes central only", async () => {


        try {

            /* floor: the legacy workspace project file
               cap:   the central file of the registered project */

            const floorFile = path.join(legacyRoot(), "project.json");
            const capFile = path.join(centralRoot("prj-a"), "project.json");

            const floor = {

                version: "1",
                name: "workspace",
                created_at: "2026-08-01T00:00:00.000Z",
                opened: 7,
                settings: {
                    AGENT_MODEL: "floor-model",
                    AGENT_VERBOSE: "0"
                }
            };

            const cap = {

                version: "1",
                name: "workspace",
                created_at: "2026-08-02T00:00:00.000Z",
                opened: 3,
                settings: {
                    AGENT_MODEL: "cap-model"
                }
            };

            writeJson(floorFile, floor);
            writeJson(capFile, cap);

            const merged = projectFile.loadOverlay("prj-a");

            /* cap wins per key, floor fills the rest */

            assert.equal(merged.settings.AGENT_MODEL, "cap-model");
            assert.equal(merged.settings.AGENT_VERBOSE, "0");
            assert.equal(merged.opened, 3);

            /* opening applies the overlay and records the visit on the
               central target ONLY — the floor file stays byte-exact */

            const floorBefore = fs.readFileSync(floorFile, "utf8");

            const opened = projectFile.openProject("prj-a");

            assert.equal(settings.get("AGENT_MODEL"), "cap-model");
            assert.equal(settings.get("AGENT_VERBOSE"), "0");
            assert.equal(opened.path, floorFile);
            assert.equal(opened.overlay_path, capFile);

            assert.equal(
                fs.readFileSync(floorFile, "utf8"),
                floorBefore,
                "the legacy floor must not be written in the overlay model"
            );

            const capAfter = JSON.parse(fs.readFileSync(capFile, "utf8"));

            assert.equal(capAfter.opened, 4);
            assert.ok(capAfter.last_opened_at, "the visit went into the cap");

            /* the raw legacy read is untouched by the overlay */

            assert.equal(
                projectFile.loadProject().settings.AGENT_MODEL,
                "floor-model"
            );

            settings.reset("AGENT_MODEL");
            settings.reset("AGENT_VERBOSE");

        } finally {


        }

    });


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

            fs.rmSync(LEGACY, { recursive: true, force: true });

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

        fs.rmSync(ADOPT, { recursive: true, force: true });

    });


    console.log(
        `\n${results.filter(item => item.ok).length}/${results.length} passed`
    );

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }

    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.rmSync(ROOT_A, { recursive: true, force: true });
    fs.rmSync(ROOT_B, { recursive: true, force: true });
    fs.rmSync(DATA_HOME, { recursive: true, force: true });

}

main();
