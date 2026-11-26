"use strict";

/*
|--------------------------------------------------------------------------
| P0-4 — Web server fuzz and token x endpoint matrix
|--------------------------------------------------------------------------
|
| 1. 1000 generated requests (random methods, malformed %-escapes, odd
|    bytes, very long paths) plus malformed Host headers: every request
|    gets an answer, malformed escapes and hosts get 4xx, nothing escapes
|    as an unhandled error and the server keeps answering.
| 2. Console-wide endpoints: no token -> 401, every scoped token -> 403,
|    the master token still works.
| 3. Project endpoints: a token scoped to project A gets 403 on every
|    project-B endpoint and 200 on its own project.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "p04m-ws-"));
const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "p04m-a-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "p04m-b-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "p04m-data-"));

const A_READ = "p04m-scoped-a-read-token-0001";
const A_WRITE = "p04m-scoped-a-write-token-002";
const ALL_WRITE = "p04m-scoped-all-write-tok-003";

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "test-model";
process.env.AGENT_APPROVAL = "deny";
process.env.SESSIONS_ENABLED = "true";
process.env.AGENT_BASE_URL = "http://127.0.0.1:9/v1";
process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    [A_READ]: { allowedProjects: ["prj-a"], permissions: ["project:read"] },
    [A_WRITE]: { allowedProjects: ["prj-a"], permissions: ["project:read", "project:write"] },
    /* every project, but still not the admin (master) token */
    [ALL_WRITE]: { allowedProjects: ["*"], permissions: ["project:read", "project:write"] }
});

const crashes = [];
process.on("unhandledRejection", error => crashes.push(error));
process.on("uncaughtException", error => crashes.push(error));

setTimeout(() => {
    console.log("  FAIL global timeout (120s) — suite did not finish");
    process.exit(1);
}, 120_000).unref();

const results = [];

async function test(name, fn) {
    try {
        await fn();
        results.push(true);
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push(false);
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}

const agent = new http.Agent({ keepAlive: false });

function raw(port, { method = "GET", pathname, headers = {}, body, timeoutMs = 3000 }) {

    return new Promise(resolve => {

        const payload = body === undefined ? undefined : JSON.stringify(body);

        const req = http.request({
            host: "127.0.0.1",
            port,
            method,
            path: pathname,
            agent,
            headers: {
                ...(payload !== undefined
                    ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
                    : {}),
                ...headers
            }
        }, res => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", chunk => (text += chunk));
            res.on("end", () => resolve({ status: res.statusCode, text }));
            res.on("error", () => resolve({ status: 0, text: "", error: "response error" }));
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve({ status: 0, text: "", error: "no response (timeout)" });
        });
        req.on("error", error => resolve({ status: 0, text: "", error: error.message }));

        if (payload !== undefined) {
            req.write(payload);
        }
        req.end();
    });
}

/* deterministic PRNG so a failure is reproducible */
function prng(seed) {
    let x = seed >>> 0;
    return () => {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        return x / 4294967296;
    };
}

function isMalformed(pathname) {
    try {
        for (const part of pathname.split("?")[0].split("/")) {
            decodeURIComponent(part);
        }
        return false;
    } catch {
        return true;
    }
}

const PREFIXES = [
    "/api/sessions/", "/api/mcp/", "/api/approvals/", "/api/projects/",
    "/api/calls/", "/api/projects/prj-zz/", "/projects/", "/api/", "/"
];
const BAD_ESCAPES = ["%", "%Z", "%ZZ", "%E0", "%E0%A4", "%C3", "%ED%A0%80", "%FF", "%%", "%0", "%G1"];
const SAFE = "abcdefghijklmnopqrstuvwxyz0123456789-_.~!$&'()*+,;=:@";
/* fuzzed methods never start work: no POST bodies, deny mode for tools */
const METHODS = ["GET", "DELETE", "PATCH", "PUT", "OPTIONS"];

function fuzzPath(next) {

    let out = PREFIXES[Math.floor(next() * PREFIXES.length)];
    const parts = 1 + Math.floor(next() * 4);

    for (let i = 0; i < parts; i++) {

        const roll = next();

        if (roll < 0.45) {
            out += BAD_ESCAPES[Math.floor(next() * BAD_ESCAPES.length)];
        } else if (roll < 0.55) {
            out += "%" + Math.floor(next() * 256).toString(16).padStart(2, "0").toUpperCase();
        } else if (roll < 0.6) {
            out += "a".repeat(200 + Math.floor(next() * 2000));
        } else {
            const len = 1 + Math.floor(next() * 12);
            for (let j = 0; j < len; j++) {
                out += SAFE[Math.floor(next() * SAFE.length)];
            }
        }

        if (next() < 0.3) {
            out += "/";
        }
    }

    return out;
}

async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));

    runtime.projects.registry().register({ id: "prj-a", name: "A", rootPath: ROOT_A });
    runtime.projects.registry().register({ id: "prj-b", name: "B", rootPath: ROOT_B });

    const web = createServer(runtime, { apiRateLimit: 100_000 });
    const address = await web.listen(0, "127.0.0.1");
    const port = address.port;
    const master = web.token;

    const as = (token, method, pathname, body) =>
        raw(port, {
            method,
            pathname,
            headers: token ? { authorization: `Bearer ${token}` } : {},
            body
        });

    /* ------------------------------------------------ 1. fuzz */

    await test("P0-4: 1000 fuzzed paths are answered, malformed escapes get 4xx, nothing crashes", async () => {

        const next = prng(0x5eed04);
        const before = crashes.length;
        const failures = [];
        let malformed = 0;

        for (let i = 0; i < 1000; i++) {

            const method = METHODS[Math.floor(next() * METHODS.length)];
            const pathname = fuzzPath(next);
            const response = await as(master, method, pathname);

            if (!response.status) {
                failures.push(`${method} ${pathname.slice(0, 80)} -> ${response.error}`);
            } else if (isMalformed(pathname)) {
                malformed++;
                if (response.status < 400 || response.status >= 500) {
                    failures.push(`${method} ${pathname.slice(0, 80)} -> ${response.status}`);
                }
            }

            if (failures.length > 20) {
                break;
            }
        }

        assert.ok(malformed > 200, `fixture: expected many malformed paths, got ${malformed}`);
        assert.deepStrictEqual(failures, [], `bad answers: ${failures.join("; ")}`);
        assert.strictEqual(
            crashes.length,
            before,
            `unhandled errors: ${crashes.slice(before).map(e => e && e.message).join("; ")}`
        );

        const alive = await as(master, "GET", "/api/state");
        assert.strictEqual(alive.status, 200, "server must keep answering after the fuzz run");
    });

    await test("P0-4: malformed Host headers get 4xx on API and static routes", async () => {

        const before = crashes.length;
        const failures = [];

        for (const host of ["[bad", "bad host name", "[::1", "a b:80", "%zz", "[]"]) {
            for (const pathname of ["/api/state", "/", "/api/sessions/x", "/projects/prj-a"]) {

                const response = await raw(port, {
                    pathname,
                    headers: { host, authorization: `Bearer ${master}` }
                });

                if (!(response.status >= 400 && response.status < 500)) {
                    failures.push(`Host "${host}" ${pathname} -> ${response.status || response.error}`);
                }
            }
        }

        assert.deepStrictEqual(failures, [], failures.join("; "));
        assert.strictEqual(crashes.length, before, "bad Host raised unhandled errors");

        const alive = await as(master, "GET", "/api/state");
        assert.strictEqual(alive.status, 200);
    });

    await test("P0-4: a malformed cookie is answered with 401, not a crash", async () => {

        const before = crashes.length;
        const response = await raw(port, {
            pathname: "/api/state",
            headers: { cookie: "structured_ai_console=%ZZ; other=%E0" }
        });

        assert.strictEqual(response.status, 401, `got ${response.status || response.error}`);
        assert.strictEqual(crashes.length, before, "a malformed cookie raised unhandled errors");

        const alive = await as(master, "GET", "/api/state");
        assert.strictEqual(alive.status, 200);
    });

    /* ------------------------------------------------ 2. console-wide */

    const ADMIN_ONLY = [
        ["GET", "/api/settings"],
        ["POST", "/api/settings", { key: "AGENT_MODEL", value: "p04m-evil" }],
        ["POST", "/api/approval-mode", { mode: "auto" }],
        ["POST", "/api/mcp", { name: "p04m", transport: "http", url: "http://127.0.0.1:9/mcp", persist: false }],
        ["DELETE", "/api/mcp/p04m"],
        ["POST", "/api/mcp/p04m/enabled", { enabled: false }]
    ];

    const UNSCOPED = [
        ["GET", "/api/sessions"],
        ["GET", "/api/sessions/some-id"],
        ["POST", "/api/sessions"],
        ["POST", "/api/sessions/some-id"],
        ["DELETE", "/api/sessions/some-id"],
        ["GET", "/api/calls"],
        ["GET", "/api/calls/some-key"],
        ["GET", "/api/mcp"],
        ["POST", "/api/tasks", { task: "p04m should never run" }],
        ["POST", "/api/discussion", { task: "p04m", personas: [] }],
        ["POST", "/api/cancel"],
        ["POST", "/api/clear"]
    ];

    await test("P0-4: matrix — without a token every API endpoint answers 401", async () => {

        const failures = [];

        for (const [method, pathname, body] of [...ADMIN_ONLY, ...UNSCOPED]) {
            const response = await as(null, method, pathname, body);
            if (response.status !== 401) {
                failures.push(`${method} ${pathname} -> ${response.status || response.error}`);
            }
        }

        assert.deepStrictEqual(failures, [], failures.join("; "));
    });

    await test("P0-4: matrix — scoped tokens (even allowedProjects ['*']) get 403 on admin endpoints", async () => {

        const failures = [];
        const model = runtime.settings.get("AGENT_MODEL");
        const mode = runtime.getApprovalMode();

        for (const token of [A_READ, A_WRITE, ALL_WRITE]) {
            for (const [method, pathname, body] of ADMIN_ONLY) {
                const response = await as(token, method, pathname, body);
                if (response.status !== 403) {
                    failures.push(`${token.slice(0, 18)} ${method} ${pathname} -> ${response.status || response.error}`);
                }
            }
        }

        assert.deepStrictEqual(failures, [], failures.join("; "));
        assert.strictEqual(runtime.settings.get("AGENT_MODEL"), model, "a scoped token changed a setting");
        assert.strictEqual(runtime.getApprovalMode(), mode, "a scoped token changed the approval mode");
    });

    await test("P0-4: matrix — project-scoped tokens get 403 on unscoped legacy endpoints", async () => {

        const failures = [];

        for (const token of [A_READ, A_WRITE]) {
            for (const [method, pathname, body] of UNSCOPED) {
                const response = await as(token, method, pathname, body);
                if (response.status !== 403) {
                    failures.push(`${token.slice(0, 18)} ${method} ${pathname} -> ${response.status || response.error}`);
                }
            }
        }

        assert.deepStrictEqual(failures, [], failures.join("; "));
    });

    await test("P0-4: matrix — an approval of the unscoped console run needs a token for every project", async () => {

        const id = `approval_p04m_${Date.now()}`;
        let answered;

        web.approvalStore.addPending({
            id,
            agent: "main_agent",
            tool: "write_file",
            reason: "p04m fixture",
            arguments: {},
            resolve: value => { answered = value; }
        });

        try {

            for (const token of [A_READ, A_WRITE]) {
                const response = await as(token, "POST", `/api/approvals/${id}`, { approved: true });
                assert.strictEqual(response.status, 403, `${token.slice(0, 18)} -> ${response.status || response.error}`);
            }

            assert.strictEqual(answered, undefined, "a project-scoped token answered a console approval");
            assert.ok(web.approvalStore.getPending(id), "the console approval must still be pending");

            const owner = await as(ALL_WRITE, "POST", `/api/approvals/${id}`, { approved: false });
            assert.strictEqual(owner.status, 200, `an all-projects write token must resolve it, got ${owner.status}`);
            assert.strictEqual(answered, false);

            const missing = await as(A_READ, "POST", "/api/approvals/p04m-missing", { approved: true });
            assert.strictEqual(missing.status, 403, `read-only token on a missing approval -> ${missing.status}`);

        } finally {

            const left = web.approvalStore.removePending(id);

            if (left && typeof left.resolve === "function") {
                left.resolve(false);
            }
        }
    });

    await test("P0-4: matrix — the master token still reaches admin and legacy endpoints", async () => {

        for (const [method, pathname] of [["GET", "/api/settings"], ["GET", "/api/sessions"], ["GET", "/api/mcp"], ["GET", "/api/calls"]]) {
            const response = await as(master, method, pathname);
            assert.strictEqual(response.status, 200, `${method} ${pathname} -> ${response.status}`);
        }
    });

    /* ------------------------------------------------ 3. project scope */

    await test("P0-4: matrix — a project-A token gets 403 on every project-B endpoint but reaches its own", async () => {

        const reads = ["", "/state", "/sessions", "/metrics", "/health", "/discussions"];
        const failures = [];

        for (const token of [A_READ, A_WRITE]) {

            for (const suffix of reads) {

                const other = await as(token, "GET", `/api/projects/prj-b${suffix}`);
                if (other.status !== 403) {
                    failures.push(`${token.slice(0, 18)} GET prj-b${suffix} -> ${other.status || other.error}`);
                }
                if (/p04m-b-/.test(other.text)) {
                    failures.push(`${token.slice(0, 18)} GET prj-b${suffix} leaked project B's root path`);
                }

                const own = await as(token, "GET", `/api/projects/prj-a${suffix}`);
                if (!own.status || own.status === 401 || own.status === 403) {
                    failures.push(`${token.slice(0, 18)} GET prj-a${suffix} -> ${own.status || own.error}`);
                }
            }

            const cancel = await as(token, "POST", "/api/projects/prj-b/cancel");
            if (cancel.status !== 403) {
                failures.push(`${token.slice(0, 18)} POST prj-b/cancel -> ${cancel.status || cancel.error}`);
            }
        }

        const listed = await as(A_READ, "GET", "/api/projects");
        assert.strictEqual(listed.status, 200, `GET /api/projects -> ${listed.status}`);
        assert.ok(!/prj-b/.test(listed.text), "a project-A token listed project B");

        assert.deepStrictEqual(failures, [], failures.join("; "));
    });

    /* ------------------------------------------------ summary */

    const failed = results.filter(ok => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);

    if (failed > 0) {
        process.exitCode = 1;
    }

    try {
        if (web.server && typeof web.server.closeAllConnections === "function") {
            web.server.closeAllConnections();
        }
        await Promise.race([
            Promise.resolve(web.close()).catch(() => {}),
            new Promise(done => setTimeout(done, 1000).unref())
        ]);
        await Promise.race([
            Promise.resolve(runtime.shutdown && runtime.shutdown()).catch(() => {}),
            new Promise(done => setTimeout(done, 1000).unref())
        ]);
    } catch {
        /* best effort */
    }

    for (const dir of [WORKSPACE, ROOT_A, ROOT_B, DATA_HOME]) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
            /* Windows may still hold a handle */
        }
    }

    process.exit(process.exitCode || 0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
