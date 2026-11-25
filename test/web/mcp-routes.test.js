"use strict";

/*
|--------------------------------------------------------------------------
| Console MCP routes over real HTTP
|--------------------------------------------------------------------------
|
| web/server/routes/mcp.js is what the console's MCP panel talks to:
| list, add, toggle and remove servers, and read or save the raw workspace
| config. Each route is driven here through a live console server against
| a real stdio MCP server, including the refusals: no token, a scoped
| token, runtime management switched off, an approval policy that says no,
| and a config that must not be written.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-routes-"));
const TRUST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-routes-trust-"));
const SCOPED = "scoped-token-mcp-routes";

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_TRUST_FILE = path.join(TRUST_HOME, "trusted-workspaces.json");
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    [SCOPED]: { allowedProjects: ["prj-a"], permissions: ["project:read", "project:write"] }
});

const REPO = path.resolve(__dirname, "..", "..");
const { writeStdioServer } = require("../mcp/mcp-stdio-server")({ WORKSPACE });

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


async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    const server = createServer(runtime, { apiRateLimit: 1000 });
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const settings = runtime.settings;

    const call = async (method, url, body, token = server.token) => {
        const response = await fetch(`${baseUrl}${url}`, {
            method,
            headers: {
                ...(body ? { "content-type": "application/json" } : {}),
                ...(token ? { authorization: `Bearer ${token}` } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null };
    };

    const serverFile = writeStdioServer({ name: "routes-fixture" });
    const definition = { transport: "stdio", command: process.execPath, args: [serverFile] };
    const configFile = path.join(WORKSPACE, ".agent", "mcp.json");
    const listed = async query => (await call("GET", `/api/mcp${query || ""}`)).body;
    const named = (status, name) => status.servers.find(entry => entry.name === name);

    console.log("console MCP routes");

    await test("GET /api/mcp needs a token and refuses a project-scoped one", async () => {

        assert.equal((await call("GET", "/api/mcp", null, null)).status, 401);
        assert.equal((await call("GET", "/api/mcp", null, SCOPED)).status, 403);
        assert.equal((await call("POST", "/api/mcp", { name: "x", ...definition }, SCOPED)).status, 403);

        const empty = await call("GET", "/api/mcp");
        assert.equal(empty.status, 200);
        assert.deepEqual(empty.body.servers, []);
        assert.deepEqual(empty.body.tools, []);
        assert.deepEqual(empty.body.transports, ["stdio", "http", "sse", "websocket"]);
    });

    await test("POST /api/mcp adds and persists a server whose tools a refresh then lists", async () => {

        const added = await call("POST", "/api/mcp", { name: "fixture", ...definition });
        assert.equal(added.status, 200, added.body.error);
        assert.deepEqual(
            { server: added.body.server, transport: added.body.transport, persisted_to: added.body.persisted_to },
            { server: "fixture", transport: "stdio", persisted_to: configFile }
        );
        assert.ok(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers.fixture, "the definition is on disk");
        if (process.platform !== "win32") {
            assert.equal(fs.statSync(configFile).mode & 0o777, 0o600, "saved env and headers stay private");
        }

        const status = await listed("?refresh=1");
        assert.equal(named(status, "fixture").state, "ready");
        assert.deepEqual(
            status.tools.map(tool => [tool.server, tool.tool]).sort(),
            [["fixture", "add"], ["fixture", "echo"]]
        );
        assert.ok(status.tools.every(tool => tool.name && typeof tool.description === "string"));
    });

    await test("POST /api/mcp maps the panel's command_args and keeps a persist:false server off disk", async () => {

        const added = await call("POST", "/api/mcp", {
            name: "session-only",
            transport: "stdio",
            command: process.execPath,
            command_args: [serverFile],
            persist: false
        });
        assert.equal(added.status, 200, added.body.error);
        assert.equal(added.body.persisted_to, null);
        assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers["session-only"], undefined);
        assert.deepEqual(named(await listed("?refresh=1"), "session-only").connection.args, [serverFile]);
        assert.equal((await call("DELETE", "/api/mcp/session-only")).status, 200);
    });

    await test("POST /api/mcp answers an invalid definition with 400 and its reason", async () => {

        const rejected = await call("POST", "/api/mcp", { name: "broken", transport: "stdio" });
        assert.equal(rejected.status, 400);
        assert.match(rejected.body.error, /needs a command/);
        assert.equal(named(await listed(), "broken"), undefined);
    });

    await test("POST /api/mcp/:name/enabled switches a server off and on without forgetting it", async () => {

        const off = await call("POST", "/api/mcp/fixture/enabled", { enabled: false });
        assert.deepEqual(off.body, { ok: true, server: "fixture", enabled: false });
        let status = await listed();
        assert.equal(named(status, "fixture").enabled, false);
        assert.equal(status.tools.length, 0, "a disabled server offers no tools");

        const on = await call("POST", "/api/mcp/fixture/enabled", {});
        assert.deepEqual(on.body, { ok: true, server: "fixture", enabled: true }, "a missing flag means on");
        status = await listed();
        assert.equal(named(status, "fixture").enabled, true);
        assert.equal(status.tools.length, 2, "switching on rediscovers the tools");

        const unknown = await call("POST", "/api/mcp/nope/enabled", { enabled: true });
        assert.equal(unknown.status, 404);
        assert.match(unknown.body.error, /unknown MCP server: nope/);
    });

    await test("an approval policy that refuses is a 400 on every route, and nothing changes", async () => {

        settings.set("AGENT_APPROVAL", "deny");
        try {
            const attempts = [
                ["POST", "/api/mcp", { name: "denied", ...definition }],
                ["DELETE", "/api/mcp/fixture"],
                ["POST", "/api/mcp/fixture/enabled", { enabled: false }],
                ["PUT", "/api/mcp/config", { text: JSON.stringify({ mcpServers: { denied: definition } }) }]
            ];
            for (const [method, url, body] of attempts) {
                const refused = await call(method, url, body);
                assert.equal(refused.status, 400, `${method} ${url}`);
                assert.match(refused.body.error, /requires approval/, `${method} ${url}`);
            }
        } finally {
            settings.set("AGENT_APPROVAL", "auto");
        }

        const status = await listed();
        assert.equal(named(status, "fixture").enabled, true);
        assert.equal(named(status, "denied"), undefined);
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers), ["fixture"]);
    });

    await test("MCP_ALLOW_RUNTIME_ADD=false locks every changing route with 403", async () => {

        settings.set("MCP_ALLOW_RUNTIME_ADD", false);
        try {
            for (const [method, url, body] of [
                ["POST", "/api/mcp", { name: "x", ...definition }],
                ["DELETE", "/api/mcp/fixture"],
                ["POST", "/api/mcp/fixture/enabled", { enabled: false }],
                ["PUT", "/api/mcp/config", { text: "{\"mcpServers\":{}}" }]
            ]) {
                const locked = await call(method, url, body);
                assert.equal(locked.status, 403, `${method} ${url}`);
                assert.match(locked.body.error, /management is disabled/);
            }
            assert.equal((await call("GET", "/api/mcp")).status, 200, "reading stays open");
        } finally {
            settings.reset("MCP_ALLOW_RUNTIME_ADD");
        }
        assert.ok(named(await listed(), "fixture"));
    });

    await test("DELETE /api/mcp/:name removes the server, its tools and its saved definition", async () => {

        const removed = await call("DELETE", "/api/mcp/fixture");
        assert.equal(removed.status, 200);
        assert.equal(removed.body.server, "fixture");
        assert.equal(removed.body.removed, true);

        const status = await listed();
        assert.equal(named(status, "fixture"), undefined);
        assert.deepEqual(status.tools, []);
        assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers.fixture, undefined);
    });

    await test("PUT /api/mcp/config refuses what it cannot load and leaves the file as it was", async () => {

        const before = fs.readFileSync(configFile, "utf8");

        for (const [text, reason] of [
            ["{", /JSON/],
            ["[]", /must be a JSON object/],
            ["{\"other\":{}}", /object under "mcpServers"/],
            ["{\"mcpServers\":[]}", /object under "mcpServers"/],
            ["{\"mcpServers\":{\"bad\":[]}}", /must have a name and an object definition/],
            ["{\"mcpServers\":{\"bad\":\"node server.js\"}}", /must have a name and an object definition/],
            ["{\"mcpServers\":{\"bad\":{\"transport\":\"stdio\"}}}", /command/]
        ]) {
            const refused = await call("PUT", "/api/mcp/config", { text });
            assert.equal(refused.status, 400, text);
            assert.match(refused.body.error, reason, text);
        }

        assert.equal((await call("PUT", "/api/mcp/config", {})).status, 400, "a missing text is not a config");
        assert.equal(fs.readFileSync(configFile, "utf8"), before, "nothing was written");
    });

    await test("PUT /api/mcp/config writes a private file that is loaded but only started once trusted", async () => {

        const text = JSON.stringify({ mcpServers: { from_config: definition } }, null, 2);
        const saved = await call("PUT", "/api/mcp/config", { text });
        assert.equal(saved.status, 200, saved.body && saved.body.error);
        assert.equal(saved.body.path, configFile);
        if (process.platform !== "win32") {
            assert.equal(fs.statSync(configFile).mode & 0o777, 0o600, "the config may hold tokens");
        }

        /* a stdio command chosen by a workspace file is never spawned untrusted */
        let status = await listed("?refresh=1");
        assert.equal(named(status, "from_config").state, "idle");
        assert.equal(named(status, "from_config").connection.pid, null);
        assert.equal(status.tools.length, 0);

        settings.set("MCP_TRUST_PROJECT_CONFIG", true);
        try {
            status = await listed("?refresh=1");
            assert.equal(named(status, "from_config").state, "ready", "trusted, it is started");
            assert.equal(status.tools.length, 2);
        } finally {
            settings.reset("MCP_TRUST_PROJECT_CONFIG");
        }

        const read = await call("GET", "/api/mcp/config");
        assert.deepEqual(JSON.parse(read.body.text), JSON.parse(text));

        const cleared = await call("PUT", "/api/mcp/config", { text: "{\"mcpServers\":{}}" });
        assert.equal(cleared.status, 200);
        assert.equal(named(await listed(), "from_config"), undefined, "a server left out is removed");
    });

    await require(path.join(REPO, "agent", "tools")).mcp._manager.shutdown();
    await server.close();

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(TRUST_HOME, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
