"use strict";

/*
|--------------------------------------------------------------------------
| Tools / Tool Registry — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
|
| Locks the extracted tool groups against the historical modules:
| wrappers stay facades, there is no require cycle back to agent.js,
| names/schemas stay in parity with the Phase 14 loader, executeTool
| keeps the Phase 4 signature, and SemanticClient is shared with Phase 6.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase19-tools-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.PROCESS_SANDBOX_MODE = "test";

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
        console.log(`       ${error.message}`);

    }

}


function walkJs(directory, visit) {

    const names = fs.readdirSync(directory);

    for (const name of names) {

        const full = path.join(directory, name);

        if (fs.statSync(full).isDirectory()) {

            walkJs(full, visit);
            continue;

        }

        if (name.endsWith(".js")) {
            visit(full);
        }

    }

}


async function main() {

    const toolsDir = path.join(REPO, "agent", "tools");
    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const tools = require(path.join(REPO, "agent", "tools"));
    const toolRuntime = require(path.join(toolsDir, "ToolRuntime.js"));
    const adapter = require(path.join(toolsDir, "ToolRegistryAdapter.js"));
    const loader = require(path.join(REPO, "agent", "registry", "RegistryLoader.js"));
    const settings = require(path.join(REPO, "agent", "lib", "storage.js"));


    await test("named Phase 19 modules exist", async () => {

        const required = [
            "ToolRuntime.js",
            "ToolRegistryAdapter.js",
            "index.js",
            path.join("filesystem", "PathBoundary.js"),
            path.join("filesystem", "ReadTools.js"),
            path.join("filesystem", "WriteTools.js"),
            path.join("filesystem", "DirectoryTools.js"),
            path.join("filesystem", "FileMetadataTools.js"),
            path.join("filesystem", "index.js"),
            path.join("process", "ProcessManager.js"),
            path.join("process", "ForegroundCommand.js"),
            path.join("process", "BackgroundSession.js"),
            path.join("process", "index.js"),
            path.join("code", "SemanticClient.js"),
            path.join("code", "SemanticTools.js"),
            path.join("code", "LiveLspTools.js"),
            path.join("code", "IndexSessions.js"),
            path.join("code", "index.js"),
            path.join("planning", "PlanModel.js"),
            path.join("planning", "PlanRepository.js"),
            path.join("planning", "PlanTools.js"),
            path.join("planning", "index.js"),
            path.join("memory", "MemoryTools.js"),
            path.join("memory", "ArchiveTools.js"),
            path.join("memory", "index.js")
        ];

        for (const name of required) {

            assert.equal(
                fs.existsSync(path.join(toolsDir, name)),
                true,
                `missing agent/tools/${name}`
            );

        }

    });


    await test("legacy wrappers stay facades over the extracted groups", async () => {

        assert.equal(
            require(path.join(toolsDir, "filesystem.js")),
            require(path.join(toolsDir, "filesystem", "index.js"))
        );

        assert.equal(
            require(path.join(toolsDir, "process.js")),
            require(path.join(toolsDir, "process", "index.js"))
        );

        assert.equal(
            require(path.join(toolsDir, "code.js")),
            require(path.join(toolsDir, "code", "index.js"))
        );

        assert.equal(
            require(path.join(toolsDir, "plan.js")),
            require(path.join(toolsDir, "planning", "index.js"))
        );

        assert.equal(
            require(path.join(toolsDir, "memory.js")),
            require(path.join(toolsDir, "memory", "index.js"))
        );

        const fileinfo = require(path.join(toolsDir, "fileinfo.js"));
        const meta = require(path.join(toolsDir, "filesystem", "FileMetadataTools.js"));

        assert.equal(fileinfo.fs_info, meta.fs_info);
        assert.equal(typeof fileinfo.fs_info, "function");

        assert.equal(tools.executeTool, toolRuntime.executeTool);
        assert.equal(tools.hasTool, toolRuntime.hasTool);
        assert.equal(tools.implementedToolNames, toolRuntime.implementedToolNames);
        assert.equal(tools.callableToolNames, toolRuntime.callableToolNames);
        assert.equal(tools.startRunScope, toolRuntime.startRunScope);
        assert.equal(tools.shutdown, toolRuntime.shutdown);
        assert.equal(tools.telemetry, toolRuntime.telemetry);
        assert.equal(typeof tools.ToolRegistryAdapter.assertParity, "function");

    });


    await test("the extracted Phase 19 modules have no require cycle back to agent.js", async () => {

        const extracted = [
            path.join(toolsDir, "ToolRuntime.js"),
            path.join(toolsDir, "ToolRegistryAdapter.js"),
            path.join(toolsDir, "index.js"),
            path.join(toolsDir, "filesystem"),
            path.join(toolsDir, "process"),
            path.join(toolsDir, "code"),
            path.join(toolsDir, "planning"),
            path.join(toolsDir, "memory")
        ];

        const visit = full => {

            const body = fs.readFileSync(full, "utf8");

            assert.equal(
                /require\(["']\.\.\/agent(?:\.js)?["']\)/.test(body),
                false,
                `${path.relative(REPO, full)} requires agent.js`
            );

        };

        for (const target of extracted) {

            if (fs.statSync(target).isDirectory()) {
                walkJs(target, visit);
            } else {
                visit(target);
            }

        }

    });


    await test("executeTool keeps the Phase 4 signature and result cap", async () => {

        assert.equal(typeof tools.executeTool, "function");
        assert.equal(tools.executeTool.length, 2);

        const written = await tools.executeTool(
            "fs_write",
            { path: "phase19.txt", content: "hello phase 19\n" },
            { agent: "test" }
        );

        assert.equal(written.created, true);

        const read = await tools.executeTool(
            "fs_read",
            { path: "phase19.txt" },
            { agent: "test" }
        );

        assert.match(read.content, /hello phase 19/);

        await assert.rejects(
            () => tools.executeTool(
                "fs_read",
                { path: "../../etc/passwd" },
                { agent: "test" }
            ),
            /outside workspace/
        );

        await assert.rejects(
            () => tools.executeTool(
                "fs_read",
                { path: "phase19.txt", projectId: "forged" },
                { agent: "test" }
            ),
            /rule 9/
        );

    });


    await test("registry schemas, runtime implementations and the adapter agree", async () => {

        const fromFile =
            require(path.join(REPO, "agent", "registry", "tools.json"))
                .map(item => item.function.name);

        const fromLoader = loader.loadToolSchemas().map(item => item.function.name);
        const fromAdapter = adapter.declaredNames();
        const implemented = tools.implementedToolNames();

        assert.deepEqual(fromLoader, fromFile);
        assert.deepEqual(fromAdapter, fromFile);
        assert.deepEqual(implemented, [...implemented].sort());

        assert.deepEqual(
            fromFile.filter(name => !implemented.includes(name)),
            []
        );

        assert.deepEqual(
            implemented.filter(name => !fromFile.includes(name)),
            []
        );

        const report = adapter.parity();

        assert.equal(report.equal, true);
        assert.deepEqual(report.missing, []);
        assert.deepEqual(report.extra, []);
        assert.equal(adapter.assertParity(), true);

        adapter.validateAgainst({
            tools: require(path.join(REPO, "agent", "registry", "tools.json")),
            groups: require(path.join(REPO, "agent", "registry", "tool_groups.json")),
            skills: require(path.join(REPO, "agent", "registry", "skills.json")),
            agents: require(path.join(REPO, "agent", "registry", "agents.json")),
            personas: require(path.join(REPO, "agent", "registry", "personas.json")),
            policy: require(path.join(REPO, "agent", "registry", "policy.json"))
        });

        runtime.validateRegistries();

    });


    await test("SemanticClient is shared with Phase 6 and index sessions stay on the engine", async () => {

        const groupClient = require(path.join(toolsDir, "code", "SemanticClient.js"));
        const phase6Client = require(path.join(REPO, "agent", "mcp", "SemanticClient.js"));

        assert.equal(groupClient, phase6Client);
        assert.equal(typeof groupClient, "function");

        const codeTools = require(path.join(toolsDir, "code.js"));

        assert.equal(typeof codeTools._shutdown, "function");
        assert.equal(typeof codeTools._startRunScope, "function");

        const scope = codeTools._startRunScope(undefined);

        assert.ok(scope === undefined || typeof scope === "object");

        const processTools = require(path.join(toolsDir, "process.js"));

        assert.ok(processTools._sessions instanceof Map);
        assert.equal(typeof processTools.shutdownAll, "function");

        const planTools = require(path.join(toolsDir, "plan.js"));

        assert.equal(typeof planTools._loadPlan, "function");
        assert.equal(typeof planTools._summarise, "function");
        assert.equal(typeof planTools._normaliseUpdateArguments, "function");
        assert.equal(typeof planTools._planPath, "string");

    });


    await test("PathBoundary and process group keep the previous security helpers", async () => {

        const PathBoundary = require(path.join(toolsDir, "filesystem", "PathBoundary.js"));
        const ProcessManager = require(path.join(toolsDir, "process", "ProcessManager.js"));

        assert.equal(typeof PathBoundary.bound, "function");
        assert.equal(typeof PathBoundary.looksBinary, "function");
        assert.equal(typeof PathBoundary.statSafe, "function");
        assert.equal(typeof PathBoundary.ignoredDirectories, "function");

        const ctx = PathBoundary.bound({ agent: "test" });

        assert.equal(ctx.root, WORKSPACE);

        assert.equal(typeof ProcessManager.killTree, "function");
        assert.equal(typeof ProcessManager.spawnInGroup, "function");
        assert.equal(typeof ProcessManager.shutdownAll, "function");
        assert.equal(ProcessManager.USE_PROCESS_GROUPS, process.platform !== "win32");

    });


    await test("Phase 19 does not invent a MODE flag and schema defaults stay legacy", async () => {

        assert.equal(settings.definitionOf("PROJECT_CONTEXT_MODE").default, "legacy");
        assert.equal(settings.definitionOf("RUN_CONTEXT_MODE").default, "legacy");
        assert.equal(settings.definitionOf("PROMPT_BUILDER_MODE").default, "legacy");
        assert.equal(settings.definitionOf("SEMANTIC_POOL_MODE").default, "legacy");
        assert.equal(settings.definitionOf("RUNTIME_ENGINE_MODE").default, "legacy");

        const keys = settings.definitions.map(item => item.key);

        assert.equal(
            keys.some(key => key === "TOOL_RUNTIME_MODE" || key === "TOOLS_MODE"),
            false
        );

        walkJs(toolsDir, full => {

            const body = fs.readFileSync(full, "utf8");

            assert.equal(
                /TOOL_RUNTIME_MODE|TOOLS_MODE/.test(body),
                false,
                `${path.relative(REPO, full)} invented a MODE flag`
            );

        });

    });


    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    try {
        tools.shutdown();
    } catch {
        /* ignore */
    }

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
