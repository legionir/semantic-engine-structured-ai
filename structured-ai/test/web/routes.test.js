"use strict";

/*
|--------------------------------------------------------------------------
| Web backend boundary — EXECUTION_PLAN Phase 23
|--------------------------------------------------------------------------
|
| Locks the complete method/path inventory and the extracted HTTP seams.
| web.test.js remains the end-to-end HTTP suite; this file adds
| focused checks for routing, middleware, body/response helpers and modular
| server lifecycle.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "phase23-web-"));
process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";

const REPO = path.resolve(__dirname, "..", "..");
const web = require(path.join(REPO, "web", "server"));
const { ROUTES, keys, assertUnique } = require(path.join(REPO, "web", "server", "RouteInventory"));
const apiSurface = require(path.join(REPO, "test", "fixtures", "api-surface.json"));
const { Router } = require(path.join(REPO, "web", "server", "Router"));
const body = require(path.join(REPO, "web", "server", "RequestBody"));
const response = require(path.join(REPO, "web", "server", "Response"));
const middleware = require(path.join(REPO, "web", "server", "Middleware"));
const { SseHub } = require(path.join(REPO, "web", "server", "SseHub"));
const controllers = require(path.join(REPO, "web", "server", "controllers"));
const services = require(path.join(REPO, "web", "server", "services"));

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


function fakeResponse() {

    return {
        status: null,
        headers: null,
        chunks: [],
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
        },
        write(chunk) {
            this.chunks.push(String(chunk));
        },
        end(chunk) {
            if (chunk !== undefined) {
                this.chunks.push(String(chunk));
            }
            this.ended = true;
        }
    };
}


function fakeRequest(text) {

    return Readable.from([text]);
}


async function main() {

    await test("the complete route inventory is unique and method-aware", async () => {

        assert.equal(assertUnique(), true);
        assert.equal(ROUTES.length, 45);

        const required = [
            "GET /api/events",
            "GET /api/state",
            "GET /api/mcp",
            "POST /api/mcp",
            "DELETE /api/mcp/:name",
            "POST /api/mcp/:name/enabled",
            "GET /api/sessions",
            "POST /api/sessions",
            "GET /api/sessions/:id",
            "POST /api/sessions/:id",
            "DELETE /api/sessions/:id",
            "GET /api/calls",
            "GET /api/calls/:key",
            "GET /api/graph/:view",
            "POST /api/tasks",
            "GET /api/projects",
            "POST /api/projects",
            "GET /api/projects/:projectId",
            "PATCH /api/projects/:projectId",
            "DELETE /api/projects/:projectId",
            "GET /api/projects/:projectId/state",
            "GET /api/projects/:projectId/sessions",
            "GET /api/projects/:projectId/events",
            "POST /api/projects/:projectId/cancel",
            "POST /api/projects/:projectId/chat",
            "POST /api/projects/:projectId/tasks",
            "GET /api/projects/:projectId/metrics",
            "GET /api/projects/:projectId/health",
            "GET /api/projects/:projectId/discussions",
            "POST /api/projects/:projectId/discussions",
            "GET /api/projects/:projectId/discussions/:discussionId",
            "GET /api/discussion/personas",
            "POST /api/discussion",
            "POST /api/approvals/:id",
            "POST /api/cancel",
            "POST /api/clear",
            "POST /api/approval-mode",
            "GET /api/settings",
            "POST /api/settings",
            "GET /api/stats",
            "GET /api/metrics",
            "GET /api/health",
            "GET /",
            "GET /projects",
            "GET /projects/:projectId"
        ];

        assert.deepEqual(keys(), required);
        assert.deepEqual(apiSurface.method_paths, required);
    });


    await test("Router matches exact paths and named parameters without decoding twice", async () => {

        const router = new Router();
        let seen = null;

        router.get(
            "/api/projects/:projectId/sessions",
            request => { seen = request; }
        );
        router.post(
            "/api/projects/:projectId/tasks",
            request => { seen = request; }
        );

        const req = { method: "GET", url: "/api/projects/project%2Fa/sessions", headers: { host: "localhost" } };
        const res = fakeResponse();
        await router.handle(req, res);

        assert.equal(seen.params.projectId, "project/a");
        assert.equal(seen.route.name, "GET /api/projects/:projectId/sessions");

        const matched = router.match("POST", "/api/projects/a/tasks");
        assert.equal(matched.params.projectId, "a");
        assert.equal(router.match("DELETE", "/api/projects/a/tasks"), null);
    });


    await test("RequestBody enforces the bounded JSON contract", async () => {

        assert.deepEqual(await body.readBody(fakeRequest("")), {});
        assert.deepEqual(
            await body.readBody(fakeRequest('{"task":"run"}')),
            { task: "run" }
        );

        await assert.rejects(
            () => body.readBody(fakeRequest("not-json")),
            /request body is not valid JSON/
        );

        await assert.rejects(
            () => body.readBody(fakeRequest("123456"), { maxBytes: 3 }),
            /request body is too large/
        );
    });


    await test("SA-F-005: a multi-byte character split across chunks decodes intact", async () => {

        /* "日本語" is 9 UTF-8 bytes; slice the buffer so a 3-byte
           character is cut in half between two incoming chunks. */

        const payload = Buffer.from(JSON.stringify({ task: "日本語" }), "utf8");
        const cut = payload.indexOf(Buffer.from([0x96])) + 1; /* mid-character */

        const splitRequest = () => Readable.from([
            payload.subarray(0, cut),
            payload.subarray(cut)
        ]);

        const parsed = await body.readBody(splitRequest());

        assert.deepEqual(parsed, { task: "日本語" });
        assert.ok(!JSON.stringify(parsed).includes("\uFFFD"), "no replacement char");
    });


    await test("Response and SseHub preserve JSON and SSE wire shapes", async () => {

        const json = fakeResponse();
        response.sendJson(json, 202, { accepted: true });
        assert.equal(json.status, 202);
        assert.deepEqual(JSON.parse(json.chunks[0]), { accepted: true });
        assert.match(json.headers["content-type"], /application\/json/);

        const clients = new Set();
        const hub = new SseHub({ clients, keepAliveMs: 60_000 });
        const req = new (require("events").EventEmitter)();
        const sse = fakeResponse();
        hub.attach(req, sse, { res: sse, projectId: null }, { type: "snapshot" });
        hub.broadcast({ type: "run:start" });

        assert.equal(sse.status, 200);
        assert.match(sse.chunks[0], /"type":"snapshot"/);
        assert.match(sse.chunks[1], /"type":"run:start"/);
        assert.equal(hub.size(), 1);
        hub.close();
        assert.equal(sse.ended, true);
    });


    await test("Middleware centralizes authentication, origin and rate limits", async () => {

        const auth = {
            resolve: (candidate, expected) =>
                candidate === expected
                    ? { master: true }
                    : null
        };
        const req = {
            headers: {
                authorization: "Bearer secret",
                host: "console.test",
                origin: "https://console.test"
            },
            socket: { remoteAddress: "127.0.0.1" }
        };
        const url = new URL("https://console.test/api/state");

        const result = middleware.authenticate({
            req,
            url,
            consoleToken: "secret",
            consoleAuth: auth
        });

        assert.equal(result.authenticated, true);
        assert.equal(middleware.sameOrigin(req.headers.origin, req.headers.host), true);
        assert.equal(middleware.sameOrigin("https://other.test", req.headers.host), false);

        const limiter = new middleware.RateLimiter({ limit: 1, windowMs: 60_000 });
        assert.equal(limiter.allow(req), true);
        assert.equal(limiter.allow(req), false);
    });


    await test("domain services and controllers have explicit injected boundaries", async () => {

        const state = { status: "idle", discussion: null };
        let started = null;
        const taskService = new services.TaskService({
            state,
            startTask: (task, options) => {
                started = { task, options };
                return "run";
            }
        });
        const taskController = new controllers.TaskController({ taskService });

        assert.equal(taskService.busy(), false);
        assert.equal(taskController.start("verify", { projectId: "a" }), "run");
        assert.deepEqual(started, { task: "verify", options: { projectId: "a" } });

        const settings = { all: () => [{ key: "x" }], set: (key, value) => `${key}:${value}` };
        const settingsController = new controllers.SettingsController({
            settingsService: new services.SettingsService({ runtime: { settings } })
        });
        assert.deepEqual(settingsController.list(), [{ key: "x" }]);
        assert.equal(settingsController.set("x", 1), "x:1");
    });


    await test("the canonical server exposes the route/controller graph", async () => {

        const runtime = require(path.join(REPO, "agent", "agent"));
        const app = web.createServer(runtime);
        try {
            assert.equal(app.mode, "modular");
            assert.equal(app.routeInventory.length, ROUTES.length);
            assert.ok(app.controllers.task);
            assert.ok(app.controllers.project);
            assert.ok(app.services.events);
            assert.equal(typeof app.router.handle, "function");
        } finally {
            await app.close();
        }
    });


    await test("the canonical server preserves authenticated API and public static contracts", async () => {

        const runtime = require(path.join(REPO, "agent", "agent"));
        const app = web.createServer(runtime);
        const address = await app.listen(0, "127.0.0.1");
        const base = `http://127.0.0.1:${address.port}`;

        try {
            const unauthenticated = await fetch(`${base}/api/state`);
            assert.equal(unauthenticated.status, 401);

            const authenticated = await fetch(`${base}/api/state`, {
                headers: { "x-console-token": app.token }
            });
            assert.equal(authenticated.status, 200);
            assert.equal((await authenticated.json()).status, "idle");

            const projects = await fetch(`${base}/api/projects`, {
                headers: { "x-console-token": app.token }
            });
            assert.equal(projects.status, 200);
            assert.ok(Array.isArray((await projects.json()).projects));

            const page = await fetch(`${base}/projects/any-project`);
            assert.equal(page.status, 200);
            assert.match(await page.text(), /structured-ai|<!doctype html/i);

            const visualizer = await fetch(`${base}/visualizer.html`);
            assert.equal(visualizer.status, 200);
            assert.match(await visualizer.text(), /visualizer\/main\.js/);

            const visualizerModule = await fetch(`${base}/visualizer/main.js`);
            assert.equal(visualizerModule.status, 200);
            assert.match(visualizerModule.headers.get("content-type"), /javascript/);

            const worker = await fetch(`${base}/workers/layout.worker.js`);
            assert.equal(worker.status, 200);
            assert.match(await worker.text(), /requestId/);
        } finally {
            await app.close();
        }
    });


    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
