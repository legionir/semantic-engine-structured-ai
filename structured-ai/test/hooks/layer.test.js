"use strict";

/*
|--------------------------------------------------------------------------
| Hook layer — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| Two things are pinned here.
|
| First, the move: `agent/lib/hooks.js` is a facade over `agent/hooks`, the
| six modules are the ones the phase names, the closed condition/template
| languages are unchanged, and importing the directory must not drag in
| agent.js — that cycle is what made every hook test boot the whole runtime.
|
| Second, the behaviour that became testable only because the runner is now
| reachable: the phase order, the nesting guard, the per-phase deadline,
| `on_failure: stop`, the `hook:end` payload (one projection, not three
| copies), and the refusals that protect the commit hook. A stub host is
| enough for all of it — which is the point of the boundary.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase22-hooks-"));

process.env.WORKSPACE_ROOT = WORKSPACE;

const REPO = path.resolve(__dirname, "..", "..");

const settings = require(path.join(REPO, "agent", "lib", "storage.js"));
const project = require(path.join(REPO, "agent", "lib", "project.js"));
const events = require(path.join(REPO, "agent", "lib", "events.js"));

const hooks = require(path.join(REPO, "agent", "hooks"));

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


/*
| A hooks.json for the workspace overlay — the supported way to declare hooks
| in a test, and the same path the settings UI writes.
*/

function writeHooks(hooksByPhase) {

    fs.mkdirSync(path.dirname(project.projectPath()), { recursive: true });

    fs.writeFileSync(
        project.projectPath(),
        JSON.stringify({
            version: "1",
            settings: {},
            hooks: {
                before_task: hooksByPhase.before_task || [],
                after_task: hooksByPhase.after_task || []
            }
        })
    );

    hooks.load(true);
}


/*
| The smallest host that satisfies the runner: the real executors are replaced
| by recorders, so a test measures what the runner *asks for* rather than
| re-testing the tool graph.
*/

function stubHost(overrides = {}) {

    const calls = { toolGraph: [], delegations: [], dependency: [] };

    const run = {
        inHook: false,
        hook_phase: null,
        hook_started_at: 0,
        hook_deadline_at: null,
        hook_results: {},
        controller: null,
        cancelled_reason: null,
        files_changed: [],
        file_tracking_complete: true
    };

    const host = {
        settings,

        currentRun: () => run,

        assertRunActive: () => undefined,

        cancelRun: reason => {
            run.cancelled_reason = reason;
        },

        executeToolGraph: async (steps, allowed, agent, meta) => {
            calls.toolGraph.push({ steps, agent, meta });
            return steps.map((step, index) => (
                (overrides.toolResults && overrides.toolResults[index]) || {
                    id: step.id,
                    success: true,
                    result: { stdout: "done", exit_code: 0 }
                }
            ));
        },

        executeDelegations: async (items) => {
            calls.delegations.push(items);
            return overrides.delegationResult
                ? overrides.delegationResult()
                : [{ success: true, result: { success: true, performed: { tools: 1 }, stdout: "ok" } }];
        },

        executeDependencyGraph: async ({ items, executor }) => {
            calls.dependency.push({ count: items.length });
            const out = [];
            for (const item of items) {
                out.push({ item, result: await executor(item) });
            }
            return out;
        },

        resolveDepthBudget: () => 2,

        TOOL_REGISTRY_OF: () => new Map([["fs_list", {}], ["fs_read", {}]])
    };

    return { host, calls, run };
}


async function main() {

    /* ---------------------------------------------------------- modules */

    await test("the six modules the phase names exist, and lib/hooks.js is a facade", async () => {

        for (const file of [
            "HookRegistry.js", "HookLoader.js", "HookCondition.js",
            "HookRenderer.js", "HookRunner.js", "HookResult.js", "index.js"
        ]) {
            assert.ok(
                fs.existsSync(path.join(REPO, "agent", "hooks", file)),
                `expected agent/hooks/${file}`
            );
        }

        const wrapper =
            fs.readFileSync(path.join(REPO, "agent", "lib", "hooks.js"), "utf8");

        assert.match(wrapper, /module\.exports = require\("\.\.\/hooks\/HookRegistry"\)/);
        assert.ok(wrapper.split("\n").length < 40, "the wrapper keeps no logic of its own");

        const legacy = require(path.join(REPO, "agent", "lib", "hooks.js"));
        assert.equal(legacy.load, hooks.load, "one loader, one cache — not two");
        assert.equal(legacy.render, hooks.render);
        assert.equal(legacy.evaluateWhen, hooks.evaluateWhen);
    });


    await test("importing the hook layer does not pull in agent.js", async () => {

        const { execFileSync } = require("child_process");

        const loaded =
            execFileSync(
                process.execPath,
                [
                    "-e",
                    `require(${JSON.stringify(path.join(REPO, "agent", "hooks"))});` +
                    `process.stdout.write(Object.keys(require.cache)` +
                    `.filter(p => /[\\\\/]agent[\\\\/]agent\\.js$/.test(p)).join("|"));`
                ],
                { encoding: "utf8" }
            ).trim();

        assert.equal(loaded, "", `the runner reached back into the runtime: ${loaded}`);
    });


    await test("the condition and template languages are the ones the loader validated", async () => {

        const context = {
            task: "fix the parser",
            files_changed: ["src/a.js"],
            hooks: { verify: { ok: true, summary: "npm test passed" } }
        };

        assert.equal(hooks.evaluateWhen("always", context), true);
        assert.equal(hooks.evaluateWhen("", context), true);
        assert.equal(hooks.evaluateWhen("files_changed && !plan_complete", context), true);
        assert.equal(hooks.evaluateWhen("nope", context), false);
        /* یک الگوی تمام‌قد مقدار را برمی‌گرداند، نه رشته‌اش — git_add به
           آرایه نیاز دارد نه به "a.js, b.js". */
        assert.deepEqual(hooks.render("${files_changed}", context), ["src/a.js"]);
        assert.equal(
            hooks.render("changed: ${files_changed}", context),
            "changed: src/a.js"
        );
        /* و ارجاع بی‌نتیجه خطاست، نه رشتهٔ خالی: hookی که با مسیر تهی
           «موفق» گزارش کند، از همان اول باید بگوید نمی‌تواند کار کند. */
        assert.throws(
            () => hooks.render("${missing}", context),
            /template reference is unavailable: missing/
        );

        /* the strict half: an unresolvable reference is refused at load time */
        assert.throws(
            () => hooks.validateConfig({
                version: "1",
                before_task: [{
                    id: "bad", type: "tool", tool: "fs_list",
                    arguments: { path: "${nope.deep}" }
                }],
                after_task: []
            }),
            /nope/
        );

        /* and a tool no registry declares is refused too */
        assert.throws(
            () => hooks.validateConfig({
                version: "1",
                before_task: [{ id: "ghost", type: "tool", tool: "no_such_tool", arguments: {} }],
                after_task: []
            }),
            /unavailable tool|unknown tool|no_such_tool/
        );
    });


    /* ------------------------------------------------------------ runner */

    await test("the runner refuses to guess a host", async () => {

        /* A fresh process: nothing has been bound yet. */
        const { execFileSync } = require("child_process");

        const out =
            execFileSync(
                process.execPath,
                [
                    "-e",
                    `const h = require(${JSON.stringify(path.join(REPO, "agent", "hooks"))});` +
                    'h.HookRunner.executeOneHook(' +
                    '{ id: "x", type: "tool", tool: "fs_list", phase: "before_task", when: "always", on_failure: "report" },' +
                    '{}, null).then(() => console.log("ran"), e => console.log(e.message));'
                ],
                { encoding: "utf8" }
            ).trim();

        assert.match(out, /hooks runner is not bound|host is not bound|Cannot read/, out);
    });


    await test("a phase with no enabled hooks reports skipped, never empty-success", async () => {

        const { host } = stubHost();
        hooks.bind(host);
        settings.set("HOOKS_ENABLED", false);
        writeHooks({});

        const report = await hooks.runHooks("before_task", { task: "t" }, null);

        assert.deepEqual(report, {
            phase: "before_task", skipped: true, stopped: false, results: []
        });
    });


    await test("hooks never nest: a hook running a phase is skipped, not recursed", async () => {

        const { host, run } = stubHost();
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            before_task: [{ id: "list", type: "tool", tool: "fs_list", arguments: { path: "." } }]
        });

        run.inHook = true;
        const nested = await hooks.runHooks("before_task", { task: "t" }, null);
        run.inHook = false;

        assert.equal(nested.skipped, true);
        assert.deepEqual(nested.results, []);
        assert.deepEqual(nested, {
            phase: "before_task", skipped: true, stopped: false, results: []
        });

        /*
        | `withHookBudget` نگهبان تودرتویی خودش را دارد و `reason` همان‌جا
        | نوشته می‌شود. از runHooks هرگز به آن شاخه نمی‌رسیم (نگهبانِ بالا زودتر
        | برمی‌گردد)، پس این‌جا مستقیم صدا زده می‌شود تا شکل پاسخ آن مسیر هم
        | قفل باشد: اگر روزی فراخوان دیگری budget را صدا زد، مصرف‌کننده بداند
        | چه می‌گیرد.
        */
        run.inHook = true;
        try {

            const budgeted = await hooks.HookRunner.withHookBudget(
                "before_task",
                async () => { throw new Error("callback must not run"); }
            );

            assert.equal(budgeted.skipped, true);
            assert.equal(budgeted.reason, "nested hooks are disabled");
            assert.deepEqual(budgeted.results, []);

        } finally {

            run.inHook = false;
        }
    });


    await test("a tool hook runs through the tool graph and is announced as a hook", async () => {

        const { host, calls, run } = stubHost();
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            before_task: [{
                id: "snapshot", type: "tool", tool: "fs_list",
                arguments: { path: "${task}" }, on_failure: "report"
            }]
        });

        const seen = [];
        const sink = event => { if (event.type === "hook:start" || event.type === "hook:end") seen.push(event); };
        events.bus.on("event", sink);

        try {

            const report = await hooks.runHooks("before_task", { task: "src" }, null);

            assert.equal(report.skipped, false);
            assert.equal(report.stopped, false);
            assert.equal(report.results.length, 1);
            assert.equal(report.results[0].status, "done");
            assert.equal(report.results[0].ok, true);

            /* the template was resolved before the tool saw the arguments */
            assert.equal(calls.toolGraph[0].steps[0].arguments.path, "src");
            assert.equal(calls.toolGraph[0].meta.hook, "snapshot");

            /* result context for later hooks, and the event pair */
            assert.equal(run.hook_results.snapshot.status, "done");
            assert.equal(seen[0].type, "hook:start");
            assert.equal(seen[1].type, "hook:end");
            assert.equal(seen[1].id, "snapshot");

        } finally {
            events.bus.off("event", sink);
            settings.set("HOOKS_ENABLED", false);
        }
    });


    await test("hook:end has exactly the historical payload, from one place", async () => {

        const { HookResult } = hooks;

        const record = {
            id: "h1", type: "tool", phase: "before_task", ok: true, skipped: false,
            status: "done", summary: "done", result: { any: true },
            on_failure: "report", duration_ms: 4
        };

        assert.deepEqual(HookResult.endEvent(record), {
            id: "h1",
            phase: "before_task",
            hook_type: "tool",
            ok: true,
            skipped: false,
            status: "done",
            summary: "done",
            error: undefined,
            on_failure: "report",
            duration_ms: 4
        });

        /* `result` stays out of the event: it is for the context, not the log. */
        assert.ok(!("result" in HookResult.endEvent(record)));
        assert.equal(HookResult.hookResultSummary(null), "completed");
        assert.equal(HookResult.hookResultSummary({ stdout: "  trimmed  " }), "trimmed");
    });


    await test("on_failure stop marks the phase, and the other hooks still run", async () => {

        const { host, calls } = stubHost({
            toolResults: [
                { id: "a", success: false, error: { message: "boom" } },
                { id: "b", success: true, result: { exit_code: 0, stdout: "fine" } }
            ]
        });
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            before_task: [
                { id: "a", type: "tool", tool: "fs_list", arguments: {}, on_failure: "stop" },
                { id: "b", type: "tool", tool: "fs_read", arguments: {}, on_failure: "report" }
            ]
        });

        const report = await hooks.runHooks("before_task", { task: "t" }, null);

        assert.equal(report.stopped, true);
        assert.equal(report.results.length, 2, "the phase is not abandoned mid-way");
        assert.equal(report.results[0].status, "failed");
        assert.match(report.results[0].summary, /boom/);
        settings.set("HOOKS_ENABLED", false);
    });


    await test("a hook that the condition excludes is skipped, with the reason recorded", async () => {

        const { host, calls } = stubHost();
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            before_task: [{
                id: "only_dirty", type: "tool", tool: "fs_list",
                arguments: {}, when: "repository.dirty", on_failure: "report"
            }]
        });

        const report = await hooks.runHooks("before_task", { task: "t", repository: { dirty: false } }, null);

        assert.equal(report.results[0].status, "skipped");
        assert.match(report.results[0].summary, /condition was false: repository\.dirty/);
        assert.equal(calls.toolGraph.length, 0, "a skipped hook never reaches the tool graph");
        settings.set("HOOKS_ENABLED", false);
    });


    /* ------------------------------------------------- commit protections */

    await test("an after_task commit hook refuses to guess the file set", async () => {

        const { host } = stubHost();
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            after_task: [{
                id: "wip", type: "git_commit", message: "wip",
                paths: ["src/a.js"], on_failure: "report"
            }]
        });

        const report = await hooks.runHooks(
            "after_task",
            { task: "t", file_tracking_complete: false },
            null
        );

        assert.equal(report.results[0].status, "failed");
        assert.match(
            report.results[0].summary,
            /cannot prove the complete set of files changed by this run/
        );
        settings.set("HOOKS_ENABLED", false);
    });


    await test("a commit hook with no attributable paths is refused, not an empty commit", async () => {

        const { host } = stubHost();
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            after_task: [{
                id: "wip", type: "git_commit", message: "wip", on_failure: "report"
            }]
        });

        const report = await hooks.runHooks(
            "after_task",
            { task: "t", files_changed: [], file_tracking_complete: true },
            null
        );

        assert.match(report.results[0].summary, /No safely attributable paths/);
        settings.set("HOOKS_ENABLED", false);
    });


    await test("an agent hook with no runtime evidence is a failure, not a success", async () => {

        const { host } = stubHost({
            delegationResult: () => [{
                success: true,
                result: { success: true, performed: { tools: 0, delegations: 0 } }
            }]
        });
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            after_task: [{
                id: "review", type: "agent", agent: "testing", task: "review ${task}",
                on_failure: "report"
            }]
        });

        const report = await hooks.runHooks("after_task", { task: "t" }, null);

        assert.equal(report.results[0].status, "failed");
        assert.match(report.results[0].summary, /without executing a tool or delegation/);
        settings.set("HOOKS_ENABLED", false);
    });


    /* ------------------------------------------------------- hook budget */

    await test("the phase runs under its own deadline and restores the run after", async () => {

        const { host, run } = stubHost();
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        settings.set("HOOK_TIMEOUT_MS", 5000);
        writeHooks({
            before_task: [{ id: "list", type: "tool", tool: "fs_list", arguments: {}, on_failure: "report" }]
        });

        let seenDuringHook = null;

        const inner = host.executeToolGraph;
        host.executeToolGraph = async (...args) => {
            seenDuringHook = {
                inHook: run.inHook,
                phase: run.hook_phase,
                hasController: Boolean(run.controller),
                deadlineInFuture: run.hook_deadline_at > Date.now()
            };
            return inner(...args);
        };

        const before = run.controller;
        await hooks.runHooks("before_task", { task: "t" }, null);

        assert.deepEqual(seenDuringHook, {
            inHook: true, phase: "before_task", hasController: true, deadlineInFuture: true
        });
        assert.equal(run.inHook, false, "the guard is released");
        assert.equal(run.hook_phase, null);
        assert.equal(run.controller, before, "the run's own controller is back");

        settings.set("HOOKS_ENABLED", false);
    });


    await test("a hook timeout cancels as 'hook deadline', not as a user cancel", async () => {

        const { host, run } = stubHost();
        hooks.bind(host);

        settings.set("HOOK_TIMEOUT_MS", 1000);
        /* کف مجاز تنظیمات ۱۰۰۰ms است، پس همین‌جا یک ثانیه صبر می‌کنیم. */
        host.executeToolGraph = async () => {
            await new Promise(resolve => setTimeout(resolve, 1400));
            return [{ id: "h", success: true, result: { exit_code: 0 } }];
        };

        let captured = null;
        host.cancelRun = reason => { captured = reason; run.cancelled_reason = reason; };
        hooks.bind(host);

        settings.set("HOOKS_ENABLED", true);
        writeHooks({
            before_task: [{ id: "slow", type: "tool", tool: "fs_list", arguments: {}, on_failure: "report" }]
        });

        await hooks.runHooks("before_task", { task: "t" }, null);

        assert.equal(captured, "hook deadline");
        settings.set("HOOKS_ENABLED", false);
    });


    /* ------------------------------------------------------------ summary */

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    settings.reset("HOOKS_ENABLED");
    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
