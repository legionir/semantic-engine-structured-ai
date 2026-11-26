"use strict";

/*
|--------------------------------------------------------------------------
| Hooks modules — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| The existing hooks.test.js locks the public legacy behaviour. This suite
| locks the extracted boundaries and a small deterministic runner harness.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const hooks = require(path.join(REPO, "agent", "hooks"));
const legacy = require(path.join(REPO, "agent", "hooks"));

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


function makeSettings(values = {}) {

    const defaults = {
        HOOKS_ON_FAILURE: "report",
        HOOKS_ENABLED: true,
        MAX_PARALLEL_TOOLS: 2,
        HOOK_TIMEOUT_MS: 1000,
        MAX_AGENT_DEPTH: 3
    };

    return {
        get(key) {
            return Object.prototype.hasOwnProperty.call(values, key)
                ? values[key]
                : defaults[key];
        }
    };
}


async function main() {

    await test("named hook modules exist and do not depend on agent.js", async () => {

        const required = [
            "HookRegistry.js",
            "HookLoader.js",
            "HookCondition.js",
            "HookRenderer.js",
            "HookRunner.js",
            "HookResult.js",
            "index.js"
        ];

        for (const name of required) {
            assert.equal(
                fs.existsSync(path.join(REPO, "agent", "hooks", name)),
                true,
                `missing ${name}`
            );
        }

        for (const name of required) {

            const source =
                fs.readFileSync(path.join(REPO, "agent", "hooks", name), "utf8");

            assert.doesNotMatch(
                source,
                /require\(["'][^"']*agent\.js["']\)/,
                `${name} must not require agent.js`
            );
        }
    });


    await test("the legacy hooks facade is the extracted registry facade", async () => {

        assert.equal(legacy.HookRegistry, hooks.HookRegistry);
        assert.equal(legacy.HookLoader, hooks.HookLoader);
        assert.equal(legacy.HookRunner, hooks.HookRunner);
        assert.equal(legacy.HookResult, hooks.HookResult);
        assert.equal(legacy.load, hooks.load);
        assert.equal(legacy.enabledHooks, hooks.enabledHooks);
        assert.equal(legacy.routine, hooks.routine);
    });


    await test("HookCondition keeps the closed boolean language", async () => {

        const context = {
            repository: { dirty: true },
            files_changed: ["src/a.js"],
            plan: { complete: false },
            hooks: { verify: { ok: true } }
        };

        assert.equal(
            hooks.HookCondition.evaluateWhen(
                "repository.dirty && files_changed && hooks.verify.ok && !plan.complete",
                context
            ),
            true
        );

        assert.equal(
            hooks.HookCondition.evaluateWhen(
                "repository.dirty && plan.complete",
                context
            ),
            false
        );

        assert.throws(
            () => hooks.HookCondition.assertCondition(
                "process.env.SECRET",
                "after_task[0]"
            ),
            /unsupported condition/
        );
    });


    await test("HookRenderer preserves exact types and safe nested templates", async () => {

        const context = {
            task: "verify",
            files_changed: ["a.js", "b.js"],
            hooks: { verify: { ok: true, summary: "passed" } }
        };

        assert.deepEqual(
            hooks.HookRenderer.render("${files_changed}", context),
            ["a.js", "b.js"]
        );
        assert.equal(
            hooks.HookRenderer.render(
                "${task}: ${hooks.verify.summary} (${files_changed})",
                context
            ),
            "verify: passed (a.js, b.js)"
        );
        assert.throws(
            () => hooks.HookRenderer.render("${missing.value}", context),
            /template reference is unavailable/
        );
    });


    await test("HookLoader merges project overrides and invalidates on file changes", async () => {

        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phase22-loader-"));
        const registryPath = path.join(directory, "hooks.json");
        const toolsPath = path.join(directory, "tools.json");
        const agentsPath = path.join(directory, "agents.json");
        const projectPath = path.join(directory, "project.json");

        fs.writeFileSync(
            registryPath,
            JSON.stringify({
                version: "1",
                before_task: [{ id: "base", type: "tool", tool: "fs_read" }],
                after_task: []
            })
        );
        fs.writeFileSync(
            toolsPath,
            JSON.stringify([{ type: "function", function: { name: "fs_read" } }])
        );
        fs.writeFileSync(
            agentsPath,
            JSON.stringify([{ name: "testing" }])
        );
        fs.writeFileSync(
            projectPath,
            JSON.stringify({
                hooks: {
                    before_task: [{ id: "override", type: "tool", tool: "fs_read" }]
                }
            })
        );

        const loader = new hooks.HookLoader({
            settingsStore: makeSettings(),
            projectProfile: {
                projectPath: () => projectPath,
                loadProject: () => JSON.parse(fs.readFileSync(projectPath, "utf8"))
            },
            registryPath,
            toolsPath,
            agentsPath
        });

        const first = loader.load();
        assert.equal(first.before_task[0].id, "override");
        assert.equal(loader.load(), first);

        fs.writeFileSync(
            projectPath,
            JSON.stringify({
                hooks: {
                    before_task: [{ id: "override_again", type: "tool", tool: "fs_read" }]
                }
            })
        );

        const second = loader.load();
        assert.equal(second.before_task[0].id, "override_again");
        assert.notEqual(second, first);

        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });


    await test("HookRegistry validates hook graph references and project-wide ids", async () => {

        const registry = new hooks.HookRegistry({
            settingsStore: makeSettings(),
            loader: {
                toolNames: () => new Set(["fs_read"]),
                agentNames: () => new Set(["testing"]),
                load: validate => validate({
                    version: "1",
                    before_task: [],
                    after_task: []
                })
            }
        });

        const config = registry.validateConfig({
            before_task: [
                { id: "prepare", type: "tool", tool: "fs_read" }
            ],
            after_task: [
                {
                    id: "verify",
                    type: "agent",
                    agent: "testing",
                    task: "verify ${hooks.prepare.ok}"
                }
            ]
        });

        /* Cross-phase references are context dependencies, not same-phase
           graph edges, so the after hook remains schedulable. */
        assert.deepEqual(config.after_task[0].depends_on, []);

        assert.throws(
            () => registry.validateConfig({
                before_task: [{ id: "same", type: "tool", tool: "fs_read" }],
                after_task: [{ id: "same", type: "tool", tool: "fs_read" }]
            }),
            /unique across all phases/
        );
    });


    await test("HookResult centralizes stable result and report shapes", async () => {

        const hook = {
            id: "verify",
            type: "tool",
            phase: "after_task",
            when: "always",
            on_failure: "report"
        };

        const done = hooks.HookResult.completedResult(hook, "passed", 4);
        const failed = hooks.HookResult.failedResult(hook, new Error("nope"), 5);
        const skipped = hooks.HookResult.skippedResult(hook, 1);

        assert.equal(done.status, "done");
        assert.equal(done.summary, "passed");
        assert.equal(failed.status, "failed");
        assert.equal(failed.error, "nope");
        assert.equal(skipped.skipped, true);
        assert.match(
            hooks.HookResult.hookReportText({ results: [done, failed, skipped] }),
            /verify: ok — passed/
        );
    });


    await test("HookRunner executes through injected graph and emits lifecycle events", async () => {

        const run = {
            task: "verify",
            hook_results: {},
            inHook: false,
            controller: null,
            cancelled_reason: null,
            after_hooks_ran: false,
            main_agent_definition: { name: "main_agent" }
        };
        const emitted = [];
        const hook = {
            id: "verify",
            type: "tool",
            phase: "before_task",
            when: "always",
            on_failure: "report",
            arguments: { path: "README.md" },
            tool: "fs_read",
            depends_on: []
        };

        const registry = {
            enabledHooks: () => [hook],
            evaluateWhen: () => true,
            render: value => value
        };
        const runner = new hooks.HookRunner({
            settings: makeSettings(),
            registry,
            events: { emit: (type, value) => emitted.push({ type, value }) },
            currentRun: () => run,
            assertRunActive: () => {},
            cancelRun: reason => { run.cancelled_reason = reason; },
            currentPlanSummary: () => ({ objective: "verify" }),
            detectRepository: () => ({ dirty: false }),
            toolRuntime: {
                telemetry: {
                    changedFiles: () => [],
                    changeTrackingComplete: () => true,
                    dirtyFiles: () => []
                }
            },
            executeToolGraph: async () => [{
                success: true,
                result: { content: "passed" }
            }],
            executeDependencyGraph: async ({
                items,
                executor,
                stopReason,
                skipItem
            }) => {
                const results = new Map();
                const scheduled = [];
                let stopping = null;

                for (const item of items) {

                    if (stopping) {
                        const skipped = await skipItem(item, stopping);
                        const wrapped = {
                            id: item.id,
                            success: false,
                            skipped: true,
                            result: skipped,
                            error: {
                                code: "SKIPPED",
                                message: stopping,
                                retryable: false
                            }
                        };
                        results.set(item.id, wrapped);
                        scheduled.push(wrapped);
                        continue;
                    }

                    const result = await executor(item, results);
                    const wrapped = { id: item.id, success: true, result };
                    results.set(item.id, wrapped);
                    scheduled.push(wrapped);

                    if (typeof stopReason === "function") {
                        stopping = stopReason(item, wrapped) || null;
                    }
                }

                return scheduled;
            },
            executeDelegations: async () => [],
            resolveDepthBudget: () => 1,
            toolRegistryOf: () => new Map([["fs_read", {}]]),
            mainAgentProfile: () => ({ name: "main_agent" })
        });

        const report = await runner.runHooks(
            "before_task",
            runner.executionContext(),
            run.main_agent_definition
        );

        assert.equal(report.results[0].status, "done");
        assert.equal(run.hook_results.verify.ok, true);
        assert.equal(run.inHook, false);
        assert.deepEqual(
            emitted.map(item => item.type),
            ["hook:phase:start", "hook:start", "hook:end", "hook:phase:end"]
        );
    });


    await test("HookRunner stops dependents with the real dependency graph", async () => {

        const { executeDependencyGraph } =
            require(path.join(REPO, "agent", "runtime", "ToolGraphExecutor.js"));

        const run = {
            task: "verify",
            hook_results: {},
            inHook: false,
            controller: null,
            cancelled_reason: null,
            after_hooks_ran: false,
            main_agent_definition: { name: "main_agent" }
        };

        const verify = {
            id: "verify",
            type: "tool",
            phase: "after_task",
            when: "always",
            on_failure: "stop",
            tool: "fs_read",
            arguments: { path: "README.md" },
            depends_on: []
        };
        const record = {
            id: "record",
            type: "tool",
            phase: "after_task",
            when: "always",
            on_failure: "report",
            tool: "fs_read",
            arguments: { path: "README.md" },
            depends_on: []
        };

        const emitted = [];
        const toolsCalled = [];

        const registry = {
            enabledHooks: () => [verify, record],
            evaluateWhen: () => true,
            render: value => value
        };

        const runner = new hooks.HookRunner({
            settings: makeSettings(),
            registry,
            events: { emit: (type, value) => emitted.push({ type, value }) },
            currentRun: () => run,
            assertRunActive: () => {},
            cancelRun: reason => { run.cancelled_reason = reason; },
            currentPlanSummary: () => ({ objective: "verify" }),
            detectRepository: () => ({ dirty: false }),
            toolRuntime: {
                telemetry: {
                    changedFiles: () => [],
                    changeTrackingComplete: () => true,
                    dirtyFiles: () => []
                }
            },
            executeToolGraph: async calls => {
                toolsCalled.push(calls[0].id);
                if (calls[0].id === "hook_verify") {
                    throw new Error("verify tool failed");
                }
                return [{ success: true, result: { exit_code: 0, content: "ok" } }];
            },
            executeDependencyGraph,
            executeDelegations: async () => [],
            resolveDepthBudget: () => 1,
            toolRegistryOf: () => new Map([["fs_read", {}]]),
            mainAgentProfile: () => ({ name: "main_agent" })
        });

        const report = await runner.runHooks(
            "after_task",
            runner.executionContext(),
            run.main_agent_definition
        );

        /* withStopBarriers pushed "record" into a later wave behind the stop
           hook, so once verify failed with stop, record never reached the tool. */
        assert.equal(report.stopped, true);
        assert.deepEqual(toolsCalled, ["hook_verify"]);

        const rec = run.hook_results.record;
        assert.equal(rec.skipped, true);
        assert.equal(rec.skipped_by, "on_failure_stop");

        /* the reason is surfaced in the operator report text */
        assert.match(runner.hookReportText(report), /record: skipped/);

        const skipStart = emitted.find(
            item => item.type === "hook:start" && item.value.id === "record"
        );
        assert.ok(skipStart, "a skipped hook still pairs hook:start with hook:end");
    });


    await test("a stop is run-scoped: later phases do not dispatch", async () => {

        const { executeDependencyGraph } =
            require(path.join(REPO, "agent", "runtime", "ToolGraphExecutor.js"));

        const run = {
            task: "verify",
            hook_results: {},
            inHook: false,
            controller: null,
            cancelled_reason: null,
            after_hooks_ran: false,
            main_agent_definition: { name: "main_agent" }
        };

        const before = {
            id: "guard",
            type: "tool",
            phase: "before_task",
            when: "always",
            on_failure: "stop",
            tool: "fs_read",
            arguments: { path: "README.md" },
            depends_on: []
        };
        const after = {
            id: "commit",
            type: "tool",
            phase: "after_task",
            when: "always",
            on_failure: "report",
            tool: "fs_read",
            arguments: { path: "README.md" },
            depends_on: []
        };

        const toolsCalled = [];
        const registry = {
            enabledHooks: phase => (phase === "before_task" ? [before] : [after]),
            evaluateWhen: () => true,
            render: value => value
        };

        const runner = new hooks.HookRunner({
            settings: makeSettings(),
            registry,
            events: { emit() {} },
            currentRun: () => run,
            assertRunActive: () => {},
            cancelRun: reason => { run.cancelled_reason = reason; },
            currentPlanSummary: () => ({ objective: "verify" }),
            detectRepository: () => ({ dirty: false }),
            toolRuntime: {
                telemetry: {
                    changedFiles: () => [],
                    changeTrackingComplete: () => true,
                    dirtyFiles: () => []
                }
            },
            executeToolGraph: async calls => {
                toolsCalled.push(calls[0].id);
                throw new Error("guard tool failed");
            },
            executeDependencyGraph,
            executeDelegations: async () => [],
            resolveDepthBudget: () => 1,
            toolRegistryOf: () => new Map([["fs_read", {}]]),
            mainAgentProfile: () => ({ name: "main_agent" })
        });

        const first = await runner.runHooks(
            "before_task",
            runner.executionContext(),
            run.main_agent_definition
        );
        assert.equal(first.stopped, true);
        assert.ok(run.hooks_stopped, "the stop verdict is recorded on the run");

        /* a later phase must short-circuit instead of dispatching its hooks */
        const second = await runner.runHooks(
            "after_task",
            runner.executionContext(),
            run.main_agent_definition
        );
        assert.equal(second.stopped, true);
        assert.deepEqual(toolsCalled, ["hook_guard"], "no after_task tool ran");
        assert.equal(run.hook_results.commit.skipped_by, "on_failure_stop");
    });


    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
