"use strict";

/*
|--------------------------------------------------------------------------
| Atomic saves for plan, session and project profile (plan phase 2 / step 3)
|--------------------------------------------------------------------------
|
| Crash injection: fs.renameSync throws after the temp file was written.
| The previous valid document must still be readable, no temp file may be
| left behind, and the failure must reach the caller.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "atomic-saves-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.SESSIONS_ENABLED = "1";

const REPO = path.resolve(__dirname, "..", "..");

const PlanRepository = require(path.join(REPO, "agent", "tools", "planning", "PlanRepository.js"));
const SessionRepository = require(path.join(REPO, "agent", "persistence", "SessionRepository.js"));
const WorkspaceProfile = require(path.join(REPO, "agent", "projects", "WorkspaceProfile.js"));
const ProjectStore = require(path.join(REPO, "agent", "projects", "ProjectStore.js"));

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


function withFailingRename(fn) {

    const rename = fs.renameSync;

    fs.renameSync = () => {

        throw new Error("simulated crash before rename");
    };

    try {

        return fn();

    } finally {

        fs.renameSync = rename;
    }
}


function assertNoTempFiles(directory) {

    const leftovers =
        fs.readdirSync(directory).filter(name => name.includes(".tmp-"));

    assert.deepStrictEqual(leftovers, [], "temp files left behind");
}


async function main() {

    await test("savePlan keeps the previous plan when the write crashes", () => {

        const root = fs.mkdtempSync(path.join(WORKSPACE, "plan-"));

        PlanRepository.savePlan({ version: 1, title: "first", phases: [] }, root);

        const file = PlanRepository.planPath(root);
        const before = fs.readFileSync(file, "utf8");

        assert.throws(
            () => withFailingRename(
                () => PlanRepository.savePlan({ version: 1, title: "second", phases: [] }, root)
            ),
            /simulated crash/
        );

        assert.strictEqual(fs.readFileSync(file, "utf8"), before);
        assert.strictEqual(JSON.parse(before).title, "first");
        assertNoTempFiles(path.dirname(file));

        PlanRepository.savePlan({ version: 1, title: "third", phases: [] }, root);
        assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).title, "third");
    });

    await test("saveSession keeps the previous session when the write crashes", () => {

        const root = fs.mkdtempSync(path.join(WORKSPACE, "session-"));

        const session = SessionRepository.emptySession("atomic-one");
        session.title = "before";
        SessionRepository.saveSession(session, root);

        const file = SessionRepository.sessionPath("atomic-one", root);
        const before = fs.readFileSync(file, "utf8");

        session.title = "after";

        assert.throws(
            () => withFailingRename(() => SessionRepository.saveSession(session, root)),
            /simulated crash/
        );

        assert.strictEqual(fs.readFileSync(file, "utf8"), before);
        assert.strictEqual(JSON.parse(before).title, "before");
        assertNoTempFiles(path.dirname(file));
    });

    await test("saveProject keeps the previous project profile when the write crashes", () => {

        const target = path.join(fs.mkdtempSync(path.join(WORKSPACE, "profile-")), "project.json");

        WorkspaceProfile.saveProject({ version: WorkspaceProfile.PROJECT_VERSION, settings: { A: 1 } }, target);
        const before = fs.readFileSync(target, "utf8");

        assert.throws(
            () => withFailingRename(
                () => WorkspaceProfile.saveProject(
                    { version: WorkspaceProfile.PROJECT_VERSION, settings: { A: 2 } },
                    target
                )
            ),
            /simulated crash/
        );

        assert.strictEqual(fs.readFileSync(target, "utf8"), before);
        assertNoTempFiles(path.dirname(target));
    });

    /*
    | SA-F-016 (contained half) — the registry save used to hand-roll the
    | atomic write with a pid-only temp suffix. It now goes through the
    | same AtomicFile path as every other durable write, so a crash
    | before rename must keep the previous registry and leave no .tmp-
    | file behind. This locks that; the cross-process RMW race is the
    | separate, still-open ledger half.
    */
    await test("ProjectStore.save keeps the previous registry when the write crashes", () => {

        const target = path.join(fs.mkdtempSync(path.join(WORKSPACE, "registry-")), "registry.json");

        ProjectStore.save({ version: ProjectStore.STORE_VERSION, projects: { a: { rootPath: "/a" } } }, target);
        const before = fs.readFileSync(target, "utf8");

        assert.throws(
            () => withFailingRename(
                () => ProjectStore.save(
                    { version: ProjectStore.STORE_VERSION, projects: { b: { rootPath: "/b" } } },
                    target
                )
            ),
            /simulated crash/
        );

        assert.strictEqual(fs.readFileSync(target, "utf8"), before);
        assert.deepStrictEqual(JSON.parse(before).projects.a.rootPath, "/a");
        assertNoTempFiles(path.dirname(target));
    });

    const failed = results.filter(result => !result.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
