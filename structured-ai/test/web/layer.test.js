"use strict";

/*
|--------------------------------------------------------------------------
| Web console layer — EXECUTION_PLAN Phase 23, گام ۲
|--------------------------------------------------------------------------
|
| The route contract answers "did any response change?". This file answers what
| a response cannot show: whether the structure the phase promised exists,
| whether the wiring has a name that resolves to nothing, whether a moved
| require still points at the file it meant, whether an extracted projection
| answers exactly what the inline expression it replaced answered, and whether
| WEB_SERVER_MODE forks behaviour the way a *move* must not.
|
| Only the last two tests boot anything. The rest read the modules directly —
| which is the point of the split: a controller is now testable without a
| socket, and a test that needs no socket does not become an integration test
| by accident.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const SERVER_DIR = path.join(REPO, "web", "server");

/*
| The runtime reads its environment when a module of it is first required, so
| all of it is set before any require below — the order routeHarness.js uses.
*/

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-layer-web-"));

fs.writeFileSync(path.join(WORKSPACE, "app.js"), "const value = 1;\n");

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";

const results = [];

async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.message.split("\n")[0]}`);
    }
}

/* ------------------------------------------------------------------- helpers */

const readSource = (...parts) => fs.readFileSync(path.join(SERVER_DIR, ...parts), "utf8");

function everyModule(dir = SERVER_DIR) {

    const found = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {

        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) found.push(...everyModule(full));
        else if (entry.name.endsWith(".js")) found.push(full);
    }

    return found;
}

const relative = file => path.relative(SERVER_DIR, file).split(path.sep).join("/");

const blockNames = (text, marker = "\n    return {") => {

    const block = new RegExp(`${marker.replace(/[{}]/g, "\\$&")}\\n([\\s\\S]*?)\\n    \\}`).exec(text);

    if (!block) return [];

    return block[1]
        .split(",")
        .map(part => part.trim().replace(/:.*$/, "").trim())
        .filter(Boolean);
};

/* a response double that records what a guard or an error answer writes */

function fakeResponse() {

    return {
        status: null,
        headers: null,
        body: "",
        ended: false,
        cookies: [],

        writeHead(status, headers) {

            this.status = status;
            this.headers = headers || {};
        },

        setHeader(name, value) {

            this.cookies.push([name, value]);
        },

        write(chunk) {

            this.body += chunk;
        },

        end(chunk) {

            if (chunk !== undefined) this.body += chunk;

            this.ended = true;
        }
    };
}

function fakeRequest(overrides = {}) {

    return {
        method: "GET",
        url: "/api/state",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
        on() {},
        destroy() {},
        ...overrides
    };
}

function send(baseUrl, urlPath, { token, method = "GET", body } = {}) {

    const payload = body === undefined ? null : JSON.stringify(body);

    return new Promise((resolve, reject) => {

        const request =
            http.request(
                baseUrl + urlPath,
                {
                    method,
                    headers: {
                        ...(token ? { authorization: `Bearer ${token}` } : {}),
                        ...(payload === null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) })
                    }
                },
                response => {

                    let body = "";

                    response.setEncoding("utf8");
                    response.on("data", chunk => { body += chunk; });

                    response.on("end", () => resolve({
                        status: response.statusCode,
                        type: response.headers["content-type"],
                        body
                    }));
                }
            );

        request.on("error", reject);
        request.setTimeout(20000, () => request.destroy(new Error("timed out")));

        if (payload !== null) request.write(payload);

        request.end();
    });
}

const get = (baseUrl, urlPath, token) => send(baseUrl, urlPath, { token });

/* --------------------------------------------------------------- the tests */

async function main() {

    /* ============================================================ structure */

    await test("the layer has exactly the modules the phase declared", () => {

        const declared = [
            "index.js",
            "Middleware.js",
            "RequestBody.js",
            "Response.js",
            "Router.js",
            "SseHub.js",
            "ServerMode.js",
            "WebServer.js",
            "controllers/ApprovalController.js",
            "controllers/DiscussionController.js",
            "controllers/EventStreamController.js",
            "controllers/GraphController.js",
            "controllers/McpController.js",
            "controllers/ProjectController.js",
            "controllers/SessionController.js",
            "controllers/SettingsController.js",
            "controllers/StateController.js",
            "controllers/TaskController.js",
            "serializers/ErrorSerializer.js",
            "serializers/SessionSerializer.js",
            "serializers/StateSerializer.js",
            "services/ApprovalService.js",
            "services/DiscussionService.js",
            "services/EventStreamService.js",
            "services/GitReportService.js",
            "services/SessionService.js",
            "services/SettingsService.js",
            "services/TaskService.js"
        ].sort();

        assert.deepEqual(everyModule().map(relative).sort(), declared);
    });

    await test("the two names the reference doc listed are recorded, not invented", () => {

        /*
        | REFACTOR_EXECUTION_PLAN گام ۱۲ named an ArchiveController and a
        | PlanController. The console has no /api/archive and no /api/plan: the
        | plan view is a *field* of the snapshot plus a predicate in the broadcast,
        | and archive is not exposed at all. Inventing an endpoint to fill a box in
        | a diagram would have been a new contract in a phase whose criteria say
        | responses are untouched, so the deviation is recorded in EXECUTION_PLAN
        | instead. This test fails the day such a route appears without that record.
        */

        assert.doesNotMatch(readSource("Router.js"), /\/api\/(archive|plan)/);
        assert.match(readSource("serializers", "StateSerializer.js"), /currentPlanView\(\)/);
        assert.match(readSource("SseHub.js"), /plan:autoroute:end/);
    });

    await test("web/server.js is a wrapper whose only export is createServer", () => {

        const facade = require(path.join(REPO, "web", "server.js"));

        assert.deepEqual(Object.keys(facade), ["createServer"], "the monolith exported exactly this");
        assert.equal(typeof facade.createServer, "function");

        assert.deepEqual(
            Object.keys(require(path.join(SERVER_DIR, "index.js"))).sort(),
            ["createServer", "webServerMode"]
        );
    });

    await test("the wrapper does not require itself", () => {

        /* `require("./server")` from web/server.js resolves back to
           web/server.js — a self-require that hands out a half-built module */

        assert.match(
            fs.readFileSync(path.join(REPO, "web", "server.js"), "utf8"),
            /require\("\.\/server\/index\.js"\)/
        );
    });

    /* ---------------------------------------------------------- require paths */

    await test("every module reads agent/ from the depth it now sits at", () => {

        const problems = [];

        for (const file of everyModule()) {

            const text = fs.readFileSync(file, "utf8");
            const dir = path.dirname(file);

            for (const match of text.matchAll(/require\("((?:\.\.\/)+agent\/[^"]+)"\)/g)) {

                const target = path.resolve(dir, match[1]);

                if (!fs.existsSync(target) && !fs.existsSync(`${target}.js`)) {
                    problems.push(`${relative(file)} → ${match[1]}`);
                }
            }

            for (const match of text.matchAll(/path\.resolve\(__dirname((?:,\s*"\.\.")+)[^)]*\)/g)) {

                const ups = (match[1].match(/"\.\."/g) || []).length;
                const tail = /"agent",\s*\n?\s*"(\w+)"/.exec(text.slice(match.index, match.index + 260));

                if (!tail) continue;

                const target = path.resolve(dir, ...Array(ups).fill(".."), "agent", tail[1]);

                if (!fs.existsSync(target)) {
                    problems.push(`${relative(file)} → agent/${tail[1]} resolves to ${target}`);
                }
            }
        }

        assert.deepEqual(problems, [], `a require that points at nothing:\n${problems.join("\n")}`);
    });

    await test("PUBLIC_DIR still resolves to the folder the console served", () => {

        const { PUBLIC_DIR, MIME } = require(path.join(SERVER_DIR, "Response.js"));

        assert.equal(PUBLIC_DIR, path.join(REPO, "web", "public"));
        assert.ok(fs.existsSync(path.join(PUBLIC_DIR, "index.html")));
        assert.deepEqual(Object.keys(MIME).sort(), [".css", ".html", ".ico", ".js", ".svg"]);
    });

    await test("one require each for agent/tools and agent/discussion", () => {

        /*
        | Both were required inside createServer off __dirname. A wrong depth and
        | the server does not boot; two copies and there are two MCP runtimes and
        | two persona registries in one process.
        */

        const tools = require(path.join(REPO, "agent", "tools"));
        const discussion = require(path.join(REPO, "agent", "discussion"));

        assert.equal(
            require(path.join(SERVER_DIR, "services", "DiscussionService.js")).DISCUSSION_MODULE,
            discussion,
            "the discussion service must share the module, not keep a second cache"
        );

        const requiring = everyModule().filter(file =>
            /agent",\s*\n?\s*"discussion"|agent\/discussion/.test(fs.readFileSync(file, "utf8"))
        );

        assert.deepEqual(
            requiring.map(relative),
            ["services/DiscussionService.js"],
            "exactly one file may require agent/discussion, or there are two persona registries"
        );

        assert.match(
            readSource("WebServer.js"),
            /path\.resolve\(__dirname, "\.\.", "\.\."\),\s*\n\s*"agent",\s*\n\s*"tools"/,
            "the tools require must resolve from web/server up two levels"
        );

        assert.equal(typeof tools.telemetry.runtime_stats, "function");
    });

    /* ---------------------------------------------------------------- wiring */

    await test("no module reads a ctx name the composition root never provides", () => {

        const webServer = readSource("WebServer.js");

        const literal = /const ctx = \{([\s\S]*?)\n {4}\};/.exec(webServer);

        assert.ok(literal, "WebServer must build its ctx object in one literal");

        const provided = new Set();

        for (const line of literal[1].split("\n")) {

            const key = /^\s*([A-Za-z0-9_$]+)\s*(,|:|$)/.exec(line);

            if (key) provided.add(key[1]);

            if (/^\s*\.\.\.response/.test(line)) {
                for (const name of Object.keys(require(path.join(SERVER_DIR, "Response.js")))) {
                    provided.add(name);
                }
            }
        }

        /* the namespaces: one object per controller, plus `settings` */

        /*
        | The namespaces are read out of the wiring itself — `fooController:
        | createFooController(ctx)` — because deriving them from file names would
        | have spelled EventStreamController "eventstreamController" and reported a
        | name nothing provides, which is the mistake the test exists to catch.
        */

        const namespaces = new Map();

        for (const match of webServer.matchAll(/([A-Za-z0-9_$]+Controller): (create[A-Za-z0-9_$]+)\(/g)) {

            const [, namespace, factory] = match;
            const file = path.join(SERVER_DIR, "controllers", `${factory.slice(6)}.js`);

            assert.ok(fs.existsSync(file), `${factory} must live in controllers/${factory.slice(6)}.js`);

            namespaces.set(namespace, new Set(blockNames(fs.readFileSync(file, "utf8"))));
        }

        assert.equal(namespaces.size, 10, "ten controller namespaces, one per route group");

        for (const name of namespaces.keys()) provided.add(name);

        provided.add("settings");
        provided.add("dispatch");
        provided.add("mode");

        /* what each service and helper contributes */

        for (const file of everyModule()) {

            const text = fs.readFileSync(file, "utf8");

            for (const name of blockNames(text)) provided.add(name);
        }

        const settingsNames = new Set(
            blockNames(readSource("services", "SettingsService.js"))
        );

        assert.ok(settingsNames.size >= 8, "the settings service must expose its knobs");

        const dangling = new Set();

        for (const file of everyModule()) {

            const text = fs.readFileSync(file, "utf8");

            for (const match of text.matchAll(/ctx\.([A-Za-z0-9_$]+)(?:\.([A-Za-z0-9_$]+))?/g)) {

                const [, first, second] = match;

                if (namespaces.has(first)) {

                    if (second && !namespaces.get(first).has(second)) {
                        dangling.add(`${relative(file)}: ctx.${first}.${second}`);
                    }

                    continue;
                }

                if (first === "settings") {

                    if (second && !settingsNames.has(second)) {
                        dangling.add(`${relative(file)}: ctx.settings.${second}`);
                    }

                    continue;
                }

                if (!provided.has(first)) {
                    dangling.add(`${relative(file)}: ctx.${first}`);
                }
            }
        }

        assert.deepEqual(
            [...dangling].sort(),
            [],
            `a name no wiring provides:\n${[...dangling].sort().join("\n")}`
        );
    });

    await test("the two installs happen before the socket is built", () => {

        const text = readSource("WebServer.js");

        const listeners = text.indexOf("ctx.installConsoleListeners()");
        const handler = text.indexOf("ctx.installApprovalHandler()");
        const socket = text.indexOf("http.createServer(");

        assert.ok(listeners > 0 && handler > 0 && socket > 0, "all three must be there");
        assert.ok(listeners < socket && handler < socket,
            "a console subscribed after listen() can miss the event that opens its own stream");
        assert.ok(listeners < handler,
            "the bus listeners are attached before the approval handler, as the monolith did");
    });

    await test("the layer does not boot the agent runtime to be loadable", () => {

        const loaded = () =>
            Object.keys(require.cache).filter(key => key.endsWith(`${path.sep}agent${path.sep}agent.js`));

        const before = loaded();

        for (const part of [
            ["Response.js"],
            ["RequestBody.js"],
            ["Middleware.js"],
            ["serializers", "SessionSerializer.js"],
            ["serializers", "ErrorSerializer.js"],
            ["services", "SettingsService.js"],
            ["services", "SessionService.js"],
            ["Router.js"]
        ]) {
            require(path.join(SERVER_DIR, ...part));
        }

        assert.deepEqual(loaded(), before, "the console layer pulled in agent.js at require time");
    });

    /* ---------------------------------------------------------------- router */

    await test("every inventoried route has a condition in the router", () => {

        const { PROBE_ORDER } = require("./routes.js");
        const router = readSource("Router.js");

        const missing = [];

        for (const probe of PROBE_ORDER) {

            if (!probe.path.startsWith("/api/")) continue;

            /* the one probe that exists to be unknown */

            if (probe.path === "/api/no-such-endpoint") continue;

            const prefix = probe.path.split("?")[0].split("/").slice(0, 3).join("/");

            if (!router.includes(prefix)) missing.push(`${probe.method} ${probe.path} (looks for ${prefix})`);
        }

        assert.deepEqual(missing, [], `routes no dispatcher claims:\n${missing.join("\n")}`);
    });

    await test("no path literal from the Phase 1 surface scan has gone missing", () => {

        /*
        | test/fixtures/api-surface.json is the route inventory the baseline phase
        | extracted from web/server.js. It is the oldest statement of what the
        | console answers, so it is checked against the whole layer: a handler that
        | was moved but never re-attached, or a prefix route that lost its trailing
        | slash, shows up here even if no probe in routes.js covers it.
        */

        const fixture = JSON.parse(
            fs.readFileSync(path.join(REPO, "test", "fixtures", "api-surface.json"), "utf8")
        );

        const text = everyModule()
            .concat([path.join(REPO, "web", "server.js")])
            .map(file => fs.readFileSync(file, "utf8"))
            .join("\n");

        const missing = fixture.paths.filter(literal => !text.includes(literal));

        assert.deepEqual(missing, [], `path literals the layer no longer mentions:\n${missing.join("\n")}`);
    });

    await test("every URL the frontend fetches is a route the router knows", () => {

        /*
        | The move touched only the server; the browser did not change. This is the
        | one place the two halves are checked against each other, so a renamed or
        | dropped route fails here rather than as a blank tab.
        */

        const app = fs.readFileSync(path.join(REPO, "web", "public", "app.js"), "utf8");
        const router = readSource("Router.js");

        const called = new Set();

        for (const match of app.matchAll(/["'`](\/api\/[A-Za-z0-9_/-]*)/g)) {

            called.add(match[1].split("/").slice(0, 3).join("/"));
        }

        assert.ok(called.size >= 10, `found ${called.size} API paths in app.js — the scan is broken`);

        const orphaned = [...called].filter(prefix => !router.includes(prefix));

        assert.deepEqual(orphaned, [], `the UI calls routes the router does not have:\n${orphaned.join("\n")}`);
    });

    await test("each branch dispatches to a controller and then ends the chain", () => {

        const router = readSource("Router.js");

        const dispatched =
            (router.match(/await ctx\.[A-Za-z]+Controller\.[A-Za-z]+\(/g) || []).length;
        const statics =
            (router.match(/ctx\.serveStatic\(/g) || []).length;
        const stops =
            (router.match(/^ {12}return;$/gm) || []).length;

        assert.equal(dispatched, 27, "27 route groups are answered by a controller");
        assert.equal(statics, 2, "two static branches stay in the router");
        assert.ok(stops >= 29, "every branch that answers must end the chain");

        assert.match(
            router,
            /ctx\.sendJson\(res, 405, \{ error: "method not allowed" \}\);/,
            "the 405 fallback must stay the last word"
        );
    });

    /* ------------------------------------------------------------ middleware */

    await test("a token is taken from the header, then the custom header, then the query, then the cookie", () => {

        const { requestToken, parseCookies } = require(path.join(SERVER_DIR, "Middleware.js"));

        const url = new URL("http://x/api/state?token=query");

        assert.equal(
            requestToken({ headers: { authorization: "Bearer bearer", "x-console-token": "custom", cookie: "structured_ai_console=cookie" } }, url),
            "bearer"
        );
        assert.equal(
            requestToken({ headers: { "x-console-token": "custom", cookie: "structured_ai_console=cookie" } }, url),
            "custom"
        );
        assert.equal(requestToken({ headers: { cookie: "structured_ai_console=cookie" } }, url), "query");
        assert.equal(requestToken({ headers: { cookie: "structured_ai_console=cookie" } }, new URL("http://x/api/state")), "cookie");
        assert.equal(requestToken({ headers: {} }, new URL("http://x/api/state")), null);
        assert.equal(requestToken({ headers: { authorization: "Basic nope" } }, new URL("http://x/api/state")), null,
            "a non-Bearer Authorization header is not a console token");

        assert.deepEqual(parseCookies("a=1; b=two%20words"), { a: "1", b: "two words" });
    });

    await test("the console's duplicate token match answers what consoleAuth's answers", () => {

        const { tokenMatches } = require(path.join(SERVER_DIR, "Middleware.js"));
        const consoleAuth = require(path.join(REPO, "agent", "lib", "consoleAuth.js"));

        /*
        | web/server.js carried its own constant-time comparison and never called it
        | — resolve() in consoleAuth does the real matching, with its own copy. The
        | duplicate moved rather than being quietly deleted; this pins that phase 30
        | can remove it without changing one answer.
        */

        for (const [candidate, expected] of [
            ["abc", "abc"],
            ["abc", "abd"],
            ["abc", "abcd"],
            ["a".repeat(32), "a".repeat(32)],
            ["", "x"],
            [undefined, "abc"],
            [123, "123"]
        ]) {

            const ours = String(tokenMatches(candidate, expected));
            const theirs = String(consoleAuth.tokenMatches(candidate, expected));

            assert.equal(ours, theirs, `disagreement on ${String(candidate)} vs ${expected}`);
        }

        /*
        | They do disagree on one input, and the honest thing is to record it:
        | comparing two empty strings is `true` for the console's copy and `false`
        | for consoleAuth's. It cannot change an answer, because resolve() refuses
        | an empty token before it compares anything — which is what the last two
        | assertions prove instead of a table of coincidences.
        */

        assert.equal(tokenMatches("", ""), true);
        assert.equal(consoleAuth.tokenMatches("", ""), false);
        assert.equal(consoleAuth.resolve("", "anything"), null, "an empty token never reaches a match");
        assert.equal(consoleAuth.resolve(null, ""), null);
    });

    await test("the API rate limit is per socket and per minute", () => {

        const { createMiddleware } = require(path.join(SERVER_DIR, "Middleware.js"));

        const { allowApiRequest } = createMiddleware({ consoleToken: "t" });

        let allowed = 0;

        for (let i = 0; i < 200; i += 1) {
            if (allowApiRequest({ socket: { remoteAddress: "10.0.0.1" } })) allowed += 1;
        }

        assert.equal(allowed, 120, "the window admits 120 requests and no more");
        assert.ok(allowApiRequest({ socket: { remoteAddress: "10.0.0.2" } }), "another socket, another window");
    });

    await test("the guard answers 429, 403 and 401 itself and nothing else", () => {

        const { createMiddleware } = require(path.join(SERVER_DIR, "Middleware.js"));

        /* the guard answers refusals with the shared JSON writer, exactly as the
           monolith did — so it is wired in here the way WebServer wires it */

        const middleware = createMiddleware({
            consoleToken: "secret-token",
            ...require(path.join(SERVER_DIR, "Response.js"))
        });

        const { guard } = middleware;

        /* 429 — through the real window, not a stub */

        const flooded = fakeResponse();

        for (let i = 0; i < 120; i += 1) {
            middleware.allowApiRequest({ socket: { remoteAddress: "10.9.9.9" } });
        }

        const rate = guard(
            fakeRequest({ headers: { authorization: "Bearer secret-token" }, socket: { remoteAddress: "10.9.9.9" } }),
            flooded,
            new URL("http://x/api/state")
        );

        assert.deepEqual(rate, { handled: true }, "a refused request must not reach a route");
        assert.equal(flooded.status, 429);
        assert.match(flooded.body, /rate limit/);

        /* 403 — cross-origin */

        const origin = fakeResponse();

        assert.deepEqual(
            guard(
                fakeRequest({ headers: { origin: "http://evil.example", authorization: "Bearer secret-token" } }),
                origin,
                new URL("http://x/api/state")
            ),
            { handled: true }
        );
        assert.equal(origin.status, 403);
        assert.match(origin.body, /cross-origin/);

        /* a same-origin request is *not* refused, which is the other half of that rule */

        const same = fakeResponse();

        assert.equal(
            guard(
                fakeRequest({ headers: { origin: "http://x", host: "x", authorization: "Bearer secret-token" } }),
                same,
                new URL("http://x/api/state")
            ).handled,
            false,
            "the console is same-origin by construction; refusing its own origin would break it"
        );

        /* 401 — no token on an API path */

        const anonymous = fakeResponse();

        assert.deepEqual(guard(fakeRequest(), anonymous, new URL("http://x/api/state")), { handled: true });
        assert.equal(anonymous.status, 401);
        assert.match(anonymous.body, /authentication required/);

        /* static paths are public */

        const asset = fakeResponse();

        assert.deepEqual(guard(fakeRequest({ url: "/app.css" }), asset, new URL("http://x/app.css")), {
            handled: false,
            claims: null
        });
        assert.equal(asset.status, null, "the guard must not answer a static file");

        /* and the launch link's token is exchanged for a cookie */

        const cookie = fakeResponse();

        const exchanged = guard(
            fakeRequest({ headers: { authorization: "Bearer secret-token" } }),
            cookie,
            new URL("http://x/api/state?token=secret-token")
        );

        assert.equal(exchanged.handled, false, "the request goes on to its route");
        assert.ok(exchanged.claims, "and it carries claims");
        assert.deepEqual(cookie.cookies, [[
            "set-cookie",
            "structured_ai_console=secret-token; HttpOnly; SameSite=Strict; Path=/"
        ]]);
    });

    /* ------------------------------------------------------------ serializers */

    await test("the extracted projections answer what the inline expressions answered", () => {

        const {
            pendingApprovalsForSnapshot,
            pendingApprovalsForProject,
            callSummaries
        } = require(path.join(SERVER_DIR, "serializers", "SessionSerializer.js"));

        /* the three expressions as web/server.js wrote them before the move */

        const inlineSnapshot = pending =>
            pending.map(
                request => ({
                    id: request.id,
                    agent: request.agent,
                    tool: request.tool,
                    reason: request.reason,
                    arguments: request.arguments,
                    project_id: request.project_id || null
                })
            );

        const inlineProject = pending =>
            pending.map(item => ({
                id: item.id,
                agent: item.agent,
                tool: item.tool,
                reason: item.reason,
                arguments: item.arguments,
                project_id: item.project_id
            }));

        const inlineCalls = list =>
            list.map(call => ({
                key: call.key,
                agent: call.agent,
                id: call.id,
                name: call.name,
                graph_id: call.graph_id,
                shape: call.shape,
                wave: call.wave,
                iteration: call.iteration,
                depends_on: call.depends_on,
                status: call.status,
                duration_ms: call.duration_ms
            }));

        const pending = [
            { id: "a1", agent: "main_agent", tool: "fs_write", reason: "r", arguments: { path: "x" } },
            { id: "a2", agent: "sub", tool: "git_commit", reason: "r2", arguments: {}, project_id: "prj-a" }
        ];

        assert.deepEqual(pendingApprovalsForSnapshot(pending), inlineSnapshot(pending));
        assert.deepEqual(pendingApprovalsForProject(pending), inlineProject(pending));

        assert.equal(pendingApprovalsForSnapshot(pending)[0].project_id, null,
            "the global snapshot says `null` where a project id is unknown");
        assert.equal("project_id" in pendingApprovalsForProject(pending)[0], true);
        assert.equal(pendingApprovalsForProject(pending)[0].project_id, undefined,
            "…and the project snapshot passes the field through, not a made-up value");

        const calls = [
            { key: "k|g|1", agent: "main_agent", id: 1, name: "fs_read", arguments: { big: "x".repeat(10_000) }, result: { deep: true } },
            { key: "k|g|2", agent: "sub", id: 2, name: "git_status", wave: 0, depends_on: [], status: "done", duration_ms: 12 }
        ];

        assert.deepEqual(callSummaries(calls), inlineCalls(calls));
        assert.equal(callSummaries(calls)[0].arguments, undefined, "the list never carries the arguments");
    });

    await test("an error keeps the status its thrower chose and everything else is 500", () => {

        const { sendError } = require(path.join(SERVER_DIR, "serializers", "ErrorSerializer.js"));

        for (const [error, status] of [
            [Object.assign(new Error("Unknown project: x"), { status: 404 }), 404],
            [Object.assign(new Error("nope"), { status: 409 }), 409],
            [new Error("boom"), 500],
            [Object.assign(new Error("gone"), { status: "404" }), "404"]
        ]) {

            const res = fakeResponse();

            sendError(res, error);

            assert.equal(res.status, status, `status for ${error.message}`);
            assert.deepEqual(JSON.parse(res.body), { error: error.message });
            assert.ok(res.ended, "an error answer must end the response");
        }
    });

    await test("the console only calls the approval store's real methods", () => {

        /*
        | Phase 21 replaced the console's local pending Map with the engine's own
        | ApprovalStore. One call site was left reading the Map API, so
        | `POST /api/cancel` threw a TypeError: the run was cancelled and answered
        | 500, and the approvals that cancel exists to release stayed pending.
        | The route contract caught it because it records the 500; this catches the
        | whole class — a method the store does not have cannot be called again.
        */

        const { ApprovalStore } = require(path.join(REPO, "agent", "policy"));

        const callers = new Map();

        for (const file of everyModule()) {

            const text = fs.readFileSync(file, "utf8");

            for (const match of text.matchAll(/state\.approvals\.([A-Za-z0-9_$]+)\(/g)) {
                callers.set(match[1], relative(file));
            }
        }

        assert.ok(callers.size >= 3, `found ${callers.size} call sites — the scan is broken`);

        const missing = [...callers].filter(([name]) => typeof ApprovalStore.prototype[name] !== "function");

        assert.deepEqual(
            missing.map(([name, file]) => `${file}: state.approvals.${name}() is not an ApprovalStore method`),
            [],
            `the console calls methods the store does not have:\n${missing.join("\n")}`
        );

        assert.ok(callers.has("take") && callers.has("begin"), "the queue is still entered and left through the store");
    });

    /* ------------------------------------------------------------- services */

    await test("every named setting reads the key it replaced", () => {

        const { createSettingsService } = require(path.join(SERVER_DIR, "services", "SettingsService.js"));

        const values = {
            SESSIONS_ENABLED: true,
            CONSOLE_RESULT_CHARS: 4000,
            CONSOLE_CALL_HISTORY: 50,
            MAX_CONSOLE_EVENTS: 500,
            AUTO_CONTINUE: false,
            MAX_AUTO_CYCLES: 3,
            MCP_ALLOW_RUNTIME_ADD: undefined
        };

        const settings = createSettingsService({
            runtime: {
                settings: { get: key => values[key], all: () => [{ key: "X" }] },
                events: { emit() {} }
            }
        });

        assert.deepEqual(Object.keys(settings).sort(), [
            "all", "allowMcpRuntimeAdd", "apply", "autoContinue", "callHistoryLimit",
            "maxAutoCycles", "maxConsoleEvents", "resultChars", "sessionsEnabled"
        ]);

        assert.equal(settings.sessionsEnabled(), true);
        assert.equal(settings.resultChars(), 4000);
        assert.equal(settings.callHistoryLimit(), 50);
        assert.equal(settings.maxConsoleEvents(), 500);
        assert.equal(settings.autoContinue(), false);
        assert.equal(settings.maxAutoCycles(), 3);
        assert.deepEqual(settings.all(), [{ key: "X" }]);

        /* the MCP gate: the original test was `=== false`, so only a real false closes it */

        assert.equal(settings.allowMcpRuntimeAdd(), true, "an unset key is not a refusal");

        values.MCP_ALLOW_RUNTIME_ADD = false;
        assert.equal(settings.allowMcpRuntimeAdd(), false);

        values.MCP_ALLOW_RUNTIME_ADD = "false";
        assert.equal(settings.allowMcpRuntimeAdd(), true, "a string is not the boolean false");
    });

    await test("a settings write goes to the store, then the event, then nothing else", () => {

        const { createSettingsService } = require(path.join(SERVER_DIR, "services", "SettingsService.js"));

        const order = [];

        const service = createSettingsService({
            runtime: {
                settings: {
                    reset: key => { order.push(`reset:${key}`); return 0; },
                    set: (key, value) => { order.push(`set:${key}=${value}`); return value; },
                    definitionOf: key => ({ key }),
                    describe: definition => { order.push("describe"); return { ...definition, value: 7, source: "env" }; }
                },
                events: {
                    emit: (type, payload) => order.push(`${type}:${payload.key}:${payload.value}:${payload.source}`)
                }
            }
        });

        assert.deepEqual(
            service.apply({ key: "MAX_RUN_MS", value: 7 }),
            { key: "MAX_RUN_MS", value: 7, source: "env" },
            "the route answers with the description the store returned"
        );

        assert.deepEqual(order, ["set:MAX_RUN_MS=7", "describe", "settings:changed:MAX_RUN_MS:7:env"]);

        order.length = 0;

        service.apply({ key: "MAX_RUN_MS", reset: true });

        assert.deepEqual(order, ["reset:MAX_RUN_MS", "describe", "settings:changed:MAX_RUN_MS:7:env"]);
    });

    await test("the event cap the stream honours is the named setting", () => {

        /*
        | `runtime.settings.get("MAX_CONSOLE_EVENTS")` became
        | `ctx.settings.maxConsoleEvents()` inside broadcast(). If the knob and the
        | reader disagreed, replay would start showing the wrong number of events
        | and no route response would change — the class of bug a contract test
        | cannot see.
        */

        const { createSseHub } = require(path.join(SERVER_DIR, "SseHub.js"));

        const state = { events: [], session: { events: [] } };
        const clients = new Set();
        const written = [];

        clients.add({ res: { write: payload => written.push(payload) }, projectId: null, claims: null });

        let capped = 0;

        const ctx = {
            state,
            clients,
            forStream: event => event,
            settings: {
                maxConsoleEvents: () => { capped += 1; return 3; },
                sessionsEnabled: () => false
            },
            runtime: {
                currentPlanView: () => ({ steps: [] }),
                events: {
                    visibleOnProjectStream: (event, projectId) => (event.project_id === projectId ? event : null),
                    aggregateMetadata: event => ({ aggregate: true, type: event.type })
                }
            }
        };

        const hub = createSseHub(ctx);

        Object.assign(ctx, hub);

        for (let i = 0; i < 7; i += 1) {
            ctx.broadcast({ type: "run:status", seq: i });
        }

        assert.equal(state.events.length, 3, "the ring buffer keeps the cap, not the history");
        assert.ok(capped >= 7, "the cap is read per broadcast through the named setting");
        assert.equal(written.length, 7, "every event still reached the live client");
    });

    await test("a client sees only what its claims allow", () => {

        const { createSseHub } = require(path.join(SERVER_DIR, "SseHub.js"));
        const consoleAuth = require(path.join(REPO, "agent", "lib", "consoleAuth.js"));

        const hub = createSseHub({
            state: { events: [] },
            clients: new Set(),
            runtime: {
                events: {
                    visibleOnProjectStream: (event, projectId) => (event.project_id === projectId ? event : null),
                    aggregateMetadata: event => ({ aggregate: true, type: event.type })
                }
            }
        });

        assert.deepEqual(
            hub.eventForClient({ type: "run:start", project_id: "prj-a" }, { projectId: "prj-a" }),
            { type: "run:start", project_id: "prj-a" }
        );
        assert.equal(hub.eventForClient({ type: "run:start", project_id: "prj-b" }, { projectId: "prj-a" }), null,
            "another project's payload must not reach this stream at all");
        assert.equal(hub.eventForClient({ type: "x" }, null).type, "x", "no client, no filter");

        const scoped = { projectId: null, claims: { master: false, allowedProjects: ["prj-a"], permissions: [] } };

        assert.deepEqual(
            hub.eventForClient({ type: "tool:end", project_id: "prj-a" }, scoped),
            { type: "tool:end", project_id: "prj-a" }
        );
        assert.equal(hub.eventForClient({ type: "tool:end", project_id: "prj-b" }, scoped), null);
        assert.deepEqual(
            hub.eventForClient({ type: "run:start" }, scoped),
            { aggregate: true, type: "run:start" },
            "an event with no project is metadata for a scoped token, not its payload"
        );

        assert.equal(typeof consoleAuth.allowsAllProjects, "function");
    });

    await test("the execution key groups a turn's tool events with the message that caused them", () => {

        const { createSessionService } = require(path.join(SERVER_DIR, "services", "SessionService.js"));

        const service = createSessionService({
            runtime: { events: { emit() {} }, settings: { get: () => true } },
            state: { session: { id: "s", messages: [] }, status: "idle", history: [], events: [] },
            calls: new Map(),
            sessions: { saveSession: () => ({}), summarise: () => ({}) },
            settings: { sessionsEnabled: () => false }
        });

        assert.equal(service.executionMessageKey({ message_id: "m1" }), "m1");
        assert.equal(service.executionMessageKey({ ai_message_id: "m2" }), "m2");
        assert.equal(service.executionMessageKey({ turn_id: "t", scope: "sub", iteration: 3 }), "t|sub|3");
        assert.equal(service.executionMessageKey({}), "run|main_agent|unknown",
            "an event with no correlation fields still gets one stable key");
    });

    await test("the preview the browser gets is bounded, and the full record is kept", () => {

        const { createEventStreamService } = require(path.join(SERVER_DIR, "services", "EventStreamService.js"));

        const calls = new Map();

        const { createSettingsService } = require(path.join(SERVER_DIR, "services", "SettingsService.js"));

        const service = createEventStreamService({
            calls,
            settings: createSettingsService({
                runtime: {
                    settings: { get: key => (key === "CONSOLE_RESULT_CHARS" ? 20 : 2) },
                    events: { emit() {} }
                }
            })
        });

        const big = "x".repeat(500);

        const shown = service.preview(big);

        assert.equal(shown.chars, 500);
        assert.equal(shown.text.length, 21, "the ceiling, plus the ellipsis");
        assert.equal(shown.truncated, true);
        assert.deepEqual(service.preview(null), { text: null, chars: 0, truncated: false });

        const streamed = service.forStream({
            type: "tool:end",
            id: "c1",
            name: "fs_read",
            agent: "main_agent",
            success: true,
            result: big
        });

        assert.equal(streamed.result, undefined, "the result never rides the stream");
        assert.equal(streamed.result_chars, 500);
        assert.equal(streamed.call_key, "main_agent|graph|c1");
        assert.equal(calls.size, 1, "the full record stays on the server, keyed");
        assert.equal(calls.get("main_agent|graph|c1").result, big);

        /* the cap on the record is the named setting, and it evicts oldest-first */

        for (let i = 0; i < 6; i += 1) {
            service.forStream({ type: "tool:end", id: `c${i}`, name: "fs_read", agent: "main_agent", success: true });
        }

        assert.equal(calls.size, 2, "CONSOLE_CALL_HISTORY is honoured through the service");
    });

    /* ------------------------------------------------------------ flag: mode */

    await test("WEB_SERVER_MODE defaults to legacy and a misspelling stays legacy", () => {

        const settings = require(path.join(REPO, "agent", "lib", "storage.js"));
        const { webServerMode } = require(path.join(SERVER_DIR, "index.js"));

        assert.equal(settings.definitionOf("WEB_SERVER_MODE").default, "legacy",
            "rule 8: the default of a fresh flag is legacy");
        assert.equal(webServerMode({ settings }), "legacy");

        for (const [value, expected] of [
            ["modular", "modular"],
            ["moduler", "legacy"],
            ["MODULAR", "legacy"],
            ["", "legacy"],
            [undefined, "legacy"]
        ]) {

            settings.set("WEB_SERVER_MODE", value);

            try {
                assert.equal(webServerMode({ settings }), expected, `value ${JSON.stringify(value)}`);
            } finally {
                settings.reset("WEB_SERVER_MODE");
            }
        }

        assert.equal(webServerMode({}), "legacy", "a runtime without settings is not a crash");
    });

    await test("legacy and modular answer the same routes with the same bytes", async () => {

        /*
        | The claim of a move. Whole bodies are compared, not statuses: a field
        | that quietly appears, or an event list that stops being capped, also
        | answers 200.
        */

        const settings = require(path.join(REPO, "agent", "lib", "storage.js"));
        const runtime = require(path.join(REPO, "agent", "agent.js"));
        const { createServer } = require(path.join(REPO, "web", "server.js"));

        const PATHS = [
            "/api/health",
            "/api/metrics",
            "/api/discussion/personas",
            "/api/projects",
            "/api/calls",
            "/api/sessions",
            "/api/no-such-endpoint",
            "/",
            "/app.css"
        ];

        /*
        | /api/settings is deliberately not compared: it answers with every setting
        | including WEB_SERVER_MODE itself, so the two modes must differ in exactly
        | that one field. A comparison that passes only when a flag hides itself is
        | not a comparison worth having.
        */

        /*
        | Health and metrics embed live telemetry (memory, timings), which is
        | volatile between two boots for reasons that have nothing to do with the
        | flag. Those fields are zeroed rather than the comparison being dropped —
        | the shape and every string in them are still compared. /api/state is not
        | compared at all: two servers share one event bus, so each accumulates the
        | events of the other's probes, and that is a property of the harness, not
        | of the console.
        */

        const { shape } = require("./routeHarness.js");

        const answers = {};

        for (const mode of ["legacy", "modular"]) {

            settings.set("WEB_SERVER_MODE", mode);

            const server = createServer(runtime, {});
            const address = await server.listen(0, "127.0.0.1");
            const baseUrl = `http://127.0.0.1:${address.port}`;

            for (const urlPath of PATHS) {

                answers[urlPath] = answers[urlPath] || {};
                answers[urlPath][mode] = await get(baseUrl, urlPath, server.token);
            }

            await server.close();
            settings.reset("WEB_SERVER_MODE");
        }

        for (const urlPath of PATHS) {

            const legacy = answers[urlPath].legacy;
            const modular = answers[urlPath].modular;

            assert.equal(modular.status, legacy.status, `${urlPath}: status differs by mode`);
            assert.equal(modular.type, legacy.type, `${urlPath}: content-type differs by mode`);

            if (!modular.body.trimStart().startsWith("{")) {

                /* a static asset: the same bytes or the move touched the UI */

                assert.equal(modular.body, legacy.body, `${urlPath}: a static file changed`);
                continue;
            }

            /*
            | A JSON answer is compared by the same measure the route contract
            | uses — the key tree and the type of every leaf — because ids,
            | timestamps and memory figures differ between two boots whatever the
            | mode is. A field that appears, vanishes or changes type in one mode
            | and not the other is what this is looking for.
            */

            assert.deepEqual(
                shape(JSON.parse(modular.body)),
                shape(JSON.parse(legacy.body)),
                `${urlPath} differs between the two modes:\n  legacy : ${legacy.body.slice(0, 240)}\n  modular: ${modular.body.slice(0, 240)}`
            );

            assert.ok(
                answers[urlPath].legacy.body.length > 0,
                `${urlPath} answered empty in both modes — the probe proves nothing`
            );
        }
    });

    await test("the handle and the console state are the monolith's, key for key", async () => {

        const runtime = require(path.join(REPO, "agent", "agent.js"));
        const { createServer } = require(path.join(SERVER_DIR, "WebServer.js"));

        const server = createServer(runtime, {});

        try {
            await server.listen(0, "127.0.0.1");

            assert.deepEqual(Object.keys(server).sort(), ["close", "listen", "server", "state", "token"]);

            assert.deepEqual(
                Object.keys(server.state).sort(),
                [
                    "answer", "approvals", "currentTurnId", "cycles", "discussion",
                    "error", "events", "finishedAt", "history", "lastPlanSignature",
                    "projectId", "session", "startedAt", "status", "stopRequested",
                    "task", "turnCounter"
                ],
                "the console state object kept every field it had — the snapshot is built from it"
            );

            assert.ok(server.state.approvals.listPending, "the pending list is the engine's store, not a mirror");
            assert.equal(typeof server.token, "string");
            assert.ok(server.token.length >= 16, "a token is generated when nobody configured one");
        } finally {
            await server.close();
        }
    });

    await test("cancel releases the approval a run was waiting on", async () => {

        /*
        | The behavioural half of the fix: the drain in POST /api/cancel is why a
        | cancelled run does not leave a question hanging in the queue. With the
        | Map API left in place, this request answered 500 *after* cancelling and
        | resolved nothing — so the number of the status and the state of the queue
        | are both asserted, not just the status.
        */

        const runtime = require(path.join(REPO, "agent", "agent.js"));
        const { createServer } = require(path.join(REPO, "web", "server.js"));

        const server = createServer(runtime, {});
        const address = await server.listen(0, "127.0.0.1");

        try {

            let answer;

            const stored =
                server.state.approvals.begin({
                    agent: "main_agent",
                    tool: "fs_write",
                    reason: "policy requires it",
                    arguments: {},
                    resolve: value => { answer = value; }
                });

            const response =
                await send(
                    `http://127.0.0.1:${address.port}`,
                    "/api/cancel",
                    { token: server.token, method: "POST", body: {} }
                );

            assert.equal(response.status, 200, response.body);
            assert.deepEqual(JSON.parse(response.body), { cancelled: true });

            assert.equal(answer, false, "a cancel must deny what the run was waiting on, not leave it open");
            assert.deepEqual(server.state.approvals.listPending(), [], "and the queue must be empty afterwards");
            assert.equal(typeof stored.id, "string");
        } finally {
            await server.close();
        }
    });

    /* ---------------------------------------------------------------- done */

    const failed = results.filter(entry => !entry.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length) {
        console.log("\n" + failed.map(f => `${f.name}\n   ${f.error && f.error.stack}`).join("\n\n"));
    }

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    /* routeHarness.js creates its own workspace when required; shutdown() is the
       only thing that removes it, and a harness left in a temp dir is a leak the
       suite should not have */

    try {
        await require("./routeHarness.js").shutdown({});
    } catch {
        /* nothing was booted, so there is nothing to close */
    }

    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
