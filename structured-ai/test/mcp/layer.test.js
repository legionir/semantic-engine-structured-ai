"use strict";

/*
|--------------------------------------------------------------------------
| MCP Layer — EXECUTION_PLAN Phase 20
|--------------------------------------------------------------------------
|
| Locks the extracted MCP modules against the historical files:
| wrappers stay facades, there is no require cycle back to agent.js,
| split/merged frames decode, namespaced tools do not collide, a
| broken server does not crash the runtime, and Phase 9 project
| scoping is unchanged. No MODE flag is invented.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase20-mcp-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";

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


function writeStdioServer(serverName) {

    const file =
        path.join(WORKSPACE, `server-${crypto.randomBytes(4).toString("hex")}.js`);

    const source = `
"use strict";
const NAME = ${JSON.stringify(serverName)};
function send(message) {
    const body = JSON.stringify(message);
    if (lineMode) {
        process.stdout.write(body + "\\n");
        return;
    }
    process.stdout.write(
        "Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body
    );
}
let buffer = Buffer.alloc(0);
let lineMode = false;
process.stdin.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
        /* answer in the framing the client used: NDJSON lines or Content-Length */
        const text = buffer.toString("utf8");
        const start = text.search(/\\S/);
        if (start !== -1 && text[start] === "{") {
            const newline = buffer.indexOf("\\n");
            if (newline === -1) return;
            const line = buffer.slice(0, newline).toString().trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            lineMode = true;
            handle(JSON.parse(line));
            continue;
        }
        const separator = buffer.indexOf("\\r\\n\\r\\n");
        if (separator === -1) return;
        const match = /Content-Length:\\s*(\\d+)/i.exec(
            buffer.slice(0, separator).toString()
        );
        if (!match) return;
        const length = parseInt(match[1], 10);
        if (buffer.length < separator + 4 + length) return;
        const body = buffer.slice(separator + 4, separator + 4 + length).toString();
        buffer = buffer.slice(separator + 4 + length);
        lineMode = false;
        handle(JSON.parse(body));
    }
});
function handle(message) {
    {
        if (message.method === "initialize") {
            send({ jsonrpc: "2.0", id: message.id, result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: NAME, version: "1.0.0" }
            }});
            return;
        }
        if (message.method === "tools/list") {
            send({ jsonrpc: "2.0", id: message.id, result: { tools: [
                { name: "echo", description: "echo", inputSchema: { type: "object", properties: {} } }
            ]}});
            return;
        }
        if (message.method === "tools/call") {
            send({ jsonrpc: "2.0", id: message.id, result: {
                content: [{ type: "text", text: JSON.stringify({ via: NAME }) }]
            }});
            return;
        }
        if (message.id !== undefined) {
            send({ jsonrpc: "2.0", id: message.id, result: {} });
        }
    }
}
`;

    fs.writeFileSync(file, source, "utf8");

    return file;
}


async function main() {

    const mcpDir = path.join(REPO, "agent", "mcp");
    const settings = require(path.join(REPO, "agent", "config"));
    const protocol = require(path.join(mcpDir, "protocol"));
    const config = require(path.join(mcpDir, "McpConfig.js"));
    const managerMod = require(path.join(mcpDir, "McpManager.js"));
    const clientMod = require(path.join(mcpDir, "McpConnection.js"));


    await test("named Phase 20 modules exist", async () => {

        const required = [
            "McpManager.js",
            "McpConfigLoader.js",
            "McpConfigValidator.js",
            "McpConnection.js",
            "McpCatalogue.js",
            "McpTrustPolicy.js",
            path.join("protocol", "JsonRpcCodec.js"),
            path.join("protocol", "ContentLengthCodec.js"),
            path.join("protocol", "NdjsonCodec.js"),
            path.join("protocol", "McpErrors.js"),
            path.join("protocol", "index.js"),
            path.join("transports", "StdioTransport.js"),
            path.join("transports", "HttpTransport.js"),
            path.join("transports", "SseTransport.js"),
            path.join("transports", "WebSocketTransport.js")
        ];

        for (const name of required) {

            assert.equal(
                fs.existsSync(path.join(mcpDir, name)),
                true,
                `missing agent/mcp/${name}`
            );

        }

    });


    await test("canonical MCP modules expose one public connection and configuration surface", async () => {

        assert.equal(config.load, require(path.join(mcpDir, "McpConfigLoader.js")).load);
        assert.equal(config.normalizeOne, require(path.join(mcpDir, "McpConfigValidator.js")).normalizeOne);
        assert.equal(config.serverVisibleTo, require(path.join(mcpDir, "McpTrustPolicy.js")).serverVisibleTo);
        assert.equal(typeof managerMod.McpManager, "function");
        assert.equal(typeof managerMod.manager, "object");
        assert.equal(clientMod.McpClient, clientMod.McpConnection);
        assert.equal(typeof protocol.MessageDecoder, "function");
        assert.equal(typeof protocol.EventStreamDecoder, "function");
        for (const removed of [
            "client.js", "config.js", "manager.js", "protocol.js",
            path.join("transports", "stdio.js"), path.join("transports", "http.js"),
            path.join("transports", "sse.js"), path.join("transports", "websocket.js")
        ]) {
            assert.equal(fs.existsSync(path.join(mcpDir, removed)), false, `${removed} is still a wrapper`);
        }

    });


    await test("the extracted MCP modules have no require cycle back to agent.js", async () => {

        const extracted = [
            path.join(mcpDir, "McpManager.js"),
            path.join(mcpDir, "McpConfigLoader.js"),
            path.join(mcpDir, "McpConfigValidator.js"),
            path.join(mcpDir, "McpConnection.js"),
            path.join(mcpDir, "McpCatalogue.js"),
            path.join(mcpDir, "McpTrustPolicy.js"),
            path.join(mcpDir, "protocol"),
            path.join(mcpDir, "transports", "StdioTransport.js"),
            path.join(mcpDir, "transports", "HttpTransport.js"),
            path.join(mcpDir, "transports", "SseTransport.js"),
            path.join(mcpDir, "transports", "WebSocketTransport.js")
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


    await test("split and merged frames decode as separate JSON-RPC messages", async () => {

        const seen = [];

        const decoder =
            new protocol.MessageDecoder(message => seen.push(message));

        const first =
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "a" });

        const second =
            JSON.stringify({ jsonrpc: "2.0", id: 2, result: "b" });

        const framed =
            protocol.encode({ jsonrpc: "2.0", id: 1, result: "a" }) +
            protocol.encode({ jsonrpc: "2.0", id: 2, result: "b" });

        for (const byte of Buffer.from(framed)) {
            decoder.push(Buffer.from([byte]));
        }

        assert.deepEqual(seen.map(item => item.result), ["a", "b"]);

        const merged = [];

        const secondDecoder =
            new protocol.MessageDecoder(message => merged.push(message));

        secondDecoder.push(
            Buffer.from(
                `Content-Length: ${Buffer.byteLength(first)}\r\n\r\n${first}` +
                `Content-Length: ${Buffer.byteLength(second)}\r\n\r\n${second}`
            )
        );

        assert.deepEqual(merged.map(item => item.result), ["a", "b"]);

        const lines = [];

        const lineDecoder =
            new protocol.MessageDecoder(message => lines.push(message));

        lineDecoder.push(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: 3, result: 9 })}\n`));

        assert.equal(lines[0].result, 9);

        const contentLength = require(path.join(mcpDir, "protocol", "ContentLengthCodec.js"));
        const ndjson = require(path.join(mcpDir, "protocol", "NdjsonCodec.js"));

        assert.match(contentLength.encode({ id: 1 }), /Content-Length:/);
        assert.match(ndjson.encode({ id: 1 }), /\n$/);

    });


    await test("same-named tools on two servers do not collide", async () => {

        const { McpManager } = managerMod;
        const manager = new McpManager();

        await manager.add(
            "alpha",
            { command: writeStdioServer("alpha-server"), cwd: WORKSPACE },
            { persist: false }
        );

        await manager.add(
            "beta",
            { command: writeStdioServer("beta-server"), cwd: WORKSPACE },
            { persist: false }
        );

        const names =
            manager.catalogueEntries().map(entry => entry.name).sort();

        assert.deepEqual(names, ["mcp__alpha__echo", "mcp__beta__echo"]);

        assert.equal(
            (await manager.callTool("mcp__alpha__echo", {})).via,
            "alpha-server"
        );

        assert.equal(
            (await manager.callTool("mcp__beta__echo", {})).via,
            "beta-server"
        );

        await manager.shutdown();

    });


    await test("a broken server is left out and does not crash the runtime", async () => {

        const { McpManager } = managerMod;
        const { McpClient } = clientMod;
        const manager = new McpManager();

        await manager.add(
            "working",
            { command: writeStdioServer("working-server"), cwd: WORKSPACE },
            { persist: false }
        );

        manager.clients.set(
            "broken",
            new McpClient({
                name: "broken",
                transport: "http",
                url: "http://127.0.0.1:1/mcp",
                enabled: true
            })
        );

        const discovered =
            await manager.discover({ force: true });

        assert.deepEqual(
            discovered.map(entry => entry.server),
            ["working"]
        );

        assert.equal(
            manager.status().servers.find(server => server.name === "broken").state,
            "failed"
        );

        assert.equal(
            (await manager.callTool("mcp__working__echo", {})).via,
            "working-server"
        );

        await manager.shutdown();

    });


    await test("all four transports are registered and Phase 9 project scope is preserved", async () => {

        assert.deepEqual(
            [...clientMod.TRANSPORT_KINDS].sort(),
            ["http", "sse", "stdio", "websocket"]
        );

        const trust = require(path.join(mcpDir, "McpTrustPolicy.js"));

        assert.equal(trust.serverVisibleTo({ scope: "global" }, "prj-a"), true);
        assert.equal(trust.serverVisibleTo({ scope: "project", projects: ["prj-a"] }, "prj-a"), true);
        assert.equal(trust.serverVisibleTo({ scope: "project", projects: ["prj-a"] }, "prj-b"), false);
        assert.equal(trust.serverVisibleTo({ scope: "project", projects: ["prj-a"] }, null), true);

        assert.equal(config.serverVisibleTo, trust.serverVisibleTo);

        const { McpClient } = clientMod;

        const client =
            new McpClient({
                name: "phase20",
                transport: "stdio",
                command: writeStdioServer("handshake-server"),
                cwd: WORKSPACE
            });

        await client.listTools();

        assert.equal(client.state, "ready");
        assert.equal(client.serverInfo.name, "handshake-server");

        await client.close();

    });


    await test("Phase 30 removes rollout flags while preserving the MCP surface", async () => {

        for (const removed of [
            "PROJECT_CONTEXT_MODE",
            "RUN_CONTEXT_MODE",
            "PROMPT_BUILDER_MODE",
            "SEMANTIC_POOL_MODE",
            "RUNTIME_ENGINE_MODE",
            "WEB_SERVER_MODE",
            "MCP_LAYER_MODE",
            "MCP_MODE"
        ]) {
            assert.throws(() => settings.definitionOf(removed), /Unknown setting/);
        }

        const keys = settings.definitions.map(item => item.key);
        assert.equal(keys.some(key => key.endsWith("_MODE") && key.startsWith("MCP_")), false);

        walkJs(mcpDir, full => {

            const body = fs.readFileSync(full, "utf8");

            assert.equal(
                /MCP_LAYER_MODE|MCP_SERVER_MODE/.test(body),
                false,
                `${path.relative(REPO, full)} invented a MODE flag`
            );

        });

    });


    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
