"use strict";

/*
|--------------------------------------------------------------------------
| Project API / Auth / MCP scope — EXECUTION_PLAN Phase 9
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { removeTempDirs } = require("../helpers/cleanup");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase9-ws-"));
const OTHER_ROOT =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase9-other-"));
const DATA_HOME =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase9-data-"));

fs.writeFileSync(path.join(WORKSPACE, "a.txt"), "a\n");
fs.writeFileSync(path.join(OTHER_ROOT, "b.txt"), "b\n");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";

const SCOPED_A = "scoped-token-aaa-phase9";
const SCOPED_B = "scoped-token-bbb-phase9";

process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    [SCOPED_A]: {
        allowedProjects: ["prj-a"],
        permissions: ["project:read", "project:write"]
    },
    [SCOPED_B]: {
        allowedProjects: ["prj-b"],
        permissions: ["project:read"]
    }
});

const results = [];

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


function startModelStub() {

    return new Promise(resolve => {

        const requests = [];
        const server = http.createServer((req, res) => {

            let body = "";
            req.on("data", chunk => (body += chunk));
            req.on("end", () => {

                try { requests.push(JSON.parse(body)); } catch { /* ignored non-JSON request */ }
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                version: "1.0",
                                action: "final",
                                tool_calls: null,
                                delegations: null,
                                response: { type: "text", content: "ok" },
                                data: null,
                                error: null
                            })
                        }
                    }]
                }));
            });
        });

        server.listen(0, "127.0.0.1", () => {

            resolve({
                port: server.address().port,
                requests,
                close: () => new Promise(done => server.close(done))
            });
        });
    });
}


async function request(baseUrl, method, url, { token, body } = {}) {

    const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();

    return {
        status: response.status,
        body: text ? JSON.parse(text) : null
    };
}


async function main() {

    const consoleAuth = require(path.join(REPO_ROOT, "agent", "config", "ConsoleAuth"));
    const mcpConfig = require(path.join(REPO_ROOT, "agent", "mcp", "McpConfig"));
    const { manager } = require(path.join(REPO_ROOT, "agent", "mcp", "McpManager"));
    const {
        PolicyEngine,
        setApprovalHandler,
        resetGatewayApprovals
    } = require(path.join(REPO_ROOT, "agent", "policy"));

    /* ------------------------------------------------ unit --- */

    await test("redact masks bearer tokens and secret fields", async () => {

        const redacted =
            consoleAuth.redact("Authorization: Bearer abcdefghijklmnop");

        assert.ok(
            redacted.includes("****"),
            `expected secrets to be masked, got ${redacted}`
        );

        const hidden = consoleAuth.redact({ token: "secret-value", ok: true });
        assert.equal(hidden.token, "****");
        assert.equal(hidden.ok, true);
    });


    await test("a scoped token cannot access another project", async () => {

        const claims = consoleAuth.resolve(SCOPED_A, "master-not-this");
        assert.equal(claims.master, false);
        assert.equal(consoleAuth.allowsProject(claims, "prj-a"), true);
        assert.equal(consoleAuth.allowsProject(claims, "prj-b"), false);

        const denied = consoleAuth.authorize(claims, {
            projectId: "prj-b",
            permission: "project:read"
        });
        assert.equal(denied.status, 403);
    });


    await test("MCP project-scoped servers are hidden from other projects", async () => {

        assert.equal(
            mcpConfig.serverVisibleTo({ scope: "global" }, "prj-a"),
            true
        );
        assert.equal(
            mcpConfig.serverVisibleTo(
                { scope: "project", projects: ["prj-a"] },
                "prj-b"
            ),
            false
        );
        assert.equal(
            mcpConfig.serverVisibleTo(
                { scope: "project", projects: ["prj-a"] },
                "prj-a"
            ),
            true
        );
        /* legacy (no project id) keeps every server visible */
        assert.equal(
            mcpConfig.serverVisibleTo(
                { scope: "project", projects: ["prj-a"] },
                null
            ),
            true
        );
    });


    await test("catalogueEntries and call honour MCP scope", async () => {

        manager.workspaceRoot = WORKSPACE;
        manager.loadedAt = Date.now();
        manager.clients.set("alpha", {
            config: {
                name: "alpha",
                scope: "project",
                projects: ["prj-a"],
                enabled: true
            }
        });
        manager.catalogue.set("mcp__alpha__echo", {
            name: "mcp__alpha__echo",
            server: "alpha",
            tool: "echo",
            description: "echo"
        });

        assert.equal(manager.catalogueEntries("prj-a").length, 1);
        assert.equal(manager.catalogueEntries("prj-b").length, 0);

        await assert.rejects(
            () => manager.call("alpha", "echo", {}, { projectId: "prj-b" }),
            /not in scope for project prj-b/
        );
    });


    await test("global MCP approval is cached per gateway and audited per project", async () => {

        resetGatewayApprovals();

        manager.workspaceRoot = WORKSPACE;
        manager.loadedAt = Date.now();
        manager.clients.set("glob", {
            config: { name: "glob", scope: "global", enabled: true }
        });

        let prompts = 0;

        setApprovalHandler(async () => {

            prompts += 1;
            return true;
        });

        const engine = new PolicyEngine({
            policy: { default_action: "allow", rules: [] },
            toolGroups: {}
        });

        const saved = process.env.AGENT_APPROVAL;
        process.env.AGENT_APPROVAL = "prompt";

        try {

            const first = await engine.requestApproval(
                {
                    tool: "mcp__glob__ping",
                    agent: "main_agent",
                    reason: "restricted",
                    project_id: "prj-a"
                },
                {}
            );

            const second = await engine.requestApproval(
                {
                    tool: "mcp__glob__ping",
                    agent: "main_agent",
                    reason: "restricted",
                    project_id: "prj-b"
                },
                {}
            );

            assert.equal(prompts, 1, "the second project must reuse the gateway approval");
            assert.equal(first.approved, true);
            assert.equal(second.gateway_cached, true);
            assert.equal(second.project_id, "prj-b");
            assert.equal(first.project_id, "prj-a");

        } finally {

            process.env.AGENT_APPROVAL = saved;
            setApprovalHandler(null);
            resetGatewayApprovals();
        }
    });


    /* ------------------------------------------------ HTTP --- */

    const stub = await startModelStub();
    process.env.AGENT_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
    process.env.AGENT_MODEL = "test-model";

    const runtime = require(path.join(REPO_ROOT, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO_ROOT, "web", "server.js"));

    runtime.projects.registry().register({
        id: "prj-a",
        name: "Alpha",
        rootPath: WORKSPACE
    });
    runtime.projects.registry().register({
        id: "prj-b",
        name: "Beta",
        rootPath: OTHER_ROOT
    });

    const server = createServer(runtime, {});
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const master = server.token;


    await test("MCP raw workspace config can be read and saved as JSON", async () => {

        const loaded = await request(baseUrl, "GET", "/api/mcp/config", { token: master });
        assert.equal(loaded.status, 200);
        assert.match(loaded.body.text, /mcpServers/);
        assert.match(loaded.body.path, /\.agent[\\/]mcp\.json$/);

        const text = '{\n  "mcpServers": {}\n}';
        const saved = await request(baseUrl, "PUT", "/api/mcp/config", {
            token: master,
            body: { text }
        });
        assert.equal(saved.status, 200, saved.body.error);
        assert.deepEqual(JSON.parse(fs.readFileSync(saved.body.path, "utf8")), { mcpServers: {} });
    });


    await test("GET /api/projects lists registered projects", async () => {

        const listed = await request(baseUrl, "GET", "/api/projects", { token: master });
        assert.equal(listed.status, 200);
        const ids = listed.body.projects.map(item => item.id).sort();
        assert.deepEqual(ids, ["prj-a", "prj-b"]);
    });


    await test("a scoped token only lists its allowed projects", async () => {

        const listed = await request(baseUrl, "GET", "/api/projects", { token: SCOPED_A });
        assert.equal(listed.status, 200);
        assert.deepEqual(
            listed.body.projects.map(item => item.id),
            ["prj-a"]
        );
    });


    await test("uploads are stored under the authorized project upload_tmp directory", async () => {

        const form = new FormData();
        form.append("files", new Blob(["uploaded contents\n"], { type: "text/plain" }), "notes.txt");
        const response = await fetch(`${baseUrl}/api/uploads?projectId=prj-a`, {
            method: "POST",
            headers: { authorization: `Bearer ${SCOPED_A}` },
            body: form
        });
        const payload = await response.json();

        assert.equal(response.status, 201);
        assert.equal(payload.files.length, 1);
        assert.equal(payload.files[0].name, "notes.txt");
        assert.match(path.basename(payload.files[0].path), /^notes_[a-f0-9]+\.txt$/);
        assert.equal(path.dirname(payload.files[0].path), path.join(WORKSPACE, "upload_tmp"));
        assert.equal(fs.readFileSync(payload.files[0].path, "utf8"), "uploaded contents\n");
    });


    await test("unscoped uploads use the runtime workspace root", async () => {

        const form = new FormData();
        form.append("files", new Blob(["default workspace file"]), "workspace.txt");
        const response = await fetch(`${baseUrl}/api/uploads`, {
            method: "POST",
            headers: { authorization: `Bearer ${master}` },
            body: form
        });
        const payload = await response.json();

        assert.equal(response.status, 201);
        assert.equal(path.dirname(payload.files[0].path), path.join(WORKSPACE, "upload_tmp"));
        assert.equal(fs.readFileSync(payload.files[0].path, "utf8"), "default workspace file");
    });


    await test("uploads enforce project write scope", async () => {

        const form = new FormData();
        form.append("files", new Blob(["no"], { type: "text/plain" }), "blocked.txt");
        const response = await fetch(`${baseUrl}/api/uploads?projectId=prj-a`, {
            method: "POST",
            headers: { authorization: `Bearer ${SCOPED_B}` },
            body: form
        });
        assert.equal(response.status, 403);
    });


    await test("@ completion lists the project's entries inside its root only (roadmap P1-09)", async () => {

        fs.mkdirSync(path.join(WORKSPACE, "mention-src", "deep"), { recursive: true });
        fs.writeFileSync(path.join(WORKSPACE, "mention-src", "app.js"), "x");
        fs.writeFileSync(path.join(WORKSPACE, "mention-src", ".hidden"), "x");

        const list = async (q, token = SCOPED_A) => request(baseUrl, "GET", `/api/mentions?projectId=prj-a&q=${encodeURIComponent(q)}`, { token });

        const top = await list("mention-");
        assert.equal(top.status, 200);
        assert.deepEqual(top.body.entries, [{ path: "mention-src/", type: "directory" }]);

        const inner = await list("mention-src/");
        assert.deepEqual(inner.body.entries.map(entry => entry.path), ["mention-src/deep/", "mention-src/app.js"]);
        assert.deepEqual((await list("mention-src/.h")).body.entries.map(entry => entry.path), ["mention-src/.hidden"]);

        for (const escape of ["../", "/etc/", "mention-src/../../"]) {
            assert.deepEqual((await list(escape)).body.entries, [], `${escape} lists nothing`);
        }

        assert.equal((await list("mention-", SCOPED_B)).status, 403);
    });


    await test("token limited to A cannot read B (403)", async () => {

        const denied = await request(
            baseUrl,
            "GET",
            "/api/projects/prj-b",
            { token: SCOPED_A }
        );
        assert.equal(denied.status, 403);
        assert.match(denied.body.error, /prj-b/);
    });


    await test("unknown project is 404", async () => {

        const missing = await request(
            baseUrl,
            "GET",
            "/api/projects/prj-ghost",
            { token: master }
        );
        assert.equal(missing.status, 404);
    });


    await test("PATCH and GET /state stay on the named project", async () => {

        const patched = await request(
            baseUrl,
            "PATCH",
            "/api/projects/prj-a",
            { token: master, body: { name: "Alpha Prime" } }
        );
        assert.equal(patched.status, 200);
        assert.equal(patched.body.project.name, "Alpha Prime");

        const state = await request(
            baseUrl,
            "GET",
            "/api/projects/prj-a/state",
            { token: master }
        );
        assert.equal(state.status, 200);
        assert.equal(state.body.project.id, "prj-a");
        assert.equal(state.body.status, "idle");
    });


    await test("POST /api/projects/:id/chat is accepted like tasks", async () => {

        const submitted = await request(
            baseUrl,
            "POST",
            "/api/projects/prj-a/chat",
            { token: master, body: { message: "hello from chat" } }
        );
        assert.equal(submitted.status, 202);
        assert.equal(submitted.body.project_id, "prj-a");

        const deadline = Date.now() + 15000;

        while (Date.now() < deadline) {

            const state = await request(
                baseUrl,
                "GET",
                "/api/projects/prj-a/state",
                { token: master }
            );

            if (state.body.status !== "running") {
                assert.ok(["done", "failed", "cancelled", "idle"].includes(state.body.status));
                return;
            }

            await new Promise(done => setTimeout(done, 50));
        }

        throw new Error("chat run never finished");
    });


    await test("a task effort override reaches the model and invalid values are rejected", async () => {

        const invalid = await request(baseUrl, "POST", "/api/projects/prj-a/tasks", {
            token: master,
            body: { task: "invalid effort probe", reasoning_effort: "ultra" }
        });
        assert.equal(invalid.status, 400);

        const before = stub.requests.length;
        const submitted = await request(baseUrl, "POST", "/api/projects/prj-a/tasks", {
            token: master,
            body: { task: "effort probe", reasoning_effort: "high" }
        });
        assert.equal(submitted.status, 202);

        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            if (stub.requests.slice(before).some(payload => payload.reasoning_effort === "high")) return;
            await new Promise(done => setTimeout(done, 25));
        }
        throw new Error("the model request did not receive reasoning_effort=high");
    });


    await test("project B's events do not appear on A's stream", async () => {

        runtime.events.emit("probe:a", { project_id: "prj-a", note: "for-a" });
        runtime.events.emit("probe:b", { project_id: "prj-b", note: "for-b" });
        runtime.events.emit("probe:global", { note: "unscoped" });

        const stateA = await request(
            baseUrl,
            "GET",
            "/api/projects/prj-a/state",
            { token: master }
        );

        const types = (stateA.body.events || []).map(event => event.type);
        assert.ok(types.includes("probe:a"));
        assert.ok(!types.includes("probe:b"));

        const global = (stateA.body.events || []).find(event => event.type === "probe:global");
        assert.ok(global);
        assert.equal(global.aggregate, true);
        assert.equal(global.note, undefined);
    });


    await test("GET /api/events?projectId= filters the same way", async () => {

        const denied = await request(
            baseUrl,
            "GET",
            "/api/events?projectId=prj-b",
            { token: SCOPED_A }
        );
        assert.equal(denied.status, 403);
    });


    await test("cancel on A does not cancel B's runs", async () => {

        const cancelled = await request(
            baseUrl,
            "POST",
            "/api/projects/prj-b/cancel",
            { token: master }
        );
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.project_id, "prj-b");

        /* a read-only token cannot cancel */
        const refused = await request(
            baseUrl,
            "POST",
            "/api/projects/prj-a/cancel",
            { token: SCOPED_B }
        );
        assert.equal(refused.status, 403);
    });


    await test("legacy /api/state still works for the master token", async () => {

        const state = await request(baseUrl, "GET", "/api/state", { token: master });
        assert.equal(state.status, 200);
        assert.ok(state.body.workspace);
        assert.ok(Array.isArray(state.body.events));
    });


    await test("POST /api/projects validates rootPath", async () => {

        const missing = await request(
            baseUrl,
            "POST",
            "/api/projects",
            { token: master, body: { name: "nope" } }
        );
        assert.equal(missing.status, 400);
    });


    await test("POST /api/projects can create a missing root when explicitly requested", async () => {

        const rootPath = path.join(WORKSPACE, "new-project", "nested");
        const created = await request(
            baseUrl,
            "POST",
            "/api/projects",
            { token: master, body: { name: "Created workspace", rootPath, createIfMissing: true } }
        );

        assert.equal(created.status, 201);
        assert.equal(fs.statSync(rootPath).isDirectory(), true);
        assert.equal(created.body.project.rootPath, fs.realpathSync(rootPath));
    });


    await test("scoped tokens cannot register a new project", async () => {

        const refused = await request(
            baseUrl,
            "POST",
            "/api/projects",
            {
                token: SCOPED_A,
                body: { name: "x", rootPath: WORKSPACE }
            }
        );
        assert.equal(refused.status, 403);
    });


    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    try {
        await server.close();
    } catch { /* best-effort */ }

    try {
        await stub.close();
    } catch { /* best-effort */ }

    /* flushes both stores and never fails the suite over a temp folder (Windows EBUSY) */
    await removeTempDirs(runtime, WORKSPACE, OTHER_ROOT, DATA_HOME);

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
