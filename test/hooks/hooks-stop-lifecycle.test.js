"use strict";

/*
|--------------------------------------------------------------------------
| Hooks stop lifecycle regression tests
|--------------------------------------------------------------------------
|
| on_failure: stop has three lifetimes that are easy to get wrong and were
| wrong once: inside a phase (dependents must be skipped, not raced), inside
| a run (later phases short-circuit), and across runs (the verdict belongs
| to one run and must never silence the next one). These tests lock all
| three, plus the rule that a stopped report must always be consumable by
| its two readers — AgentRun's before_task throw and applyAfterTaskHooks.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const { HookRunner } = require(path.join(REPO, "agent", "hooks", "HookRunner.js"));
const { executeDependencyGraph } =
    require(path.join(REPO, "agent", "runtime", "ToolGraphExecutor.js"));

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


function hook(id, phase, onFailure, dependsOn = []) {

    return {
        id,
        type: "tool",
        phase,
        when: "always",
        enabled: true,
        on_failure: onFailure,
        tool: "fs_read",
        arguments: { path: "README.md" },
        depends_on: dependsOn
    };
}


function freshRun() {

    return {
        task: "verify",
        hook_results: {},
        inHook: false,
        controller: null,
        cancelled_reason: null,
        hooks_stopped: null,
        hooks_stopped_by: null,
        after_hooks_ran: false,
        main_agent_definition: { name: "main_agent" }
    };
}


/*
| A runner whose every declared hook fails at the tool, so a stop verdict is
| produced by the real executeOneHook path rather than a stubbed one.
*/
function makeRunner({ run, declarations, toolsCalled, emitted }) {

    return new HookRunner({
        settings: makeSettings(),
        registry: {
            enabledHooks: phase => declarations.filter(item => item.phase === phase),
            evaluateWhen: () => true,
            render: value => value
        },
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
            throw new Error(`hook ${calls[0].id} failed`);
        },
        executeDependencyGraph,
        executeDelegations: async () => [],
        resolveDepthBudget: () => 1,
        toolRegistryOf: () => new Map([["fs_read", {}]]),
        mainAgentProfile: () => ({ name: "main_agent" })
    });
}


async function main() {

    /* ------------------------------------------------------------------ */
    /* I-1: the clean-slate reset covers what the runner writes            */
    /* ------------------------------------------------------------------ */

    await test("startRun() resets every run-scoped field HookRunner writes", () => {

        const written = new Set(
            [...fs.readFileSync(
                path.join(REPO, "agent", "hooks", "HookRunner.js"), "utf8"
            ).matchAll(/currentRun\(\)\.([a-z_]+)(?:\[[^\]]*\])?\s*=/g)].map(m => m[1])
        );

        /* the runtime's composition root and its ./host modules */
        const runtimeSource = [
            path.join(REPO, "agent", "agent.js"),
            ...fs.readdirSync(path.join(REPO, "agent", "host"))
                .filter(name => name.endsWith(".js"))
                .sort()
                .map(name => path.join(REPO, "agent", "host", name))
        ].map(file => fs.readFileSync(file, "utf8")).join("\n");

        const reset = new Set(
            [...runtimeSource
                .matchAll(/currentRun\(\)\.([a-z_]+)(?:\[[^\]]*\])?\s*=/g)].map(m => m[1])
        );

        /* AgentRun assigns project/id after startRun on purpose; anything
           else that a hook writes must be part of the clean slate. */
        const carriedAfterStart = ["id", "project", "carried", "started_at", "task"];

        assert.deepEqual(
            [...written].filter(field =>
                !reset.has(field) && !carriedAfterStart.includes(field)
            ),
            [],
            "a run-scoped field is written by HookRunner but never reset by startRun()"
        );

        /* and the legacy global RUN declares the verdict up front, so a
           fresh process starts with an explicit null rather than undefined */
        const runLiteral = fs
            .readFileSync(path.join(REPO, "agent", "host", "run-lifecycle.js"), "utf8")
            .match(/const RUN = \{[\s\S]*?\n {4}\};/)[0];

        assert.ok(
            runLiteral.includes("hooks_stopped: null"),
            "RUN must declare hooks_stopped"
        );
        assert.ok(
            runLiteral.includes("hooks_stopped_by: null"),
            "RUN must declare hooks_stopped_by"
        );
    });


    await test("the modular run context exposes the same verdict fields", () => {

        const AgentRunContext = require(path.join(REPO, "agent", "runtime", "AgentRunContext.js"));
        const context = new AgentRunContext({ runId: "run-x" });

        assert.equal(context.hooks_stopped, null);
        assert.equal(context.hooks_stopped_by, null);

        context.hooks_stopped = "hook guard failed with on_failure: stop";
        context.hooks_stopped_by = "guard";

        assert.equal(context.hooksStopped, "hook guard failed with on_failure: stop");
        assert.equal(context.hooksStoppedBy, "guard");
    });


    /* ------------------------------------------------------------------ */
    /* I-2: a stopped report is always consumable                          */
    /* ------------------------------------------------------------------ */

    await test("a short-circuited phase names its own stop cause", async () => {

        const run = freshRun();
        const toolsCalled = [];
        const emitted = [];

        const runner = makeRunner({
            run,
            toolsCalled,
            emitted,
            declarations: [
                hook("guard", "before_task", "stop"),
                hook("commit", "after_task", "report")
            ]
        });

        const first = await runner.runHooks("before_task", runner.executionContext());

        assert.equal(first.stopped, true);
        assert.equal(first.stopped_by, "guard");
        assert.match(first.stop_reason, /hook guard failed with on_failure: stop/);

        const second = await runner.runHooks("after_task", runner.executionContext());

        assert.equal(second.stopped, true, "the later phase still reports the stop");
        assert.equal(second.stopped_by, "guard", "and says which hook caused it");
        assert.equal(second.stop_reason, run.hooks_stopped);
        assert.deepEqual(
            second.results.map(item => item.status),
            ["skipped"],
            "a short-circuited phase has no failed entry to find"
        );

        const phaseEnd = emitted.filter(item => item.type === "hook:phase:end").pop();
        assert.equal(phaseEnd.value.stopped_by, "guard");
        assert.match(phaseEnd.value.reason, /on_failure: stop/);
    });


    await test("applyAfterTaskHooks turns an earlier-phase stop into HOOK_FAILED", async () => {

        const run = freshRun();
        const toolsCalled = [];

        const runner = makeRunner({
            run,
            toolsCalled,
            emitted: [],
            declarations: [
                hook("guard", "before_task", "stop"),
                hook("commit", "after_task", "report")
            ]
        });

        await runner.runHooks("before_task", runner.executionContext());

        const finalized = await runner.applyAfterTaskHooks(
            {
                version: "1.0",
                action: "final",
                response: { type: "text", content: "done" }
            },
            null
        );

        assert.equal(finalized.action.error.code, "HOOK_FAILED");
        assert.match(finalized.action.error.message, /Required before_task hook "guard" failed/);
        assert.deepEqual(toolsCalled, ["hook_guard"], "no after_task tool ran");
    });


    await test("a stop with no failed entry still produces a message, not a crash", async () => {

        const run = freshRun();

        /* the exact shape that used to crash: the verdict leaked in from a
           previous phase, so hook_results holds only skipped envelopes */
        run.hooks_stopped = "hook guard failed with on_failure: stop";
        run.hooks_stopped_by = "guard";

        const runner = makeRunner({
            run,
            toolsCalled: [],
            emitted: [],
            declarations: [hook("commit", "after_task", "report")]
        });

        const report = await runner.runHooks("after_task", runner.executionContext());
        const failed = report.results.find(
            item => item.status === "failed" && item.on_failure === "stop"
        );

        assert.equal(failed, undefined, "the phase really has no failed entry");
        assert.equal(report.stopped_by, "guard", "and the report still names the cause");

        const finalized = await runner.applyAfterTaskHooks(
            { version: "1.0", action: "final", response: { type: "text", content: "done" } },
            null
        );

        /* a verdict that leaked from a phase with no failed envelope of its
           own must still say what stopped the run — never a dereference of
           a missing entry */
        assert.match(
            finalized.action.error.message,
            /stopped: hook guard failed with on_failure: stop/
        );
        assert.equal(finalized.action.error.code, "HOOK_FAILED");
    });


    /* ------------------------------------------------------------------ */
    /* I-4: barrier edges must never close a cycle                         */
    /* ------------------------------------------------------------------ */

    await test("a stop hook that depends on a later hook does not create a cycle", () => {

        const runner = new HookRunner({ settings: makeSettings() });

        const scheduled = runner.withStopBarriers([
            hook("guard", "after_task", "stop", ["record"]),
            hook("record", "after_task", "report")
        ]);

        const edges = scheduled.map(item => `${item.id} -> [${item.depends_on.join(", ")}]`);

        assert.deepEqual(
            edges,
            ["guard -> [record]", "record -> []"],
            `the implicit barrier closed a cycle: ${edges.join(" | ")}`
        );
    });


    await test("barriers still gate plain dependents of a stop hook", () => {

        const runner = new HookRunner({ settings: makeSettings() });

        const scheduled = runner.withStopBarriers([
            hook("guard", "after_task", "stop"),
            hook("record", "after_task", "report"),
            hook("publish", "after_task", "report")
        ]);

        assert.deepEqual(scheduled[0].depends_on, []);
        assert.deepEqual(scheduled[1].depends_on, ["guard"]);
        assert.deepEqual(scheduled[2].depends_on, ["guard"]);
    });


    await test("the scheduler rejects a dependency cycle before dispatching", async () => {

        const started = [];

        await assert.rejects(
            () => executeDependencyGraph({
                items: [
                    { id: "a", depends_on: ["b"] },
                    { id: "b", depends_on: ["a"] }
                ],
                maxParallel: 2,
                executor: async item => { started.push(item.id); return {}; }
            }),
            /cycle/i
        );

        assert.deepEqual(started, [], "a cyclic graph must never start executing");
    });


    await test("a synchronous throw in an executor does not wedge the loop", async () => {

        /* The trap the slot reservation closes: the settled promise stays in
           inFlight, so with nothing left to run the loop races it forever.
           A timeout turns that hang into a readable failure. */
        const executed = [];

        const within = promise =>
            Promise.race([
                promise,
                new Promise((resolve, reject) => setTimeout(
                    () => reject(new Error("the scheduler loop wedged")),
                    2000
                ))
            ]);

        const settled = await within(executeDependencyGraph({
            items: [
                { id: "boom", depends_on: [] },
                { id: "after", depends_on: [] }
            ],
            maxParallel: 2,
            executor: item => {
                executed.push(item.id);
                if (item.id === "boom") {
                    throw new Error("sync executor threw");
                }
                return { ok: true };
            }
        }));

        assert.deepEqual(executed.sort(), ["after", "boom"]);
        assert.equal(settled[0].success, false);
        assert.equal(settled[0].error.code, "Error");
        assert.equal(settled[1].success, true);

        /* and the single-item shape, where nothing else keeps the loop busy */
        const alone = await within(executeDependencyGraph({
            items: [{ id: "only", depends_on: [] }],
            maxParallel: 2,
            executor: () => { throw new Error("sync throw"); }
        }));

        assert.equal(alone[0].success, false, "the graph still terminates");
    });


    /* ------------------------------------------------------------------ */
    /* I-1 end to end: the same process, two runs                          */
    /* ------------------------------------------------------------------ */

    await test("a stop verdict does not silence the next run in the same process", async () => {

        require(path.join(REPO, "agent", "agent.js"));
        const { host } = require(path.join(REPO, "agent", "runtime", "engineContext.js"));
        const runtime = host();
        const hookModule = require(path.join(REPO, "agent", "hooks"));

        const guard = hook("guard", "before_task", "stop");
        const commit = hook("commit", "after_task", "report");
        const original = hookModule.enabledHooks;

        /* the tool must really fail, or there is no verdict to leak */
        for (const declaration of [guard, commit]) {
            declaration.arguments = { path: "__never_written__.md" };
        }

        hookModule.enabledHooks = phase =>
            phase === "before_task" ? [guard] : [commit];

        try {
            runtime.startRun();
            const run = runtime.currentRun();

            const firstBefore = await runtime.runHooks(
                "before_task",
                runtime.hookExecutionContext()
            );

            assert.equal(firstBefore.stopped, true);
            assert.equal(firstBefore.stopped_by, "guard");
            assert.ok(run.hooks_stopped, "the verdict is recorded for this run");

            runtime.startRun();

            assert.equal(
                runtime.currentRun().hooks_stopped,
                null,
                "startRun() must clear the verdict: a stop is one run's decision"
            );
            assert.equal(runtime.currentRun().hooks_stopped_by, null);

            const secondBefore = await runtime.runHooks(
                "before_task",
                runtime.hookExecutionContext()
            );

            assert.equal(
                secondBefore.results[0].status,
                "failed",
                "the new run must dispatch its hook, not skip it"
            );
            assert.equal(secondBefore.stopped_by, "guard");
        } finally {
            hookModule.enabledHooks = original;
            runtime.startRun();
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
