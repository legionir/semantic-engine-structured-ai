"use strict";

/*
| mcp.test.js: transports, failure
|
| Runs inside mcp.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function transportsCases(ctx) {

    const {
        McpClient,
        WORKSPACE,
        startHttpServer,
        test,
        writeStdioServer
    } = ctx;

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
};
