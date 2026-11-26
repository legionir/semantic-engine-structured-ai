"use strict";

/*
|--------------------------------------------------------------------------
| Canonical rollout contract — EXECUTION_PLAN Phase 30
|--------------------------------------------------------------------------
|
| The final rollout is intentionally a deletion: old facades, mode switches
| and compatibility assets must not quietly return. These tests make that
| technical-debt boundary executable while the behavioral suites prove that
| the canonical implementations still serve the same product contracts.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
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

async function main() {
    await test("removed facade files are absent and canonical replacements are present", async () => {
        const removed = [
            "agent/lib",
            "agent/mcp/client.js",
            "agent/mcp/config.js",
            "agent/mcp/manager.js",
            "agent/mcp/protocol.js",
            "agent/mcp/transports/http.js",
            "agent/mcp/transports/sse.js",
            "agent/mcp/transports/stdio.js",
            "agent/mcp/transports/websocket.js",
            "agent/tools/code.js",
            "agent/tools/fileinfo.js",
            "agent/tools/filesystem.js",
            "agent/tools/git.js",
            "agent/tools/mcp.js",
            "agent/tools/memory.js",
            "agent/tools/net.js",
            "agent/tools/plan.js",
            "agent/tools/process.js",
            "agent/tools/search.js",
            "agent/tools/skills.js",
            "agent/tools/telemetry.js",
            "agent/tools/discussion.js",
            "web/server/LegacyWebServer.js",
            "web/public/app.js",
            "web/public/app/api.js",
            "web/public/app/event-stream.js",
            "web/public/app/task-runner.js",
            "web/public/app/modal-manager.js",
            "web/public/app/project-state.js",
            "test/fixtures/legacy-console",
        ];
        for (const relative of removed) {
            assert.equal(fs.existsSync(path.join(ROOT, relative)), false, `${relative} remains`);
        }

        for (const relative of [
            "agent/config/SettingsStore.js",
            "agent/context/WorkspaceBoundary.js",
            "agent/context/Memory.js",
            "agent/events/EventBus.js",
            "agent/mcp/McpConnection.js",
            "agent/mcp/McpConfig.js",
            "agent/mcp/McpManager.js",
            "agent/mcp/index.js",
            "agent/mcp/protocol/index.js",
            "agent/persistence/DataRoot.js",
            "agent/persistence/index.js",
            "agent/projects/WorkspaceProfile.js",
            "agent/runtime/Telemetry.js",
            "agent/tools/index.js",
            "web/server/ServerImplementation.js",
            "web/server/WebServer.js",
            "web/public/app/console.js",
        ]) {
            assert.equal(fs.existsSync(path.join(ROOT, relative)), true, `${relative} is missing`);
        }
    });

    await test("the six rollout flags are gone from the settings contract", async () => {
        const schema = require(path.join(ROOT, "agent", "config", "SettingsSchema"));
        for (const removed of [
            "PROJECT_CONTEXT_MODE",
            "RUN_CONTEXT_MODE",
            "PROMPT_BUILDER_MODE",
            "RUNTIME_ENGINE_MODE",
            "WEB_SERVER_MODE"
        ]) {
            assert.throws(() => schema.definitionOf(removed), /Unknown setting/);
            assert.equal(schema.DEFINITIONS.some(item => item.key === removed), false);
        }
    });

    await test("canonical public entrypoints no longer select a legacy implementation", async () => {
        const web = require(path.join(ROOT, "web", "server"));
        const webImplementation = require(path.join(ROOT, "web", "server", "WebServer"));
        const tools = require(path.join(ROOT, "agent", "tools"));
        const toolRuntime = require(path.join(ROOT, "agent", "tools", "ToolRuntime"));
        const mcp = require(path.join(ROOT, "agent", "mcp", "McpManager"));
        const config = require(path.join(ROOT, "agent", "config"));

        assert.equal(web.createServer, webImplementation.createServer);
        assert.equal(typeof webImplementation.WebServer, "function");
        assert.equal(tools.executeTool, toolRuntime.executeTool);
        assert.equal(typeof mcp.McpManager, "function");
        assert.equal(typeof config.get, "function");
        assert.equal(Object.prototype.hasOwnProperty.call(web, "webServerMode"), false);
    });

    await test("runtime source imports canonical paths and has no mode lookup", async () => {
        const sourceFiles = [];
        const walk = directory => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const full = path.join(directory, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith(".js")) sourceFiles.push(full);
            }
        };
        walk(path.join(ROOT, "agent"));
        walk(path.join(ROOT, "web"));
        walk(path.join(ROOT, "bin"));

        for (const file of sourceFiles) {
            const source = fs.readFileSync(file, "utf8");
            assert.doesNotMatch(source, /require\([^\n]*agent\/lib\//, path.relative(ROOT, file));
            assert.doesNotMatch(source, /require\([^\n]*(?:LegacyWebServer|tools\/(?:code|fileinfo|filesystem|git|memory|mcp|net|plan|process|search|skills|telemetry)\.js|mcp\/(?:client|config|manager|protocol)\.js)/, path.relative(ROOT, file));
            assert.doesNotMatch(source, /settings\.get\("(?:PROJECT_CONTEXT_MODE|RUN_CONTEXT_MODE|PROMPT_BUILDER_MODE|RUNTIME_ENGINE_MODE|WEB_SERVER_MODE)"\)/, path.relative(ROOT, file));
        }
    });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
