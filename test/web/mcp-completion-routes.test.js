"use strict";

/*
|--------------------------------------------------------------------------
| MCP completion routes over real HTTP (roadmap P4-05 … P4-12)
|--------------------------------------------------------------------------
|
| A live console with the mock MCP server (test/helpers/mock-mcp-server.js),
| an OAuth-protected remote (test/helpers/mock-oauth-mcp.js) and a mock
| MCP registry:
|
|   import preview → 409 on a conflict → import with a rename
|   per-tool switch from the console; refused for a scoped token
|   resources, prompts (rendered as a command), elicitation answers
|   OAuth sign-in end to end through /api/mcp/oauth/callback, which is
|   reached without the console token (its state is the credential)
|   registry search, the trust confirmation, and a restricted add
|   /mcp: bearer only, foreign origins refused, project-token scoping
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { removeTempDirs } = require("../helpers/cleanup");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-completion-routes-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-completion-routes-data-"));
const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-completion-prj-a-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-completion-prj-b-"));
const SCOPED = "scoped-token-mcp-completion";

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.STRUCTURED_AI_TRUST_FILE = path.join(DATA_HOME, "trusted-workspaces.json");
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    [SCOPED]: { allowedProjects: ["prj-a"], permissions: ["project:read", "project:write"] }
});

const REPO = path.resolve(__dirname, "..", "..");
const MOCK = path.join(REPO, "test", "helpers", "mock-mcp-server.js");
const { startOAuthMcp } = require(path.join(REPO, "test", "helpers", "mock-oauth-mcp"));

const results = [];
const closers = [];


async function test(name, fn) {

    try {
        await fn();
        results.push(true);
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push(false);
        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.stack || error}`);
    }
}


async function waitFor(check, ms = 5000, label = "condition") {

    const started = Date.now();

    while (Date.now() - started < ms) {
        const value = await check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 25));
    }

    throw new Error(`timed out waiting for ${label}`);
}


/* a registry that knows one server, by the generic registry API */
function startRegistry() {

    const record = {
        server: {
            name: "io.github.tester/mockserver",
            description: "The mock server, published",
            version: "2.0.0",
            packages: [{
                registryType: "npm",
                identifier: "@tester/mockserver",
                version: "2.0.0",
                transport: { type: "stdio" },
                environmentVariables: [{ name: "MOCK_API_KEY", isRequired: true, isSecret: true, description: "API key" }]
            }]
        },
        _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true, publishedAt: "2026-10-01T00:00:00Z" } }
    };

    const server = http.createServer((req, res) => {

        const url = new URL(req.url, "http://registry.test");
        const send = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };

        if (url.pathname === "/v0.1/servers") {
            const search = url.searchParams.get("search") || "";
            return send(200, { servers: record.server.name.includes(search) ? [record] : [], metadata: { count: 1 } });
        }

        if (url.pathname === `/v0.1/servers/${encodeURIComponent(record.server.name)}/versions/latest`) {
            return send(200, record);
        }

        send(404, { title: "Not Found", detail: "Server not found" });
    });

    return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
        closers.push(() => new Promise(done => server.close(() => done())));
        resolve(`http://127.0.0.1:${server.address().port}`);
    }));
}


async function main() {

    const registryUrl = await startRegistry();
    process.env.MCP_REGISTRY_URL = registryUrl;

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    runtime.projects.registry().register({ id: "prj-a", name: "Alpha", rootPath: ROOT_A });
    runtime.projects.registry().register({ id: "prj-b", name: "Beta", rootPath: ROOT_B });

    const server = createServer(runtime, { apiRateLimit: 1000 });
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const call = async (method, url, body, { token = server.token, headers = {} } = {}) => {
        const response = await fetch(`${baseUrl}${url}`, {
            method,
            headers: {
                ...(body ? { "content-type": "application/json" } : {}),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...headers
            },
            body: body ? JSON.stringify(body) : undefined
        });
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
        return { status: response.status, body: parsed, headers: response.headers };
    };

    const mockText = JSON.stringify({ mcpServers: { mock: { command: process.execPath, args: [MOCK] } } });

    await test("P4-05 import: preview, then merge into the user config", async () => {

        const preview = await call("POST", "/api/mcp/import/preview", { text: mockText });
        assert.strictEqual(preview.status, 200, JSON.stringify(preview.body));
        assert.strictEqual(preview.body.entries[0].status, "new");

        const imported = await call("POST", "/api/mcp/import", { text: mockText, target: "user" });
        assert.strictEqual(imported.status, 200, JSON.stringify(imported.body));
        assert.deepStrictEqual(imported.body.added, ["mock"]);

        const listed = await call("GET", "/api/mcp");
        assert.ok(JSON.stringify(listed.body).includes("\"mock\""));
    });

    await test("P4-05 import: a duplicate is a 409 until it is skipped, replaced or renamed", async () => {

        const changed = JSON.stringify({ mcpServers: { mock: { command: process.execPath, args: [MOCK, "--variant"] } } });

        const preview = await call("POST", "/api/mcp/import/preview", { text: changed });
        assert.strictEqual(preview.body.entries[0].status, "conflict");

        const refused = await call("POST", "/api/mcp/import", { text: changed, target: "user" });
        assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
        assert.ok(refused.body.conflicts.length === 1);

        const renamed = await call("POST", "/api/mcp/import", { text: changed, target: "user", resolutions: { mock: "rename:mock2" } });
        assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.body));
        assert.deepStrictEqual(renamed.body.added, ["mock2"]);

        const broken = await call("POST", "/api/mcp/import/preview", { text: "{ \"mcpServers\": " });
        assert.strictEqual(broken.status, 400);
        assert.ok(broken.body.error.length > 10);

        const scoped = await call("POST", "/api/mcp/import/preview", { text: mockText }, { token: SCOPED });
        assert.strictEqual(scoped.status, 403);
    });

    await test("P4-07 a tool switched off in the console disappears from the server's tool list", async () => {

        const off = await call("PATCH", "/api/mcp/mock/controls", { tool: "write_note", enabled: false });
        assert.strictEqual(off.status, 200, JSON.stringify(off.body));
        assert.deepStrictEqual(off.body.overrides.disabled_tools, ["write_note"]);

        const status = await waitFor(async () => {
            const listed = await call("GET", "/api/mcp");
            const mock = (listed.body.servers || []).find(item => item.name === "mock");
            return mock && Array.isArray(mock.tools) && mock.tools.length ? mock : null;
        }, 8000, "the mock server's tools");

        const writeNote = status.tools.find(tool => tool.name === "write_note");
        assert.ok(!writeNote || writeNote.enabled === false, JSON.stringify(status.tools));

        const approval = await call("PATCH", "/api/mcp/mock/controls", { approval: { read: "never", write: "always" } });
        assert.strictEqual(approval.status, 200, JSON.stringify(approval.body));
        assert.deepStrictEqual(approval.body.overrides.approval, { read: "never", write: "always" });

        const unknown = await call("PATCH", "/api/mcp/ghost/controls", { tool: "x", enabled: false });
        assert.strictEqual(unknown.status, 404);

        const scoped = await call("PATCH", "/api/mcp/mock/controls", { tool: "echo", enabled: false }, { token: SCOPED });
        assert.strictEqual(scoped.status, 403);

        await call("PATCH", "/api/mcp/mock/controls", { tool: "write_note", enabled: true, approval: null });
    });

    await test("P4-10 resources and prompts from the console; a prompt renders as command text", async () => {

        const resources = await call("GET", "/api/mcp/mock/resources");
        assert.strictEqual(resources.status, 200, JSON.stringify(resources.body));
        assert.strictEqual(resources.body.resources[0].uri, "note://welcome");
        assert.strictEqual(resources.body.templates[0].uriTemplate, "note://{id}");

        const read = await call("GET", `/api/mcp/mock/resources?uri=${encodeURIComponent("note://welcome")}`);
        assert.strictEqual(read.body.contents[0].text, "contents of note://welcome");

        const prompts = await call("GET", "/api/mcp/mock/prompts");
        assert.strictEqual(prompts.body.prompts[0].name, "review_code");

        const index = await call("GET", "/api/mcp/prompts");
        assert.strictEqual(index.status, 200, JSON.stringify(index.body));
        assert.ok(index.body.prompts.some(prompt => prompt.server === "mock" && prompt.name === "review_code" && prompt.arguments[0].name === "language"), JSON.stringify(index.body));

        const rendered = await call("POST", "/api/mcp/mock/prompts/review_code", { arguments: { language: "rust" } });
        assert.strictEqual(rendered.status, 200, JSON.stringify(rendered.body));
        assert.strictEqual(rendered.body.text, "Review this rust code carefully.");

        const scoped = await call("GET", "/api/mcp/mock/resources", null, { token: SCOPED });
        assert.strictEqual(scoped.status, 403);
    });

    await test("P4-10 a server's question waits in the console and is answered there", async () => {

        const manager = require(path.join(REPO, "agent", "tools")).mcp._manager;
        const asked = manager.call("mock", "ask_user", {}, { agent: "web_console" });

        const pending = await waitFor(async () => {
            const listed = await call("GET", "/api/mcp/elicitations");
            return listed.body.elicitations.length ? listed.body.elicitations[0] : null;
        }, 5000, "a pending question");

        assert.strictEqual(pending.message, "What is your name?");

        const invalid = await call("POST", `/api/mcp/elicitations/${pending.id}`, { action: "accept", content: {} });
        assert.strictEqual(invalid.status, 400);

        const answered = await call("POST", `/api/mcp/elicitations/${pending.id}`, { action: "accept", content: { name: "Reza" } });
        assert.strictEqual(answered.status, 200, JSON.stringify(answered.body));
        assert.match(JSON.stringify(await asked), /hello Reza/);

        const gone = await call("POST", `/api/mcp/elicitations/${pending.id}`, { action: "decline" });
        assert.strictEqual(gone.status, 404);
    });

    await test("P4-08 OAuth sign-in end to end; the callback needs no console token", async () => {

        const remote = await startOAuthMcp();
        closers.push(() => remote.close());

        const imported = await call("POST", "/api/mcp/import", {
            text: JSON.stringify({ mcpServers: { secured: { type: "http", url: remote.url, oauth: true } } }),
            target: "user"
        });
        assert.strictEqual(imported.status, 200, JSON.stringify(imported.body));

        const forged = await fetch(`${baseUrl}/api/mcp/oauth/callback?state=forged&code=x`);
        assert.strictEqual(forged.status, 400, "reached without a token, refused by state");
        assert.match(await forged.text(), /unknown or has expired/);

        const started = await call("POST", "/api/mcp/secured/oauth/start", {});
        assert.strictEqual(started.status, 200, JSON.stringify(started.body));
        assert.strictEqual(started.body.redirect_uri, `${baseUrl}/api/mcp/oauth/callback`);
        assert.strictEqual(started.body.state, undefined, "the state is not handed to the page");

        const provider = await fetch(started.body.authorization_url, { redirect: "manual" });
        const callback = await fetch(provider.headers.get("location"));
        const page = await callback.text();

        assert.strictEqual(callback.status, 200, page);
        assert.match(page, /Signed in/);
        assert.ok(!/access_token|Bearer/.test(page));

        const manager = require(path.join(REPO, "agent", "tools")).mcp._manager;
        assert.match(JSON.stringify(await manager.call("secured", "whoami", {}, { agent: "web_console" })), /signed-in user/);

        const listed = await call("GET", "/api/mcp");
        const secured = listed.body.servers.find(item => item.name === "secured");
        assert.strictEqual(secured.oauth.signed_in, true);

        const out = await call("POST", "/api/mcp/secured/oauth/signout", {});
        assert.strictEqual(out.status, 200);
    });

    await test("P4-12 registry search shows the trust warning; adding needs a confirmation and stays restricted", async () => {

        const short = await call("GET", "/api/mcp/registry?q=ab");
        assert.strictEqual(short.status, 400);

        const found = await call("GET", "/api/mcp/registry?q=mockserver");
        assert.strictEqual(found.status, 200, JSON.stringify(found.body));
        assert.strictEqual(found.body.servers[0].name, "io.github.tester/mockserver");
        assert.match(found.body.warning, /does not review/);

        const unconfirmed = await call("POST", "/api/mcp/registry/add", { name: "io.github.tester/mockserver" });
        assert.strictEqual(unconfirmed.status, 428);
        assert.match(unconfirmed.body.warning, /does not review/);

        const incomplete = await call("POST", "/api/mcp/registry/add", { name: "io.github.tester/mockserver", acknowledge_untrusted: true });
        assert.strictEqual(incomplete.status, 400);
        assert.deepStrictEqual(incomplete.body.missing.map(input => input.name), ["MOCK_API_KEY"]);

        const added = await call("POST", "/api/mcp/registry/add", {
            name: "io.github.tester/mockserver",
            acknowledge_untrusted: true,
            inputs: { MOCK_API_KEY: "sk-registry-secret-123" }
        });
        assert.strictEqual(added.status, 200, JSON.stringify(added.body));
        assert.strictEqual(added.body.server, "mockserver");
        assert.ok(!JSON.stringify(added.body).includes("sk-registry-secret-123"), "the secret never comes back");

        const saved = JSON.parse(fs.readFileSync(path.join(DATA_HOME, "mcp.json"), "utf8")).mcpServers.mockserver;
        assert.strictEqual(saved.trust, "restricted");
        assert.deepStrictEqual(saved.args, ["-y", "@tester/mockserver@2.0.0"]);
        assert.match(saved.env.MOCK_API_KEY, /^\$\{secret:[A-Z0-9_]+\}$/);
        assert.ok(!fs.readFileSync(path.join(DATA_HOME, "mcp.json"), "utf8").includes("sk-registry-secret-123"));

        const again = await call("POST", "/api/mcp/registry/add", { name: "io.github.tester/mockserver", acknowledge_untrusted: true, inputs: { MOCK_API_KEY: "x" } });
        assert.strictEqual(again.status, 409);

        const scoped = await call("GET", "/api/mcp/registry?q=mockserver", null, { token: SCOPED });
        assert.strictEqual(scoped.status, 403);
    });

    await test("P4-11 /mcp: bearer only, foreign origins refused, a project token sees its own project", async () => {

        const rpc = (message, options = {}) => call("POST", "/mcp", message, options);

        const anonymous = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { token: null });
        assert.strictEqual(anonymous.status, 401);
        assert.match(anonymous.headers.get("www-authenticate") || "", /Bearer/);

        const foreign = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { headers: { origin: "https://evil.example" } });
        assert.strictEqual(foreign.status, 403);

        const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
        assert.strictEqual(init.status, 200, JSON.stringify(init.body));
        assert.strictEqual(init.body.result.serverInfo.name, "structured-ai");
        assert.ok(init.headers.get("mcp-session-id"));

        const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
        assert.strictEqual(note.status, 202);

        const all = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_projects", arguments: {} } });
        const allIds = JSON.parse(all.body.result.content[0].text).projects.map(project => project.id);
        assert.ok(allIds.includes("prj-a") && allIds.includes("prj-b"), allIds.join(","));

        const scopedList = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_projects", arguments: {} } }, { token: SCOPED });
        assert.deepStrictEqual(JSON.parse(scopedList.body.result.content[0].text).projects.map(project => project.id), ["prj-a"]);

        const forbidden = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "task_status", arguments: { project: "prj-b" } } }, { token: SCOPED });
        assert.strictEqual(forbidden.body.result.isError, true, JSON.stringify(forbidden.body));

        const own = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "task_status", arguments: { project: "Alpha" } } }, { token: SCOPED });
        assert.ok(!own.body.result.isError, JSON.stringify(own.body));
        assert.match(own.body.result.content[0].text, /idle/);

        const stream = await call("GET", "/mcp");
        assert.strictEqual(stream.status, 405);
    });

    await test("P4-11 agent mcp-serve: the stdio bridge carries JSON-RPC to /mcp in order", async () => {

        const { PassThrough } = require("stream");
        const { runStdioBridge } = require(path.join(REPO, "agent", "mcp", "McpServerHost"));
        const input = new PassThrough();
        const output = new PassThrough();
        let received = "";
        output.on("data", chunk => { received += chunk; });

        const bridged = runStdioBridge({ url: baseUrl, token: SCOPED, input, output, log: () => {} });

        input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } })}\n`);
        input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        input.write("not json\n");
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_projects", arguments: {} } })}\n`);
        input.end();
        await bridged;

        const lines = received.trim().split("\n").map(line => JSON.parse(line));
        const answers = lines.filter(line => line.id !== null);

        assert.deepStrictEqual(answers.map(line => line.id), [1, 2], received);
        assert.strictEqual(answers[0].result.serverInfo.name, "structured-ai");
        assert.deepStrictEqual(JSON.parse(answers[1].result.content[0].text).projects.map(project => project.id), ["prj-a"]);
        assert.ok(lines.some(line => line.id === null && line.error.code === -32700), "a bad line is a parse error");

        const refused = new PassThrough();
        const refusedOut = new PassThrough();
        let refusedText = "";
        refusedOut.on("data", chunk => { refusedText += chunk; });
        const bad = runStdioBridge({ url: baseUrl, token: "wrong-token", input: refused, output: refusedOut, log: () => {} });
        refused.end(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" })}\n`);
        await bad;
        assert.match(refusedText, /401/);
    });

    await test("P4-06/09/10 agent tools: mcp_search_tools, mcp_resources, mcp_prompts and mcp_build", async () => {

        const tools = require(path.join(REPO, "agent", "tools"));
        const run = (name, args) => tools.executeTool(name, args, { agent: "main" });

        const found = await run("mcp_search_tools", { query: "echo text", server: "mock" });
        assert.strictEqual(found.ok, true, JSON.stringify(found));
        assert.strictEqual(found.tools[0].name, "mcp__mock__echo");
        assert.ok(found.tools[0].input_schema.properties.text);

        const named = await run("mcp_search_tools", { names: ["mcp__mock__slow_count"] });
        assert.deepStrictEqual(named.tools.map(tool => tool.name), ["mcp__mock__slow_count"]);

        const listed = await run("mcp_resources", { server: "mock" });
        assert.ok(JSON.stringify(listed).includes("note://welcome"), JSON.stringify(listed));
        const read = await run("mcp_resources", { server: "mock", uri: "note://x" });
        assert.strictEqual(read.contents[0].text, "contents of note://x");

        const prompts = await run("mcp_prompts", { server: "mock" });
        assert.ok(JSON.stringify(prompts).includes("review_code"));
        const rendered = await run("mcp_prompts", { server: "mock", name: "review_code", arguments: { language: "go" } });
        assert.strictEqual(rendered.messages[0].text, "Review this go code carefully.");

        await assert.rejects(() => run("mcp_resources", { server: "ghost" }), /ghost|unknown|not configured/i);

        const built = await run("mcp_build", {
            action: "create",
            name: "calc",
            language: "node",
            tools: [{ name: "mul", description: "Multiply", input_schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } }, body: "return { product: args.a * args.b };" }]
        });
        assert.strictEqual(built.ok, true, JSON.stringify(built));
        assert.deepStrictEqual(built.tools, ["mcp__calc__mul"]);

        const product = await run("mcp_call", { tool: "mcp__calc__mul", arguments: { a: 6, b: 7 } });
        assert.strictEqual(product.result.product, 42);

        /* the agent edits tools.js, then reloads */
        const toolsFile = path.join(WORKSPACE, ".agent", "mcp-servers", "calc", "tools.js");
        fs.writeFileSync(toolsFile, fs.readFileSync(toolsFile, "utf8").replace("args.a * args.b", "args.a * args.b + 1"));
        const reloaded = await run("mcp_build", { action: "reload", name: "calc" });
        assert.strictEqual(reloaded.ok, true, JSON.stringify(reloaded));
        assert.strictEqual((await run("mcp_call", { tool: "mcp__calc__mul", arguments: { a: 6, b: 7 } })).result.product, 43);

        await assert.rejects(() => run("mcp_build", { action: "create", name: "calc", tools: [{ name: "x" }] }), /already exists/);
        await assert.rejects(() => run("mcp_build", { action: "reload", name: "nothing" }), /no server called/);
    });

    await server.close();

    for (const close of closers.reverse()) {
        try { await close(); } catch { /* already closed */ }
    }

    try {
        await require(path.join(REPO, "agent", "tools")).mcp._manager.shutdown();
    } catch { /* nothing running */ }

    removeTempDirs([WORKSPACE, DATA_HOME, ROOT_A, ROOT_B]);

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} MCP completion route checks passed`);

    process.exit(failed ? 1 : 0);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
