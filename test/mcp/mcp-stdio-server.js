/*
| mcp.test.js: the tool list, the shared answers and the stdio server
|
| Every fixture server answers the same handshake and tool list; the stdio
| one is written to disk inside the runner's workspace.
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");


module.exports = function createStdioServers({ WORKSPACE }) {

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

    return { answer, writeStdioServer };
};
