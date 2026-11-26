"use strict";

/*
|--------------------------------------------------------------------------
| P0-2 — cached gateway approvals expire
|--------------------------------------------------------------------------
|
| P0-2 says a cached approval has a TTL and never overrides deny. The deny
| half lives in p02.test.js; this suite covers the TTL half:
|
|   1. MCP_GATEWAY_APPROVAL_TTL_MS is a declared setting with a bounded,
|      non-zero default
|   2. a fresh cached answer is reused without asking again
|   3. an answer older than the TTL is not reused: the operator is asked
|   4. a TTL of 0 never reuses an answer
|   5. an entry without a timestamp cannot be aged and is not reused
|   6. a cached denial expires the same way
|
| No network, no LLM, no child processes.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

/* WORKSPACE_ROOT is fixed at startup: set it before the config loads. */
const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "p02ttl-policy-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
delete process.env.MCP_SERVERS;
delete process.env.MCP_GATEWAY_APPROVAL_TTL_MS;

const schema = require(path.join(REPO, "agent", "config", "SettingsSchema"));
const settings = require(path.join(REPO, "agent", "config"));
const policy = require(path.join(REPO, "agent", "policy"));

const SERVER = "p02ttlgateway";
const ARGS = { server: SERVER, tool: "echo" };
const EVALUATION = {
    tool: "mcp_call",
    agent: "main_agent",
    reason: "restricted server"
};

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


/*
| An isolated manager in "prompt" mode with a counting operator handler,
| its own gateway cache and a controllable TTL.
*/
function fixture({ ttl, answer = true } = {}) {

    const state = { asked: 0, ttl, answer };

    const fakeSettings = {
        get: key =>
            key === "AGENT_APPROVAL"
                ? "prompt"
                : key === "MCP_GATEWAY_APPROVAL_TTL_MS"
                    ? state.ttl
                    : key === "APPROVAL_HISTORY_LIMIT"
                        ? 100
                        : null,
        set: (_key, value) => value
    };

    const store = new policy.ApprovalStore({ gateway: new Map() });

    const approvals = new policy.ApprovalManager({
        settingsStore: fakeSettings,
        store,
        currentProjectId: () => "prj-p02ttl",
        mcpServerOf: () => SERVER,
        globalMcpServer: name =>
            name ? { name, config: { scope: "global" } } : null
    });

    approvals.setHandler(async () => {
        state.asked += 1;
        return state.answer;
    });

    return { state, store, approvals };
}


async function outcome(approvals) {

    try {
        return await approvals.request(EVALUATION, ARGS);
    } catch (error) {
        return { thrown: error };
    }
}


async function main() {

    await test("P0-2: MCP_GATEWAY_APPROVAL_TTL_MS is a declared, bounded setting", async () => {

        const definition = schema.BY_KEY.get("MCP_GATEWAY_APPROVAL_TTL_MS");

        assert.ok(definition, "MCP_GATEWAY_APPROVAL_TTL_MS is not in SettingsSchema");
        assert.equal(definition.type, schema.NUMBER);
        assert.equal(definition.min, 0);
        assert.ok(
            typeof definition.default === "number" &&
            definition.default > 0 &&
            definition.default <= definition.max,
            `unexpected default ${definition.default}`
        );

        const value = settings.get("MCP_GATEWAY_APPROVAL_TTL_MS");

        assert.equal(Number(value), definition.default);
    });

    await test("P0-2: a fresh cached gateway answer is reused without asking", async () => {

        const { state, store, approvals } = fixture({ ttl: 60000 });

        const first = await approvals.request(EVALUATION, ARGS);

        assert.equal(first.approved, true);
        assert.equal(state.asked, 1);
        assert.equal(store.hasGateway(SERVER), true, "the answer was not remembered");

        const second = await approvals.request(EVALUATION, ARGS);

        assert.equal(second.approved, true);
        assert.equal(second.gateway_cached, true, "a fresh answer was not reused");
        assert.equal(state.asked, 1, "the operator was asked again inside the TTL");
    });

    await test("P0-2: a gateway answer older than the TTL is not reused", async () => {

        const { state, store, approvals } = fixture({ ttl: 60000 });

        store.rememberGateway(SERVER, { approved: true, at: Date.now() - 60001 });

        const result = await approvals.request(EVALUATION, ARGS);

        assert.equal(state.asked, 1, "an expired gateway approval ran without asking the operator");
        assert.notEqual(result.gateway_cached, true);
        assert.equal(result.mode, "prompt");

        /* the new answer is remembered with a fresh timestamp */
        const cached = store.gatewayFor(SERVER);

        assert.ok(Date.now() - Number(cached.at) < 60000, "the refreshed answer has a stale timestamp");
    });

    await test("P0-2: a TTL of 0 never reuses a gateway answer", async () => {

        const { state, approvals } = fixture({ ttl: 0 });

        await approvals.request(EVALUATION, ARGS);
        const second = await approvals.request(EVALUATION, ARGS);

        assert.equal(state.asked, 2, "TTL 0 still reused a cached answer");
        assert.notEqual(second.gateway_cached, true);
    });

    await test("P0-2: a gateway entry without a timestamp is not trusted forever", async () => {

        const { state, store, approvals } = fixture({ ttl: 60000 });

        store.rememberGateway(SERVER, { approved: true });

        const result = await approvals.request(EVALUATION, ARGS);

        assert.equal(state.asked, 1, "an unaged cache entry bypassed the operator");
        assert.notEqual(result.gateway_cached, true);
    });

    await test("P0-2: a cached denial expires too", async () => {

        const { state, store, approvals } = fixture({ ttl: 60000, answer: true });

        store.rememberGateway(SERVER, { approved: false, at: Date.now() });

        const fresh = await outcome(approvals);

        assert.ok(fresh.thrown, "a fresh cached denial was not honoured");
        assert.equal(state.asked, 0);

        store.rememberGateway(SERVER, { approved: false, at: Date.now() - 60001 });

        const expired = await outcome(approvals);

        assert.equal(state.asked, 1, "an expired denial was reused instead of asking");
        assert.equal(expired.approved, true);
    });

    try {
        new policy.ApprovalManager().setHandler(null);
    } catch {
        /* nothing to reset */
    }

    try {
        fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
        /* best effort */
    }

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length > 0) {
        process.exitCode = 1;
    }
}


main().catch(error => {

    console.error(error);
    process.exitCode = 1;
});
