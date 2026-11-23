"use strict";

/*
|--------------------------------------------------------------------------
| P0-2 — Policy everywhere + deny-by-default
|--------------------------------------------------------------------------
|
| Regression tests for the P0-2 roadmap item. Every test asserts the
| DESIRED secure behaviour, so it fails while the defect exists and passes
| once it is fixed:
|
|   1. an unknown tool does not fall through to "allow"
|      (agent/registry/policy.json default_action)
|   2. mcp_call to a server whose trust is "restricted" requires approval
|      (agent/policy/PolicyEngine.js mcpEscalation, McpManager.call)
|   3. the model-callable mcp_add cannot self-declare trust:"trusted"
|      (agent/tools/mcp/McpTools.js mcpAdd)
|   4. a cached gateway approval never overrides AGENT_APPROVAL=deny
|      (agent/policy/ApprovalManager.js request)
|   5. process_write is gated by policy (agent/registry/policy.json)
|
| No network, no LLM. The only child process is a tiny stdio MCP server
| written to a temp dir and started with process.execPath; it is shut
| down before the script ends.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

/* WORKSPACE_ROOT is fixed at startup: set it before the config loads. */
const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "p02-policy-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
delete process.env.MCP_SERVERS;

const GLOBAL_TIMEOUT_MS = 60000;

setTimeout(() => {

    console.error(`\nP0-2 suite timed out after ${GLOBAL_TIMEOUT_MS} ms`);
    process.exit(1);

}, GLOBAL_TIMEOUT_MS).unref();

const settings = require(path.join(REPO, "agent", "config"));
const policy = require(path.join(REPO, "agent", "policy"));
const {
    manager,
    managerRegistry
} = require(path.join(REPO, "agent", "mcp", "McpManager"));
const mcpTools = require(path.join(REPO, "agent", "tools", "mcp"));

const POLICY_FILE = path.join(REPO, "agent", "registry", "policy.json");
const TOOL_GROUPS_FILE = path.join(REPO, "agent", "registry", "tool_groups.json");

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


function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}


function shippedEngine(options = {}) {

    return new policy.PolicyEngine({
        policy: readJson(POLICY_FILE),
        toolGroups: readJson(TOOL_GROUPS_FILE),
        ...options
    });
}


/* A settings store whose AGENT_APPROVAL is "deny"; everything else is real. */
function denySettings() {

    return {
        get: key =>
            key === "AGENT_APPROVAL"
                ? "deny"
                : key === "MCP_APPROVAL"
                    ? "inherit"
                    : settings.get(key),
        set: (_key, value) => value
    };
}


/*
| A minimal stdio MCP server. It answers in whichever framing it received
| (NDJSON or Content-Length), so it works with either codec.
*/
function writeStdioServer() {

    const file = path.join(WORKSPACE, "p02-stdio-server.js");

    const source = `
"use strict";

const TOOLS = [{
    name: "echo",
    description: "Echo the arguments back.",
    inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"]
    }
}];

let framed = false;

function send(message) {
    const body = JSON.stringify(message);
    if (framed) {
        process.stdout.write(
            "Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body
        );
    } else {
        process.stdout.write(body + "\\n");
    }
}

function handle(message) {
    if (!message || message.id === undefined || message.id === null) {
        return;
    }
    if (message.method === "initialize") {
        send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "p02-server", version: "1.0.0" }
            }
        });
        return;
    }
    if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
        return;
    }
    if (message.method === "tools/call") {
        send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
                content: [{ type: "text", text: "ok" }],
                structuredContent: { echoed: true }
            }
        });
        return;
    }
    if (message.method === "ping") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
        return;
    }
    send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "unknown method" }
    });
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
        if (/^Content-Length/i.test(buffer.slice(0, 15).toString())) {
            const separator = buffer.indexOf("\\r\\n\\r\\n");
            if (separator === -1) return;
            const match = /Content-Length:\\s*(\\d+)/i.exec(
                buffer.slice(0, separator).toString()
            );
            const length = parseInt(match[1], 10);
            if (buffer.length < separator + 4 + length) return;
            const body = buffer.slice(separator + 4, separator + 4 + length).toString();
            buffer = buffer.slice(separator + 4 + length);
            framed = true;
            handle(JSON.parse(body));
            continue;
        }
        const newline = buffer.indexOf(0x0a);
        if (newline === -1) return;
        const line = buffer.slice(0, newline).toString().trim();
        buffer = buffer.slice(newline + 1);
        if (line) handle(JSON.parse(line));
    }
});

process.stdin.on("end", () => process.exit(0));
`;

    fs.writeFileSync(file, source, "utf8");

    return file;
}


async function main() {

    /* ------------------------------------------------------------------ */

    await test("P0-2: an unknown tool does not default to allow (deny-by-default)", async () => {

        const shipped = readJson(POLICY_FILE);

        assert.notEqual(
            shipped.default_action,
            "allow",
            "agent/registry/policy.json default_action must not be \"allow\""
        );

        const engine = shippedEngine();

        const unknown =
            engine.evaluate("p0_totally_unknown_tool", {}, "main_agent");

        assert.notEqual(
            unknown.decision,
            "allow",
            `an unknown tool was allowed (rule: ${unknown.rule}, reason: ${unknown.reason})`
        );

        assert.ok(
            ["deny", "require_approval"].includes(unknown.decision),
            `unexpected decision "${unknown.decision}"`
        );

        assert.notEqual(engine.summary().default_action, "allow");
    });

    /* ------------------------------------------------------------------ */

    await test("P0-2: mcp_call on a 'restricted' server requires approval", async () => {

        /* load once so the injected double is not dropped by a later load() */
        manager.load();

        const serverName = "p02guarded";
        const namespaced = `mcp__${serverName}__echo`;

        const double = {
            name: serverName,
            state: "ready",
            config: {
                name: serverName,
                transport: "http",
                url: "http://127.0.0.1:1/mcp",
                enabled: true,
                source: "runtime",
                trust: "restricted",
                scope: "global",
                projects: null,
                include: null,
                exclude: null
            },
            close: async () => {}
        };

        manager.clients.set(serverName, double);
        manager.catalogue.set(namespaced, {
            name: namespaced,
            server: serverName,
            tool: "echo",
            description: "",
            input_schema: null,
            annotations: null,
            trust: "restricted",
            builtin: false
        });

        const previousMcpApproval = settings.get("MCP_APPROVAL");
        settings.set("MCP_APPROVAL", "inherit");

        try {

            const engine = shippedEngine();

            /* sanity: the namespaced form is already escalated today */
            assert.equal(
                engine.evaluate(namespaced, {}, "main_agent").decision,
                "require_approval",
                "fixture broken: the namespaced restricted tool is not escalated"
            );

            const byPair =
                engine.evaluate(
                    "mcp_call",
                    { server: serverName, tool: "echo", arguments: {} },
                    "main_agent"
                );

            assert.equal(
                byPair.decision,
                "require_approval",
                `mcp_call {server:"${serverName}"} on a restricted server was "${byPair.decision}"`
            );

            const byName =
                engine.evaluate(
                    "mcp_call",
                    { tool: namespaced, arguments: {} },
                    "main_agent"
                );

            assert.equal(
                byName.decision,
                "require_approval",
                `mcp_call {tool:"${namespaced}"} on a restricted server was "${byName.decision}"`
            );

            /* and with AGENT_APPROVAL=deny the call is actually refused */
            const strict = shippedEngine({ settingsStore: denySettings() });

            await assert.rejects(
                () => strict.enforce(
                    "mcp_call",
                    { server: serverName, tool: "echo", arguments: {} },
                    "main_agent"
                ),
                "mcp_call on a restricted server ran without approval under AGENT_APPROVAL=deny"
            );

        } finally {

            settings.set("MCP_APPROVAL", previousMcpApproval);
            manager.clients.delete(serverName);
            manager.catalogue.delete(namespaced);
        }
    });

    /* ------------------------------------------------------------------ */

    await test("P0-2: model-callable mcp_add cannot self-declare trust:'trusted'", async () => {

        const command = writeStdioServer();

        /* control: the fixture server is reachable, so a pass is meaningful */
        const control =
            await mcpTools.mcp_add({
                name: "p02control",
                transport: "stdio",
                command,
                persist: false
            });

        try {

            assert.equal(
                control.ok,
                true,
                `fixture broken: control server could not be added: ${control.error}`
            );

        } finally {

            await manager.remove("p02control", { persist: false }).catch(() => {});
        }

        const added =
            await mcpTools.mcp_add({
                name: "p02selftrust",
                transport: "stdio",
                command,
                trust: "trusted",
                persist: false
            });

        try {

            if (added.ok === false) {
                /* refusing the self-declared trust outright is also secure */
                return;
            }

            const client = manager.client("p02selftrust");

            assert.ok(client, "mcp_add reported ok but no client was registered");

            assert.notEqual(
                client.config.trust,
                "trusted",
                "mcp_add let the model declare its own server as trusted"
            );

            for (const entry of manager.catalogueEntries()) {

                if (entry.server !== "p02selftrust") {
                    continue;
                }

                assert.notEqual(
                    entry.trust,
                    "trusted",
                    `catalogue entry ${entry.name} carries self-declared trust`
                );
            }

        } finally {

            await manager.remove("p02selftrust", { persist: false }).catch(() => {});
        }
    });

    /* ------------------------------------------------------------------ */

    await test("P0-2: a cached gateway approval does not override AGENT_APPROVAL=deny", async () => {

        let mode = "auto";

        const fakeSettings = {
            get: key =>
                key === "AGENT_APPROVAL"
                    ? mode
                    : key === "APPROVAL_HISTORY_LIMIT"
                        ? 100
                        : null,
            set: (_key, value) => {
                mode = value;
                return value;
            }
        };

        /* an isolated gateway cache, so no other suite is affected */
        const store = new policy.ApprovalStore({ gateway: new Map() });

        const approvals = new policy.ApprovalManager({
            settingsStore: fakeSettings,
            store,
            currentProjectId: () => "prj-p02",
            mcpServerOf: () => "p02gateway",
            globalMcpServer: name =>
                name ? { name, config: { scope: "global" } } : null
        });

        const evaluation = {
            tool: "mcp_call",
            agent: "main_agent",
            reason: "restricted server"
        };

        const first =
            await approvals.request(evaluation, { server: "p02gateway", tool: "echo" });

        assert.equal(first.approved, true);
        assert.equal(
            store.hasGateway("p02gateway"),
            true,
            "fixture broken: the auto approval was not cached for the gateway"
        );

        /* the operator now switches to deny: nothing may run unattended */
        mode = "deny";

        let outcome = null;

        try {

            outcome =
                await approvals.request(evaluation, { server: "p02gateway", tool: "echo" });

        } catch (error) {

            outcome = { thrown: error };
        }

        assert.ok(
            outcome && outcome.thrown,
            `AGENT_APPROVAL=deny was overridden by a cached approval (mode: ${
                outcome && outcome.mode
            }, gateway_cached: ${outcome && outcome.gateway_cached})`
        );

        /* also a pre-seeded cache entry must not bypass deny */
        store.rememberGateway("p02gateway", { approved: true, at: Date.now() });

        await assert.rejects(
            () => approvals.request(evaluation, { server: "p02gateway", tool: "echo" }),
            "a seeded gateway approval bypassed AGENT_APPROVAL=deny"
        );
    });

    /* ------------------------------------------------------------------ */

    await test("P0-2: process_write is policy-gated", async () => {

        const engine = shippedEngine();

        const decision =
            engine.evaluate(
                "process_write",
                { process_id: "proc_1", input: "rm -rf ~\n" },
                "main_agent"
            );

        assert.ok(
            ["require_approval", "deny"].includes(decision.decision),
            `process_write was "${decision.decision}" (rule: ${decision.rule}); writing to a running shell must be gated`
        );

        const strict = shippedEngine({ settingsStore: denySettings() });

        await assert.rejects(
            () => strict.enforce(
                "process_write",
                { process_id: "proc_1", input: "echo hi\n" },
                "main_agent"
            ),
            "process_write ran without approval under AGENT_APPROVAL=deny"
        );
    });

    /* ------------------------------------------------------------------ */

    try {
        await managerRegistry.shutdown();
    } catch {
        /* nothing left to close */
    }

    try {
        fs.rmSync(WORKSPACE, { recursive: true, force: true });
    } catch {
        /* Windows may still hold the server script briefly */
    }

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length > 0) {
        process.exitCode = 1;
    }
}


main().catch(async error => {

    console.error(error);
    process.exitCode = 1;

    try {
        await managerRegistry.shutdown();
    } catch {
        /* ignore */
    }
});
