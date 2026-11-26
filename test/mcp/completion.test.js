"use strict";

/*
|--------------------------------------------------------------------------
| MCP completion (roadmap P4-05 … P4-12), against mock servers
|--------------------------------------------------------------------------
|
| P4-05  importing another client's config: formats, conflicts, errors
| P4-06  lazy loading: the definitions of ten servers stay under the cap,
|        mcp_search_tools finds the deferred ones
| P4-07  a switched-off tool is gone from the list and refused; read and
|        write approval; a server limited to one agent
| P4-08  OAuth 2.1: discovery, registration, PKCE, refresh, revocation
| P4-09  a node and a python server built by the agent answer calls
| P4-10  resources, prompts, progress, elicitation, sampling and its
|        budget, each against the mock server (test/helpers/mock-mcp-server.js)
| P4-11  the runtime as an MCP server: handshake, tools, errors
| P4-12  registry records become runnable definitions
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { removeTempDirs } = require("../helpers/cleanup");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-completion-ws-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-completion-data-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.STRUCTURED_AI_TRUST_FILE = path.join(DATA_HOME, "trusted-workspaces.json");
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.AGENT_APPROVAL = "auto";
process.env.MCP_SAMPLING_ENABLED = "true";
process.env.MCP_SAMPLING_BUDGET_TOKENS = "5000";
process.env.MCP_ELICITATION_TIMEOUT_MS = "1000";

const REPO = path.resolve(__dirname, "..", "..");
const MOCK = path.join(REPO, "test", "helpers", "mock-mcp-server.js");

const events = require(path.join(REPO, "agent", "events"));
const validator = require(path.join(REPO, "agent", "mcp", "McpConfigValidator"));
const importer = require(path.join(REPO, "agent", "mcp", "McpConfigImport"));
const overrides = require(path.join(REPO, "agent", "mcp", "McpOverrides"));
const budget = require(path.join(REPO, "agent", "mcp", "McpToolBudget"));
const interactions = require(path.join(REPO, "agent", "mcp", "McpInteractions"));
const oauth = require(path.join(REPO, "agent", "mcp", "McpOAuth"));
const builder = require(path.join(REPO, "agent", "mcp", "McpServerBuilder"));
const host = require(path.join(REPO, "agent", "mcp", "McpServerHost"));
const registry = require(path.join(REPO, "agent", "mcp", "McpRegistryClient"));
const rules = require(path.join(REPO, "agent", "policy", "McpToolRules"));
const { McpManager } = require(path.join(REPO, "agent", "mcp", "McpManager"));
const { McpClient } = require(path.join(REPO, "agent", "mcp", "McpConnection"));
const { startOAuthMcp } = require(path.join(REPO, "test", "helpers", "mock-oauth-mcp"));

const results = [];
const cleanups = [];
const seen = [];

for (const type of ["mcp:progress", "mcp:elicitation", "mcp:elicitation_resolved", "mcp:sampling", "mcp:oauth"]) {
    events.bus.on(type, event => seen.push({ type, ...(event && event.payload ? event.payload : event) }));
}


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
        await new Promise(resolve => setTimeout(resolve, 20));
    }

    throw new Error(`timed out waiting for ${label}`);
}


function mockClient(name, extra = {}, env = {}) {

    const client = new McpClient(validator.normalizeOne(name, {
        command: process.execPath,
        args: [MOCK],
        ...(Object.keys(env).length ? { env } : {}),
        ...extra
    }, WORKSPACE));

    cleanups.push(() => client.close());

    return client;
}


function writeUserConfig(servers) {

    fs.writeFileSync(path.join(DATA_HOME, "mcp.json"), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}


async function main() {

    /* ------------------------------------------------------------ P4-05 */

    await test("P4-05 import reads Claude Desktop, VS Code (JSONC) and Zed configs", () => {

        const claude = importer.preview(JSON.stringify({
            mcpServers: { files: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] } }
        }), { workspaceRoot: WORKSPACE });

        assert.strictEqual(claude.entries.length, 1);
        assert.strictEqual(claude.entries[0].status, "new");

        const vscode = importer.preview(`{
            // VS Code keeps comments in mcp.json
            "servers": {
                "remote": { "type": "http", "url": "https://example.com/mcp" },
                "local": { "type": "stdio", "command": "node", "args": ["x.js"], },
                "ask": { "command": "tool", "env": { "KEY": "\${input:api-key}" } }
            }
        }`, { workspaceRoot: WORKSPACE });

        const byName = Object.fromEntries(vscode.entries.map(entry => [entry.name, entry]));

        assert.strictEqual(byName.remote.status, "new");
        assert.strictEqual(byName.remote.definition.transport, "http");
        assert.strictEqual(byName.local.status, "new");
        assert.ok(JSON.stringify(byName.ask).includes("api-key"), "an ${input:…} placeholder is reported");

        const zed = importer.preview(JSON.stringify({
            context_servers: { zedded: { command: { path: "node", args: ["s.js"] } } }
        }), { workspaceRoot: WORKSPACE });

        assert.strictEqual(zed.entries[0].definition.command, "node");
        assert.deepStrictEqual(zed.entries[0].definition.args, ["s.js"]);
    });

    await test("P4-05 import errors are precise, and a conflict writes nothing until resolved", () => {

        assert.throws(() => importer.preview("{ not json", { workspaceRoot: WORKSPACE }), /JSON|line|position/i);
        assert.throws(() => importer.preview(JSON.stringify({ something: 1 }), { workspaceRoot: WORKSPACE }), /mcpServers|servers/);

        const bad = importer.preview(JSON.stringify({ mcpServers: { broken: { transport: "http" } } }), { workspaceRoot: WORKSPACE });
        assert.strictEqual(bad.entries[0].status, "invalid");
        assert.match(bad.entries[0].error, /broken/);

        const manager = new McpManager(WORKSPACE);
        cleanups.push(() => manager.shutdown());
        writeUserConfig({ files: { command: "npx", args: ["a"] } });
        manager.invalidate();
        manager.load(WORKSPACE);

        const previewed = importer.preview(JSON.stringify({
            mcpServers: { files: { command: "npx", args: ["b"] }, other: { command: "npx", args: ["c"] } }
        }), { manager });

        const files = previewed.entries.find(entry => entry.name === "files");
        assert.strictEqual(files.status, "conflict");

        const unresolved = importer.plan(previewed, {});
        assert.deepStrictEqual(unresolved.unresolved.map(item => item.name || item), ["files"]);

        const renamed = importer.plan(previewed, { files: "rename:files-2" });
        assert.deepStrictEqual(renamed.unresolved, []);
        assert.deepStrictEqual(renamed.writes.map(item => item.name).sort(), ["files-2", "other"]);

        const skipped = importer.plan(previewed, { files: "skip" });
        assert.deepStrictEqual(skipped.writes.map(item => item.name), ["other"]);
    });

    /* ------------------------------------------------------------ P4-06 */

    await test("P4-06 ten big servers: the declared definitions stay under the cap, the rest are findable", () => {

        const topics = ["weather", "github", "postgres", "slack", "jira", "stripe", "notion", "sentry", "docker", "figma"];
        const verbs = ["list", "get", "create", "update", "delete", "search", "export", "import", "archive", "watch"];
        const entries = [];

        for (let server = 0; server < 10; server++) {
            for (let tool = 0; tool < 30; tool++) {
                entries.push({
                    name: `mcp__${topics[server]}__${verbs[tool % 10]}_${tool}`,
                    server: topics[server],
                    tool: `${verbs[tool % 10]}_${tool}`,
                    description: `${verbs[tool % 10]} ${topics[server]} records: ${"does a thing with care. ".repeat(8)}`,
                    parameters: { type: "object", properties: { a: { type: "string", description: "x".repeat(120) } } }
                });
            }
        }

        const declarations = entries.map(entry => ({
            type: "function",
            function: { name: entry.name, description: entry.description, parameters: entry.parameters }
        }));

        const cap = 24000;
        const total = declarations.reduce((sum, item) => sum + budget.size(item), 0);

        assert.ok(total > cap * 3, "the fixture is far over the cap");

        for (const mode of ["auto", "eager", "lazy"]) {
            const selected = budget.select(declarations, { mode, budget: cap });
            const used = selected.declared.reduce((sum, item) => sum + budget.size(item), 0);
            assert.ok(used <= cap, `${mode}: ${used} > ${cap}`);
            assert.strictEqual(selected.declared.length + selected.deferred.length, declarations.length);
            for (const item of selected.deferred) {
                assert.ok(item.name && item.description.length <= 120 && !item.description.includes("\n"), "a deferred tool is a name and one short line");
            }
        }

        const deferredIndex = budget.select(declarations, { mode: "auto", budget: cap }).deferred;
        assert.ok(JSON.stringify(deferredIndex).length < total / 3, "the deferred index is much smaller than the definitions");

        const found = budget.search(entries, { query: "export postgres", limit: 3 });
        assert.ok(found.length > 0 && found.every(item => item.server === "postgres" && item.tool.startsWith("export_")), JSON.stringify(found.map(item => item.name)));

        const named = budget.search(entries, { names: ["mcp__figma__watch_29"] });
        assert.deepStrictEqual(named.map(item => item.name), ["mcp__figma__watch_29"]);
    });

    /* ------------------------------------------------------------ P4-07 */

    await test("P4-07 a switched-off tool is gone from the list and a direct call is refused", async () => {

        writeUserConfig({ mock: { command: process.execPath, args: [MOCK] } });

        const manager = new McpManager(WORKSPACE);
        cleanups.push(() => manager.shutdown());
        manager.invalidate();
        manager.load(WORKSPACE);
        await manager.discover({ force: true });

        assert.ok(manager.catalogueEntries().some(entry => entry.tool === "write_note"));

        overrides.set("mock", { tool: "write_note", enabled: false });
        assert.deepStrictEqual(overrides.get("mock").disabled_tools, ["write_note"]);

        manager.invalidate();
        manager.load(WORKSPACE);
        await manager.discover({ force: true });

        const tools = manager.catalogueEntries().map(entry => entry.tool);
        assert.ok(!tools.includes("write_note"), tools.join(","));
        assert.ok(tools.includes("echo"));

        const denied = rules.mcpToolRule(manager, "mcp_call", { args: { server: "mock", tool: "write_note" }, agent: "main" });
        assert.strictEqual(denied.decision, "deny");
        assert.strictEqual(denied.rule, "mcp_tool_disabled");

        await assert.rejects(() => manager.call("mock", "write_note", { text: "x" }), /switched off|not exposed|excluded|disabled|filter/i);

        /* apply() never widens a server's own include list */
        const narrowed = overrides.apply({ name: "x", include: ["echo"], exclude: [] }, { disabled_tools: ["write_note"] });
        assert.deepStrictEqual(narrowed.include, ["echo"]);
        assert.deepStrictEqual(narrowed.exclude, ["write_note"]);

        overrides.set("mock", { tool: "write_note", enabled: true });
        assert.strictEqual(overrides.get("mock"), null, "an empty override is dropped");
    });

    await test("P4-07 read and write tools have separate approval; a server can be limited to one agent", async () => {

        writeUserConfig({ mock: { command: process.execPath, args: [MOCK], approval: { read: "never", write: "always" }, agents: ["researcher"] } });

        const manager = new McpManager(WORKSPACE);
        cleanups.push(() => manager.shutdown());
        manager.invalidate();
        manager.load(WORKSPACE);
        await manager.discover({ force: true });

        const read = rules.mcpToolRule(manager, "mcp_call", { args: { server: "mock", tool: "echo" }, agent: "researcher" });
        const write = rules.mcpToolRule(manager, "mcp_call", { args: { server: "mock", tool: "write_note" }, agent: "researcher#1" });

        assert.strictEqual(read.decision, "allow");
        assert.strictEqual(read.rule, "mcp_approval_read");
        assert.strictEqual(write.decision, "require_approval");
        assert.strictEqual(write.rule, "mcp_approval_write");

        const other = rules.mcpToolRule(manager, "mcp_call", { args: { server: "mock", tool: "echo" }, agent: "main" });
        assert.strictEqual(other.decision, "deny");
        assert.strictEqual(other.rule, "mcp_agent_scope");

        assert.strictEqual(manager.catalogueEntries(null, { agent: "main" }).filter(entry => entry.server === "mock").length, 0);
        assert.ok(manager.catalogueEntries(null, { agent: "researcher" }).some(entry => entry.server === "mock"));
        assert.throws(() => manager.usableClient("mock", { agent: "main" }), /limited|researcher/);

        /* the console is not an agent */
        assert.ok(manager.usableClient("mock", { agent: "web_console" }));
    });

    /* ------------------------------------------------------------ P4-10 */

    const client = mockClient("mock-full", { sampling: true });

    await test("P4-10 resources and prompts are listed, read and rendered", async () => {

        await client.ensureReady();

        assert.deepStrictEqual((await client.listResources()).map(item => item.uri), ["note://welcome"]);
        assert.deepStrictEqual((await client.listResourceTemplates()).map(item => item.uriTemplate), ["note://{id}"]);
        assert.strictEqual((await client.readResource("note://7"))[0].text, "contents of note://7");

        const prompts = await client.listPrompts();
        assert.strictEqual(prompts[0].name, "review_code");

        const rendered = require(path.join(REPO, "agent", "tools", "mcp", "McpProtocolTools")).renderPrompt(await client.getPrompt("review_code", { language: "go" }));
        assert.ok(JSON.stringify(rendered).includes("Review this go code carefully."));
    });

    await test("P4-10 the client advertises elicitation and sampling (when allowed)", async () => {

        const capabilities = await client.callTool("client_capabilities", {});

        assert.ok(capabilities.elicitation, JSON.stringify(capabilities));
        assert.ok(capabilities.sampling, JSON.stringify(capabilities));

        const plain = mockClient("mock-plain");
        const plainCapabilities = await plain.callTool("client_capabilities", {});
        assert.ok(!plainCapabilities.sampling, "no sampling without the server's sampling: true");
    });

    await test("P4-10 progress notifications become mcp:progress events for the running call", async () => {

        seen.length = 0;

        assert.strictEqual((await client.callTool("slow_count", {})).text, "counted");

        const progress = seen.filter(event => event.type === "mcp:progress");
        assert.deepStrictEqual(progress.map(event => event.progress), [1, 2, 3]);
        assert.strictEqual(progress[0].server, "mock-full");
        assert.strictEqual(progress[0].total, 3);
        assert.match(progress[0].token, /^mock-full:slow_count:/);
    });

    await test("P4-10 elicitation: a dialog is pending, answered, validated, declined or timed out", async () => {

        interactions.setInteractive(true);
        seen.length = 0;

        const accepted = client.callTool("ask_user", {});
        const [pending] = await waitFor(() => interactions.pending().length ? interactions.pending() : null, 3000, "a pending question");

        assert.strictEqual(pending.server, "mock-full");
        assert.strictEqual(pending.message, "What is your name?");
        assert.ok(seen.some(event => event.type === "mcp:elicitation" && event.id === pending.id));

        assert.throws(() => interactions.answer(pending.id, { action: "accept", content: {} }), error => error.status === 400 && /name/i.test(error.message));
        assert.throws(() => interactions.answer(pending.id, { action: "maybe" }), error => error.status === 400);

        interactions.answer(pending.id, { action: "accept", content: { name: "Sara" } });
        assert.strictEqual((await accepted).text, "hello Sara");
        assert.throws(() => interactions.answer(pending.id, { action: "accept", content: { name: "x" } }), error => error.status === 404);

        const declined = client.callTool("ask_user", {});
        const [second] = await waitFor(() => interactions.pending().length ? interactions.pending() : null, 3000, "a second question");
        interactions.answer(second.id, { action: "decline" });
        assert.strictEqual((await declined).text, "no answer (decline)");

        /* MCP_ELICITATION_TIMEOUT_MS=1000: nobody answers */
        assert.strictEqual((await client.callTool("ask_user", {})).text, "no answer (cancel)");
        assert.strictEqual(interactions.pending().length, 0);

        /* no console attached: cancelled at once */
        interactions.setInteractive(false);
        const started = Date.now();
        assert.strictEqual((await client.callTool("ask_user", {})).text, "no answer (cancel)");
        assert.ok(Date.now() - started < 300);
        interactions.setInteractive(true);
    });

    await test("P4-10 sampling calls the model within the per-server budget", async () => {

        const requests = [];

        interactions.setModelCaller(async request => {
            requests.push(request);
            return { choices: [{ message: { content: "a short summary" } }], usage: { total_tokens: 2000 } };
        });

        seen.length = 0;

        assert.strictEqual((await client.callTool("summarize", { text: "long text" })).text, "summary: a short summary");
        assert.strictEqual(requests.length, 1);
        assert.strictEqual(requests[0].scope, "mcp:mock-full");
        assert.ok(requests[0].agentDefinition.max_tokens <= 4096, "maxTokens is capped by MCP_SAMPLING_MAX_TOKENS");
        assert.strictEqual(interactions.usage("mock-full").used_tokens, 2000);

        /* a request is admitted only if its max output still fits (5000-token budget) */
        await client.callTool("summarize", { text: "again" });
        assert.strictEqual(interactions.usage("mock-full").used_tokens, 4000);

        await assert.rejects(() => client.callTool("summarize", { text: "over" }), /budget/i);
        assert.strictEqual(requests.length, 2, "the model is not called past the budget");
        assert.ok(seen.some(event => event.type === "mcp:sampling" && event.ok === false));

        const plain = mockClient("mock-nosampling");
        await assert.rejects(() => plain.callTool("summarize", { text: "x" }), /not allowed|sampling/i);

        interactions.resetSampling();
    });

    /* ------------------------------------------------------------ P4-08 */

    await test("P4-08 OAuth: discovery, registration, PKCE sign-in, refresh on 401, revocation", async () => {

        const mock = await startOAuthMcp();
        cleanups.push(() => mock.close());

        const config = validator.normalizeOne("remote", { transport: "http", url: mock.url, oauth: true }, WORKSPACE);
        const remote = new McpClient(config);
        cleanups.push(() => remote.close());

        await assert.rejects(() => remote.ensureReady(), error => error.code === "MCP_OAUTH_REQUIRED");

        const started = await oauth.start(config, { requestBase: "http://console.test" });
        assert.strictEqual(started.redirect_uri, "http://console.test/api/mcp/oauth/callback");

        const authorize = new URL(started.authorization_url);
        assert.strictEqual(authorize.searchParams.get("code_challenge_method"), "S256");
        assert.strictEqual(authorize.searchParams.get("resource"), mock.url);
        assert.strictEqual(authorize.searchParams.get("client_id"), "client-1", "registered dynamically");

        await assert.rejects(() => oauth.complete({ state: "forged", code: "x" }), /unknown|expired/);

        const redirect = await fetch(started.authorization_url, { redirect: "manual" });
        const callback = new URL(redirect.headers.get("location"));
        await oauth.complete(Object.fromEntries(callback.searchParams));

        await assert.rejects(() => oauth.complete(Object.fromEntries(callback.searchParams)), /unknown|expired/, "a state works once");

        const status = oauth.status("remote");
        assert.strictEqual(status.signed_in, true);
        assert.ok(!JSON.stringify(status).match(/access_token|refresh_token/), "status shows no token");

        await remote.reconnectNow().catch(() => {});
        assert.strictEqual((await remote.callTool("whoami", {})).text, "signed-in user");

        mock.state.expireAccess();
        assert.strictEqual((await remote.callTool("whoami", {})).text, "signed-in user", "refreshed after a 401");
        assert.strictEqual(mock.state.log.filter(line => line === "POST /token").length, 2);

        /* a second sign-in reuses the registration */
        await oauth.start(config, { requestBase: "http://console.test" });
        assert.strictEqual(mock.state.clients.size, 1);

        mock.state.expireAccess();
        mock.state.revokeRefresh();
        await assert.rejects(() => remote.callTool("whoami", {}), error => error.code === "MCP_OAUTH_REQUIRED");
        assert.strictEqual(oauth.status("remote").signed_in, false);
        assert.ok(seen.some(event => event.type === "mcp:oauth" && event.status === "expired"));

        oauth.signOut("remote", { forgetClient: true });
        assert.strictEqual(oauth.status("remote").signed_in, false);
    });

    /* ------------------------------------------------------------ P4-09 */

    await test("P4-09 a node server built by the agent registers and answers", async () => {

        const built = builder.scaffold({
            workspaceRoot: WORKSPACE,
            name: "adder",
            language: "node",
            tools: [{ name: "add", description: "Add two numbers", input_schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } }, body: "return { sum: args.a + args.b };", read_only: true }]
        });

        assert.ok(built.dir.startsWith(path.join(WORKSPACE, ".agent", "mcp-servers")));
        assert.throws(() => builder.scaffold({ workspaceRoot: WORKSPACE, name: "adder", tools: [{ name: "x" }] }), /already exists/);

        const adder = new McpClient(validator.normalizeOne("adder", builder.definitionFor({ ...built, name: "adder" }), WORKSPACE));
        cleanups.push(() => adder.close());

        await adder.ensureReady();
        const tools = await adder.listTools();
        assert.strictEqual(tools[0].annotations.readOnlyHint, true);
        assert.match(JSON.stringify(await adder.callTool("add", { a: 2, b: 3 })), /5/);
    });

    const python = spawnSync(process.platform === "win32" ? "python" : "python3", ["--version"]);

    await test("P4-09 a python server built by the agent answers (skipped without python)", async () => {

        if (python.status !== 0) {
            console.log("       (python is not installed; skipped)");
            return;
        }

        const built = builder.scaffold({
            workspaceRoot: WORKSPACE,
            name: "pyecho",
            language: "python",
            tools: [{ name: "shout", description: "Upper-case text", input_schema: { type: "object", properties: { text: { type: "string" } } }, body: "return {\"text\": args[\"text\"].upper()}" }]
        });

        const pyecho = new McpClient(validator.normalizeOne("pyecho", builder.definitionFor({ ...built, name: "pyecho" }), WORKSPACE));
        cleanups.push(() => pyecho.close());

        await pyecho.ensureReady();
        assert.match(JSON.stringify(await pyecho.callTool("shout", { text: "hi" })), /HI/);
    });

    await test("P4-09 an OpenAPI document becomes a server whose tools call the API", async () => {

        const api = http.createServer((req, res) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization || null }));
        });

        await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
        cleanups.push(() => new Promise(resolve => api.close(() => resolve())));

        const spec = builder.fromOpenApi({
            openapi: "3.0.0",
            servers: [{ url: `http://127.0.0.1:${api.address().port}` }],
            paths: {
                "/pets/{id}": {
                    get: { operationId: "getPet", summary: "One pet", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "full", in: "query", schema: { type: "boolean" } }] }
                }
            }
        });

        assert.deepStrictEqual(spec.operations.map(item => item.name), ["getPet"]);

        const built = builder.scaffold({ workspaceRoot: WORKSPACE, name: "petapi", openapi: spec });
        const definition = builder.definitionFor({ ...built, name: "petapi" });
        const petapi = new McpClient(validator.normalizeOne("petapi", { ...definition, env: { OPENAPI_BEARER_TOKEN: "tok" } }, WORKSPACE));
        cleanups.push(() => petapi.close());

        const answer = JSON.stringify(await petapi.callTool("getPet", { id: "7", full: true }));
        assert.match(answer, /\/pets\/7\?full=true/);
        assert.match(answer, /Bearer tok/);
    });

    /* ------------------------------------------------------------ P4-11 */

    await test("P4-11 the runtime as an MCP server: handshake, tools, isError on failure", async () => {

        const calls = [];
        const handler = host.createHandler({
            listProjects: async () => [{ id: "p1", name: "one" }],
            resolveProject: async name => {
                if (name !== "p1" && name !== "one") throw Object.assign(new Error("no such project"), { status: 404 });
                return "p1";
            },
            runTask: async (id, task, options) => { calls.push({ id, task, options }); return { accepted: true, project_id: id }; },
            waitFor: async () => ({ status: "completed", answer: "done" }),
            status: async id => ({ project_id: id, status: "idle" })
        });

        const init = await handler({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
        assert.strictEqual(init.result.protocolVersion, "2025-06-18");
        assert.ok(init.result.capabilities.tools);

        assert.strictEqual(await handler({ jsonrpc: "2.0", method: "notifications/initialized" }), null);

        const list = await handler({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        assert.deepStrictEqual(list.result.tools.map(tool => tool.name).sort(), ["list_projects", "run_task", "task_status"]);

        const run = await handler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "run_task", arguments: { project: "one", task: "fix it", wait_seconds: 5, plan_first: true } } });
        assert.ok(!run.result.isError, JSON.stringify(run));
        assert.match(run.result.content[0].text, /done/);
        assert.deepStrictEqual(calls[0], { id: "p1", task: "fix it", options: { planFirst: true } });

        const missing = await handler({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "task_status", arguments: { project: "nope" } } });
        assert.strictEqual(missing.result.isError, true);
        assert.match(missing.result.content[0].text, /no such project/);

        const unknown = await handler({ jsonrpc: "2.0", id: 5, method: "nope/nope" });
        assert.strictEqual(unknown.error.code, -32601);
    });

    /* ------------------------------------------------------------ P4-12 */

    await test("P4-12 registry records become runnable definitions; required inputs are reported", () => {

        const record = registry.normalize({
            server: {
                name: "io.github.someone/weather",
                description: "Weather",
                version: "1.2.0",
                packages: [
                    { registryType: "npm", identifier: "@someone/weather", version: "1.2.0", transport: { type: "stdio" }, environmentVariables: [{ name: "WEATHER_KEY", isRequired: true, isSecret: true }] },
                    { registryType: "pypi", identifier: "weather-mcp", version: "1.2.0", transport: { type: "stdio" } }
                ],
                remotes: [{ type: "streamable-http", url: "https://weather.example/mcp" }]
            },
            _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } }
        });

        assert.strictEqual(record.installable, true);
        assert.strictEqual(registry.localName(record.name), "weather");

        const missing = registry.definitionFor(record, {});
        assert.deepStrictEqual(missing.missing.map(input => input.name), ["WEATHER_KEY"]);

        const npm = registry.definitionFor(record, { inputs: { WEATHER_KEY: "${secret:WEATHER_KEY}" } });
        assert.deepStrictEqual([npm.definition.command, ...npm.definition.args], ["npx", "-y", "@someone/weather@1.2.0"]);
        assert.strictEqual(npm.definition.env.WEATHER_KEY, "${secret:WEATHER_KEY}");

        const pypi = registry.definitionFor(record, { choice: "package:1" });
        assert.deepStrictEqual([pypi.definition.command, ...pypi.definition.args], ["uvx", "weather-mcp==1.2.0"]);

        const remote = registry.definitionFor(record, { choice: "remote:0" });
        assert.deepStrictEqual(remote.definition, { transport: "http", url: "https://weather.example/mcp", oauth: true, description: "Weather", registry: { name: "io.github.someone/weather", version: "1.2.0" } });

        for (const definition of [npm.definition, pypi.definition, remote.definition]) {
            const stored = { ...definition };
            delete stored.registry;
            validator.normalizeOne("weather", stored, WORKSPACE, { secrets: true, expandSecrets: false });
        }

        assert.match(registry.TRUST_WARNING, /does not review/);
    });

    for (const cleanup of cleanups.reverse()) {
        try { await cleanup(); } catch { /* already gone */ }
    }

    removeTempDirs([WORKSPACE, DATA_HOME]);

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} MCP completion checks passed`);

    process.exit(failed ? 1 : 0);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
