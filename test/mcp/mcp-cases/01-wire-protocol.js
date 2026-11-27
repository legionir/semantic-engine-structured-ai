"use strict";

/*
| mcp.test.js: wire protocol, configuration
|
| Runs inside mcp.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function wireProtocolCases(ctx) {

    const {
        WORKSPACE,
        config,
        protocol,
        settings,
        test,
        websocket
    } = ctx;

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

        /*
        | P0-5 / P0-8: a repository MCP configuration (.mcp.json and
        | .agent/mcp.json) may pull a value out of the environment only
        | once the operator trusted the workspace. Until then the server is
        | refused, so a cloned project cannot route the user's tokens to a
        | server it chose. Operator configuration (MCP_SERVERS, the
        | registry) always may.
        */

        const WorkspaceTrust = require("../../../agent/projects/WorkspaceTrust");

        process.env.MCP_TEST_TOKEN = "s3cret";

        const workspaceConfig =
            path.join(WORKSPACE, ".agent", "mcp.json");

        const previousWorkspaceConfig =
            fs.existsSync(workspaceConfig)
                ? fs.readFileSync(workspaceConfig, "utf8")
                : null;

        fs.mkdirSync(path.dirname(workspaceConfig), { recursive: true });

        fs.writeFileSync(
            workspaceConfig,
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

        try {

            WorkspaceTrust.revoke(WORKSPACE);

            const untrusted =
                config.load(WORKSPACE);

            assert.equal(
                untrusted.servers.some(server => server.name === "remote"),
                false,
                ".agent/mcp.json of an untrusted workspace must not expand environment placeholders"
            );

            assert.match(untrusted.problems.join(" "), /placeholder/);
            assert.doesNotMatch(JSON.stringify(untrusted), /s3cret/);

            WorkspaceTrust.trust(WORKSPACE, { by: "mcp.test" });

            const loaded =
                config.load(WORKSPACE);

            assert.equal(
                loaded.servers.find(server => server.name === "remote").headers.authorization,
                "Bearer s3cret"
            );

            assert.match(
                fs.readFileSync(workspaceConfig, "utf8"),
                /\$\{env:MCP_TEST_TOKEN\}/
            );

            WorkspaceTrust.revoke(WORKSPACE);

            fs.writeFileSync(workspaceConfig, JSON.stringify({}), "utf8");

            fs.writeFileSync(
                path.join(WORKSPACE, ".mcp.json"),
                JSON.stringify({
                    mcpServers: {
                        repo_remote: {
                            url: "https://example.com/mcp",
                            headers: { authorization: "Bearer ${env:MCP_TEST_TOKEN}" }
                        }
                    }
                }),
                "utf8"
            );

            const fromRepository =
                config.load(WORKSPACE);

            assert.equal(
                fromRepository.servers.some(server => server.name === "repo_remote"),
                false,
                "a repository .mcp.json must not expand environment placeholders"
            );

            assert.match(
                fromRepository.problems.join(" "),
                /placeholder/
            );

            assert.doesNotMatch(
                JSON.stringify(fromRepository),
                /s3cret/
            );

        } finally {

            WorkspaceTrust.revoke(WORKSPACE);

            fs.rmSync(path.join(WORKSPACE, ".mcp.json"), { force: true });

            if (previousWorkspaceConfig === null) {
                fs.rmSync(workspaceConfig, { force: true });
            } else {
                fs.writeFileSync(workspaceConfig, previousWorkspaceConfig, "utf8");
            }

            delete process.env.MCP_TEST_TOKEN;
        }
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

    await test("http, sse and websocket transports preserve arbitrary custom headers and mask them in describe()", async () => {

        const validator = require("../../../agent/mcp/McpConfigValidator");
        const { HttpTransport } = require("../../../agent/mcp/transports/HttpTransport");
        const { SseTransport } = require("../../../agent/mcp/transports/SseTransport");
        const { WebSocketTransport } = require("../../../agent/mcp/transports/WebSocketTransport");

        const normalized = validator.normalizeOne("custom", {
            transport: "http",
            url: "https://example.com/mcp",
            headers: {
                "X-Custom-Header": "abc",
                Authorization: "CustomScheme xyz",
                "   ": "ignored"
            }
        }, WORKSPACE);
        assert.deepEqual(normalized.headers, {
            "X-Custom-Header": "abc",
            Authorization: "CustomScheme xyz"
        });

        const httpTransport = new HttpTransport({
            name: "http-hdrs",
            url: "https://example.com/mcp",
            token: "fallback-token",
            headers: {
                "X-Tenant": "t-1",
                Authorization: "ApiKey custom",
                Accept: "application/json"
            }
        });
        const httpHeaders = httpTransport.headers();
        assert.equal(httpHeaders["X-Tenant"], "t-1");
        assert.equal(httpHeaders.Authorization, "ApiKey custom");
        assert.equal(httpHeaders.authorization, undefined);
        assert.equal(httpHeaders.Accept, "application/json");
        assert.deepEqual(httpTransport.describe().headers, {
            "X-Tenant": "****",
            Authorization: "****",
            Accept: "****"
        });

        const sseTransport = new SseTransport({
            name: "sse-hdrs",
            url: "https://example.com/sse",
            token: "fallback-token",
            headers: {
                "X-Org": "org-7",
                Authorization: "Custom sse-secret",
                Accept: "text/event-stream; charset=utf-8"
            }
        });
        const sseHeaders = sseTransport.headers({}, { accept: "text/event-stream", "cache-control": "no-cache" });
        assert.equal(sseHeaders["X-Org"], "org-7");
        assert.equal(sseHeaders.Authorization, "Custom sse-secret");
        assert.equal(sseHeaders.Accept, "text/event-stream; charset=utf-8");
        assert.equal(sseHeaders["cache-control"], "no-cache");
        assert.deepEqual(sseTransport.describe().headers, {
            "X-Org": "****",
            Authorization: "****",
            Accept: "****"
        });

        const http = require("http");
        let captured = null;
        const upgraded = new Set();
        const wsServer = http.createServer((_req, res) => {
            res.writeHead(404).end();
        });
        wsServer.on("upgrade", (req, socket) => {
            captured = req.headers;
            upgraded.add(socket);
            socket.on("close", () => upgraded.delete(socket));
            const key = req.headers["sec-websocket-key"];
            socket.write(
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${websocket.acceptValue(key)}\r\n\r\n`
            );
        });
        await new Promise(resolve => wsServer.listen(0, "127.0.0.1", resolve));
        const wsPort = wsServer.address().port;
        try {
            const wsTransport = new WebSocketTransport({
                name: "ws-hdrs",
                url: `ws://127.0.0.1:${wsPort}/ws`,
                token: "fallback-token",
                headers: {
                    "X-WS-Trace": "trace-9",
                    Authorization: "Custom ws-secret",
                    "Sec-WebSocket-Protocol": "custom-subproto"
                }
            });
            assert.deepEqual(wsTransport.describe().headers, {
                "X-WS-Trace": "****",
                Authorization: "****",
                "Sec-WebSocket-Protocol": "****"
            });
            await wsTransport.connect();
            assert.equal(captured["x-ws-trace"], "trace-9");
            assert.equal(captured.authorization, "Custom ws-secret");
            assert.equal(captured["sec-websocket-protocol"], "custom-subproto");
            await wsTransport.close();
        } finally {
            /* an upgraded socket is no longer tracked by the HTTP server, so
               closeAllConnections() misses it and close() would never call
               back, which let the test process exit early with code 0 */
            for (const socket of upgraded) socket.destroy();
            wsServer.closeAllConnections?.();
            await new Promise(resolve => wsServer.close(resolve));
        }
    });
};
