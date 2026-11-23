"use strict";

/*
|--------------------------------------------------------------------------
| P0-4 — Web server safety (regression tests)
|--------------------------------------------------------------------------
|
| 1. Malformed percent-escapes in a routed path (GET /api/sessions/%ZZ,
|    DELETE /api/mcp/%E0, ...) must be answered with 4xx; they must not
|    raise an unhandled rejection that kills the process.
| 2. A malformed Host header must be answered with 4xx, not crash.
| 3. Scoped (non-master) tokens must not change runtime settings such as
|    AGENT_CONSOLE_TOKENS (privilege escalation) or the LLM endpoint.
| 4. Scoped tokens must not add MCP servers.
| 5. Scoped tokens must not switch the approval mode.
| 6. A token scoped to project B must not answer project A's approvals.
| 7. Legacy session endpoints must respect project scope (read / delete /
|    switch of the default conversation store).
|
| Every test asserts the DESIRED behaviour, so it fails on the unfixed
| code and passes once P0-4 is implemented.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "p04-ws-"));
const ROOT_A = fs.mkdtempSync(path.join(os.tmpdir(), "p04-a-"));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), "p04-b-"));
const DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "p04-data-"));

/* scoped tokens (Phase 9 claims format, see agent/config/ConsoleAuth.js) */
const SCOPED_A_WRITE = "p04-scoped-a-write-token-0001";
const SCOPED_B_READ = "p04-scoped-b-read-token-00002";
const SCOPED_B_WRITE = "p04-scoped-b-write-token-0003";
const EVIL_TOKEN = "p04-self-granted-evil-token-04";

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_MODEL = "test-model";
process.env.AGENT_APPROVAL = "auto";
process.env.SESSIONS_ENABLED = "true";
/* never contacted: no task is started by this suite */
process.env.AGENT_BASE_URL = "http://127.0.0.1:9/v1";
process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    [SCOPED_A_WRITE]: {
        allowedProjects: ["prj-a"],
        permissions: ["project:read", "project:write"]
    },
    [SCOPED_B_READ]: {
        allowedProjects: ["prj-b"],
        permissions: ["project:read"]
    },
    [SCOPED_B_WRITE]: {
        allowedProjects: ["prj-b"],
        permissions: ["project:read", "project:write"]
    }
});

const ORIGINAL_CONSOLE_TOKENS = process.env.AGENT_CONSOLE_TOKENS;
const ORIGINAL_BASE_URL = process.env.AGENT_BASE_URL;


/* ------------------------------------------------------------------
| A crash in a request handler surfaces as an unhandled rejection (the
| router's async handle() is not awaited by http.createServer). Record
| them instead of letting Node kill the suite, so the summary is printed.
------------------------------------------------------------------ */

const crashes = [];

process.on("unhandledRejection", error => {
    crashes.push(error);
});

process.on("uncaughtException", error => {
    crashes.push(error);
});


/* global safety net: never hang CI */
setTimeout(() => {
    console.log("  FAIL global timeout (90s) — suite did not finish");
    process.exit(1);
}, 90_000).unref();


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


/*
| Raw request so the path is sent byte-for-byte (no client-side
| normalisation of %ZZ) and the Host header can be forged.
*/
function raw(port, { method = "GET", pathname, headers = {}, body, timeoutMs = 2500 }) {

    return new Promise(resolve => {

        const payload = body === undefined ? undefined : JSON.stringify(body);

        const req = http.request({
            host: "127.0.0.1",
            port,
            method,
            path: pathname,
            headers: {
                ...(payload !== undefined
                    ? {
                        "content-type": "application/json",
                        "content-length": Buffer.byteLength(payload)
                    }
                    : {}),
                ...headers
            }
        }, res => {

            let text = "";
            res.setEncoding("utf8");
            res.on("data", chunk => (text += chunk));
            res.on("end", () => {

                let parsed = null;

                try {
                    parsed = text ? JSON.parse(text) : null;
                } catch {
                    parsed = text;
                }

                resolve({ status: res.statusCode, body: parsed, text });
            });
            res.on("error", () => resolve({ status: 0, body: null, text: "", error: "response error" }));
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve({ status: 0, body: null, text: "", error: "no response (timeout)" });
        });

        req.on("error", error => {
            resolve({ status: 0, body: null, text: "", error: error.message });
        });

        if (payload !== undefined) {
            req.write(payload);
        }

        req.end();
    });
}


function freePort() {

    return new Promise(resolve => {

        const probe = net.createServer();

        probe.listen(0, "127.0.0.1", () => {

            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}


function is4xx(status) {
    return status >= 400 && status < 500;
}


async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));
    const toolRuntime = require(path.join(REPO, "agent", "tools"));

    runtime.projects.registry().register({ id: "prj-a", name: "A", rootPath: ROOT_A });
    runtime.projects.registry().register({ id: "prj-b", name: "B", rootPath: ROOT_B });

    /* a conversation stored in the default (legacy, unscoped) store */
    const seeded = runtime.sessions.emptySession();
    seeded.messages.push({ role: "user", content: "p04 secret default conversation" });
    runtime.sessions.saveSession(seeded);

    const web = createServer(runtime, { apiRateLimit: 10_000 });
    const address = await web.listen(0, "127.0.0.1");
    const port = address.port;
    const master = web.token;

    const as = (token, method, pathname, body) =>
        raw(port, {
            method,
            pathname,
            headers: { authorization: `Bearer ${token}` },
            body
        });


    /* ------------------------------------------------ 1. escapes */

    await test("P0-4: malformed percent-escapes in routed paths return 4xx and do not crash the server", async () => {

        const before = crashes.length;

        const cases = [
            ["GET", "/api/sessions/%ZZ"],
            ["DELETE", "/api/mcp/%E0"],
            ["DELETE", "/api/sessions/%E0%A4"],
            ["POST", "/api/approvals/%ZZ"],
            ["GET", "/api/projects/%ZZ"]
        ];

        const failures = [];

        for (const [method, pathname] of cases) {

            const response = await as(
                master,
                method,
                pathname,
                method === "POST" ? { approved: false } : undefined
            );

            if (!is4xx(response.status)) {
                failures.push(
                    `${method} ${pathname} -> ${response.status || response.error}`
                );
            }
        }

        assert.deepStrictEqual(failures, [], `expected 4xx for every malformed escape: ${failures.join("; ")}`);

        assert.strictEqual(
            crashes.length,
            before,
            `request handling raised unhandled errors: ${crashes.slice(before).map(e => e && e.message).join("; ")}`
        );

        const alive = await as(master, "GET", "/api/state");
        assert.strictEqual(alive.status, 200, "server must keep answering after malformed requests");
    });


    /* ------------------------------------------------ 2. host */

    await test("P0-4: a malformed Host header returns 4xx and does not crash the server", async () => {

        const before = crashes.length;
        const failures = [];

        for (const host of ["[bad", "bad host name"]) {

            const response = await raw(port, {
                method: "GET",
                pathname: "/api/state",
                headers: { host, authorization: `Bearer ${master}` }
            });

            if (!is4xx(response.status)) {
                failures.push(`Host "${host}" -> ${response.status || response.error}`);
            }
        }

        assert.deepStrictEqual(failures, [], `expected 4xx for a bad Host header: ${failures.join("; ")}`);

        assert.strictEqual(
            crashes.length,
            before,
            `bad Host raised unhandled errors: ${crashes.slice(before).map(e => e && e.message).join("; ")}`
        );

        const alive = await as(master, "GET", "/api/state");
        assert.strictEqual(alive.status, 200, "server must keep answering after a bad Host header");
    });


    /* ------------------------------------------------ 3. settings */

    await test("P0-4: a scoped read-only token cannot rewrite AGENT_CONSOLE_TOKENS (no self-granted master token)", async () => {

        try {

            const response = await as(SCOPED_B_READ, "POST", "/api/settings", {
                key: "AGENT_CONSOLE_TOKENS",
                value: JSON.stringify({
                    [EVIL_TOKEN]: {
                        allowedProjects: ["*"],
                        permissions: ["project:read", "project:write", "semantic:query", "semantic:index"]
                    }
                })
            });

            assert.ok(
                response.status === 401 || response.status === 403,
                `expected 401/403, got ${response.status} ${JSON.stringify(response.body)}`
            );

            assert.strictEqual(
                runtime.settings.get("AGENT_CONSOLE_TOKENS"),
                ORIGINAL_CONSOLE_TOKENS,
                "AGENT_CONSOLE_TOKENS was changed by a scoped token"
            );

            const evil = await as(EVIL_TOKEN, "GET", "/api/state");
            assert.strictEqual(evil.status, 401, "a self-granted token must not authenticate");

        } finally {

            try { runtime.settings.reset("AGENT_CONSOLE_TOKENS"); } catch { /* best effort */ }
        }
    });


    await test("P0-4: a project-scoped token cannot change the LLM endpoint (AGENT_BASE_URL)", async () => {

        try {

            const response = await as(SCOPED_A_WRITE, "POST", "/api/settings", {
                key: "AGENT_BASE_URL",
                value: "http://attacker.invalid/v1"
            });

            assert.ok(
                response.status === 401 || response.status === 403,
                `expected 401/403, got ${response.status} ${JSON.stringify(response.body)}`
            );

            assert.strictEqual(
                runtime.settings.get("AGENT_BASE_URL"),
                ORIGINAL_BASE_URL,
                "AGENT_BASE_URL was changed by a scoped token"
            );

        } finally {

            try { runtime.settings.reset("AGENT_BASE_URL"); } catch { /* best effort */ }
        }
    });


    /* ------------------------------------------------ 4. mcp add */

    await test("P0-4: a scoped token cannot add an MCP server", async () => {

        const manager = toolRuntime.mcp._manager;
        const closed = await freePort();

        try {

            const response = await as(SCOPED_B_READ, "POST", "/api/mcp", {
                name: "p04-evil",
                transport: "http",
                url: `http://127.0.0.1:${closed}/mcp`,
                persist: false
            });

            assert.ok(
                response.status === 401 || response.status === 403,
                `expected 401/403 before any MCP work, got ${response.status} ${JSON.stringify(response.body)}`
            );

            assert.ok(
                !(manager.clients && manager.clients.has("p04-evil")),
                "the MCP server was registered by a scoped token"
            );

        } finally {

            if (manager.clients && manager.clients.has("p04-evil")) {
                await Promise.resolve(manager.remove("p04-evil")).catch(() => {});
            }
        }
    });


    /* ------------------------------------------------ 5. approval mode */

    await test("P0-4: a scoped token cannot switch the approval mode", async () => {

        const before = runtime.getApprovalMode();

        try {

            const response = await as(SCOPED_B_READ, "POST", "/api/approval-mode", {
                mode: before === "deny" ? "auto" : "deny"
            });

            assert.ok(
                response.status === 401 || response.status === 403,
                `expected 401/403, got ${response.status} ${JSON.stringify(response.body)}`
            );

            assert.strictEqual(runtime.getApprovalMode(), before, "approval mode was switched by a scoped token");

        } finally {

            try { runtime.settings.reset("AGENT_APPROVAL"); } catch { /* best effort */ }
        }
    });


    /* ------------------------------------------------ 6. approvals */

    await test("P0-4: a token scoped to project B cannot answer an approval owned by project A", async () => {

        const id = `approval_p04_${Date.now()}`;
        let answered;

        web.approvalStore.addPending({
            id,
            agent: "main_agent",
            tool: "write_file",
            reason: "p04 fixture",
            arguments: {},
            project_id: "prj-a",
            resolve: value => { answered = value; }
        });

        try {

            const response = await as(SCOPED_B_WRITE, "POST", `/api/approvals/${id}`, { approved: true });

            assert.ok(
                response.status === 403 || response.status === 404,
                `expected 403 (or 404), got ${response.status} ${JSON.stringify(response.body)}`
            );

            assert.strictEqual(answered, undefined, "project A's approval was answered by a project-B token");
            assert.ok(web.approvalStore.getPending(id), "project A's approval must still be pending");

            /* the owner (master) can still answer it */
            const owner = await as(master, "POST", `/api/approvals/${id}`, { approved: false });
            assert.strictEqual(owner.status, 200, `master must still resolve approvals, got ${owner.status}`);
            assert.strictEqual(answered, false);

        } finally {

            const left = web.approvalStore.removePending(id);

            if (left && typeof left.resolve === "function") {
                left.resolve(false);
            }
        }
    });


    /* ------------------------------------------------ 7. sessions */

    await test("P0-4: a project-scoped token cannot list or read conversations outside its scope", async () => {

        const control = await as(master, "GET", `/api/sessions/${encodeURIComponent(seeded.id)}`);
        assert.strictEqual(control.status, 200, `fixture: master must read the seeded session, got ${control.status}`);

        const listed = await as(SCOPED_B_READ, "GET", "/api/sessions");

        if (listed.status === 200) {

            const ids = ((listed.body && listed.body.sessions) || []).map(item => item.id);
            assert.ok(
                !ids.includes(seeded.id),
                "a prj-b token listed a conversation from the default (unscoped) store"
            );

        } else {

            assert.ok(is4xx(listed.status), `unexpected status ${listed.status}`);
        }

        const read = await as(SCOPED_B_READ, "GET", `/api/sessions/${encodeURIComponent(seeded.id)}`);

        assert.ok(
            read.status === 403 || read.status === 404,
            `expected 403/404 reading an out-of-scope session, got ${read.status}`
        );
        assert.ok(
            !String(read.text).includes("p04 secret default conversation"),
            "out-of-scope session content was returned"
        );
    });


    await test("P0-4: a project-scoped token cannot delete conversations outside its scope", async () => {

        const response = await as(SCOPED_B_WRITE, "DELETE", `/api/sessions/${encodeURIComponent(seeded.id)}`);

        assert.ok(
            response.status === 403 || response.status === 404,
            `expected 403/404, got ${response.status} ${JSON.stringify(response.body)}`
        );

        assert.ok(
            runtime.sessions.loadSession(seeded.id),
            "the out-of-scope session file was deleted"
        );
    });


    await test("P0-4: a scoped read-only token cannot create or switch the console conversation", async () => {

        const current = web.state.session.id;

        const created = await as(SCOPED_B_READ, "POST", "/api/sessions");

        assert.ok(
            created.status === 401 || created.status === 403,
            `POST /api/sessions: expected 401/403, got ${created.status}`
        );
        assert.strictEqual(web.state.session.id, current, "the open conversation was replaced by a scoped token");

        const opened = await as(SCOPED_B_READ, "POST", `/api/sessions/${encodeURIComponent(seeded.id)}`);

        assert.ok(
            opened.status === 403 || opened.status === 404,
            `POST /api/sessions/:id: expected 403/404, got ${opened.status}`
        );
        assert.strictEqual(web.state.session.id, current, "a scoped token switched the open conversation");
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
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            /* Windows may still hold a handle; temp dirs are disposable */
        }
    }

    process.exit(process.exitCode || 0);
}


main().catch(error => {

    console.error(error);
    process.exit(1);
});
