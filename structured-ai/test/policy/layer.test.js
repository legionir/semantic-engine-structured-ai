"use strict";

/*
|--------------------------------------------------------------------------
| Policy boundary — EXECUTION_PLAN Phase 21
|--------------------------------------------------------------------------
|
| Locks what the extraction must not change and what phase 21 adds:
|
|   • `agent/lib/policy.js` stays a facade over `agent/policy` — one copy of
|     the mutable state (mode, injected handler, gateway cache), so an
|     importer on the old path cannot drift from one on the new one;
|   • rule semantics are unchanged: last match wins, `default_action` fills
|     the gap, conditions see the RESOLVED arguments, MCP trust can only
|     escalate;
|   • the current `policy.json` still answers every representative call the
|     way it did before the move — and now also covers `agent/policy/`, which
|     is the enforcement code after the move;
|   • approval modes refuse in the exact historical wording, and an injected
|     handler is the only interactive path when there is no TTY;
|   • approvals are per-project where project context exists (phase 9), and
|     pending requests live in the one store the console renders from.
|
| No MODE flag is invented: this phase moves code, it does not fork it.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase21-policy-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";

const REPO = path.resolve(__dirname, "..", "..");

const POLICY_DOC =
    JSON.parse(
        fs.readFileSync(path.join(REPO, "agent", "registry", "policy.json"), "utf8")
    );

const TOOL_GROUPS =
    JSON.parse(
        fs.readFileSync(path.join(REPO, "agent", "registry", "tool_groups.json"), "utf8")
    );

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


function newEngine(extra = {}) {

    const { PolicyEngine } = require(path.join(REPO, "agent", "policy"));

    return new PolicyEngine({
        policy: POLICY_DOC,
        toolGroups: TOOL_GROUPS,
        ...extra
    });
}


function decisionOf(engine, tool, args, agent = "main_agent") {

    return engine.evaluate(tool, args, agent).decision;
}


async function main() {

    /* -------------------------------------------------------- modules */

    await test("agent/policy holds the six modules the phase names", async () => {

        for (const file of [
            "PolicyEngine.js",
            "PolicyMatcher.js",
            "PolicyRegistry.js",
            "ApprovalManager.js",
            "ApprovalStore.js",
            "PolicyErrors.js",
            "index.js"
        ]) {
            assert.ok(
                fs.existsSync(path.join(REPO, "agent", "policy", file)),
                `expected agent/policy/${file}`
            );
        }
    });


    await test("lib/policy.js is a facade, not a second implementation", async () => {

        const source =
            fs.readFileSync(path.join(REPO, "agent", "lib", "policy.js"), "utf8");

        assert.match(source, /module\.exports = require\("\.\.\/policy"\)/);
        assert.ok(
            source.split("\n").length < 40,
            "the wrapper must not keep code of its own"
        );

        const legacy = require(path.join(REPO, "agent", "lib", "policy.js"));
        const current = require(path.join(REPO, "agent", "policy"));

        assert.equal(legacy.PolicyEngine, current.PolicyEngine);
        assert.equal(legacy.getApprovalMode, current.getApprovalMode);
        assert.equal(legacy.setApprovalHandler, current.setApprovalHandler);
        assert.equal(legacy.resetGatewayApprovals, current.resetGatewayApprovals);
    });


    await test("no require cycle back to agent.js", async () => {

        const { execFileSync } = require("child_process");

        const loaded =
            execFileSync(
                process.execPath,
                [
                    "-e",
                    `require(${JSON.stringify(path.join(REPO, "agent", "policy"))});` +
                    `process.stdout.write(Object.keys(require.cache).filter(p => /agent[\\\\/]agent\\.js$/.test(p)).join("|"));`
                ],
                { encoding: "utf8" }
            ).trim();

        assert.equal(
            loaded,
            "",
            `requiring the policy boundary pulled in the runtime: ${loaded}`
        );
    });


    /* ------------------------------------------------------ matching */

    await test("the last matching rule wins, so a narrow rule may follow a broad one", async () => {

        const engine = newEngine();

        /* `repository_mutations` says approval, `branch_listing_is_free`
           says allow, and it comes later — for `--list` only. */
        assert.equal(decisionOf(engine, "git_branch", { action: "list" }), "allow");
        assert.equal(decisionOf(engine, "git_branch", { action: "create" }), "require_approval");
    });


    await test("default_action answers a call no rule targets", async () => {

        const engine = newEngine();

        assert.equal(
            decisionOf(engine, "memory_search", { query: "x" }),
            POLICY_DOC.default_action
        );
    });


    await test("a malformed document degrades to the historical default, not a crash", async () => {

        const { PolicyEngine } = require(path.join(REPO, "agent", "policy"));

        const empty = new PolicyEngine({});

        assert.equal(empty.evaluate("fs_delete", { path: "a.txt" }, "x").decision, "allow");
        assert.equal(empty.summary().rules, 0);
    });


    await test("conditions see the resolved arguments the tool will receive", async () => {

        const engine = newEngine();

        /*
        | The `.git` guard is a regex on `path`, so what matters is that the
        | value it reads is the one the tool acts on. A relative path that
        | walks into .git is matched, because the match is on the string the
        | guard cares about rather than on a normalised, "safe-looking" one.
        */
        assert.equal(
            engine.evaluate("fs_write", { path: "./work/../../.git/config" }, "main_agent").decision,
            "deny"
        );

        const { valueAtPath } = require(path.join(REPO, "agent", "policy"));

        assert.equal(valueAtPath({ a: { b: { c: 1 } } }, "a.b.c"), 1);
        assert.equal(valueAtPath({ a: null }, "a.b"), null);
        assert.equal(valueAtPath({}, "a.b"), undefined);
    });


    await test("no guarded tool can hide a path in an undeclared or nested argument", async () => {

        /*
        | The rules speak about `path`, `source` and `destination`. That is
        | only sufficient while those are the only places a path can arrive:
        | a `files: [{ path }]` array, or an undeclared extra argument, would
        | reach the tool without any rule seeing it. `additionalProperties:
        | false` on every filesystem tool is what makes that impossible, so it
        | is asserted here rather than trusted.
        */
        const registry =
            require(path.join(REPO, "agent", "registry", "tools.json"));

        const guarded =
            /^(fs_|git_(add|commit|checkout|branch))/;

        let checked = 0;

        for (const entry of registry) {

            const fn = entry.function || entry;
            const name = fn.name || "";

            if (!guarded.test(name)) {
                continue;
            }

            checked += 1;

            const parameters = fn.parameters || {};

            assert.equal(
                parameters.additionalProperties,
                false,
                `${name} must reject undeclared arguments, or a path can arrive unexamined`
            );

            for (const [field, schema] of Object.entries(parameters.properties || {})) {

                const nestsAPath =
                    schema &&
                    schema.type === "array" &&
                    schema.items &&
                    schema.items.properties &&
                    (schema.items.properties.path || schema.items.properties.file);

                assert.ok(
                    !nestsAPath,
                    `${name}.${field} would carry a path no rule can see`
                );
            }
        }

        assert.ok(checked >= 4, `expected to check the filesystem tools, checked ${checked}`);
    });


    await test("agent patterns match the profile that made the call", async () => {

        const engine = newEngine({
            policy: {
                default_action: "allow",
                rules: [
                    {
                        id: "subagents_may_not_write",
                        tools: ["fs_write"],
                        when: { agents: ["sub_*"] },
                        action: "deny",
                        reason: "subagents are read-only here"
                    }
                ]
            },
            toolGroups: {}
        });

        assert.equal(engine.evaluate("fs_write", { path: "a" }, "sub_worker").decision, "deny");
        assert.equal(engine.evaluate("fs_write", { path: "a" }, "main_agent").decision, "allow");
    });


    await test("reload takes a new document without a restart", async () => {

        const engine = newEngine({
            policy: { default_action: "allow", rules: [] },
            toolGroups: {}
        });

        assert.equal(decisionOf(engine, "fs_delete", { path: "a.txt" }), "allow");

        engine.reload({
            policy: {
                default_action: "allow",
                rules: [{ id: "no_delete", tools: ["fs_delete"], action: "deny", reason: "no" }]
            },
            toolGroups: {}
        });

        assert.equal(decisionOf(engine, "fs_delete", { path: "a.txt" }), "deny");
    });


    /* ------------------------------------------------- policy semantics */

    await test("the shipped policy.json keeps its meaning after the move", async () => {

        const engine = newEngine();

        const expectations = [
            ["fs_read", { path: "a.txt" }, "allow"],
            ["fs_write", { path: "src/a.ts" }, "require_approval"],
            ["fs_delete", { path: "a.txt" }, "require_approval"],
            ["fs_write", { path: ".git/config" }, "deny"],
            ["fs_move", { source: "a", destination: "x/.git/y" }, "deny"],
            ["fs_write", { path: "agent/registry/policy.json" }, "deny"],
            ["fs_edit", { path: "agent/registry/agents.json" }, "require_approval"],
            ["terminal_exec", { command: "ls" }, "require_approval"],
            ["terminal_exec", { command: "rm -rf /" }, "deny"],
            ["terminal_exec", { command: "git push --force origin main" }, "deny"],
            ["git_status", {}, "allow"],
            ["git_commit", { message: "x" }, "require_approval"],
            ["search_text", { query: "x" }, "allow"],
            ["mcp_call", { server: "s", tool: "t" }, "allow"],
            ["mcp_add", { name: "s" }, "require_approval"]
        ];

        for (const [tool, args, expected] of expectations) {

            const actual =
                decisionOf(engine, tool, args);

            assert.equal(
                actual,
                expected,
                `${tool} ${JSON.stringify(args)}: expected ${expected}, got ${actual}`
            );
        }
    });


    await test("the moved enforcement code protects itself", async () => {

        const engine = newEngine();

        /*
        | The rule used to name `agent/lib/policy.js`, which is now a
        | one-line facade. If the new directory were not covered, editing the
        | real enforcement code would need no approval at all.
        */
        for (const file of [
            "agent/lib/policy.js",
            "agent/policy/PolicyEngine.js",
            "agent/policy/PolicyMatcher.js",
            "agent/policy/ApprovalManager.js"
        ]) {
            for (const tool of ["fs_write", "fs_edit", "fs_delete", "fs_move"]) {
                assert.equal(
                    engine.evaluate(tool, { path: file, content: "x" }, "main_agent").decision,
                    "require_approval",
                    `${tool} on ${file} must need approval`
                );
            }
        }
    });


    /* -------------------------------------------------------- escalation */

    await test("MCP trust can only escalate, and never over a denial", async () => {

        const settings = require(path.join(REPO, "agent", "lib", "storage.js"));
        const engine = newEngine();

        const previous = settings.get("MCP_APPROVAL");

        try {

            settings.set("MCP_APPROVAL", "always");

            assert.equal(
                decisionOf(engine, "mcp_call", { server: "s", tool: "t" }),
                "require_approval"
            );

            /* A denial is final: MCP_APPROVAL cannot soften it either. */
            assert.equal(
                decisionOf(engine, "fs_write", { path: "agent/registry/policy.json" }),
                "deny"
            );

            settings.set("MCP_APPROVAL", "never");

            assert.equal(
                decisionOf(engine, "mcp_call", { server: "s", tool: "t" }),
                "allow"
            );

        } finally {

            settings.set("MCP_APPROVAL", previous ?? "auto");
        }
    });


    /* ----------------------------------------------------------- modes */

    await test("deny mode refuses an escalation in the historical words", async () => {

        const settings = require(path.join(REPO, "agent", "lib", "storage.js"));
        const previous = settings.get("AGENT_APPROVAL");

        try {

            settings.set("AGENT_APPROVAL", "deny");

            const engine = newEngine();

            await assert.rejects(
                () => engine.enforce("fs_delete", { path: "a.txt" }, "main_agent"),
                error => {
                    assert.match(
                        error.message,
                        /requires approval and the runtime is running unattended \(AGENT_APPROVAL=deny\): deletes files/
                    );
                    return true;
                }
            );

            /* The refusal is audited, with the mode it came from. */
            const last = engine.approvals[engine.approvals.length - 1];
            assert.equal(last.approved, false);
            assert.equal(last.mode, "deny");

        } finally {

            settings.set("AGENT_APPROVAL", previous ?? "prompt");
        }
    });


    await test("prompt with no handler and no TTY refuses rather than hanging", async () => {

        const settings = require(path.join(REPO, "agent", "lib", "storage.js"));
        const wasTTY = process.stdin.isTTY;
        const previous = settings.get("AGENT_APPROVAL");

        process.stdin.isTTY = false;
        settings.set("AGENT_APPROVAL", "prompt");

        try {

            const engine = newEngine();

            await assert.rejects(
                () => engine.enforce("fs_delete", { path: "a.txt" }, "main_agent"),
                /requires an interactive approval, but no approval handler or TTY is available/
            );

        } finally {

            process.stdin.isTTY = wasTTY;
            settings.set("AGENT_APPROVAL", previous ?? "prompt");
        }
    });


    await test("an injected handler answers the escalation and is audited as prompt", async () => {

        const { setApprovalHandler } = require(path.join(REPO, "agent", "policy"));
        const settings = require(path.join(REPO, "agent", "lib", "storage.js"));

        const previous = settings.get("AGENT_APPROVAL");
        const previousHandler = (() => { let captured = null; return captured; })();

        settings.set("AGENT_APPROVAL", "prompt");

        const seen = [];
        setApprovalHandler(async (evaluation, args) => {
            seen.push({ tool: evaluation.tool, args });
            return true;
        });

        try {

            const engine = newEngine();
            const evaluation = await engine.enforce("fs_delete", { path: "a.txt" }, "main_agent");

            assert.equal(evaluation.decision, "require_approval");
            assert.equal(seen.length, 1);
            assert.equal(seen[0].tool, "fs_delete");

            const record = engine.approvals[engine.approvals.length - 1];
            assert.equal(record.approved, true);
            assert.equal(record.mode, "prompt");

            const decisions = [];
            const auditing = newEngine({ onDecision: d => decisions.push(d) });
            setApprovalHandler(async () => false);
            await assert.rejects(() => auditing.enforce("fs_delete", { path: "b.txt" }, "main_agent"),
                /was denied by the operator: deletes files/);
            assert.equal(decisions[0].approved, false);
            assert.equal(decisions[0].approval_mode, "prompt");

        } finally {

            setApprovalHandler(previousHandler);
            settings.set("AGENT_APPROVAL", previous ?? "prompt");
        }
    });


    /* -------------------------------------------------- project scoping */

    await test("an approval record carries the project that raised it", async () => {

        const { setApprovalHandler } = require(path.join(REPO, "agent", "policy"));

        setApprovalHandler(async () => true);

        try {

            const engine = newEngine();

            const evaluation = engine.evaluate("fs_delete", { path: "a.txt" }, "main_agent");
            evaluation.project_id = "prj-b";

            const record = await engine.requestApproval(evaluation, { path: "a.txt" });

            assert.equal(record.project_id, "prj-b");

            const other = engine.evaluate("fs_delete", { path: "b.txt" }, "main_agent");
            other.project_id = "prj-a";
            await engine.requestApproval(other, { path: "b.txt" });

            assert.equal(engine.store.list("prj-b").length, 1);
            assert.equal(engine.store.list("prj-b")[0].project_id, "prj-b");
            assert.equal(engine.store.list(null).length, 2, "no project means the whole trail, as before");

        } finally {

            setApprovalHandler(null);
        }
    });


    await test("pending requests are numbered, taken once, and filterable per project", async () => {

        const { ApprovalStore } = require(path.join(REPO, "agent", "policy"));

        /* پیش‌فرض همان قالب تاریخی است که مرورگر به آن POST می‌کند. */
        const store = new ApprovalStore();

        const first = store.begin({ tool: "fs_delete", agent: "main_agent", reason: "deletes files", project_id: "prj-a" });
        const second = store.begin({ tool: "fs_delete", agent: "main_agent", reason: "deletes files", project_id: "prj-b" });

        assert.match(first.id, /^approval_1_\d+$/);
        assert.match(second.id, /^approval_2_\d+$/);

        /* The console's global view keeps unscoped requests; a project view
           must not show another project's pending question. */
        assert.equal(store.listPending().length, 2);
        assert.equal(store.listPending({ projectId: "prj-a" }).length, 1);
        assert.equal(store.listPending({ projectId: "prj-c" }).length, 0);

        assert.equal(store.take(first.id).id, first.id);
        assert.equal(store.take(first.id), null, "a second resolve must find nothing");

        /* A pending request with no project is legacy-shaped: visible
           everywhere, exactly as before phase 9. */
        const unscoped = store.begin({ tool: "terminal_exec", project_id: null });
        assert.equal(store.listPending({ projectId: "prj-c" }).length, 1);
        assert.equal(
            store.listPending({ projectId: "prj-c", includeUnscoped: false }).length,
            0
        );
        assert.equal(store.get(unscoped.id).tool, "terminal_exec");
        assert.deepEqual(store.pendingIds(), [second.id, unscoped.id]);
    });


    await test("ids stay unique even when several approvals open in the same millisecond", async () => {

        /*
        | Counting the queue (`size + 1`) looked fine until a resolve happened
        | between two begins: the freed slot number is reused, and because the
        | id is the Map key, the second request would overwrite the first —
        | an approval nobody can answer any more.
        */
        const { ApprovalStore } = require(path.join(REPO, "agent", "policy"));

        const store = new ApprovalStore({ idPrefix: "test_approval_" });

        const ids = new Set();

        for (let i = 0; i < 200; i += 1) {
            ids.add(store.begin({ tool: "fs_delete", project_id: "prj-x" }).id);
            if (i % 3 === 0) {
                store.take(store.pendingIds()[0]);
            }
        }

        assert.equal(ids.size, 200, "every request needs its own id");
    });


    await test("resetGatewayApprovals clears the cache the engines consult", async () => {

        const policy = require(path.join(REPO, "agent", "policy"));

        const store = new policy.ApprovalStore();
        store.gatewayPut("shared-server", { approved: true });

        assert.equal(store.gatewayGet("shared-server").approved, true);

        policy.resetGatewayApprovals();

        /* The default store shares the module-level cache, so a reset clears
           what a live engine is actually reading. */
        const defaultStore = new policy.ApprovalStore();
        defaultStore.gatewayPut("shared-server", { approved: true });
        policy.resetGatewayApprovals();
        assert.equal(defaultStore.gatewayGet("shared-server"), null);
    });


    /* ------------------------------------------------------- enforcement */

    await test("the tool graph enforces policy at one point, and the console reuses it", async () => {

        const executor =
            fs.readFileSync(path.join(REPO, "agent", "runtime", "ToolGraphExecutor.js"), "utf8");

        const enforcedAt =
            executor.indexOf("POLICY_ENGINE.enforce(");

        const executedAt =
            executor.indexOf("toolRuntime.executeTool(");

        assert.ok(enforcedAt > 0, "the tool graph must enforce policy at all");
        assert.ok(
            enforcedAt < executedAt,
            "enforcement must happen before the tool runs, not after it"
        );

        /*
        | A second, unenforced execution point would make the boundary
        | advisory. There is exactly one call into the tool runtime here.
        */
        assert.equal(
            (executor.match(/toolRuntime\.executeTool\(/g) || []).length,
            1,
            "only one execution point may exist in the tool graph"
        );

        const server = fs.readFileSync(path.join(REPO, "web", "server.js"), "utf8");

        /* Every MCP mutation the console can trigger goes through the same
           engine rather than a console-specific shortcut. */
        const enforced =
            (server.match(/policyEngine\.enforce\(/g) || []).length;

        assert.ok(
            enforced >= 3,
            `expected the console's MCP mutations to be enforced, found ${enforced}`
        );
    });


    await test("the console renders pending approvals from the engine's own store", async () => {

        const server = fs.readFileSync(path.join(REPO, "web", "server.js"), "utf8");

        assert.match(server, /approvals:\s*runtime\.policyStore/);
        assert.match(server, /state\.approvals\.begin\(/);
        assert.match(server, /state\.approvals\.take\(/);
        assert.match(
            server,
            /listPending\(\{ projectId: record\.id, includeUnscoped: false \}\)/,
            "the per-project state endpoint must not leak another project's pending question"
        );
    });


    await test("policy:decision and approval events keep their payload and gain only fields", async () => {

        const { setApprovalHandler } = require(path.join(REPO, "agent", "policy"));
        const settings = require(path.join(REPO, "agent", "lib", "storage.js"));
        const previous = settings.get("AGENT_APPROVAL");

        settings.set("AGENT_APPROVAL", "auto");
        setApprovalHandler(null);

        try {

            const decisions = [];
            const engine = newEngine({ onDecision: d => decisions.push(d) });

            await engine.enforce("fs_delete", { path: "a.txt" }, "main_agent");

            const [decision] = decisions;

            /* The historical keys, unchanged. */
            for (const key of ["tool", "agent", "groups", "decision", "reason", "rule"]) {
                assert.ok(key in decision, `policy:decision lost "${key}"`);
            }

            /* project attribution stays absent unless a project is in scope;
               stamping null would change every legacy payload. */
            assert.ok(!("project_id" in decision) || decision.project_id, decision);

            assert.equal(decision.approved, true);
            assert.equal(decision.approval_mode, "auto");

        } finally {

            settings.set("AGENT_APPROVAL", previous ?? "prompt");
        }
    });


    /* ------------------------------------------------------------ summary */

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
