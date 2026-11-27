"use strict";

/*
|--------------------------------------------------------------------------
| Console routes over real HTTP: sessions, control, models, project records
|--------------------------------------------------------------------------
|
| The branches of web/server/routes/{sessions,control,project-records}.js
| that no other suite reaches: reading, opening and deleting saved
| conversations, cancel, the model catalogue (and its upstream failing),
| project edits and removal, discussion input checks, a project's session
| list and event stream, and every refusal a token can meet on the way.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const { removeTempDirs } = require("../helpers/cleanup");
const http = require("http");
const os = require("os");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "console-routes-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "console-routes-data-"));
const PROJECT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "console-routes-prj-"));
const SCOPED = "scoped-token-console-routes";

Object.assign(process.env, {
    WORKSPACE_ROOT: WORKSPACE,
    STRUCTURED_AI_DATA_HOME: DATA_HOME,
    AGENT_APPROVAL: "auto",
    AGENT_VERBOSE: "0",
    AGENT_PRINT_FINAL: "0",
    AGENT_MODEL: "model-a",
    AGENT_CONSOLE_TOKENS: JSON.stringify({
        [SCOPED]: { allowedProjects: ["prj-a"], permissions: ["project:read", "project:write"] }
    })
});

const REPO = path.resolve(__dirname, "..", "..");
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


/* answers /v1/models like an OpenAI-compatible endpoint */
async function startModelList() {

    const server = http.createServer((req, res) => {
        res.writeHead(req.url.endsWith("/models") ? 200 : 404, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise(r => server.close(r)) };
}


async function main() {

    const models = await startModelList();
    process.env.AGENT_BASE_URL = models.url;

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));
    runtime.projects.registry().register({ id: "prj-a", name: "Alpha", rootPath: PROJECT_ROOT });

    const server = createServer(runtime, { apiRateLimit: 1000 });
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;

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

    console.log("console routes");

    let first;
    let second;

    await test("a saved conversation can be read, reopened and is refused to project-scoped tokens", async () => {

        first = (await call("GET", "/api/sessions")).body.current;
        assert.match(first, /^s-/);
        assert.equal((await call("GET", `/api/sessions/${first}`)).body.session.id, first);

        const created = await call("POST", "/api/sessions", {});
        assert.equal(created.status, 201);
        second = created.body.session.id;
        assert.notEqual(second, first);

        const listed = (await call("GET", "/api/sessions")).body;
        assert.equal(listed.current, second);
        assert.deepEqual(listed.sessions.map(item => item.id), [first], "the previous one was saved");

        const saved = await call("GET", `/api/sessions/${first}`);
        assert.equal(saved.status, 200);
        assert.equal(saved.body.current, second, "reading does not switch");

        const reopened = await call("POST", `/api/sessions/${first}`, {});
        assert.equal(reopened.status, 200);
        assert.equal((await call("GET", "/api/sessions")).body.current, first);

        for (const [method, url] of [["GET", "/api/sessions/nope"], ["POST", "/api/sessions/nope"]]) {
            const missing = await call(method, url, method === "POST" ? {} : null);
            assert.equal(missing.status, 404, `${method} ${url}`);
            assert.equal(missing.body.error, "unknown session");
        }

        for (const [method, url] of [["GET", `/api/sessions/${first}`], ["POST", `/api/sessions/${first}`], ["DELETE", `/api/sessions/${second}`], ["POST", "/api/cancel"]]) {
            const refused = await call(method, url, method === "POST" ? {} : null, SCOPED);
            assert.equal(refused.status, 403, `${method} ${url}`);
            assert.match(refused.body.error, /not project-scoped/);
        }
        assert.equal((await call("GET", `/api/sessions/${first}`, null, null)).status, 401);
    });

    await test("deleting refuses the open conversation and unknown ids, and removes a saved one", async () => {

        const open = await call("DELETE", `/api/sessions/${first}`);
        assert.equal(open.status, 409);
        assert.equal(open.body.error, "cannot delete the open conversation");

        const unknown = await call("DELETE", "/api/sessions/nope");
        assert.equal(unknown.status, 404);
        assert.deepEqual(unknown.body, { error: "unknown session" }, "a failure is not reported as deleted");

        const removed = await call("DELETE", `/api/sessions/${second}`);
        assert.deepEqual([removed.status, removed.body], [200, { deleted: second }]);
        assert.equal((await call("GET", `/api/sessions/${second}`)).status, 404);
        assert.deepEqual(
            (await call("GET", "/api/sessions")).body.sessions.map(item => item.id),
            [first],
            "only the deleted one is gone; the open one stays saved"
        );
    });

    await test("a session id from the URL cannot reach a file outside the sessions folder", async () => {

        const outside = path.join(DATA_HOME, "outside.json");
        fs.writeFileSync(outside, "{}");
        const probe = encodeURIComponent("../../outside");

        assert.equal((await call("DELETE", `/api/sessions/${probe}`)).status, 404);
        assert.equal((await call("GET", `/api/sessions/${probe}`)).status, 404);
        assert.ok(fs.existsSync(outside), "the file outside is untouched");
    });

    await test("POST /api/cancel answers even with nothing running", async () => {

        const cancelled = await call("POST", "/api/cancel", {});
        assert.deepEqual([cancelled.status, cancelled.body], [200, { cancelled: true }]);
    });

    await test("the model catalogue lists per role, is admin-only, and reports an unreachable endpoint as 502", async () => {

        const role = await call("GET", "/api/models?role=main");
        assert.deepEqual([role.status, role.body], [200, { models: ["model-a", "model-b"] }]);

        const catalog = await call("GET", "/api/models");
        assert.equal(catalog.status, 200);
        assert.deepEqual(catalog.body.models, ["model-a", "model-b"]);
        assert.deepEqual(catalog.body.byRole.MAIN, ["model-a", "model-b"]);

        const scoped = await call("GET", "/api/models", null, SCOPED);
        assert.equal(scoped.status, 403);
        assert.match(scoped.body.error, /admin token/);

        const invalidRole = await call("GET", "/api/models?role=invalid");
        assert.equal(invalidRole.status, 400);
        assert.match(invalidRole.body.error, /role must be MAIN/);

        await models.close();
        runtime.settings.set("AGENT_BASE_URL", "http://127.0.0.1:1/v1");
        try {
            for (const url of ["/api/models?role=main", "/api/models"]) {
                const down = await call("GET", url);
                assert.equal(down.status, 502, url);
                assert.ok(down.body.error, url);
            }
        } finally {
            runtime.settings.reset("AGENT_BASE_URL");
        }
    });

    await test("auth/status reports real token authentication and auth/login exchanges tokens for a cookie", async () => {

        const unauthStatus = await fetch(`${baseUrl}/auth/status`);
        assert.equal(unauthStatus.status, 200);
        assert.deepEqual(await unauthStatus.json(), { passwordRequired: false, authenticated: false });

        const badToken = await fetch(`${baseUrl}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: "wrong-token" })
        });
        assert.equal(badToken.status, 401);

        const goodToken = await fetch(`${baseUrl}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: server.token })
        });
        assert.equal(goodToken.status, 200);
        const cookie = goodToken.headers.get("set-cookie").split(";")[0];
        assert.match(cookie, /^structured_ai_console=/);

        const authedStatus = await fetch(`${baseUrl}/auth/status`, { headers: { cookie } });
        assert.deepEqual(await authedStatus.json(), { passwordRequired: false, authenticated: true });

        const logout = await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: { cookie } });
        assert.equal(logout.status, 200);
        assert.deepEqual(await logout.json(), { ok: true, revoked: false }, "token mode has no session to revoke");
        assert.ok(logout.headers.getSetCookie().some(line => /^structured_ai_console=;.*Max-Age=0/.test(line)), "the token cookie is expired");
    });

    await test("a project can be renamed but never re-rooted, and unknown projects are 404", async () => {

        const renamed = await call("PATCH", "/api/projects/prj-a", { name: "Alpha 2" });
        assert.equal(renamed.status, 200);
        assert.equal(renamed.body.project.name, "Alpha 2");
        assert.equal(renamed.body.project.rootPath, PROJECT_ROOT);

        const rerooted = await call("PATCH", "/api/projects/prj-a", { rootPath: "/elsewhere" });
        assert.equal(rerooted.status, 400);
        assert.match(rerooted.body.error, /rootPath is immutable/);

        for (const [method, url, body] of [
            ["PATCH", "/api/projects/nope", { name: "x" }],
            ["DELETE", "/api/projects/nope"],
            ["GET", "/api/projects/nope/sessions"]
        ]) {
            const missing = await call(method, url, body);
            assert.equal(missing.status, 404, `${method} ${url}`);
            assert.match(missing.body.error, /Unknown project: nope/);
        }
    });

    await test("a project discussion checks its input before anything starts", async () => {

        for (const [body, reason] of [
            [{ personas: ["security"] }, /^task is required$/],
            [{ task: "  " , personas: ["security"] }, /^task is required$/],
            [{ task: "t" }, /personas is required/],
            [{ task: "t", personas: ["", 3] }, /personas is required/],
            [{ task: "t", personas: ["security"], max_rounds: 0 }, /max_rounds must be between 1 and 10/],
            [{ task: "t", personas: ["security"], max_rounds: 11 }, /max_rounds must be between 1 and 10/],
            [{ task: "t", personas: ["nobody"] }, /unknown persona: nobody; available: .*security/],
            [{ task: "t", personas: ["security"], reasoning_effort: "extreme" }, /reasoning_effort must be/]
        ]) {
            const refused = await call("POST", "/api/projects/prj-a/discussions", body);
            assert.equal(refused.status, 400, JSON.stringify(body));
            assert.match(refused.body.error, reason, JSON.stringify(body));
        }
    });

    await test("a project's sessions and event stream respect the token's projects", async () => {

        const own = await call("GET", "/api/projects/prj-a/sessions", null, SCOPED);
        assert.deepEqual([own.status, own.body], [200, { project_id: "prj-a", sessions: [] }]);

        const other = await call("GET", "/api/projects/prj-b/sessions", null, SCOPED);
        assert.equal(other.status, 403);
        assert.match(other.body.error, /not allowed to access project prj-b/);

        const abort = new AbortController();
        const stream = await fetch(`${baseUrl}/api/projects/prj-a/events`, {
            headers: { authorization: `Bearer ${SCOPED}` },
            signal: abort.signal
        });
        try {
            assert.equal(stream.status, 200);
            assert.match(stream.headers.get("content-type"), /text\/event-stream/);
            const reader = stream.body.getReader();
            let text = "";
            while (!text.includes("\n\n")) {
                const { value, done } = await reader.read();
                if (done) break;
                text += Buffer.from(value).toString("utf8");
            }
            const first = JSON.parse(text.slice(text.indexOf("data: ") + 6, text.indexOf("\n\n")));
            assert.equal(first.type, "snapshot");
            assert.ok(Array.isArray(first.snapshot.events));
            assert.ok(
                first.snapshot.events.every(event => event.project_id == null || event.project_id === "prj-a"),
                "no other project's events"
            );
        } finally {
            abort.abort();
        }

        const refused = await fetch(`${baseUrl}/api/projects/prj-b/events`, { headers: { authorization: `Bearer ${SCOPED}` } });
        assert.equal(refused.status, 403);
    });

    await test("GET /api/sessions aggregates project sessions with project and workspace metadata", async () => {

        const ctxA = runtime.resolveRunProjectContext({ projectId: "prj-a" });
        const prjSession = runtime.sessions.emptySession("s-prj-a-1");
        prjSession.project_id = "prj-a";
        prjSession.project_name = "Project A";
        prjSession.workspace = ctxA.workspaceRoot;
        prjSession.title = "Project A History Entry";
        runtime.sessions.saveSession(prjSession, ctxA.dataRoot);

        const listed = await call("GET", "/api/sessions");
        assert.equal(listed.status, 200);
        const found = listed.body.sessions.find(item => item.id === "s-prj-a-1");
        assert.ok(found, "project session appears in aggregated /api/sessions list");
        assert.equal(found.project_id, "prj-a");
        assert.equal(found.project_name, "Project A");
        assert.equal(found.workspace, ctxA.workspaceRoot);

        const fetched = await call("GET", "/api/sessions/s-prj-a-1?projectId=prj-a");
        assert.equal(fetched.status, 200);
        assert.equal(fetched.body.session.title, "Project A History Entry");

        const removed = await call("DELETE", "/api/sessions/s-prj-a-1?projectId=prj-a");
        assert.deepEqual([removed.status, removed.body], [200, { deleted: "s-prj-a-1" }]);
        const after = await call("GET", "/api/sessions");
        assert.equal(after.body.sessions.some(item => item.id === "s-prj-a-1"), false);
    });

    await test("the page carries a strict CSP that admits exactly its own inline script; every file is nosniff", async () => {

        const crypto = require("crypto");
        const get = async url => fetch(`${baseUrl}${url}`, { headers: { authorization: `Bearer ${server.token}` } });

        for (const url of ["/", "/projects/prj-a?tab=overview"]) {
            const page = await get(url);
            const html = await page.text();
            const csp = page.headers.get("content-security-policy") || "";
            assert.equal(page.status, 200, url);
            assert.equal(page.headers.get("x-content-type-options"), "nosniff");

            const directives = Object.fromEntries(csp.split(";").map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
            assert.deepEqual(directives["default-src"], ["'self'"]);
            assert.deepEqual(directives["style-src"], ["'self'"], "no inline styles");
            assert.deepEqual(directives["connect-src"], ["'self'"]);
            assert.deepEqual(directives["object-src"], ["'none'"]);
            assert.deepEqual(directives["base-uri"], ["'none'"]);
            assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"), csp);
            assert.ok(!csp.includes("frame-ancestors"), "the console may still be embedded (previews)");

            const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
            assert.ok(inline.length >= 1, "the page has its auth-pending script");
            const hashes = inline.map(code => `'sha256-${crypto.createHash("sha256").update(code, "utf8").digest("base64")}'`);
            assert.deepEqual(directives["script-src"], ["'self'", ...hashes], "exactly this origin and the page's own inline scripts");
            assert.doesNotMatch(html, /\son[a-z]+\s*=\s*"/i, "no inline event handlers, which the policy would block");
            assert.doesNotMatch(html, /\sstyle\s*=\s*"/i, "no style attributes, which the policy would block");
        }

        const script = await get("/app/main.js");
        await script.text();
        assert.equal(script.headers.get("x-content-type-options"), "nosniff");
        assert.equal(script.headers.get("content-security-policy"), null, "the policy belongs to the page");
    });

    await test("scoped tokens are blocked from /api/stats and receive project-isolated metrics and health", async () => {

        const statsBlocked = await call("GET", "/api/stats", null, SCOPED);
        assert.equal(statsBlocked.status, 403);

        const metrics = await call("GET", "/api/metrics", null, SCOPED);
        assert.equal(metrics.status, 200);
        assert.equal("gateway" in metrics.body, false, "scoped metrics must omit gateway");
        assert.equal("uptime_ms" in metrics.body, false, "scoped metrics must omit uptime_ms");
        assert.equal("cpu_percent" in metrics.body, false, "scoped metrics must omit cpu_percent");
        assert.ok(Object.keys(metrics.body.projects || {}).every(id => id === "prj-a"));

        const health = await call("GET", "/api/health", null, SCOPED);
        assert.equal(health.status, 200);
        assert.equal("gateway" in health.body, false, "scoped health must omit gateway");
        assert.ok(Object.keys(health.body.projects || {}).every(id => id === "prj-a"));
    });

    await test("HEAD static routes return headers without body and DELETE /api/mcp/ returns 404", async () => {

        const headRes = await fetch(`${baseUrl}/app/main.js`, { method: "HEAD" });
        assert.equal(headRes.status, 200);
        assert.match(headRes.headers.get("content-type"), /javascript/);
        assert.equal(await headRes.text(), "");

        const missingMcp = await call("DELETE", "/api/mcp/", null, server.token);
        assert.equal(missingMcp.status, 405);
    });

    await test("scoped tokens cannot inspect unscoped foreground state, workspace_root, or unscoped approvals", async () => {

        const consoleAuth = require(path.join(REPO, "agent", "config", "ConsoleAuth"));
        const createSnapshot = require(path.join(REPO, "web", "server", "console", "snapshot"));

        const scopedState = await call("GET", "/api/state", null, SCOPED);
        assert.equal(scopedState.status, 200);
        assert.equal(scopedState.body.status, "idle");
        assert.equal(scopedState.body.task, null);
        assert.equal(scopedState.body.answer, null);
        assert.deepEqual(scopedState.body.messages, []);
        assert.equal(scopedState.body.workspace, null);
        assert.equal(scopedState.body.limits.workspace_root, null);

        const abort = new AbortController();
        const stream = await fetch(`${baseUrl}/api/events?projectId=prj-a`, {
            headers: { authorization: `Bearer ${SCOPED}` },
            signal: abort.signal
        });
        try {
            const reader = stream.body.getReader();
            let text = "";
            while (!text.includes("\n\n")) {
                const { value, done } = await reader.read();
                if (done) break;
                text += Buffer.from(value).toString("utf8");
            }
            const first = JSON.parse(text.slice(text.indexOf("data: ") + 6, text.indexOf("\n\n")));
            assert.equal(first.snapshot.project_id, "prj-a");
            assert.equal(first.snapshot.workspace, PROJECT_ROOT);
            assert.equal(first.snapshot.limits.workspace_root, PROJECT_ROOT);
        } finally {
            abort.abort();
        }

        const mockState = {
            status: "running",
            projectId: null,
            task: "secret foreground task",
            answer: "secret foreground answer",
            error: "secret error",
            startedAt: 1000,
            finishedAt: null,
            cycles: 3,
            history: [{ role: "user", content: "secret prompt" }],
            discussion: { id: "disc-default", status: "running" },
            events: [],
            session: { id: "s-fg", messages: [{ role: "user", content: "secret prompt" }] }
        };
        const snapApi = createSnapshot({
            approvalStore: {
                pendingValues: () => [
                    { id: "ap-global", agent: "a", tool: "t", reason: "r", arguments: {}, project_id: null },
                    { id: "ap-b", agent: "a", tool: "t", reason: "r", arguments: {}, project_id: "prj-b" },
                    { id: "ap-a", agent: "a", tool: "t", reason: "r", arguments: {}, project_id: "prj-a" }
                ]
            },
            conversations: {
                list: () => [],
                get: id => id === "prj-a" ? {
                    background: true,
                    status: "idle",
                    task: null,
                    answer: null,
                    error: null,
                    startedAt: null,
                    finishedAt: null,
                    cycles: 0,
                    messages: [],
                    events: [],
                    session: null
                } : null
            },
            projectQueue: { view: () => ({ paused: false, items: [] }) },
            runtime,
            sessions: {
                summarise: s => ({ id: s.id }),
                listSessions: () => [
                    { id: "s-global", project_id: null },
                    { id: "s-b", project_id: "prj-b" },
                    { id: "s-a", project_id: "prj-a" }
                ]
            },
            sessionsEnabled: () => true,
            state: mockState
        });

        const claims = consoleAuth.resolve(SCOPED, server.token);
        const scopedSnap = snapApi.snapshotFor(claims);
        assert.equal(scopedSnap.status, "idle");
        assert.equal(scopedSnap.task, null);
        assert.equal(scopedSnap.answer, null);
        assert.equal(scopedSnap.error, null);
        assert.equal(scopedSnap.discussion, null);
        assert.equal(scopedSnap.session, null);
        assert.deepEqual(scopedSnap.messages, []);
        assert.equal(scopedSnap.workspace, null);
        assert.equal(scopedSnap.limits.workspace_root, null);
        assert.deepEqual(scopedSnap.pending_approvals.map(a => a.id), ["ap-a"]);
        assert.deepEqual(scopedSnap.sessions.map(s => s.id), ["s-a"]);

        mockState.projectId = "prj-b";
        const projA = snapApi.projectSnapshot("prj-a", claims);
        assert.equal(projA.project_id, "prj-a");
        assert.equal(projA.workspace, PROJECT_ROOT);
        assert.equal(projA.limits.workspace_root, PROJECT_ROOT);
        assert.ok(projA.project && typeof projA.project === "object");
        assert.equal(projA.discussion, null);
        assert.equal(projA.session, null);
        assert.deepEqual(projA.pending_approvals.map(a => a.id), ["ap-a"]);
    });

    await server.close();

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    await removeTempDirs(runtime, WORKSPACE, DATA_HOME, PROJECT_ROOT);

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
