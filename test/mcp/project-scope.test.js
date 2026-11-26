"use strict";

/*
|--------------------------------------------------------------------------
| MCP project scope (plan phase 6, steps 2 and 3)
|--------------------------------------------------------------------------
|
| Two projects with different .mcp.json files must never see each other's
| servers, a delegated child must use the child's project (not the parent's),
| and there is no silent fallback to "the first workspace".
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-scope-"));
const PROCESS_WORKSPACE = path.join(BASE, "process");
const A = path.join(BASE, "project-a");
const B = path.join(BASE, "project-b");

for (const dir of [PROCESS_WORKSPACE, A, B]) {

    fs.mkdirSync(dir, { recursive: true });
}

function writeServers(root, names) {

    const servers = {};

    for (const name of names) {

        servers[name] = { command: process.execPath, args: ["-e", "0"] };
    }

    fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: servers }));
}

writeServers(PROCESS_WORKSPACE, ["proc-server"]);
writeServers(A, ["a-server"]);
writeServers(B, ["b-server"]);

process.env.WORKSPACE_ROOT = PROCESS_WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.MCP_ENABLED = "1";

const REPO = path.resolve(__dirname, "..", "..");

const { manager, managerRegistry } = require(path.join(REPO, "agent", "mcp", "McpManager.js"));
const loader = require(path.join(REPO, "agent", "mcp", "McpConfigLoader.js"));
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


const ctx = (projectId, workspaceRoot) => ({ projectId, workspaceRoot });

const serverNames = () =>
    manager.status().servers.map(server => server.name).sort();


async function main() {

    await test("each project sees only its own .mcp.json", () => {

        runWithProject(ctx("prj-a", A), () => {

            assert.deepStrictEqual(serverNames(), ["a-server"]);
        });

        runWithProject(ctx("prj-b", B), () => {

            assert.deepStrictEqual(serverNames(), ["b-server"]);
        });
    });

    await test("the second project is never served from the first project's workspace", () => {

        runWithProject(ctx("prj-a", A), () => serverNames());

        runWithProject(ctx("prj-b", B), () => {

            const status = manager.status();

            assert.strictEqual(path.resolve(status.workspace_root), path.resolve(B));
            assert.ok(!status.servers.some(server => server.name === "a-server"));
        });
    });

    await test("a delegated child uses the child's project, and the parent's is restored after", () => {

        runWithProject(ctx("prj-a", A), () => {

            assert.deepStrictEqual(serverNames(), ["a-server"]);

            runWithProject(ctx("prj-b", B), () => {

                assert.deepStrictEqual(serverNames(), ["b-server"]);
            });

            assert.deepStrictEqual(serverNames(), ["a-server"]);
        });
    });

    await test("concurrent children of two projects do not mix", async () => {

        const seen = await Promise.all([
            new Promise(resolve => runWithProject(ctx("prj-a", A), async () => {
                await new Promise(r => setTimeout(r, 15));
                resolve(serverNames());
            })),
            new Promise(resolve => runWithProject(ctx("prj-b", B), async () => {
                await new Promise(r => setTimeout(r, 5));
                resolve(serverNames());
            }))
        ]);

        assert.deepStrictEqual(seen, [["a-server"], ["b-server"]]);
    });

    await test("with no project the documented default (process workspace) is used", () => {

        assert.deepStrictEqual(serverNames(), ["proc-server"]);
    });

    await test("a project without a workspace root is a loud error, not a fallback", () => {

        runWithProject({ projectId: "prj-x" }, () => {

            assert.throws(() => manager.status(), /has no workspaceRoot/);
        });
    });

    await test("the config loader requires an explicit workspace root", () => {

        assert.throws(() => loader.load(), /explicit workspaceRoot/);
        assert.throws(() => loader.persist(undefined, { name: "x" }), /explicit workspaceRoot/);
        assert.throws(() => loader.forget("", "x"), /explicit workspaceRoot/);
    });

    await test("invalidating one project leaves the other project's cache alone", () => {

        runWithProject(ctx("prj-a", A), () => serverNames());
        runWithProject(ctx("prj-b", B), () => serverNames());

        const instanceB = managerRegistry.forRoot(B);
        const loadedB = instanceB.loadedAt;

        assert.ok(loadedB, "project B must be loaded");

        managerRegistry.forRoot(A).invalidate();

        assert.strictEqual(instanceB.loadedAt, loadedB);
        assert.notStrictEqual(managerRegistry.forRoot(A), instanceB);
    });

    const failed = results.filter(result => !result.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    await managerRegistry.shutdown();

    fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
