const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
|--------------------------------------------------------------------------|
| Engine paths — the consumer side of the semantic-engine data contract    |
|--------------------------------------------------------------------------|
|
| The engine moved its artifacts out of the workspace
| (MULTI_PROJECT_GATEWAY_EXECUTION_PLAN.md, فاز ۳/۴). These tests pin the two
| rules this repository depends on — where the data directory is, and how a
| project id is derived from a root — plus the read order that keeps an index
| written before the move working.
|
| The engine asserts the same rules from its side in
| semantic-engine/src/core/config/structuredAiContract.test.ts, so a change on
| either side fails a test instead of silently orphaning an index.
|--------------------------------------------------------------------------|
*/

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "engine-paths-test-"));

process.env.WORKSPACE_ROOT = WORKSPACE;

const enginePaths = require("../../agent/mcp/enginePaths");
const semantic = require("../../agent/mcp/semantic");
const settings = require("../../agent/config");

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.error(error);
    }
}

function writeIndex(target, files = [], symbols = []) {

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
        target,
        JSON.stringify({
            generatedAt: new Date().toISOString(),
            files,
            symbols
        })
    );
}

async function main() {

    await test("data home follows each platform convention", () => {

        assert.equal(
            enginePaths.engineDataHome({
                platform: "linux",
                homeDir: "/home/u",
                env: {}
            }),
            "/home/u/.local/share/semantic-engine"
        );

        assert.equal(
            enginePaths.engineDataHome({
                platform: "linux",
                homeDir: "/home/u",
                env: { XDG_DATA_HOME: "/srv/data" }
            }),
            "/srv/data/semantic-engine"
        );

        /* A relative XDG_DATA_HOME is invalid and must be ignored. */
        assert.equal(
            enginePaths.engineDataHome({
                platform: "linux",
                homeDir: "/home/u",
                env: { XDG_DATA_HOME: "relative/dir" }
            }),
            "/home/u/.local/share/semantic-engine"
        );

        assert.equal(
            enginePaths.engineDataHome({
                platform: "darwin",
                homeDir: "/Users/u",
                env: {}
            }),
            path.posix.join("/Users/u", "Library", "Application Support", "SemanticEngine")
        );

        assert.equal(
            enginePaths.engineDataHome({
                platform: "win32",
                homeDir: "C:\\Users\\u",
                env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }
            }),
            "C:\\Users\\u\\AppData\\Local\\SemanticEngine"
        );

        /* No `.semantic-engine` nested inside the platform directory. */
        for (const platform of ["linux", "darwin", "win32"]) {

            const home = enginePaths.engineDataHome({
                platform,
                homeDir: "/home/u",
                env: {}
            });

            assert.ok(
                !home.split(/[\\/]/).includes(".semantic-engine"),
                `${platform}: ${home}`
            );
        }
    });

    await test("an explicit data dir wins", () => {

        assert.equal(
            enginePaths.engineDataHome({
                override: "/srv/engine",
                platform: "linux",
                homeDir: "/home/u",
                env: { XDG_DATA_HOME: "/srv/data" }
            }),
            "/srv/engine"
        );
    });

    await test("project ids are stable and cannot collide on a shared name", () => {

        const clientA = path.join(WORKSPACE, "client-a", "app");
        const clientB = path.join(WORKSPACE, "client-b", "app");
        fs.mkdirSync(clientA, { recursive: true });
        fs.mkdirSync(clientB, { recursive: true });

        const idA = enginePaths.engineProjectIdFor(clientA);
        const idB = enginePaths.engineProjectIdFor(clientB);

        assert.match(idA, /^prj-app-[0-9a-f]{8}$/);
        assert.equal(idA, enginePaths.engineProjectIdFor(clientA));
        assert.notEqual(idA, idB);
        assert.equal(enginePaths.slugify("Engine Core"), "engine-core");
        assert.equal(enginePaths.slugify("پروژه"), "project");
    });

    await test("read order: data directory first, then the legacy locations", () => {

        const root = path.join(WORKSPACE, "ordered");
        fs.mkdirSync(root, { recursive: true });

        const candidates = enginePaths.indexPathCandidates(root, {
            override: "/srv/engine",
            platform: "linux"
        });

        assert.equal(candidates.length, 4);
        assert.equal(
            candidates[0],
            path.posix.join(
                "/srv/engine",
                "projects",
                enginePaths.engineProjectIdFor(root),
                "project-index.json"
            )
        );
        assert.equal(
            candidates[1],
            path.join(root, ".semantic-engine", "project-index.json")
        );
        assert.equal(
            candidates[2],
            path.join(root, ".agent", "semantic", "project-index.json")
        );
        assert.equal(
            candidates[3],
            path.join(root, "semantic", "project-index.json")
        );
    });

    await test("checkStaleness finds an index in the data directory", () => {

        const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "engine-data-"));
        const root = path.join(WORKSPACE, "external-app");
        fs.mkdirSync(root, { recursive: true });

        settings.set("SEMANTIC_ENGINE_DATA_DIR", dataHome);
        try {

            const external = enginePaths.externalIndexPath(root, {
                override: dataHome
            });
            writeIndex(external, [{ path: "src/a.ts" }], [{ id: "s1" }, { id: "s2" }]);

            const staleness = semantic.checkStaleness(root);

            assert.equal(staleness.state, "fresh");
            assert.equal(staleness.path, external);
            assert.equal(staleness.file_count, 1);
            assert.equal(staleness.symbol_count, 2);

            /* Nothing was written into the workspace. */
            assert.deepEqual(fs.readdirSync(root), []);
        } finally {
            settings.reset("SEMANTIC_ENGINE_DATA_DIR");
            fs.rmSync(dataHome, { recursive: true, force: true });
        }
    });

    await test("checkStaleness still reads a pre-move legacy index", () => {

        const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "engine-data-"));
        const root = path.join(WORKSPACE, "legacy-app");
        fs.mkdirSync(root, { recursive: true });

        settings.set("SEMANTIC_ENGINE_DATA_DIR", dataHome);
        try {

            const legacy = path.join(root, ".agent", "semantic", "project-index.json");
            writeIndex(legacy, [{ path: "src/a.ts" }], []);

            const staleness = semantic.checkStaleness(root);

            assert.equal(staleness.state, "fresh");
            assert.equal(staleness.path, legacy);
        } finally {
            settings.reset("SEMANTIC_ENGINE_DATA_DIR");
            fs.rmSync(dataHome, { recursive: true, force: true });
        }
    });

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
