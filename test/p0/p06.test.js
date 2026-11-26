"use strict";

/*
|--------------------------------------------------------------------------
| P0-6 — MCP stdio spec compliance & stream robustness
|--------------------------------------------------------------------------
|
|  1. the stdio transport defaults to newline-delimited JSON, not
|     Content-Length (agent/mcp/transports/StdioTransport.js)
|  2. the client answers server->client requests such as ping and
|     roots/list (agent/mcp/McpConnection.js)
|  3. EPIPE on a child's stdin does not crash the process
|     (StdioTransport.js, agent/tools/process/BackgroundSession.js)
|  4. generated LLM tool names match ^[a-zA-Z0-9_-]{1,64}$
|     (agent/mcp/McpCatalogue.js)
|
| The MCP server used here is a tiny Node script written into a temp
| directory and spawned with process.execPath (the transport runs any
| ".js" command with the current Node binary), so it works on Linux,
| macOS and Windows. No network, no LLM.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Writable } = require("stream");
const { EventEmitter } = require("events");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "p06-mcp-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.AGENT_VERBOSE = "0";

const REPO = path.resolve(__dirname, "..", "..");

const protocol = require(path.join(REPO, "agent", "mcp", "protocol"));
const { McpClient } = require(path.join(REPO, "agent", "mcp", "McpConnection.js"));
const { StdioTransport } = require(path.join(REPO, "agent", "mcp", "transports", "StdioTransport.js"));
const catalogue = require(path.join(REPO, "agent", "mcp", "McpCatalogue.js"));
const ProcessManager = require(path.join(REPO, "agent", "tools", "process", "ProcessManager.js"));
const Background = require(path.join(REPO, "agent", "tools", "process", "BackgroundSession.js"));


/* A hard ceiling so a regression can never hang CI. */
setTimeout(() => {

    console.log("  FAIL global timeout (90s) reached");

    process.exit(1);

}, 90000).unref();


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
        console.log(`       ${error && error.message}`);
    }
}


function delay(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));
}


/*
| Collects uncaught exceptions for the duration of fn, so a missing
| 'error' listener is reported as a failed assertion instead of killing
| the whole test run.
*/

async function withUncaughtCapture(fn) {

    const captured = [];

    const onError = error => captured.push(error);

    process.on("uncaughtException", onError);

    try {

        await fn(captured);

    } finally {

        process.removeListener("uncaughtException", onError);
    }

    return captured;
}


function epipeError() {

    const error = new Error("write EPIPE");

    error.code = "EPIPE";
    error.errno = -32;
    error.syscall = "write";

    return error;
}


/*
|--------------------------------------------------------------------------
| Fake MCP server (Node script)
|--------------------------------------------------------------------------
|
| P0_MODE=ndjson-only  understands only one-JSON-object-per-line; a
|                      Content-Length header is just a non-JSON line
|                      and is ignored (as the MCP spec's stdio framing
|                      implies), so a client that frames with headers
|                      never gets an answer.
| P0_MODE=dual         (default) understands both and answers in the
|                      framing it was addressed in.
| P0_ASK=1             after notifications/initialized the server sends
|                      two requests of its own: ping and roots/list.
|                      "test/report" returns the answers it received
|                      (waiting up to 2s for them).
|--------------------------------------------------------------------------
*/

const SERVER_SOURCE = String.raw`"use strict";

const MODE = process.env.P0_MODE || "dual";
const ASK = process.env.P0_ASK === "1";

let buffer = Buffer.alloc(0);
let framing = "ndjson";

const outstanding = new Map();
const answers = {};
let reportId = null;

function send(message) {
    const body = JSON.stringify(message);
    if (framing === "content-length") {
        process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n" + body);
    } else {
        process.stdout.write(body + "\n");
    }
}

function flushReport() {
    if (reportId === null) return;
    const id = reportId;
    reportId = null;
    send({ jsonrpc: "2.0", id, result: { answers, outstanding: [...outstanding.values()] } });
}

function maybeReport() {
    if (reportId !== null && outstanding.size === 0) flushReport();
}

function handle(message) {

    if (!message || typeof message !== "object") return;

    if (message.method === undefined && message.id !== undefined) {
        const method = outstanding.get(message.id);
        if (method) {
            answers[method] = message;
            outstanding.delete(message.id);
        }
        maybeReport();
        return;
    }

    switch (message.method) {

        case "initialize":
            send({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: { tools: {} },
                    serverInfo: { name: "p06-fake", version: "1.0.0" }
                }
            });
            return;

        case "notifications/initialized":
            if (ASK) {
                outstanding.set("srv-ping", "ping");
                send({ jsonrpc: "2.0", id: "srv-ping", method: "ping" });
                outstanding.set("srv-roots", "roots/list");
                send({ jsonrpc: "2.0", id: "srv-roots", method: "roots/list", params: {} });
            }
            return;

        case "ping":
            send({ jsonrpc: "2.0", id: message.id, result: {} });
            return;

        case "tools/list":
            send({
                jsonrpc: "2.0",
                id: message.id,
                result: { tools: [{ name: "noop", description: "does nothing", inputSchema: { type: "object", properties: {} } }] }
            });
            return;

        case "test/report":
            reportId = message.id;
            maybeReport();
            setTimeout(flushReport, 2000);
            return;

        default:
            if (message.id !== undefined && message.id !== null) {
                send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
            }
    }
}

function parse(text) {
    let message;
    try {
        message = JSON.parse(text);
    } catch (error) {
        process.stderr.write("ignored non-JSON input\n");
        return;
    }
    handle(message);
}

function drain() {
    for (;;) {
        if (buffer.length === 0) return;

        if (MODE !== "ndjson-only") {
            const head = buffer.slice(0, 15).toString("utf8").toLowerCase();
            if (head === "content-length:") {
                const separator = buffer.indexOf("\r\n\r\n");
                if (separator === -1) return;
                const header = buffer.slice(0, separator).toString("utf8");
                const match = /content-length:\s*(\d+)/i.exec(header);
                const length = match ? parseInt(match[1], 10) : 0;
                const end = separator + 4 + length;
                if (buffer.length < end) return;
                const body = buffer.slice(separator + 4, end).toString("utf8");
                buffer = buffer.slice(end);
                framing = "content-length";
                parse(body);
                continue;
            }
            if ("content-length:".startsWith(head)) return;
        }

        const newline = buffer.indexOf(10);
        if (newline === -1) return;
        const line = buffer.slice(0, newline).toString("utf8").trim();
        buffer = buffer.slice(newline + 1);
        if (line !== "") {
            framing = "ndjson";
            parse(line);
        }
    }
}

process.stdin.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
});

process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.stdout.on("error", () => process.exit(0));
`;

const SERVER_FILE = path.join(WORKSPACE, "p06-fake-mcp-server.js");

fs.writeFileSync(SERVER_FILE, SERVER_SOURCE, "utf8");


function stdioClient(name, env, extra) {

    const client =
        new McpClient({
            name,
            transport: "stdio",
            command: SERVER_FILE,
            cwd: WORKSPACE,
            env: env || {},
            timeouts: { default: 3000, connect: 3000, list: 3000, call: 3000 },
            ...(extra || {})
        });

    cleanups.push(() => client.close());

    return client;
}


/*
|--------------------------------------------------------------------------
| Tests
|--------------------------------------------------------------------------
*/

async function main() {

    console.log("P0-6 MCP stdio spec compliance & stream robustness");

    await test("P0-6: stdio transport defaults to newline-delimited JSON (an NDJSON-only server completes the handshake)", async () => {

        const client =
            stdioClient("p06-ndjson", { P0_MODE: "ndjson-only" });

        let tools;

        try {

            tools = await client.listTools();

        } catch (error) {

            throw new Error(
                `an NDJSON-only stdio server never answered; the client probably framed with Content-Length by default (${error.message})`
            );
        }

        assert.strictEqual(client.serverInfo && client.serverInfo.name, "p06-fake");
        assert.deepStrictEqual(tools.map(tool => tool.name), ["noop"]);

        await client.close();

        /* An explicitly configured Content-Length framing must still be honoured. */

        const explicit =
            stdioClient("p06-explicit-cl", { P0_MODE: "dual" }, { framing: "content-length" });

        const explicitTools = await explicit.listTools();

        assert.deepStrictEqual(explicitTools.map(tool => tool.name), ["noop"]);

        await explicit.close();
    });

    await test("P0-6: client answers server->client requests (ping -> {}, roots/list -> { roots: [] })", async () => {

        const client =
            stdioClient("p06-asks", { P0_MODE: "dual", P0_ASK: "1" });

        await client.listTools();

        const report =
            await client.transport.request(
                protocol.request("test/report", {}),
                { timeoutMs: 5000 }
            );

        const answers = (report && report.answers) || {};

        const ping = answers.ping;

        assert.ok(ping, "the server's ping request was never answered by the client");
        assert.ok(!ping.error, `ping was answered with an error: ${JSON.stringify(ping.error)}`);
        assert.strictEqual(ping.id, "srv-ping", "the ping answer must echo the request id");
        assert.ok(
            ping.result && typeof ping.result === "object" && !Array.isArray(ping.result),
            "ping must be answered with an (empty) result object"
        );

        const roots = answers["roots/list"];

        assert.ok(roots, "the server's roots/list request was never answered by the client");
        assert.ok(!roots.error, `roots/list was answered with an error: ${JSON.stringify(roots.error)}`);
        assert.strictEqual(roots.id, "srv-roots", "the roots/list answer must echo the request id");
        assert.ok(
            roots.result && Array.isArray(roots.result.roots),
            "roots/list must be answered with { roots: [...] } (the client advertises the roots capability)"
        );

        await client.close();
    });

    await test("P0-6: EPIPE on an MCP stdio server's stdin does not crash the process", async () => {

        const transport =
            new StdioTransport({
                name: "p06-epipe",
                command: SERVER_FILE,
                cwd: WORKSPACE,
                env: { P0_MODE: "dual" }
            });

        cleanups.push(() => transport.close());

        await transport.connect();

        const child = transport.child;

        assert.ok(child && child.stdin, "the transport did not spawn a child with a stdin pipe");

        let thrown = null;

        const uncaught =
            await withUncaughtCapture(async () => {

                try {

                    /* exactly what Node does when the reader end has gone away */
                    child.stdin.emit("error", epipeError());

                } catch (error) {

                    thrown = error;
                }

                await delay(50);
            });

        assert.strictEqual(
            thrown,
            null,
            `an EPIPE on child.stdin was unhandled and would crash the runtime: ${thrown && thrown.message}`
        );

        assert.strictEqual(
            uncaught.length,
            0,
            `EPIPE escaped as an uncaught exception: ${uncaught.map(error => error.message).join("; ")}`
        );

        await transport.close();
    });

    await test("P0-6: EPIPE while process_write writes to a background process does not crash the process", async () => {

        const original = ProcessManager.spawnInGroup;

        const child = new EventEmitter();

        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 999998;
        child.exitCode = null;
        child.kill = () => {};

        /* a pipe whose reader has exited: every write fails with EPIPE */
        child.stdin =
            new Writable({
                write(chunk, encoding, callback) {
                    callback(epipeError());
                }
            });

        ProcessManager.spawnInGroup = () => child;

        let started;

        try {

            started =
                await Background.process_start({ command: "p06-fake", wait_ms: 10 }, undefined);

        } finally {

            ProcessManager.spawnInGroup = original;
        }

        assert.strictEqual(started.status, "running");

        const uncaught =
            await withUncaughtCapture(async () => {

                try {

                    await Background.process_write(
                        { process_id: started.process_id, input: "hello" },
                        undefined
                    );

                } catch (error) {

                    /* a rejected tool call is an acceptable outcome; a crash is not */
                }

                await delay(100);
            });

        child.exitCode = 0;
        child.emit("close", 0, null);

        assert.strictEqual(
            uncaught.length,
            0,
            `EPIPE on the background process's stdin escaped as an uncaught exception: ${
                uncaught.map(error => error.message).join("; ")
            }`
        );
    });

    await test("P0-6: generated LLM tool names match ^[a-zA-Z0-9_-]{1,64}$", async () => {

        const VALID = /^[a-zA-Z0-9_-]{1,64}$/;

        const clients = [
            { name: "my.server", config: { trust: "untrusted", builtin: false } },
            { name: "a-really-long-mcp-server-name-that-keeps-going-and-going", config: { trust: "untrusted", builtin: false } }
        ];

        const toolNames = [
            "read file",
            "fs/read",
            "ns.tool:v2",
            "ünïcödé-tool",
            "x".repeat(80) + "_alpha",
            "x".repeat(80) + "_beta"
        ];

        for (const client of clients) {

            const generated = [];

            for (const name of toolNames) {

                const entry =
                    catalogue.entryFromTool(client, {
                        name,
                        description: "test tool",
                        inputSchema: { type: "object", properties: {} }
                    });

                assert.ok(
                    VALID.test(entry.name),
                    `catalogue name ${JSON.stringify(entry.name)} (server ${client.name}, tool ${JSON.stringify(name)}) is not a valid LLM tool name`
                );

                const declaration =
                    catalogue.toolDeclaration(entry);

                assert.ok(
                    VALID.test(declaration.function.name),
                    `declared function name ${JSON.stringify(declaration.function.name)} is not a valid LLM tool name`
                );

                generated.push(entry.name);
            }

            /* two tools that differ only past the 64-char limit must not shadow each other */
            assert.notStrictEqual(
                generated[4],
                generated[5],
                `long tool names collided after shortening: ${generated[4]}`
            );
        }

        /* names that are already valid keep the documented mcp__<server>__<tool> form */

        const plain =
            catalogue.entryFromTool(
                { name: "catalog", config: { trust: "trusted", builtin: true } },
                { name: "search", description: "", inputSchema: null }
            );

        assert.strictEqual(plain.name, "mcp__catalog__search");
    });


    /* ---------------------------------------------------------------- */

    for (const cleanup of cleanups.reverse()) {

        try {
            await cleanup();
        } catch {
            /* best effort */
        }
    }

    try {
        ProcessManager.shutdownAll();
    } catch {
        /* best effort */
    }

    const failed = results.filter(result => !result.ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    /* give the SIGTERM'd fake servers a moment before removing their directory */
    await delay(200);

    try {
        fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
        /* Windows may still hold the file briefly */
    }

    process.exitCode = failed === 0 ? 0 : 1;

    /* in case a stray handle would keep the loop alive */
    setTimeout(() => process.exit(process.exitCode), 500).unref();
}

main().catch(error => {

    console.error(error);

    process.exitCode = 1;

    setTimeout(() => process.exit(1), 500).unref();
});
