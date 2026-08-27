"use strict";

/*
|--------------------------------------------------------------------------
| Runtime Engine — EXECUTION_PLAN Phase 16
|--------------------------------------------------------------------------
|
| Locks the extracted loop against the historical engine: wrappers stay
| in agent.js, both RUNTIME_ENGINE_MODE values run the same extracted
| modules (a move, not a fork), a misspelled flag behaves as legacy, and
| a normalized delegation scenario is equal in both modes.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase16-engine-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_RUN_MS = "15000";
process.env.MAX_REQUEST_MS = "10000";
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";

const REPO = path.resolve(__dirname, "..", "..");
const { normalize } = require(path.join(REPO, "test", "helpers", "normalize.js"));

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


function finalAction(content) {

    return {
        version: "1.0",
        tool_calls: null,
        delegations: null,
        response: { type: "text", content },
        data: null,
        error: null,
        action: "final",
        performed: null
    };

}


function toolCall(calls) {

    return {
        version: "1.0",
        action: "tool_call",
        tool_calls: calls,
        delegations: null,
        response: null,
        data: null,
        error: null,
        performed: null
    };

}


function delegateAction(delegations) {

    return {
        version: "1.0",
        action: "delegate",
        tool_calls: null,
        delegations,
        response: null,
        data: null,
        error: null,
        performed: null
    };

}


function envelope(structured) {

    return {
        choices: [
            {
                message: {
                    role: "assistant",
                    content: JSON.stringify(structured)
                }
            }
        ]
    };

}


function stripVolatile(value) {

    if (Array.isArray(value)) {
        return value.map(stripVolatile);
    }

    if (value && typeof value === "object") {

        const out = {};

        for (const key of Object.keys(value)) {

            if (key === "project_id" || key === "graph_id") {
                continue;
            }

            out[key] = stripVolatile(value[key]);

        }

        return out;

    }

    return value;

}


function comparable(captured) {

    return captured.map(event =>
        normalize(stripVolatile(event), { workspace: WORKSPACE })
    );

}


async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const events = require(path.join(REPO, "agent", "lib", "events.js"));
    const settings = runtime.settings;
    const engineDir = path.join(REPO, "agent", "runtime");


    await test("RUNTIME_ENGINE_MODE defaults to legacy and a misspelling stays legacy", async () => {

        assert.equal(settings.get("RUNTIME_ENGINE_MODE"), "legacy");
        assert.equal(runtime.runtimeEngineMode(), "legacy");
        assert.equal(settings.definitionOf("RUNTIME_ENGINE_MODE").default, "legacy");

        settings.set("RUNTIME_ENGINE_MODE", "moduler");

        assert.equal(runtime.runtimeEngineMode(), "legacy");

        settings.set("RUNTIME_ENGINE_MODE", "modular");

        assert.equal(runtime.runtimeEngineMode(), "modular");

        settings.reset("RUNTIME_ENGINE_MODE");

        assert.equal(runtime.runtimeEngineMode(), "legacy");

    });


    await test("named Phase 16 modules exist and agent.js keeps historical wrappers", async () => {

        for (const name of [
            "AgentRun.js",
            "IterationRunner.js",
            "ActionProcessor.js",
            "ToolGraphExecutor.js",
            "DelegationRunner.js",
            "RetryController.js",
            "RunState.js",
            "ReportVerifier.js",
            "engineContext.js",
            "engine.js"
        ]) {

            assert.equal(
                fs.existsSync(path.join(engineDir, name)),
                true,
                `missing ${name}`
            );

        }

        assert.equal(typeof runtime.runtimeEngine, "object");
        assert.equal(typeof runtime.runtimeEngine.bind, "function");
        assert.equal(typeof runtime.runtimeEngine.runAgentCore, "function");
        assert.equal(typeof runtime.runtimeEngine.processAction, "function");

        for (const name of [
            "callAI",
            "executeDependencyGraph",
            "normalizeToolCalls",
            "resolveArgumentReferences",
            "appendToolConversation",
            "validateDelegationPolicy",
            "resolveDepthBudget",
            "checkPerformedClaim",
            "isUnfinishedFinal",
            "trackRepeatedFailure"
        ]) {

            assert.equal(typeof runtime[name], "function", `missing wrapper ${name}`);
            assert.equal(
                typeof runtime.runtimeEngine[name],
                "function",
                `missing kit export ${name}`
            );
            assert.notEqual(
                runtime[name],
                runtime.runtimeEngine[name],
                `${name} should stay a facade wrapper (Phase 16 / law 7)`
            );

        }

    });


    await test("the runtime engine has no require cycle back to agent.js", async () => {

        const names = fs.readdirSync(engineDir);

        for (const name of names) {

            if (!name.endsWith(".js")) {
                continue;
            }

            const body = fs.readFileSync(path.join(engineDir, name), "utf8");

            assert.equal(
                /require\(["']\.\.\/agent(?:\.js)?["']\)/.test(body),
                false,
                `${name} requires agent.js`
            );

        }

    });


    const stub = {
        handler: null,
        server: null
    };

    stub.server = http.createServer((req, res) => {

        let body = "";

        req.on("data", chunk => {
            body += chunk;
        });

        req.on("end", () => {

            const parsed = JSON.parse(body);

            const reply =
                stub.handler
                    ? stub.handler(parsed)
                    : envelope(finalAction("done"));

            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(reply));

        });

    });

    await new Promise(resolve => stub.server.listen(0, "127.0.0.1", resolve));

    settings.set(
        "AGENT_BASE_URL",
        `http://127.0.0.1:${stub.server.address().port}/v1`
    );
    settings.set("AGENT_MODEL", "stub-model");
    settings.set("AGENT_VERBOSE", false);


    async function captureRun(task, mode) {

        settings.set("RUNTIME_ENGINE_MODE", mode);

        const captured = [];
        const listen = event => captured.push(event);

        events.bus.on("event", listen);

        let outcome;

        try {

            outcome = await runtime.runAgent({ task });

        } finally {

            events.bus.off("event", listen);
            settings.reset("RUNTIME_ENGINE_MODE");

        }

        return { outcome, captured };

    }


    await test("legacy and modular produce equal normalized events for a tool then final", async () => {

        stub.handler = parsed => {

            const hasTool =
                parsed.messages.some(message => message.role === "tool");

            if (!hasTool) {

                return envelope(toolCall([
                    {
                        id: "list_root",
                        name: "fs_list",
                        arguments: { path: "." },
                        depends_on: []
                    }
                ]));

            }

            return envelope(finalAction("listed the workspace"));

        };

        await runtime.runAgent({ task: "warm-up listing" });

        const legacy = await captureRun("list the workspace", "legacy");
        const modular = await captureRun("list the workspace", "modular");

        assert.match(
            legacy.outcome.response.content,
            /listed the workspace/
        );
        assert.match(
            modular.outcome.response.content,
            /listed the workspace/
        );

        assert.deepStrictEqual(
            comparable(modular.captured),
            comparable(legacy.captured),
            "modular tool/final run does not reproduce the normalized legacy events"
        );

    });


    await test("normalized delegation scenario is equal in both flag modes", async () => {

        stub.handler = parsed => {

            const isSub =
                parsed.messages.some(
                    message =>
                        typeof message.content === "string" &&
                        message.content.includes("agent_profile")
                );

            if (isSub) {

                const answered =
                    parsed.messages.some(message => message.role === "tool");

                if (!answered) {

                    return envelope(toolCall([
                        {
                            id: "status",
                            name: "git_status",
                            arguments: { cwd: "." },
                            depends_on: []
                        }
                    ]));

                }

                return envelope(finalAction("repository inspected"));

            }

            const delegated =
                parsed.messages.some(
                    message =>
                        typeof message.content === "string" &&
                        message.content.includes("sub_agent_results")
                );

            if (delegated) {

                return envelope(finalAction("aggregated git report"));

            }

            return envelope(delegateAction([
                {
                    id: "task_1",
                    agent: "git_analysis",
                    persona: null,
                    skills: null,
                    tools: null,
                    task: "inspect the repository",
                    depends_on: []
                }
            ]));

        };

        await runtime.runAgent({ task: "warm-up delegation" });

        const legacy = await captureRun("delegate a git inspection", "legacy");
        const modular = await captureRun("delegate a git inspection", "modular");

        assert.match(
            legacy.outcome.response.content,
            /aggregated git report/
        );
        assert.match(
            modular.outcome.response.content,
            /aggregated git report/
        );

        const types = event => event.type;

        assert.ok(
            legacy.captured.some(event => event.type === "delegation:start")
        );
        assert.ok(
            legacy.captured.some(event => event.type === "delegation:end")
        );
        assert.ok(
            legacy.captured.some(event => event.type === "agent:start")
        );

        assert.deepStrictEqual(
            comparable(modular.captured),
            comparable(legacy.captured),
            "modular delegation does not reproduce the normalized legacy events"
        );

        assert.deepStrictEqual(
            modular.captured.map(types),
            legacy.captured.map(types)
        );

    });


    settings.reset("AGENT_BASE_URL");
    settings.reset("AGENT_MODEL");
    settings.reset("AGENT_VERBOSE");
    settings.reset("RUNTIME_ENGINE_MODE");

    await new Promise(resolve => stub.server.close(resolve));

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
