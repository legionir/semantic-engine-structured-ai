"use strict";

/*
|--------------------------------------------------------------------------
| P0 integration review fixes
|--------------------------------------------------------------------------
|
|   1. settings that choose an executable or a data location are locked
|      against project files (WorkspaceTrust)
|   2. a repository MCP config cannot declare its own server trusted
|      (McpConfigValidator)
|   3. McpManager.call refuses an untrusted project stdio server even when
|      it is reached by name (mcp_call), finding C2
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

const results = [];

async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.message}`);
    }
}


async function main() {

    console.log("P0 integration review fixes");

    const WorkspaceTrust = require(path.join(REPO, "agent", "projects", "WorkspaceTrust"));
    const settings = require(path.join(REPO, "agent", "config"));
    const validator = require(path.join(REPO, "agent", "mcp", "McpConfigValidator"));
    const { McpManager } = require(path.join(REPO, "agent", "mcp", "McpManager"));

    await test("executable and data-location settings are locked against project files", () => {

        for (const key of [
            "STRUCTURED_AI_DATA_HOME",
            "WORKSPACE_ROOT"
        ]) {
            assert.equal(WorkspaceTrust.classify(key, settings), "locked", key);
        }

        const { allowed, blocked } =
            WorkspaceTrust.filterProjectSettings(
                { STRUCTURED_AI_DATA_HOME: "./evil", MAX_ITERATIONS: 10 },
                { trusted: true, settings }
            );

        assert.deepEqual(Object.keys(allowed), ["MAX_ITERATIONS"]);
        assert.deepEqual(blocked.map(item => item.key), ["STRUCTURED_AI_DATA_HOME"]);
    });

    await test("a repository MCP config cannot mark its own server trusted", () => {

        const previous = settings.get("MCP_TRUST_PROJECT_CONFIG");

        try {

            settings.set("MCP_TRUST_PROJECT_CONFIG", false);

            for (const source of [validator.SOURCES.PROJECT, validator.SOURCES.WORKSPACE]) {

                const config =
                    validator.normalize(
                        "repo_server",
                        { url: "https://example.com/mcp", trust: "trusted" },
                        { source, origin: "test" }
                    );

                assert.equal(config.trust, "default", source);

                const restricted =
                    validator.normalize(
                        "repo_server2",
                        { url: "https://example.com/mcp", trust: "restricted" },
                        { source, origin: "test" }
                    );

                assert.equal(restricted.trust, "restricted", source);
            }

            const fromOperator =
                validator.normalize(
                    "operator_server",
                    { url: "https://example.com/mcp", trust: "trusted" },
                    { source: validator.SOURCES.ENVIRONMENT, origin: "test" }
                );

            assert.equal(fromOperator.trust, "trusted");

        } finally {
            settings.set("MCP_TRUST_PROJECT_CONFIG", previous);
        }
    });

    await test("C2: mcp_call cannot start an untrusted project stdio server by name", async () => {

        const previous = settings.get("MCP_TRUST_PROJECT_CONFIG");
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p0-review-"));
        const marker = path.join(workspace, "spawned.txt");

        const serverFile = path.join(workspace, "server.js");

        fs.writeFileSync(
            serverFile,
            `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");\n` +
            "process.stdin.resume();\n"
        );

        fs.writeFileSync(
            path.join(workspace, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    repo_stdio: { command: process.execPath, args: [serverFile] }
                }
            })
        );

        const manager = new McpManager(workspace);
        const previousEnabled = settings.get("MCP_ENABLED");

        try {

            settings.set("MCP_TRUST_PROJECT_CONFIG", false);
            settings.set("MCP_ENABLED", true);

            assert.ok(
                manager.client("repo_stdio"),
                "fixture broken: the repository server was not loaded from .mcp.json"
            );

            await assert.rejects(
                () => manager.call("repo_stdio", "anything", {}, {}),
                /MCP_TRUST_PROJECT_CONFIG/
            );

            await new Promise(resolve => setTimeout(resolve, 300));

            assert.equal(
                fs.existsSync(marker),
                false,
                "the repository's stdio server was started"
            );

        } finally {

            settings.set("MCP_TRUST_PROJECT_CONFIG", previous);
            settings.set("MCP_ENABLED", previousEnabled);

            await manager.shutdown().catch(() => {});

            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    const failed = results.filter(result => !result.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length) {
        process.exitCode = 1;
    }
}


setTimeout(() => {
    console.log("  FAIL global timeout (60s) reached");
    process.exit(1);
}, 60000).unref();

main().then(
    () => setTimeout(() => process.exit(process.exitCode || 0), 200).unref(),
    error => {
        console.log(`  FAIL ${error && error.stack}`);
        process.exit(1);
    }
);
