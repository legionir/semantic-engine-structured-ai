const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

/*
| The MCP layer is what four different protocols have in common, so the
| suite proves the common part once and then proves that each transport
| really carries it: a server is started for real, over a real pipe,
| socket or port, and the same tool call is made through all four.
|
| WORKSPACE_ROOT must be set before the tools are loaded.
*/

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "mcp-test-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;

const protocol = require("../agent/mcp/protocol");
const config = require("../agent/mcp/config");
const { McpManager } = require("../agent/mcp/manager");
const { McpClient } = require("../agent/mcp/client");
const websocket = require("../agent/mcp/transports/websocket");
const settings = require("../agent/lib/storage");
const tools = require("../agent/tools");

const results = [];

const cleanups = [];


async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}\n${error.stack}`);
    }
}


/*
|--------------------------------------------------------------------------
| A server that is real enough to be wrong about
|--------------------------------------------------------------------------
|
| One implementation, four ways to reach it. It answers the handshake,
| lists two tools, and echoes its arguments back, which is enough to
| prove that a call left the runtime and came back.
|--------------------------------------------------------------------------
*/

const TOOL_LIST = [
    {
        name: "echo",
        description: "Echo the arguments back.",
        inputSchema: {
            type: "object",
            properties: {
                message: { type: "string", description: "text to echo" }
            },
            required: ["message"]
        }
    },
    {
        name: "add",
        description: "Add two numbers.",
        inputSchema: {
            type: "object",
            properties: {
                a: { type: "number", description: "first" },
                b: { type: "number", description: "second" }
            },
            required: ["a", "b"]
        }
    }
];


function answer(message, serverName) {

    if (message.method === "initialize") {

        return {
            jsonrpc: "2.0",
            id: message.id,
            result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name: serverName, version: "1.0.0" }
            }
        };
    }

    if (message.method === "tools/list") {

        return {
            jsonrpc: "2.0",
            id: message.id,
            result: { tools: TOOL_LIST }
        };
    }

    if (message.method === "ping") {

        return { jsonrpc: "2.0", id: message.id, result: {} };
    }

    if (message.method === "tools/call") {

        const name = message.params && message.params.name;

        const args = (message.params && message.params.arguments) || {};

        if (name === "echo") {

            return {
                jsonrpc: "2.0",
                id: message.id,
                result: {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                echoed: args.message,
                                via: serverName
                            })
                        }
                    ]
                }
            };
        }

        if (name === "add") {

            return {
                jsonrpc: "2.0",
                id: message.id,
                result: {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ sum: args.a + args.b })
                        }
                    ]
                }
            };
        }

        if (name === "explode") {

            return {
                jsonrpc: "2.0",
                id: message.id,
                result: {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ error: "the tool refused" })
                        }
                    ]
                }
            };
        }

        return {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: `unknown tool: ${name}` }
        };
    }

    if (message.id !== undefined) {

        return {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: `unknown method: ${message.method}` }
        };
    }

    return null;
}


/*
| The stdio flavour is a script on disk, because a stdio server is a
| process this runtime spawns and nothing less proves that.
*/

function writeStdioServer(options = {}) {

    const file =
        path.join(
            WORKSPACE,
            `server-${crypto.randomBytes(4).toString("hex")}.js`
        );

    const source = `
"use strict";

const TOOL_LIST = ${JSON.stringify(TOOL_LIST)};

const NAME = ${JSON.stringify(options.name || "stdio-server")};

const NDJSON = ${options.ndjson ? "true" : "false"};

const HANG = ${options.hang ? "true" : "false"};

const CRASH = ${options.crash ? "true" : "false"};

${answer.toString()}

function send(message) {
    const body = JSON.stringify(message);
    if (NDJSON) {
        process.stdout.write(body + "\\n");
        return;
    }
    process.stdout.write(
        "Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body
    );
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", chunk => {

    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {

        const separator = buffer.indexOf("\\r\\n\\r\\n");

        if (separator !== -1 && /^Content-Length/i.test(buffer.slice(0, 15).toString())) {

            const match = /Content-Length:\\s*(\\d+)/i.exec(
                buffer.slice(0, separator).toString()
            );

            const length = parseInt(match[1], 10);

            if (buffer.length < separator + 4 + length) return;

            const body = buffer.slice(separator + 4, separator + 4 + length).toString();

            buffer = buffer.slice(separator + 4 + length);

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

function handle(message) {

    if (message.method === "tools/call" && CRASH) {
        process.exit(1);
    }

    if (message.method === "tools/call" && HANG) {
        return;
    }

    const reply = answer(message, NAME);

    if (reply) send(reply);
}
`;

    fs.writeFileSync(file, source, "utf8");

    return file;
}


/*
| One HTTP listener that speaks all three network transports, chosen by
| path, so a test can point any of them at the same port.
*/

function startHttpServer(options = {}) {

    const sseClients = new Set();

    const server =
        http.createServer((req, res) => {

            const url =
                new URL(req.url, "http://127.0.0.1");

            if (url.pathname === "/mcp" && req.method === "POST") {

                readBody(req).then(body => {

                    const message = JSON.parse(body);

                    const reply = answer(message, options.name || "http-server");

                    if (!reply) {

                        res.writeHead(202).end();

                        return;
                    }

                    if (options.stream) {

                        res.writeHead(200, {
                            "content-type": "text/event-stream"
                        });

                        res.write(
                            `event: message\ndata: ${JSON.stringify({
                                jsonrpc: "2.0",
                                method: "notifications/message",
                                params: { level: "info", data: "working" }
                            })}\n\n`
                        );

                        res.write(
                            `event: message\ndata: ${JSON.stringify(reply)}\n\n`
                        );

                        res.end();

                        return;
                    }

                    res.writeHead(200, {
                        "content-type": "application/json",
                        "mcp-session-id": "session-1"
                    });

                    res.end(JSON.stringify(reply));
                });

                return;
            }

            if (url.pathname === "/mcp" && req.method === "DELETE") {

                res.writeHead(200).end();

                return;
            }

            /* the older pair: a stream to read, a path to post to */

            if (url.pathname === "/sse" && req.method === "GET") {

                res.writeHead(200, {
                    "content-type": "text/event-stream",
                    "cache-control": "no-cache",
                    connection: "keep-alive"
                });

                res.write("event: endpoint\ndata: /messages\n\n");

                sseClients.add(res);

                req.on("close", () => sseClients.delete(res));

                return;
            }

            if (url.pathname === "/messages" && req.method === "POST") {

                readBody(req).then(body => {

                    const message = JSON.parse(body);

                    res.writeHead(202).end();

                    const reply = answer(message, options.name || "sse-server");

                    if (!reply) {
                        return;
                    }

                    for (const client of sseClients) {

                        client.write(
                            `event: message\ndata: ${JSON.stringify(reply)}\n\n`
                        );
                    }
                });

                return;
            }

            res.writeHead(404).end();
        });

    /* the websocket half: a hand rolled handshake and frame codec */

    server.on("upgrade", (req, socket) => {

        const key = req.headers["sec-websocket-key"];

        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${websocket.acceptValue(key)}\r\n\r\n`
        );

        let buffer = Buffer.alloc(0);

        socket.on("data", chunk => {

            buffer = Buffer.concat([buffer, chunk]);

            for (;;) {

                const frame =
                    websocket.decodeFrame(buffer);

                if (!frame) {
                    return;
                }

                buffer = frame.rest;

                if (frame.opcode === websocket.OPCODE.CLOSE) {

                    socket.end();

                    return;
                }

                if (frame.opcode !== websocket.OPCODE.TEXT) {
                    continue;
                }

                const message =
                    JSON.parse(frame.payload.toString("utf8"));

                const reply =
                    answer(message, options.name || "ws-server");

                if (!reply) {
                    continue;
                }

                /*
                | Answered unmasked, as a server must, and through the
                | runtime's own encoder with the mask bit cleared.
                */

                socket.write(
                    serverFrame(JSON.stringify(reply))
                );
            }
        });
    });

    return new Promise(resolve => {

        server.listen(0, "127.0.0.1", () => {

            const port = server.address().port;

            const handle = {
                port,

                close: () =>
                    new Promise(done => {

                        for (const client of sseClients) {
                            client.end();
                        }

                        server.closeAllConnections?.();

                        server.close(done);
                    })
            };

            cleanups.push(handle.close);

            resolve(handle);
        });
    });
}


function serverFrame(text) {

    const body = Buffer.from(text, "utf8");

    const header =
        body.length < 126
            ? Buffer.alloc(2)
            : Buffer.alloc(4);

    header[0] = 0x81;

    if (body.length < 126) {

        header[1] = body.length;

    } else {

        header[1] = 126;

        header.writeUInt16BE(body.length, 2);
    }

    return Buffer.concat([header, body]);
}


function readBody(req) {

    return new Promise(resolve => {

        let body = "";

        req.on("data", chunk => body += chunk);

        req.on("end", () => resolve(body));
    });
}


function freshManager() {

    const manager = new McpManager();

    cleanups.push(() => manager.shutdown());

    return manager;
}


async function main() {

    console.log(`workspace: ${WORKSPACE}\n`);

    /* ---------------------------------------------------------------- */
    console.log("wire protocol");

    await test("a decoder reads both framings, including one split mid-message", async () => {

        const seen = [];

        const decoder =
            new protocol.MessageDecoder(message => seen.push(message));

        const body =
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });

        const framed =
            `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

        /* one byte at a time is the worst a pipe can do */

        for (const byte of Buffer.from(framed)) {
            decoder.push(Buffer.from([byte]));
        }

        decoder.push(
            Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: 7 })}\n`)
        );

        assert.equal(seen.length, 2);
        assert.equal(seen[0].result.ok, true);
        assert.equal(seen[1].result, 7);
    });

    await test("two messages arriving in one chunk are not merged", async () => {

        const seen = [];

        const decoder =
            new protocol.MessageDecoder(message => seen.push(message));

        const first =
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "a" });

        const second =
            JSON.stringify({ jsonrpc: "2.0", id: 2, result: "b" });

        decoder.push(
            Buffer.from(
                `Content-Length: ${Buffer.byteLength(first)}\r\n\r\n${first}` +
                `Content-Length: ${Buffer.byteLength(second)}\r\n\r\n${second}`
            )
        );

        assert.deepEqual(
            seen.map(message => message.result),
            ["a", "b"]
        );
    });

    await test("a tool result is unpacked out of its content envelope", async () => {

        assert.deepEqual(
            protocol.unpackToolResult({
                content: [{ type: "text", text: '{"total":2}' }]
            }),
            { total: 2 }
        );

        /* text that is not JSON is text, not a parse failure */

        assert.deepEqual(
            protocol.unpackToolResult({
                content: [{ type: "text", text: "plain words" }]
            }),
            { text: "plain words" }
        );

        /* a structured result wins over the text rendering of it */

        assert.deepEqual(
            protocol.unpackToolResult({
                structuredContent: { total: 3 },
                content: [{ type: "text", text: "3" }]
            }),
            { total: 3 }
        );
    });

    await test("an event stream is split into events, not lines", async () => {

        const seen = [];

        const decoder =
            new protocol.EventStreamDecoder(event => seen.push(event));

        decoder.push("event: endpoint\ndata: /messages\n\n");
        decoder.push(": a comment that means nothing\n\n");
        decoder.push('event: message\ndata: {"jsonrpc"');
        decoder.push(':"2.0","id":1}\n\n');

        assert.equal(seen.length, 2);
        assert.equal(seen[0].event, "endpoint");
        assert.equal(seen[0].data, "/messages");
        assert.equal(JSON.parse(seen[1].data).id, 1);
    });

    await test("a websocket frame survives a round trip through the codec", async () => {

        const encoded =
            websocket.encodeFrame(websocket.OPCODE.TEXT, "hello");

        /* a client frame must be masked, which is the bit servers check */

        assert.equal((encoded[1] & 0x80) !== 0, true);

        const decoded =
            websocket.decodeFrame(encoded);

        assert.equal(decoded.payload.toString("utf8"), "hello");
        assert.equal(decoded.fin, true);

        /* a frame that is not all there yet decodes to nothing, not to junk */

        assert.equal(
            websocket.decodeFrame(encoded.slice(0, 4)),
            null
        );

        /* the extended length path, which a large tool result takes */

        const long =
            "x".repeat(70000);

        assert.equal(
            websocket.decodeFrame(
                websocket.encodeFrame(websocket.OPCODE.TEXT, long)
            ).payload.toString("utf8").length,
            70000
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nconfiguration");

    await test("the transport is inferred from what the entry actually has", async () => {

        fs.writeFileSync(
            path.join(WORKSPACE, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    local: { command: "node", args: ["server.js"] },
                    remote: { url: "https://example.com/mcp" },
                    legacy: { url: "https://example.com/sse" },
                    socket: { url: "wss://example.com/ws" }
                }
            }),
            "utf8"
        );

        const loaded =
            config.load(WORKSPACE);

        const byName =
            Object.fromEntries(
                loaded.servers.map(server => [server.name, server])
            );

        assert.equal(byName.local.transport, "stdio");
        assert.equal(byName.remote.transport, "http");
        assert.equal(byName.legacy.transport, "sse");
        assert.equal(byName.socket.transport, "websocket");
        assert.deepEqual(loaded.problems, []);
    });

    await test("a broken entry is skipped and named, and the rest still load", async () => {

        fs.writeFileSync(
            path.join(WORKSPACE, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    good: { url: "https://example.com/mcp" },
                    nothing: { description: "neither a command nor a url" },
                    "bad name!": { command: "node" }
                }
            }),
            "utf8"
        );

        const loaded =
            config.load(WORKSPACE);

        assert.deepEqual(
            loaded.servers.map(server => server.name),
            ["good"]
        );

        assert.equal(loaded.problems.length, 2);
        assert.match(loaded.problems.join(" "), /nothing/);
        assert.match(loaded.problems.join(" "), /bad name!/);
    });

    await test("a token in the environment is read, never stored in the file", async () => {

        process.env.MCP_TEST_TOKEN = "s3cret";

        fs.writeFileSync(
            path.join(WORKSPACE, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    remote: {
                        url: "https://example.com/mcp",
                        headers: { authorization: "Bearer ${env:MCP_TEST_TOKEN}" }
                    }
                }
            }),
            "utf8"
        );

        const loaded =
            config.load(WORKSPACE);

        assert.equal(
            loaded.servers[0].headers.authorization,
            "Bearer s3cret"
        );

        assert.match(
            fs.readFileSync(path.join(WORKSPACE, ".mcp.json"), "utf8"),
            /\$\{env:MCP_TEST_TOKEN\}/
        );

        delete process.env.MCP_TEST_TOKEN;
    });

    await test("the environment overrides the file, and the file overrides the registry", async () => {

        fs.writeFileSync(
            path.join(WORKSPACE, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    shared: { url: "https://from-file.example.com/mcp" }
                }
            }),
            "utf8"
        );

        settings.set(
            "MCP_SERVERS",
            JSON.stringify({
                shared: { url: "https://from-environment.example.com/mcp" }
            })
        );

        const loaded =
            config.load(WORKSPACE);

        assert.equal(
            loaded.servers.find(server => server.name === "shared").url,
            "https://from-environment.example.com/mcp"
        );

        settings.reset("MCP_SERVERS");
    });

    await test("every container shape people actually write is accepted", async () => {

        for (const document of [
            { mcpServers: { one: { url: "https://a.example.com/mcp" } } },
            { servers: { one: { url: "https://a.example.com/mcp" } } },
            { one: { url: "https://a.example.com/mcp" } },
            [{ name: "one", url: "https://a.example.com/mcp" }]
        ]) {

            fs.writeFileSync(
                path.join(WORKSPACE, ".mcp.json"),
                JSON.stringify(document),
                "utf8"
            );

            const loaded =
                config.load(WORKSPACE);

            assert.equal(
                loaded.servers.length,
                1,
                `this shape was not understood: ${JSON.stringify(document)}`
            );

            assert.equal(loaded.servers[0].name, "one");
        }

        fs.rmSync(path.join(WORKSPACE, ".mcp.json"), { force: true });
    });

    /* ---------------------------------------------------------------- */
    console.log("\ntransports");

    await test("stdio: a spawned server is reached, listed and called", async () => {

        const client =
            new McpClient({
                name: "stdio",
                transport: "stdio",
                command: writeStdioServer({ name: "stdio-server" }),
                cwd: WORKSPACE
            });

        const catalogue =
            await client.listTools();

        assert.equal(client.serverInfo.name, "stdio-server");
        assert.deepEqual(
            catalogue.map(tool => tool.name),
            ["echo", "add"]
        );

        const result =
            await client.callTool("echo", { message: "over a pipe" });

        assert.equal(result.echoed, "over a pipe");
        assert.equal(result.via, "stdio-server");

        await client.close();
    });

    await test("stdio: a server that answers in lines is understood too", async () => {

        const client =
            new McpClient({
                name: "ndjson",
                transport: "stdio",
                command: writeStdioServer({ name: "ndjson-server", ndjson: true }),
                cwd: WORKSPACE
            });

        const result =
            await client.callTool("add", { a: 2, b: 3 });

        assert.equal(result.sum, 5);

        await client.close();
    });

    await test("http: one post carries the call and brings the answer back", async () => {

        const server =
            await startHttpServer({ name: "http-server" });

        const client =
            new McpClient({
                name: "http",
                transport: "http",
                url: `http://127.0.0.1:${server.port}/mcp`
            });

        await client.listTools();

        const result =
            await client.callTool("echo", { message: "over http" });

        assert.equal(result.echoed, "over http");
        assert.equal(client.transport.sessionId, "session-1");

        await client.close();

        await server.close();
    });

    await test("http: an answer streamed as events is read past the notifications", async () => {

        const server =
            await startHttpServer({ name: "streaming-server", stream: true });

        const client =
            new McpClient({
                name: "streaming",
                transport: "http",
                url: `http://127.0.0.1:${server.port}/mcp`
            });

        const result =
            await client.callTool("add", { a: 20, b: 22 });

        assert.equal(result.sum, 42);

        /* the notification that arrived first was kept, not dropped */

        assert.match(
            client.diagnosticsTail().map(item => item.text).join(" "),
            /working/
        );

        await client.close();

        await server.close();
    });

    await test("sse: the endpoint event is followed, and answers arrive on the stream", async () => {

        const server =
            await startHttpServer({ name: "sse-server" });

        const client =
            new McpClient({
                name: "sse",
                transport: "sse",
                url: `http://127.0.0.1:${server.port}/sse`
            });

        const catalogue =
            await client.listTools();

        assert.equal(catalogue.length, 2);

        const result =
            await client.callTool("echo", { message: "over sse" });

        assert.equal(result.echoed, "over sse");
        assert.equal(client.transport.postUrl.pathname, "/messages");

        await client.close();

        await server.close();
    });

    await test("websocket: the handshake completes and frames carry the calls", async () => {

        const server =
            await startHttpServer({ name: "ws-server" });

        const client =
            new McpClient({
                name: "socket",
                transport: "websocket",
                url: `ws://127.0.0.1:${server.port}/ws`
            });

        await client.listTools();

        const result =
            await client.callTool("echo", { message: "over a socket" });

        assert.equal(result.echoed, "over a socket");
        assert.equal(result.via, "ws-server");

        /* the same socket carries a second call */

        assert.equal(
            (await client.callTool("add", { a: 1, b: 1 })).sum,
            2
        );

        await client.close();

        await server.close();
    });

    /* ---------------------------------------------------------------- */
    console.log("\nfailure");

    await test("a server that never answers times out instead of hanging", async () => {

        const client =
            new McpClient({
                name: "hanging",
                transport: "stdio",
                command: writeStdioServer({ hang: true }),
                cwd: WORKSPACE,
                timeouts: { call: 300 }
            });

        await assert.rejects(
            () => client.callTool("echo", { message: "hello" }),
            /timed out after 300ms/
        );

        await client.close();
    });

    await test("a server that dies mid-call rejects the call it was holding", async () => {

        const client =
            new McpClient({
                name: "crashing",
                transport: "stdio",
                command: writeStdioServer({ crash: true }),
                cwd: WORKSPACE,
                timeouts: { call: 5000 }
            });

        await assert.rejects(
            () => client.callTool("echo", { message: "hello" }),
            /exited unexpectedly/
        );

        await client.close();
    });

    await test("a tool that fails is an error, whichever way the server says so", async () => {

        const server =
            await startHttpServer({});

        const client =
            new McpClient({
                name: "failing",
                transport: "http",
                url: `http://127.0.0.1:${server.port}/mcp`
            });

        /* isError on a result */

        await assert.rejects(
            () => client.callTool("explode", {}),
            /the tool refused/
        );

        /* a JSON-RPC error object */

        await assert.rejects(
            () => client.callTool("nope", {}),
            /unknown tool: nope/
        );

        await client.close();

        await server.close();
    });

    await test("an unreachable server fails the call, not the process", async () => {

        const client =
            new McpClient({
                name: "gone",
                transport: "http",
                url: "http://127.0.0.1:1/mcp"
            });

        await assert.rejects(
            () => client.callTool("echo", {}),
            /unreachable/
        );

        assert.equal(client.state, "failed");

        await client.close();
    });

    /* ---------------------------------------------------------------- */
    console.log("\nmanager and catalogue");

    await test("tools from several servers are namespaced instead of shadowing", async () => {

        const server =
            await startHttpServer({ name: "remote" });

        const manager = freshManager();

        await manager.add(
            "alpha",
            { url: `http://127.0.0.1:${server.port}/mcp` },
            { persist: false }
        );

        await manager.add(
            "beta",
            { command: writeStdioServer({ name: "beta-server" }), cwd: WORKSPACE },
            { persist: false }
        );

        const names =
            manager.catalogueEntries().map(entry => entry.name).sort();

        assert.deepEqual(
            names,
            [
                "mcp__alpha__add",
                "mcp__alpha__echo",
                "mcp__beta__add",
                "mcp__beta__echo"
            ]
        );

        /* each namespaced name reaches its own server, not the other one */

        assert.equal(
            (await manager.callTool("mcp__alpha__echo", { message: "a" })).via,
            "remote"
        );

        assert.equal(
            (await manager.callTool("mcp__beta__echo", { message: "b" })).via,
            "beta-server"
        );

        await manager.shutdown();

        await server.close();
    });

    await test("include and exclude decide what the model is allowed to see", async () => {

        const manager = freshManager();

        await manager.add(
            "narrow",
            {
                command: writeStdioServer({}),
                cwd: WORKSPACE,
                include: ["echo"]
            },
            { persist: false }
        );

        assert.deepEqual(
            manager.catalogueEntries().map(entry => entry.tool),
            ["echo"]
        );

        /* and a filtered tool cannot be reached around the catalogue */

        await assert.rejects(
            () => manager.call("narrow", "add", { a: 1, b: 1 }),
            /filtered out/
        );

        await manager.shutdown();
    });

    await test("a published schema becomes a tool declaration the endpoint accepts", async () => {

        const manager = freshManager();

        await manager.add(
            "declared",
            { command: writeStdioServer({}), cwd: WORKSPACE },
            { persist: false }
        );

        const declaration =
            manager.toolDeclarations().find(
                tool => tool.function.name === "mcp__declared__add"
            );

        assert.equal(declaration.type, "function");
        assert.match(declaration.function.description, /\[MCP declared\]/);
        assert.equal(declaration.function.parameters.type, "object");
        assert.deepEqual(
            declaration.function.parameters.required,
            ["a", "b"]
        );
        assert.ok(declaration.function.parameters.properties.a);

        await manager.shutdown();
    });

    await test("a server that will not connect is left out, and the rest still work", async () => {

        const manager = freshManager();

        await manager.add(
            "working",
            { command: writeStdioServer({}), cwd: WORKSPACE },
            { persist: false }
        );

        /*
        | Added straight into the table, the way a configuration file
        | does it: a definition that was never proved reachable.
        */

        const { McpClient: Client } = require("../agent/mcp/client");

        manager.clients.set(
            "broken",
            new Client({
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
            ["working", "working"]
        );

        const status = manager.status();

        assert.equal(
            status.servers.find(server => server.name === "broken").state,
            "failed"
        );

        await manager.shutdown();
    });

    await test("a server added at runtime is written down for the next run", async () => {

        const manager = freshManager();

        const command =
            writeStdioServer({ name: "persisted-server" });

        await manager.add(
            "saved",
            { command, cwd: WORKSPACE },
            { persist: true }
        );

        const file =
            path.join(WORKSPACE, ".agent", "mcp.json");

        const written =
            JSON.parse(fs.readFileSync(file, "utf8"));

        assert.equal(written.mcpServers.saved.command, command);
        assert.equal(written.mcpServers.saved.transport, "stdio");

        await manager.remove("saved", { persist: true });

        assert.equal(
            JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.saved,
            undefined
        );

        await manager.shutdown();
    });

    await test("removing a server withdraws its tools immediately", async () => {

        const manager = freshManager();

        await manager.add(
            "temporary",
            { command: writeStdioServer({}), cwd: WORKSPACE },
            { persist: false }
        );

        assert.equal(manager.catalogueEntries().length, 2);

        await manager.remove("temporary", { persist: false });

        assert.equal(manager.catalogueEntries().length, 0);
        assert.equal(manager.hasTool("mcp__temporary__echo"), false);

        await assert.rejects(
            () => manager.callTool("mcp__temporary__echo", {}),
            /no MCP server called "temporary"/
        );

        await manager.shutdown();
    });

    /* ---------------------------------------------------------------- */
    console.log("\nthe runtime's own tools");

    await test("mcp_servers reports what is configured and why one is not connected", async () => {

        const manager = tools.mcp._manager;

        await manager.add(
            "reported",
            { command: writeStdioServer({ name: "reported-server" }), cwd: WORKSPACE },
            { persist: false }
        );

        const report =
            await tools.executeTool("mcp_servers", {}, { agent: "test" });

        assert.equal(report.enabled, true);
        assert.deepEqual(
            report.supported_transports.sort(),
            ["http", "sse", "stdio", "websocket"]
        );

        const entry =
            report.servers.find(server => server.name === "reported");

        assert.equal(entry.state, "ready");
        assert.equal(entry.transport, "stdio");
        assert.equal(entry.tool_count, 2);
        assert.equal(entry.server_name, "reported-server");
    });

    await test("mcp_tools lists the catalogue with the parameters each tool wants", async () => {

        const listed =
            await tools.executeTool(
                "mcp_tools",
                { server: "reported" },
                { agent: "test" }
            );

        assert.equal(listed.total, 2);

        const add =
            listed.tools.find(tool => tool.tool === "add");

        assert.equal(add.name, "mcp__reported__add");
        assert.deepEqual(add.parameters.sort(), ["a", "b"]);
        assert.deepEqual(add.required.sort(), ["a", "b"]);
    });

    await test("mcp_call reaches a server both by name and by namespaced tool", async () => {

        const byPair =
            await tools.executeTool(
                "mcp_call",
                {
                    server: "reported",
                    tool: "echo",
                    arguments: { message: "through the gateway" }
                },
                { agent: "test" }
            );

        assert.equal(byPair.ok, true);
        assert.equal(byPair.result.echoed, "through the gateway");

        const byName =
            await tools.executeTool(
                "mcp_call",
                {
                    tool: "mcp__reported__add",
                    arguments: { a: 4, b: 4 }
                },
                { agent: "test" }
            );

        assert.equal(byName.ok, true);
        assert.equal(byName.result.sum, 8);
    });

    await test("a discovered tool is callable by its own name, like any other tool", async () => {

        assert.equal(tools.hasTool("mcp__reported__echo"), true);

        assert.ok(
            tools.callableToolNames().includes("mcp__reported__echo")
        );

        const result =
            await tools.executeTool(
                "mcp__reported__echo",
                { message: "called directly" },
                { agent: "test" }
            );

        assert.equal(result.ok, true);
        assert.equal(result.result.echoed, "called directly");

        /* and the runtime counted it, the same as a built-in tool */

        assert.ok(
            tools.telemetry
                .executedToolNames()
                .includes("mcp__reported__echo")
        );
    });

    await test("a failing MCP call is reported, never thrown into the run", async () => {

        const result =
            await tools.executeTool(
                "mcp_call",
                { server: "reported", tool: "does_not_exist", arguments: {} },
                { agent: "test" }
            );

        assert.equal(result.ok, false);
        assert.match(result.error, /unknown tool/);

        const missingServer =
            await tools.executeTool(
                "mcp_call",
                { server: "never_configured", tool: "echo" },
                { agent: "test" }
            );

        assert.equal(missingServer.ok, false);
        assert.match(missingServer.error, /no MCP server called/);
    });

    await test("turning MCP off withdraws every server and its tools", async () => {

        settings.set("MCP_ENABLED", false);

        const report =
            await tools.executeTool("mcp_servers", {}, { agent: "test" });

        assert.equal(report.enabled, false);

        const listed =
            await tools.executeTool("mcp_tools", {}, { agent: "test" });

        assert.equal(listed.ok, false);
        assert.match(listed.error, /disabled/);

        settings.reset("MCP_ENABLED");
    });

    /* ---------------------------------------------------------------- */
    console.log("\npolicy");

    await test("a restricted server needs approval, a default one does not", async () => {

        const { PolicyEngine } = require("../agent/lib/policy");

        const engine =
            new PolicyEngine({
                policy: require("../agent/registry/policy.json"),
                toolGroups: require("../agent/registry/tool_groups.json")
            });

        const manager = tools.mcp._manager;

        await manager.add(
            "guarded",
            {
                command: writeStdioServer({}),
                cwd: WORKSPACE,
                trust: "restricted"
            },
            { persist: false }
        );

        assert.equal(
            engine.evaluate("mcp__guarded__echo", {}, "main_agent").decision,
            "require_approval"
        );

        assert.equal(
            engine.evaluate("mcp__reported__echo", {}, "main_agent").decision,
            "allow"
        );

        /* inspection is free whatever the servers are */

        assert.equal(
            engine.evaluate("mcp_servers", {}, "main_agent").decision,
            "allow"
        );

        /* and connecting a new server always asks */

        assert.equal(
            engine.evaluate("mcp_add", {}, "main_agent").decision,
            "require_approval"
        );

        await manager.remove("guarded", { persist: false });
    });

    await test("MCP_APPROVAL can tighten every call, and never loosens a denial", async () => {

        const { PolicyEngine } = require("../agent/lib/policy");

        const engine =
            new PolicyEngine({
                policy: require("../agent/registry/policy.json"),
                toolGroups: require("../agent/registry/tool_groups.json")
            });

        settings.set("MCP_APPROVAL", "always");

        assert.equal(
            engine.evaluate("mcp_call", {}, "main_agent").decision,
            "require_approval"
        );

        assert.equal(
            engine.evaluate("mcp__reported__echo", {}, "main_agent").decision,
            "require_approval"
        );

        /* a built-in tool is unaffected by an MCP setting */

        assert.equal(
            engine.evaluate("fs_read", {}, "main_agent").decision,
            "allow"
        );

        settings.set("MCP_APPROVAL", "never");

        assert.equal(
            engine.evaluate("mcp_call", {}, "main_agent").decision,
            "allow"
        );

        settings.reset("MCP_APPROVAL");
    });

    /* ---------------------------------------------------------------- */
    console.log("\nthe semantic engine as an MCP server");

    await test("the engine is registered as a built-in server and called over MCP", async () => {

        const semantic = require("../agent/mcp/semantic");

        const command =
            writeStdioServer({ name: "semantic-engine" });

        settings.set("SEMANTIC_ENGINE_BIN", command);

        assert.equal(semantic.isAvailable(), true);

        const client =
            semantic.ensureRegistered();

        assert.equal(client.config.builtin, true);
        assert.equal(client.config.transport, "stdio");
        assert.equal(client.config.trust, "trusted");

        /* the definition carries the arguments the engine needs */

        assert.deepEqual(
            client.config.args.slice(0, 2),
            ["serve", "--stdio"]
        );

        const answered =
            await semantic.call("echo", { message: "through the engine" });

        assert.equal(answered.echoed, "through the engine");

        semantic.shutdown();

        settings.reset("SEMANTIC_ENGINE_BIN");
    });

    await test("a workspace may replace the engine with its own server", async () => {

        const semantic = require("../agent/mcp/semantic");

        const manager = tools.mcp._manager;

        await manager.add(
            "semantic-engine",
            {
                command: writeStdioServer({ name: "the-project-engine" }),
                cwd: WORKSPACE
            },
            { persist: false }
        );

        /*
        | A server the workspace declared is not builtin, so the engine
        | must keep it rather than overwrite it with an autodetected one.
        */

        const client =
            semantic.ensureRegistered();

        assert.equal(client.config.builtin, false);
        assert.equal(
            (await semantic.call("echo", { message: "x" })).via,
            "the-project-engine"
        );

        await manager.remove("semantic-engine", { persist: false });
    });

    await test("the old lib path still resolves to the moved module", async () => {

        assert.equal(
            require("../agent/lib/semantic"),
            require("../agent/mcp/semantic")
        );

        /* and the helpers the code tools use are still there */

        for (
            const name
            of [
                "call", "isAvailable", "checkStaleness", "shutdown",
                "startRunScope", "startIndexSession", "getIndexSession",
                "stopIndexSession", "binaryPath"
            ]
        ) {

            assert.equal(
                typeof require("../agent/lib/semantic")[name],
                "function",
                `${name} was lost in the move`
            );
        }
    });

    /* ---------------------------------------------------------------- */

    for (const cleanup of cleanups.reverse()) {

        try {

            await cleanup();

        } catch {
            /* a server that is already down needs no help */
        }
    }

    await tools.mcp._shutdown();

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}


main();
