"use strict";

/*
|--------------------------------------------------------------------------
| Hook registry is project-scoped (plan phase 6 / step 4, phase 8 / step 5)
|--------------------------------------------------------------------------
|
| Hooks configured in project A's .agent/project.json must never be loaded
| (and so never executed) for a run of project B, and a cached config for A
| must not be served to B.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "hook-scope-"));
const DEFAULT_WS = path.join(BASE, "default");
const A = path.join(BASE, "project-a");
const B = path.join(BASE, "project-b");
const DATA_HOME = path.join(BASE, "data");

for (const dir of [DEFAULT_WS, A, B, DATA_HOME]) {

    fs.mkdirSync(dir, { recursive: true });
}

function writeHooks(root, ids) {

    fs.mkdirSync(path.join(root, ".agent"), { recursive: true });

    fs.writeFileSync(
        path.join(root, ".agent", "project.json"),
        JSON.stringify({
            version: 1,
            hooks: { before_task: ids.map(id => ({ id })), after_task: [] }
        })
    );
}

writeHooks(DEFAULT_WS, ["default-hook"]);
writeHooks(A, ["a-hook"]);
writeHooks(B, ["b-hook"]);

process.env.WORKSPACE_ROOT = DEFAULT_WS;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";

const REPO = path.resolve(__dirname, "..", "..");

const { HookLoader } = require(path.join(REPO, "agent", "hooks", "HookLoader.js"));
const { runWithProject } = require(path.join(REPO, "agent", "runtime", "ProjectOverride.js"));

const results = [];


async function test(name, fn) {

    try {

        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}


const ids = config => config.before_task.map(hook => hook.id);


async function main() {

    const loader = new HookLoader();

    await test("each project loads only its own hooks", () => {

        runWithProject({ projectId: "prj-a", workspaceRoot: A }, () => {

            assert.deepStrictEqual(ids(loader.load()), ["a-hook"]);
        });

        runWithProject({ projectId: "prj-b", workspaceRoot: B }, () => {

            assert.deepStrictEqual(ids(loader.load()), ["b-hook"]);
        });
    });

    await test("the default project keeps using the process workspace", () => {

        assert.deepStrictEqual(ids(loader.load()), ["default-hook"]);
    });

    await test("the cache is per project: A's config is not served to B or to the default", () => {

        runWithProject({ projectId: "prj-a", workspaceRoot: A }, () => loader.load());

        runWithProject({ projectId: "prj-b", workspaceRoot: B }, () => {

            assert.ok(!ids(loader.load()).includes("a-hook"));
        });

        assert.ok(!ids(loader.load()).includes("a-hook"));
        assert.strictEqual(loader.caches.size, 3);
    });

    await test("editing project A's file reloads A only", () => {

        runWithProject({ projectId: "prj-a", workspaceRoot: A }, () => loader.load());

        writeHooks(A, ["a-hook", "a-hook-2"]);

        const future = new Date(Date.now() + 5000);
        fs.utimesSync(path.join(A, ".agent", "project.json"), future, future);

        runWithProject({ projectId: "prj-a", workspaceRoot: A }, () => {

            assert.deepStrictEqual(ids(loader.load()), ["a-hook", "a-hook-2"]);
        });

        runWithProject({ projectId: "prj-b", workspaceRoot: B }, () => {

            assert.deepStrictEqual(ids(loader.load()), ["b-hook"]);
        });
    });

    await test("concurrent runs of two projects do not see each other's hooks", async () => {

        const seen = await Promise.all([
            new Promise(resolve => runWithProject({ projectId: "prj-a", workspaceRoot: A }, async () => {
                await new Promise(r => setTimeout(r, 20));
                resolve(ids(loader.load()));
            })),
            new Promise(resolve => runWithProject({ projectId: "prj-b", workspaceRoot: B }, async () => {
                await new Promise(r => setTimeout(r, 5));
                resolve(ids(loader.load()));
            }))
        ]);

        assert.deepStrictEqual(seen, [["a-hook", "a-hook-2"], ["b-hook"]]);
    });

    const failed = results.filter(result => !result.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
