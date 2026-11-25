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
const TRUST_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "mcp-trust-"));

process.env.WORKSPACE_ROOT = WORKSPACE;

/* P0-8: workspace trust is read from a store of the suite's own, never
   from the developer's ~/.config. */
process.env.STRUCTURED_AI_TRUST_FILE =
    path.join(TRUST_HOME, "trusted-workspaces.json");

const protocol = require("../../agent/mcp/protocol");
const config = require("../../agent/mcp/McpConfig");
const { McpManager } = require("../../agent/mcp/McpManager");
const { McpClient } = require("../../agent/mcp/McpConnection");
const websocket = require("../../agent/mcp/transports/WebSocketTransport");
const settings = require("../../agent/config");
const tools = require("../../agent/tools");

const results = [];

const cleanups = [];


function removeTempTree(target) {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
        /* Windows Defender/indexing can briefly retain handles even after
           every MCP transport has shut down. These are OS-temp folders;
           defer only transient Windows cleanup errors, not test failures. */
        if (process.platform !== "win32" || !["EBUSY", "EPERM"].includes(error.code)) {
            throw error;
        }
        console.warn(`  cleanup deferred for MCP temp tree (${error.code})`);
    }
}


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

    /* the cases live in ./mcp-cases, run in this order */
    const ctx = {
        McpClient,
        WORKSPACE,
        cleanups,
        config,
        freshManager,
        protocol,
        settings,
        startHttpServer,
        test,
        tools,
        websocket,
        writeStdioServer
    };

    await require("./mcp-cases/01-wire-protocol")(ctx);
    await require("./mcp-cases/02-transports")(ctx);
    await require("./mcp-cases/03-manager-and-catalogue")(ctx);
    await require("./mcp-cases/04-policy")(ctx);


    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    removeTempTree(WORKSPACE);
    removeTempTree(TRUST_HOME);

    process.exit(failed.length === 0 ? 0 : 1);
}


main();
