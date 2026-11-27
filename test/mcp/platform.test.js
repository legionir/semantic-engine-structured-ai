"use strict";

/*
|--------------------------------------------------------------------------
| MCP platform: secrets, catalogue, prerequisites, reconnects (P4-01 … 04)
|--------------------------------------------------------------------------
|
| P4-01  the secret store is encrypted, its values never come back through
|        the API, are masked by value wherever text leaves the runtime, and
|        only operator configuration may refer to them;
| P4-02  a catalogue entry is activated from the API (token → store →
|        user config → connect → tools) and deactivated cleanly;
| P4-03  a missing prerequisite stops activation before anything is
|        written; a one-click install reports progress;
| P4-04  a killed stdio server comes back by itself, with backoff, and the
|        last error is in the global log.
|
| WORKSPACE_ROOT and the data home are set before anything is loaded.
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { removeTempDirs } = require("../helpers/cleanup");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-platform-ws-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-platform-data-"));
const TRUST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-platform-trust-"));
const BROWSERS = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-platform-browsers-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.STRUCTURED_AI_TRUST_FILE = path.join(TRUST_HOME, "trusted-workspaces.json");
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.AGENT_MODEL = "test-model";
process.env.AGENT_APPROVAL = "auto";

const REPO = path.resolve(__dirname, "..", "..");

const settings = require(path.join(REPO, "agent", "config"));
const events = require(path.join(REPO, "agent", "events"));
const store = require(path.join(REPO, "agent", "secrets", "SecretStore"));
const redactor = require(path.join(REPO, "agent", "events", "EventRedactor"));
const validator = require(path.join(REPO, "agent", "mcp", "McpConfigValidator"));
const loader = require(path.join(REPO, "agent", "mcp", "McpConfigLoader"));
const prerequisites = require(path.join(REPO, "agent", "mcp", "McpPrerequisites"));
const catalog = require(path.join(REPO, "agent", "mcp", "McpCatalog"));
const { McpManager } = require(path.join(REPO, "agent", "mcp", "McpManager"));
const { McpClient, reconnectDelay } = require(path.join(REPO, "agent", "mcp", "McpConnection"));

const results = [];
const cleanups = [];

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


async function waitFor(check, ms = 10000, label = "condition") {

    const started = Date.now();

    while (Date.now() - started < ms) {
        const value = await check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 25));
    }

    throw new Error(`timed out waiting for ${label}`);
}


/*
| A stdio MCP server: answers the handshake, lists two tools, and reports
| its pid and the TEST_TOKEN it was started with. With CRASH_FILE set and
| that file present it dies as soon as it starts, for the give-up case.
*/
function writeServer(name = "platform-server") {

    const file = path.join(WORKSPACE, `${name}-${Math.random().toString(16).slice(2, 8)}.js`);

    fs.writeFileSync(file, `
"use strict";
const fs = require("fs");
if (process.env.CRASH_FILE && fs.existsSync(process.env.CRASH_FILE)) process.exit(3);
const TOOLS = [
  { name: "whoami", description: "pid and token", inputSchema: { type: "object", properties: {} } },
  { name: "echo", description: "echo", inputSchema: { type: "object", properties: { message: { type: "string" } } } }
];
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }
function handle(message) {
  if (message.method === "initialize") return reply(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: ${JSON.stringify(name)}, version: "1.0.0" } });
  if (message.method === "tools/list") return reply(message.id, { tools: TOOLS });
  if (message.method === "ping") return reply(message.id, {});
  if (message.method === "tools/call") {
    const args = (message.params && message.params.arguments) || {};
    const text = message.params.name === "whoami"
      ? JSON.stringify({ pid: process.pid, token: process.env.TEST_TOKEN || null })
      : JSON.stringify({ echoed: args.message });
    return reply(message.id, { content: [{ type: "text", text }] });
  }
  if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } }) + "\\n");
}
let buffer = Buffer.alloc(0);
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const separator = buffer.indexOf("\\r\\n\\r\\n");
    if (separator !== -1 && /^Content-Length/i.test(buffer.slice(0, 15).toString())) {
      const length = parseInt(/Content-Length:\\s*(\\d+)/i.exec(buffer.slice(0, separator).toString())[1], 10);
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
`, "utf8");

    return file;
}


function freshManager() {

    const manager = new McpManager(WORKSPACE);

    cleanups.push(() => manager.shutdown());

    return manager;
}


function seen(type) {

    const list = [];
    const listener = event => list.push(event);

    events.bus.on(type, listener);
    cleanups.push(() => events.bus.removeListener(type, listener));

    return list;
}


async function main() {

    console.log(`data home: ${DATA_HOME}\n`);

    /* ------------------------------------------------------------ P4-01 */
    console.log("secret store (P4-01)");

    const VALUE = "tok-platform-4f9c1e7a2b";

    await test("a secret is stored encrypted and listed by name only", async () => {

        const saved = store.set("TEST_TOKEN", VALUE);

        assert.deepEqual(saved, { name: "TEST_TOKEN", created: true });

        const listed = store.list();

        assert.equal(listed.length, 1);
        assert.equal(listed[0].name, "TEST_TOKEN");
        assert.equal(listed[0].value, undefined, "list() never carries a value");
        assert.ok(!JSON.stringify(listed).includes(VALUE));

        const encrypted = fs.readFileSync(store.storeFile(), "utf8");

        assert.ok(!encrypted.includes(VALUE), "the value is not in the file in clear");
        assert.ok(!encrypted.includes("TEST_TOKEN"), "nor is its name");
        assert.ok(fs.existsSync(store.keyFile()));

        if (process.platform !== "win32") {
            assert.equal(fs.statSync(store.keyFile()).mode & 0o777, 0o600);
            assert.equal(fs.statSync(store.storeFile()).mode & 0o777, 0o600);
        }

        assert.equal(store.resolve("TEST_TOKEN"), VALUE);
    });

    await test("a replaced secret keeps its creation date; a removed one is gone", async () => {

        store.set("SCRATCH", "first-value");
        const before = store.list().find(item => item.name === "SCRATCH");

        await new Promise(resolve => setTimeout(resolve, 5));
        assert.deepEqual(store.set("SCRATCH", "second-value"), { name: "SCRATCH", created: false });

        const after = store.list().find(item => item.name === "SCRATCH");

        assert.equal(after.created_at, before.created_at);
        assert.equal(store.resolve("SCRATCH"), "second-value");
        assert.equal(store.remove("SCRATCH"), true);
        assert.equal(store.remove("SCRATCH"), false);
        assert.equal(store.has("SCRATCH"), false);
    });

    await test("a bad name or an empty value is refused", async () => {

        assert.throws(() => store.set("has space", "x"), /not a usable secret name/);
        assert.throws(() => store.set("1LEADING_DIGIT", "x"), /not a usable secret name/);
        assert.throws(() => store.set("EMPTY", ""), /non-empty value/);
    });

    await test("a store opened with the wrong key says so instead of returning nothing", async () => {

        const keyText = fs.readFileSync(store.keyFile(), "utf8");

        try {
            fs.writeFileSync(store.keyFile(), `${require("crypto").randomBytes(32).toString("base64")}\n`);
            store.resetCache();
            assert.throws(() => store.list(), /could not be decrypted/);
        } finally {
            fs.writeFileSync(store.keyFile(), keyText);
            store.resetCache();
        }

        assert.equal(store.resolve("TEST_TOKEN"), VALUE);
    });

    await test("a stored value is masked in text, in persisted events and in API answers", async () => {

        redactor.resetKnownSecrets();

        const line = `the server said: bad credentials ${VALUE} (retry)`;

        assert.ok(!redactor.maskText(line).includes(VALUE));
        assert.ok(!JSON.stringify(redactor.redactSecrets({ type: "mcp:result", error: line })).includes(VALUE));
        assert.ok(!JSON.stringify(redactor.maskDeep({ servers: [{ connection: { args: ["--token", VALUE] } }] })).includes(VALUE));
        /* field names survive value masking */
        assert.deepEqual(Object.keys(redactor.maskDeep({ secret_name: "GITHUB_PAT" })), ["secret_name"]);
    });

    await test("${secret:NAME} resolves only in operator configuration", async () => {

        const definition = { command: "node", env: { TEST_TOKEN: "${secret:TEST_TOKEN}" } };

        const runtime = validator.normalizeOne("op", definition, WORKSPACE);
        assert.equal(runtime.env.TEST_TOKEN, VALUE);

        const user = validator.normalize("op", definition, { source: validator.SOURCES.USER, workspaceRoot: WORKSPACE });
        assert.equal(user.env.TEST_TOKEN, VALUE);

        const kept = validator.normalizeOne("op", definition, WORKSPACE, { secrets: true, expandSecrets: false });
        assert.equal(kept.env.TEST_TOKEN, "${secret:TEST_TOKEN}");

        /* the agent's own servers (mcp_add) */
        assert.throws(
            () => validator.normalizeOne("op", definition, WORKSPACE, { secrets: false }),
            /may only be used in operator MCP configuration/
        );

        /* a repository file, even of a trusted workspace */
        require(path.join(REPO, "agent", "projects", "WorkspaceTrust")).trust(WORKSPACE);
        assert.throws(
            () => validator.normalize("op", definition, { source: validator.SOURCES.WORKSPACE, workspaceRoot: WORKSPACE }),
            /may only be used in operator MCP configuration/
        );

        assert.throws(
            () => validator.normalizeOne("op", { command: "node", env: { X: "${secret:NOT_STORED}" } }, WORKSPACE),
            /secret "NOT_STORED" is not in the secret store/
        );
    });

    await test("file tools cannot reach the secret store, even when the data home is in the workspace", async () => {
        const boundary = require(path.join(REPO, "agent", "context", "WorkspaceBoundary"));
        store.set("BOUNDARY_PROBE", "probe-value-1234");
        for (const file of [store.storeFile(), store.keyFile()]) {
            assert.equal(boundary.isSecretStoreFile(file), true, file);
            assert.throws(
                () => boundary.resolvePathInRoot(path.dirname(file), path.basename(file)),
                /secret store and cannot be used by file tools/
            );
        }
        assert.equal(boundary.isSecretStoreFile(path.join(path.dirname(store.storeFile()), "mcp.json")), false);
        assert.equal(boundary.isSecretStoreFile(path.join(os.tmpdir(), "elsewhere", "secrets.key")), false, "same name, other folder");
        store.remove("BOUNDARY_PROBE");
    });

    await test("the agent has no tool that reads secrets, and mcp_add cannot reference one", async () => {

        const tools = require(path.join(REPO, "agent", "tools"));

        const names = tools.implementedToolNames();

        assert.ok(names.length > 10);
        assert.deepEqual(names.filter(name => /secret/i.test(name)), []);

        const outcome = await tools.executeTool(
            "mcp_add",
            { name: "sneaky", command: writeServer("sneaky"), env: { TEST_TOKEN: "${secret:TEST_TOKEN}" } },
            { agent: "test" }
        ).catch(error => ({ ok: false, error: error.message }));

        assert.ok(!JSON.stringify(outcome).includes(VALUE), "the value never reaches the agent");
        assert.match(JSON.stringify(outcome), /operator MCP configuration/);
        assert.equal(loader.readUserServer("sneaky"), null);
    });

    await test("a console-added server keeps the reference on disk, in the user config", async () => {

        const manager = freshManager();
        const script = writeServer("console-added");

        const added = await manager.add("console-added", {
            command: script,
            env: { TEST_TOKEN: "${secret:TEST_TOKEN}" }
        });

        assert.equal(added.persisted_to, loader.userFile());

        const stored = loader.readUserServer("console-added");

        assert.equal(stored.env.TEST_TOKEN, "${secret:TEST_TOKEN}");
        assert.ok(!fs.readFileSync(loader.userFile(), "utf8").includes(VALUE));
        assert.ok(!fs.existsSync(loader.workspaceFile(WORKSPACE)) || !fs.readFileSync(loader.workspaceFile(WORKSPACE), "utf8").includes(VALUE));

        const answer = await manager.call("console-added", "whoami", {});
        const text = JSON.stringify(answer);

        assert.ok(text.includes("pid"), text);

        const pid = manager.client("console-added").describe().connection.pid;

        /* reading it back from the user file keeps the running process */
        manager.invalidate();
        manager.load();

        assert.equal(manager.client("console-added").describe().connection.pid, pid);
        assert.equal(manager.client("console-added").config.source, "user");

        await manager.remove("console-added");
        assert.equal(loader.readUserServer("console-added"), null);
    });

    /* ------------------------------------------------------------ P4-04 */
    console.log("\nreconnects (P4-04)");

    await test("the reconnect wait doubles per attempt, is capped, and is jittered", async () => {

        settings.set("MCP_RECONNECT_BASE_MS", 1000);
        settings.set("MCP_RECONNECT_MAX_MS", 5000);

        const middle = () => 0.5;

        assert.equal(reconnectDelay(1, middle), 1000);
        assert.equal(reconnectDelay(2, middle), 2000);
        assert.equal(reconnectDelay(3, middle), 4000);
        assert.equal(reconnectDelay(4, middle), 5000);
        assert.equal(reconnectDelay(9, middle), 5000);
        assert.equal(reconnectDelay(1, () => 0), 800);
        assert.equal(reconnectDelay(1, () => 1), 1200);

        settings.reset("MCP_RECONNECT_BASE_MS");
        settings.reset("MCP_RECONNECT_MAX_MS");
    });

    await test("killing a stdio server starts it again by itself", async () => {

        settings.set("MCP_RECONNECT_BASE_MS", 50);

        const disconnected = seen("mcp:disconnected");
        const reconnected = seen("mcp:reconnected");

        const manager = freshManager();

        await manager.add("phoenix", { command: writeServer("phoenix") }, { persist: false });

        const client = manager.client("phoenix");
        const firstPid = client.describe().connection.pid;

        assert.ok(firstPid > 0);

        process.kill(firstPid);

        await waitFor(() => disconnected.find(event => event.server === "phoenix"), 10000, "mcp:disconnected");

        const lost = disconnected.find(event => event.server === "phoenix");

        assert.equal(lost.retrying, true);
        assert.equal(lost.attempt, 1);
        assert.match(lost.error, /disconnected: the process exited/);

        await waitFor(() => reconnected.find(event => event.server === "phoenix"), 10000, "mcp:reconnected");

        const back = client.describe();

        assert.equal(back.state, "ready");
        assert.notEqual(back.connection.pid, firstPid, "a new process");
        assert.equal(back.reconnect.count, 1);
        assert.equal(back.reconnect.attempt, 0, "the attempt budget is reset");
        assert.match(back.reconnect.last_error, /disconnected/, "the last error is kept for the status");
        assert.equal(back.error, null);

        /* and the tools work again */
        const answer = await manager.call("phoenix", "echo", { message: "again" });
        assert.match(JSON.stringify(answer), /again/);

        settings.reset("MCP_RECONNECT_BASE_MS");
    });

    await test("a server that keeps dying is given up after MCP_RECONNECT_MAX_ATTEMPTS", async () => {

        settings.set("MCP_RECONNECT_BASE_MS", 20);
        settings.set("MCP_RECONNECT_MAX_ATTEMPTS", 2);

        const unavailable = seen("mcp:unavailable");
        const crashFile = path.join(WORKSPACE, `crash-${Date.now()}`);
        const manager = freshManager();

        await manager.add("doomed", { command: writeServer("doomed"), env: { CRASH_FILE: crashFile } }, { persist: false });

        const client = manager.client("doomed");

        fs.writeFileSync(crashFile, "1");
        process.kill(client.describe().connection.pid);

        await waitFor(() => unavailable.find(event => event.server === "doomed"), 10000, "give up");

        const state = client.describe();

        assert.equal(state.state, "failed");
        assert.match(state.error, /did not come back after 2 reconnect attempt/);
        assert.equal(state.reconnect.next_at, null);

        /* Reconnect (the console button) starts over once the cause is gone */
        fs.rmSync(crashFile);
        await client.reconnectNow();
        assert.equal(client.describe().state, "ready");

        settings.reset("MCP_RECONNECT_BASE_MS");
        settings.reset("MCP_RECONNECT_MAX_ATTEMPTS");
    });

    await test("closing a server cancels its pending reconnect; reconnects can be switched off", async () => {

        settings.set("MCP_RECONNECT_BASE_MS", 5000);

        const manager = freshManager();

        await manager.add("closing", { command: writeServer("closing") }, { persist: false });

        const client = manager.client("closing");

        process.kill(client.describe().connection.pid);
        await waitFor(() => client.describe().state === "reconnecting", 10000, "reconnecting");

        assert.ok(client.reconnect.timer);

        await client.close();

        assert.equal(client.reconnect.timer, null);
        assert.equal(client.describe().state, "closed");

        settings.set("MCP_RECONNECT_ENABLED", false);

        const other = new McpClient(validator.normalizeOne("quiet", { command: writeServer("quiet") }, WORKSPACE));
        cleanups.push(() => other.close());

        await other.ensureReady();
        process.kill(other.describe().connection.pid);
        await waitFor(() => other.describe().state !== "ready", 10000, "lost");
        await new Promise(resolve => setTimeout(resolve, 100));

        assert.equal(other.reconnect.timer, null);
        assert.notEqual(other.describe().state, "reconnecting");

        settings.reset("MCP_RECONNECT_ENABLED");
        settings.reset("MCP_RECONNECT_BASE_MS");
    });

    /* ------------------------------------------------------------ P4-03 */
    console.log("\nprerequisites (P4-03)");

    await test("programs are found on PATH, a missing one comes with an install hint", async () => {

        const [node, missing] = prerequisites.check(["node", "no-such-program-4711"]);

        assert.equal(node.ok, true);
        assert.ok(node.path && fs.existsSync(node.path));

        assert.equal(missing.ok, false);
        assert.match(missing.hint, /Install no-such-program-4711/);

        const [uvx] = prerequisites.check(["uvx"]);
        if (!uvx.ok) assert.match(uvx.hint, /astral\.sh\/uv/);
    });

    await test("chromium counts once Playwright finished installing it", async () => {

        settings.set("PLAYWRIGHT_BROWSERS_PATH", BROWSERS);

        assert.equal(prerequisites.check(["chromium"])[0].ok, false);

        const directory = path.join(BROWSERS, "chromium_headless_shell-1200");
        fs.mkdirSync(directory, { recursive: true });

        assert.equal(prerequisites.check(["chromium"])[0].ok, false, "a download without its marker is not an install");

        fs.writeFileSync(path.join(directory, "INSTALLATION_COMPLETE"), "");

        const [chromium] = prerequisites.check(["chromium"]);

        assert.equal(chromium.ok, true);
        assert.equal(chromium.path, directory);

        settings.reset("PLAYWRIGHT_BROWSERS_PATH");
    });

    await test("a one-click install reports its progress and its outcome", async () => {

        const script = [
            "for (const p of [0, 25, 50, 100]) console.log(`|■■■■■     | ${p}% of 100 MiB`);",
            "console.log('Chromium downloaded to /tmp/x');"
        ].join("\n");

        const started = prerequisites.install("fake-ok", {
            recipe: { label: "Fake", command: process.execPath, args: ["-e", script] }
        });

        assert.equal(started.status, "running");

        const done = await prerequisites.waitForInstall("fake-ok", 15000);

        assert.equal(done.status, "succeeded");
        assert.equal(done.percent, 100);
        assert.ok(done.output.some(line => /downloaded to/.test(line)));
        assert.ok(done.output.filter(line => /% of 100 MiB/.test(line)).length === 1, "a progress bar is one line");

        prerequisites.install("fake-bad", {
            recipe: { command: process.execPath, args: ["-e", "console.error('no space left'); process.exit(4)"] }
        });

        const failed = await prerequisites.waitForInstall("fake-bad", 15000);

        assert.equal(failed.status, "failed");
        assert.equal(failed.exit_code, 4);
        assert.match(failed.error, /code 4: no space left/);
    });

    /* ------------------------------------------------- P4-02 over HTTP */
    console.log("\ncatalogue over the API (P4-02)");

    const script = writeServer("catalogued");
    const catalogFile = path.join(WORKSPACE, "test-catalog.json");

    fs.writeFileSync(catalogFile, JSON.stringify({
        version: "1",
        categories: { test: "Test" },
        installers: {},
        servers: [
            {
                id: "local",
                title: "Local test server",
                category: "test",
                description: "A stdio server from the test suite.",
                transport: "stdio",
                server: {
                    command: script,
                    args: ["--label", "${input:label}"],
                    env: { TEST_TOKEN: "${input:token}", OPTIONAL_KEY: "${input:optional}" }
                },
                inputs: [
                    { id: "token", label: "Test token", secret: "LOCAL_TOKEN", required: true },
                    { id: "label", label: "Label", required: true, default: "plain" },
                    { id: "optional", label: "Optional key", secret: "LOCAL_OPTIONAL", required: false }
                ],
                prerequisites: ["node"],
                trust: "default"
            },
            {
                id: "needs-missing",
                title: "Needs a missing program",
                category: "test",
                description: "",
                transport: "stdio",
                server: { command: script, env: { TEST_TOKEN: "${input:token}" } },
                inputs: [{ id: "token", label: "Token", secret: "MISSING_TOKEN", required: true }],
                prerequisites: ["no-such-program-4711"]
            },
            {
                id: "broken",
                title: "Broken server",
                category: "test",
                description: "",
                transport: "stdio",
                server: { command: path.join(WORKSPACE, "does-not-exist.js"), env: { TEST_TOKEN: "${input:token}" } },
                inputs: [{ id: "token", label: "Token", secret: "BROKEN_TOKEN", required: true }],
                prerequisites: []
            }
        ]
    }));

    catalog.useCatalogFile(catalogFile);

    const projects = require(path.join(REPO, "agent", "projects", "index.js"));
    projects.registry().register({ id: "prj-cat", name: "Cat", rootPath: WORKSPACE });

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    const web = createServer(runtime, { apiRateLimit: 100000 });
    const address = await web.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;

    const api = async (method, url, body) => {

        const response = await fetch(`${base}${url}`, {
            method,
            headers: { "content-type": "application/json", authorization: `Bearer ${web.token}` },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        const text = await response.text();

        return { status: response.status, text, body: text ? JSON.parse(text) : null };
    };

    const LOCAL = "local-token-8d2e61fa93";

    await test("secrets over the API: a value goes in and never comes out", async () => {

        const put = await api("PUT", "/api/secrets/API_ADDED", { value: "api-added-value-123" });

        assert.equal(put.status, 200);
        assert.deepEqual(put.body, { ok: true, name: "API_ADDED", created: true });

        const listed = await api("GET", "/api/secrets");

        assert.equal(listed.status, 200);
        assert.ok(listed.body.secrets.some(item => item.name === "API_ADDED"));
        assert.ok(!listed.text.includes("api-added-value-123"));
        assert.ok(!listed.text.includes(VALUE));

        assert.equal((await api("PUT", "/api/secrets/bad%20name", { value: "x" })).status, 400);
        assert.equal((await api("DELETE", "/api/secrets/API_ADDED")).status, 200);
        assert.equal((await api("DELETE", "/api/secrets/API_ADDED")).status, 404);

        const unauthenticated = await fetch(`${base}/api/secrets`);
        assert.equal(unauthenticated.status, 401);
    });

    await test("the catalogue lists entries with their prerequisites and inputs", async () => {

        const listed = await api("GET", "/api/mcp/catalog");

        assert.equal(listed.status, 200);

        const local = listed.body.servers.find(item => item.id === "local");

        assert.equal(local.prerequisites[0].id, "node");
        assert.equal(local.prerequisites[0].ok, true);
        assert.equal(local.inputs[0].secret_name, "LOCAL_TOKEN");
        assert.equal(local.inputs[0].secret_stored, false);
        assert.deepEqual(local.installed, []);

        const blocked = listed.body.servers.find(item => item.id === "needs-missing");
        assert.equal(blocked.prerequisites[0].ok, false);
    });

    await test("a missing prerequisite is reported before anything is written or started", async () => {

        const refused = await api("POST", "/api/mcp/catalog/needs-missing/activate", { inputs: { token: "would-be" } });

        assert.equal(refused.status, 412);
        assert.equal(refused.body.code, "missing_prerequisite");
        assert.equal(refused.body.missing[0].id, "no-such-program-4711");
        assert.equal(store.has("MISSING_TOKEN"), false, "no secret was stored");
        assert.equal(loader.readUserServer("needs-missing"), null, "no config was written");
    });

    await test("a required input is asked for", async () => {

        const refused = await api("POST", "/api/mcp/catalog/local/activate", { inputs: {} });

        assert.equal(refused.status, 400);
        assert.match(refused.body.error, /Test token is required/);
    });

    await test("activation stores the token, writes the config, connects and lists the tools", async () => {

        const activated = await api("POST", "/api/mcp/catalog/local/activate", { inputs: { token: LOCAL } });

        assert.equal(activated.status, 200, activated.text);
        assert.equal(activated.body.server, "local");
        assert.equal(activated.body.scope, "global");
        assert.deepEqual(activated.body.tools.map(tool => tool.name).sort(), ["echo", "whoami"]);
        assert.ok(!activated.text.includes(LOCAL));

        assert.equal(store.resolve("LOCAL_TOKEN"), LOCAL);

        const stored = loader.readUserServer("local");

        assert.equal(stored.catalog, "local");
        assert.equal(stored.env.TEST_TOKEN, "${secret:LOCAL_TOKEN}");
        assert.equal(stored.env.OPTIONAL_KEY, undefined, "an optional input left empty is dropped");
        assert.deepEqual(stored.args, ["--label", "plain"], "a plain input falls back to its default");
        assert.ok(!fs.readFileSync(loader.userFile(), "utf8").includes(LOCAL));

        /* the server really got the token */
        const shared = require(path.join(REPO, "agent", "mcp", "McpManager")).manager;
        const answer = JSON.stringify(await shared.call("local", "whoami", {}));
        assert.ok(answer.includes(LOCAL), answer);

        const status = await api("GET", "/api/mcp?refresh=1");
        const server = status.body.servers.find(item => item.name === "local");

        assert.equal(server.state, "ready");
        assert.equal(server.catalog, "local");
        assert.equal(server.reconnect.attempt, 0);
        assert.ok(status.body.tools.some(tool => tool.name === "mcp__local__whoami"));

        const listed = await api("GET", "/api/mcp/catalog");
        const local = listed.body.servers.find(item => item.id === "local");

        assert.equal(local.installed.length, 1);
        assert.equal(local.installed[0].state, "ready");
        assert.equal(local.inputs[0].secret_stored, true);
    });

    await test("a token that a server echoes is masked in what the API returns", async () => {

        /* put the stored value where the status shows it: an argument */
        loader.writeUserServer("echoing", {
            command: script,
            args: ["--token", "${secret:LOCAL_TOKEN}"]
        });

        const status = await api("GET", "/api/mcp?refresh=1");
        const server = status.body.servers.find(item => item.name === "echoing");

        assert.ok(server, "the server is listed");
        assert.ok(!status.text.includes(LOCAL), "the value is masked");
        assert.ok(server.connection.args.includes("****"));

        loader.removeUserServer("echoing");
    });

    await test("killing an activated server shows up in the status and the global log, then it is back", async () => {

        settings.set("MCP_RECONNECT_BASE_MS", 50);

        const before = (await api("GET", "/api/mcp")).body.servers.find(item => item.name === "local");

        process.kill(before.connection.pid);

        const after = await waitFor(async () => {
            const server = (await api("GET", "/api/mcp")).body.servers.find(item => item.name === "local");
            return server && server.state === "ready" && server.connection.pid !== before.connection.pid && server.reconnect.count >= 1 ? server : null;
        }, 15000, "the server back");

        assert.match(after.reconnect.last_error, /disconnected/);

        const logs = await api("GET", "/api/logs?source=mcp&limit=200");
        const messages = logs.body.entries.map(entry => entry.message).join("\n");

        assert.match(messages, /MCP server local disconnected: .*reconnect attempt 1/);
        assert.match(messages, /MCP server local reconnected after 1 attempt/);

        settings.reset("MCP_RECONNECT_BASE_MS");
    });

    await test("Reconnect starts a server over now", async () => {

        const response = await api("POST", "/api/mcp/local/reconnect");

        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.server.state, "ready");
        assert.equal((await api("POST", "/api/mcp/nope/reconnect")).status, 404);
    });

    await test("a server that cannot connect is rolled back, its new secret too", async () => {

        const failed = await api("POST", "/api/mcp/catalog/broken/activate", { inputs: { token: "broken-secret-value" } });

        assert.equal(failed.status, 502, failed.text);
        assert.equal(failed.body.code, "connect_failed");
        assert.equal(loader.readUserServer("broken"), null, "the config is as it was");
        assert.equal(store.has("BROKEN_TOKEN"), false, "the secret it created is gone");
    });

    await test("activation for one project scopes the server; deactivation reverts the config", async () => {

        const before = fs.readFileSync(loader.userFile(), "utf8");

        const activated = await api("POST", "/api/mcp/catalog/local/activate", {
            name: "local-project",
            scope: "project",
            project_id: "prj-cat",
            inputs: {}
        });

        assert.equal(activated.status, 200, activated.text);
        assert.equal(activated.body.scope, "project");
        assert.deepEqual(activated.body.projects, ["prj-cat"]);

        const stored = loader.readUserServer("local-project");

        assert.equal(stored.scope, "project");
        assert.deepEqual(stored.projects, ["prj-cat"]);
        assert.equal(stored.env.TEST_TOKEN, "${secret:LOCAL_TOKEN}", "the stored token is reused");

        assert.equal((await api("POST", "/api/mcp/catalog/project-needs-id/activate", { scope: "project" })).status, 404);
        assert.equal((await api("POST", "/api/mcp/catalog/local/activate", { scope: "project", inputs: {} })).status, 400);

        const removed = await api("POST", "/api/mcp/catalog/local-project/deactivate", { project_id: "prj-cat" });

        assert.equal(removed.status, 200, removed.text);
        assert.equal(removed.body.removed, true);
        assert.deepEqual(removed.body.secrets_removed, [], "still used by the global server");
        assert.equal(fs.readFileSync(loader.userFile(), "utf8"), before, "the user config is back to what it was");
    });

    await test("deactivating the last user of a secret can delete it; the server is gone", async () => {

        const removed = await api("POST", "/api/mcp/catalog/local/deactivate", { forget_secrets: true });

        assert.equal(removed.status, 200, removed.text);
        assert.deepEqual(removed.body.secrets_removed, ["LOCAL_TOKEN"]);
        assert.equal(store.has("LOCAL_TOKEN"), false);
        assert.equal(loader.readUserServer("local"), null);
        assert.equal(store.has("TEST_TOKEN"), true, "an unrelated secret stays");

        const status = await api("GET", "/api/mcp");
        assert.ok(!status.body.servers.some(item => item.name === "local"));

        assert.equal((await api("POST", "/api/mcp/catalog/local/deactivate", {})).status, 404);
    });

    await test("prerequisites and installs have routes; an unknown installer is refused", async () => {

        const listed = await api("GET", "/api/mcp/prerequisites?ids=node,no-such-program-4711");

        assert.equal(listed.status, 200);
        assert.deepEqual(listed.body.prerequisites.map(item => item.ok), [true, false]);

        assert.equal((await api("POST", "/api/mcp/prerequisites/nothing/install", {})).status, 404);

        const status = await api("GET", "/api/mcp/prerequisites/chromium/install");
        assert.equal(status.status, 200);
        assert.equal(status.body.prerequisite.id, "chromium");
    });

    await test("the shipped catalogue is well formed: pinned versions, inputs, prerequisites", async () => {

        catalog.useCatalogFile(null);

        const entries = catalog.entries();
        const ids = new Set();

        assert.ok(entries.length >= 10);

        for (const entry of entries) {

            assert.ok(!ids.has(entry.id), `duplicate ${entry.id}`);
            ids.add(entry.id);

            for (const key of ["id", "title", "category", "description", "transport", "server"]) {
                assert.ok(entry[key], `${entry.id} has ${key}`);
            }

            assert.ok(Array.isArray(entry.inputs), `${entry.id} inputs`);
            assert.ok(Array.isArray(entry.prerequisites), `${entry.id} prerequisites`);

            const text = JSON.stringify(entry.server);

            assert.ok(!/@latest\b/.test(text), `${entry.id} is pinned`);

            if (entry.transport === "stdio" && ["npx", "uvx"].includes(entry.server.command)) {
                const spec = entry.server.args.find(arg => !arg.startsWith("-"));
                assert.match(spec, /@\d/, `${entry.id} pins a version (${spec})`);
            }

            for (const match of text.matchAll(/\$\{input:([A-Za-z0-9_-]+)\}/g)) {
                assert.ok(entry.inputs.some(input => input.id === match[1]), `${entry.id} declares input ${match[1]}`);
            }

            for (const input of entry.inputs.filter(item => item.secret)) {
                assert.match(input.secret, store.NAME_PATTERN, `${entry.id} secret name`);
            }
        }

        assert.ok(ids.has("playwright") && ids.has("github"));
        assert.deepEqual(catalog.entry("playwright").prerequisites, ["npx", "chromium"]);
        assert.equal(catalog.entry("github").inputs[0].secret, "GITHUB_PAT");
        assert.ok(catalog.installer("chromium"));

        /* GitHub's definition refers to the store, never to a literal */
        store.set("GITHUB_PAT", "github_pat_placeholder_for_test");
        const github = catalog.buildDefinition(catalog.entry("github"), { token: "ignored-here" });
        assert.equal(github.token, "${secret:GITHUB_PAT}");
        assert.equal(github.catalog, "github");
        store.remove("GITHUB_PAT");
    });

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    for (const cleanup of cleanups.reverse()) {
        try {
            await cleanup();
        } catch {
            /* best effort */
        }
    }

    try {
        if (typeof web.closeAllConnections === "function") web.closeAllConnections();
        await Promise.race([new Promise(done => web.close(done)), new Promise(done => setTimeout(done, 1000))]);
        await runtime.shutdown?.();
    } catch {
        /* best effort */
    }

    await removeTempDirs(runtime, WORKSPACE, DATA_HOME, TRUST_HOME, BROWSERS);

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
