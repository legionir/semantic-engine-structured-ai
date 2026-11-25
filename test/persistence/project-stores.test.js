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

    /* the cases live in ./project-stores-cases, run in this order */
    const ctx = {
        ROOT_A,
        ROOT_B,
        WORKSPACE,
        archive,
        centralRoot,
        ctxA,
        ctxB,
        dataRoot,
        eventstore,
        expectThrow,
        journal,
        legacyRoot,
        memoryStore,
        planTools,
        projectFile,
        projects,
        runCli,
        sessions,
        settings,
        test,
        tools,
        writeJson
    };

    await require("./project-stores-cases/01-the-data-root-resolver-follows-the")(ctx);
    await require("./project-stores-cases/02-sessions-and-the-archive-are-separated")(ctx);
    await require("./project-stores-cases/03-migration-copies-legacy-state-stays-idempotent")(ctx);



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
