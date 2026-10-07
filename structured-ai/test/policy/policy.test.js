"use strict";

/*
|--------------------------------------------------------------------------
| Policy / Approval boundary — EXECUTION_PLAN Phase 21
|--------------------------------------------------------------------------
|
| The existing runtime, web and MCP suites lock the public behaviour. These
| tests lock the extracted policy modules themselves: matching, registry
| reload/validation, approval lifecycle and the legacy facade.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

const policy = require(path.join(REPO, "agent", "policy"));
const legacy = require(path.join(REPO, "agent", "policy"));

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


function makeRegistry() {

    return new policy.PolicyRegistry({
        policy: {
            default_action: "allow",
            rules: [
                {
                    id: "writes",
                    groups: ["filesystem.write"],
                    action: "require_approval",
                    reason: "writes need review"
                },
                {
                    id: "protect-policy",
                    tools: ["fs_write"],
                    when: {
                        argument_matches: {
                            path: ["registry/policy\\.json$"]
                        }
                    },
                    action: "deny",
                    reason: "policy is protected"
                },
                {
                    id: "only-main",
                    tools: ["fs_read"],
                    when: { agents: ["main_*"] },
                    action: "deny",
                    reason: "main inspection probe"
                }
            ]
        },
        toolGroups: {
            "filesystem.read": {
                tools: ["fs_read"]
            },
            "filesystem.write": {
                tools: ["fs_write"]
            }
        }
    });
}


async function main() {

    await test("the extracted modules and legacy facade expose the same engine", async () => {

        assert.equal(legacy.PolicyEngine, policy.PolicyEngine);
        assert.equal(legacy.PolicyMatcher, policy.PolicyMatcher);
        assert.equal(legacy.PolicyRegistry, policy.PolicyRegistry);
        assert.equal(legacy.ApprovalManager, policy.ApprovalManager);
        assert.equal(legacy.ApprovalStore, policy.ApprovalStore);
        assert.equal(typeof policy.PolicyErrors.PolicyDeniedError, "function");

    });


    await test("PolicyMatcher applies conditions and last-match-wins precedence", async () => {

        const registry = makeRegistry();
        const matcher = new policy.PolicyMatcher();

        assert.equal(
            matcher.evaluate("fs_write", { path: "src/app.js" }, "worker", registry).decision,
            "require_approval"
        );

        assert.equal(
            matcher.evaluate("fs_write", { path: "registry/policy.json" }, "worker", registry).decision,
            "deny"
        );

        assert.equal(
            matcher.evaluate("fs_read", { path: "README.md" }, "main_agent", registry).decision,
            "deny"
        );

        assert.equal(
            matcher.evaluate("fs_read", { path: "README.md" }, "worker", registry).decision,
            "allow"
        );

        assert.equal(
            policy.matchesGlob("mcp__*", "mcp__server__tool"),
            true
        );
        assert.equal(
            policy.matchesGlob("a+b", "a+b"),
            true
        );

    });


    await test("PolicyRegistry indexes groups and reloads declarative policy", async () => {

        const registry = makeRegistry();

        assert.deepEqual(
            registry.groupsFor("fs_write"),
            ["filesystem.write"]
        );
        assert.equal(registry.defaultAction(), "allow");
        assert.equal(registry.rules().length, 3);

        registry.reload({
            policy: {
                default_action: "deny",
                rules: []
            },
            toolGroups: {
                inspection: { tools: ["fs_read"] }
            }
        });

        assert.equal(registry.defaultAction(), "deny");
        assert.deepEqual(registry.groupsFor("fs_read"), ["inspection"]);
        assert.equal(registry.rules().length, 0);

    });


    await test("policy validation stays in the policy registry with legacy messages", async () => {

        const problems = policy.policyProblems({
            policy: {
                rules: [
                    {
                        id: "bad-tool",
                        tools: ["missing_tool"],
                        action: "allow"
                    },
                    {
                        id: "bad-group",
                        groups: ["missing.group"],
                        action: "allow"
                    },
                    {
                        id: "bad-action",
                        tools: ["fs_read"],
                        action: "maybe"
                    }
                ]
            },
            toolGroups: {},
            tools: [{ type: "function", function: { name: "fs_read" } }]
        });

        assert.equal(problems.length, 3);
        assert.match(problems[0], /unknown tool/);
        assert.match(problems[1], /unknown tool group/);
        assert.match(problems[2], /unknown action/);

        assert.throws(
            () => new policy.PolicyRegistry({
                policy: {
                    rules: [{ id: "bad", tools: ["missing"], action: "allow" }]
                },                toolGroups: {}
            }).validate([{ type: "function", function: { name: "fs_read" } }]),
            /Registry validation failed/
        );

    });


    await test("SA-POL-001/SA-POL-005: malformed argument_matches regex fails validation, not evaluation", async () => {

        const problems = policy.policyProblems({
            policy: {
                rules: [
                    {
                        id: "bad-regex",
                        tools: ["fs_read"],
                        when: { argument_matches: { path: ["["] } },
                        action: "deny"
                    },
                    {
                        id: "not-an-array",
                        tools: ["fs_read"],
                        when: { argument_matches: { path: "[" } },
                        action: "deny"
                    },
                    {
                        id: "good-regex",
                        tools: ["fs_read"],
                        when: { argument_matches: { path: ["^secret"] } },
                        action: "deny"
                    }
                ]
            },
            toolGroups: {},
            tools: [{ type: "function", function: { name: "fs_read" } }]
        });

        assert.equal(problems.length, 2, `expected two problems, got: ${JSON.stringify(problems)}`);
        assert.match(problems[0], /bad-regex.*invalid regex/);
        assert.match(problems[1], /not-an-array.*must be an array/);

        /* evaluation no longer sees a SyntaxError from an authored pattern */
        const ok = policy.conditionMatches(
            { argument_matches: { path: ["^secret"] } },
            { args: { path: "secret.txt" }, agent: "main_agent" }
        );
        assert.equal(ok, true);

    });


    await test("ApprovalStore owns pending records without changing the Map contract", async () => {

        const pending = new Map();
        const store = new policy.ApprovalStore({ pending });
        let answer;

        const request = {
            id: "approval_1",
            resolve: value => { answer = value; }
        };

        store.addPending(request);

        assert.equal(store.pendingSize(), 1);
        assert.equal(store.getPending("approval_1"), request);
        assert.deepEqual([...pending.keys()], ["approval_1"]);

        const removed = store.removePending("approval_1");

        assert.equal(removed, request);
        assert.equal(store.pendingSize(), 0);
        assert.equal(store.removePending("missing"), null);

        store.addPending(request);
        store.clearPending(false);
        assert.equal(answer, false);
        assert.equal(store.pendingSize(), 0);

    });


    await test("ApprovalManager preserves auto, prompt and deny modes with project attribution", async () => {

        let mode = "auto";
        const fakeSettings = {
            get: key => key === "AGENT_APPROVAL" ? mode : "never",
            set: (_key, value) => {
                mode = value;
                return value;
            }
        };

        const manager = new policy.ApprovalManager({
            settingsStore: fakeSettings,
            currentProjectId: () => "prj-a",
            mcpServerOf: () => null,
            globalMcpServer: () => null
        });

        const automatic = await manager.request(
            {
                tool: "fs_write",
                agent: "worker",
                reason: "write"
            },
            { path: "a.txt" }
        );

        assert.equal(automatic.approved, true);
        assert.equal(automatic.mode, "auto");
        assert.equal(automatic.project_id, "prj-a");

        mode = "prompt";
        policy.setApprovalHandler(async () => true);

        const prompted = await manager.request(
            {
                tool: "terminal_exec",
                agent: "worker",
                reason: "shell"
            },
            { command: "echo ok" }
        );

        assert.equal(prompted.approved, true);
        assert.equal(prompted.mode, "prompt");

        policy.setApprovalHandler(null);
        mode = "deny";

        await assert.rejects(
            () => manager.request(
                {
                    tool: "fs_write",
                    agent: "worker",
                    reason: "write"
                },
                { path: "b.txt" }
            ),
            error =>
                error.code === policy.PolicyErrors.CODES.APPROVAL_UNAVAILABLE &&
                /AGENT_APPROVAL=deny/.test(error.message)
        );

    });


    await test("pending handler delegates UI storage while the manager keeps policy ownership", async () => {

        const pendingStore = new policy.ApprovalStore();
        const manager = new policy.ApprovalManager({
            currentProjectId: () => "prj-b",
            mcpServerOf: () => null,
            globalMcpServer: () => null
        });
        let notified = null;

        const handler = manager.createPendingHandler({
            store: pendingStore,
            createId: () => "approval-ui-1",
            onRequest: request => { notified = request; }
        });

        const answer = handler(
            {
                tool: "fs_write",
                agent: "web_console",
                reason: "write",
                groups: ["filesystem.write"]
            },
            { path: "c.txt" }
        );

        assert.equal(pendingStore.pendingSize(), 1);
        assert.equal(notified.id, "approval-ui-1");
        assert.equal(notified.project_id, "prj-b");

        pendingStore.removePending("approval-ui-1").resolve(true);
        assert.equal(await answer, true);

    });


    await test("SA-POL-002/006: cancelling the run settles the pending approval with RUN_CANCELLED", async () => {

        const runtime = require("../../agent/runtime");
        const original = runtime.runManager.current;

        const controller = new AbortController();
        const fakeContext = { cancellation: { controller, signal: controller.signal } };

        try {

            runtime.runManager.current = () => fakeContext;

            const pendingStore = new policy.ApprovalStore();
            const manager = new policy.ApprovalManager();

            const handler = manager.createPendingHandler({
                store: pendingStore,
                createId: () => "approval-cancel-1"
            });

            const answer = handler(
                { tool: "fs_write", agent: "main_agent", reason: "write", groups: [] },
                { path: "x.txt" }
            );

            assert.equal(pendingStore.pendingSize(), 1);

            controller.abort();

            await assert.rejects(() => answer, error => {

                assert.equal(error.code, "RUN_CANCELLED");
                return true;
            });

            /* the question a cancelled run can never answer is gone */
            assert.equal(pendingStore.pendingSize(), 0);

            /* a run cancelled BEFORE the ask never adds a pending entry */

            controller.abort(); /* already aborted; new controller below */
            const done = new AbortController();
            done.abort();
            runtime.runManager.current = () => ({ cancellation: { controller: done, signal: done.signal } });

            const second = handler(
                { tool: "fs_write", agent: "main_agent", reason: "write", groups: [] },
                { path: "y.txt" }
            );

            await assert.rejects(() => second, /cancelled before approval/);
            assert.equal(pendingStore.pendingSize(), 0);

        } finally {

            runtime.runManager.current = original;
        }

    });


    await test("PolicyEngine sends every decision through the audit callback", async () => {

        const seen = [];
        const engine = new policy.PolicyEngine({
            policy: {
                default_action: "allow",
                rules: [{
                    id: "deny-probe",
                    tools: ["dangerous"],
                    action: "deny",
                    reason: "probe denied"
                }]
            },
            toolGroups: {},
            onDecision: decision => seen.push(decision)
        });

        const allowed = await engine.enforce("safe", {}, "worker");
        assert.equal(allowed.decision, "allow");
        assert.equal(seen[0].tool, "safe");

        await assert.rejects(
            () => engine.enforce("dangerous", {}, "worker"),
            error =>
                error instanceof policy.PolicyErrors.PolicyDeniedError &&
                /denied by policy/.test(error.message)
        );

        assert.equal(seen[1].rule, "deny-probe");
        assert.equal(seen.length, 2);

    });


    await test("SA-POL-004: a DENIED approval emits an audit decision before the throw", async () => {

        const seen = [];
        const engine = new policy.PolicyEngine({
            policy: {
                default_action: "allow",
                rules: [{
                    id: "needs-approval",
                    tools: ["fs_delete"],
                    action: "require_approval",
                    reason: "destructive"
                }]
            },
            toolGroups: {},
            onDecision: decision => seen.push(decision)
        });

        /* approval mode = deny → requestApproval throws ApprovalDenied */
        const previousMode = engine.approvalManager.getMode();
        engine.approvalManager.setMode("deny");

        await assert.rejects(
            () => engine.enforce("fs_delete", { path: "x" }, "main_agent"),
            error =>
                error instanceof policy.PolicyErrors.ApprovalDeniedError ||
                (error && error.code === policy.PolicyErrors.CODES.APPROVAL_UNAVAILABLE)
        );

        /* the denial must be visible in the audit trail (approved:false),
           not swallowed by the throw — SA-POL-004's defect */
        assert.equal(seen.length, 1);
        assert.equal(seen[0].rule, "needs-approval");
        assert.equal(seen[0].approved, false);
        assert.equal(seen[0].denial, true);

        engine.approvalManager.setMode(previousMode);
    });


    await test("POL-045: the approval history is bounded, oldest-first eviction", async () => {

        const store = new policy.ApprovalStore({ historyLimit: 3 });

        for (const id of ["a", "b", "c", "d", "e"]) {
            store.record({ tool: id, approved: true });
        }

        assert.equal(store.count(), 3);
        assert.deepEqual(store.records().map(item => item.tool), ["c", "d", "e"]);
    });


    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
