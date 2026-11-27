"use strict";

/*
|--------------------------------------------------------------------------
| Console Logs, Terminal and Files routes over real HTTP
|--------------------------------------------------------------------------
|
| The routes behind the console's Logs, Terminal and Files dialogs, driven
| through a live console server: admin-only access, the two switches that
| turn the terminal and the file manager off, every route's happy path
| and refusals, and the reason the log exists at all — a model request
| that fails is recorded with its status, endpoint and (redacted)
| response. The terminal runs on a fake pty so this file behaves the same
| on every OS.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { removeTempDirs } = require("../helpers/cleanup");

const WORKSPACE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "operator-routes-")));
const TRUST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "operator-routes-trust-"));
const SCOPED = "scoped-token-operator-routes";

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_TRUST_FILE = path.join(TRUST_HOME, "trusted-workspaces.json");
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    [SCOPED]: { allowedProjects: ["prj-a"], permissions: ["project:read", "project:write"] }
});

const REPO = path.resolve(__dirname, "..", "..");
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack}`);
    }
}


function fakePty() {

    const spawned = [];
    return {
        spawned,
        spawn(file, args, options) {
            const listeners = { data: [], exit: [] };
            const child = {
                pid: 7000 + spawned.length,
                options,
                written: [],
                sizes: [],
                onData: fn => listeners.data.push(fn),
                onExit: fn => listeners.exit.push(fn),
                write(text) {
                    child.written.push(text);
                    listeners.data.forEach(fn => fn(`echo:${text}`));
                },
                resize: (cols, rows) => child.sizes.push([cols, rows]),
                kill: () => setImmediate(() => listeners.exit.forEach(fn => fn({ exitCode: 0, signal: 1 })))
            };
            spawned.push(child);
            return child;
        }
    };
}


/* reads an SSE stream until `until(text)` holds, then closes it */
function readStream(url, token, until, timeoutMs = 5000) {

    return new Promise((resolve, reject) => {
        let text = "";
        let timer = null;
        const req = http.get(url, { headers: { authorization: `Bearer ${token}` } }, res => {
            res.setEncoding("utf8");
            res.on("data", chunk => {
                text += chunk;
                if (until(text)) {
                    clearTimeout(timer);
                    req.destroy();
                    resolve({ status: res.statusCode, type: res.headers["content-type"], text });
                }
            });
        });
        timer = setTimeout(() => {
            req.destroy();
            reject(new Error(`stream timed out; got ${JSON.stringify(text.slice(-300))}`));
        }, timeoutMs);
        req.on("error", error => {
            if (!text) reject(error);
        });
    });
}


function stubModel() {

    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            req.resume();
            req.on("end", () => {
                res.writeHead(401, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: { message: "Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX1234", code: "invalid_api_key" } }));
            });
        });
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}


/* the switches are fixed at startup, so a second process checks them */
function disabledServerAnswers() {

    const script = `
        const { createServer } = require(${JSON.stringify(path.join(REPO, "web", "server.js"))});
        const runtime = require(${JSON.stringify(path.join(REPO, "agent", "agent.js"))});
        (async () => {
            const server = createServer(runtime, { apiRateLimit: 1000 });
            const { port } = await server.listen(0, "127.0.0.1");
            const ask = async (method, url) => {
                const response = await fetch("http://127.0.0.1:" + port + url, { method, headers: { authorization: "Bearer " + server.token } });
                return { status: response.status, error: (await response.json()).error };
            };
            const answers = {
                terminal: await ask("GET", "/api/terminal"),
                terminalCreate: (await ask("POST", "/api/terminal")).status,
                files: await ask("GET", "/api/files"),
                logs: (await ask("GET", "/api/logs")).status
            };
            await server.close();
            process.stdout.write(JSON.stringify(answers));
            process.exit(0);
        })().catch(error => { console.error(error); process.exit(1); });
    `;

    return new Promise((resolve, reject) => {
        const child = require("child_process").spawn(process.execPath, ["-e", script], {
            env: { ...process.env, CONSOLE_TERMINAL_ENABLED: "false", CONSOLE_FILE_MANAGER_ENABLED: "false" },
            stdio: ["ignore", "pipe", "pipe"]
        });
        let out = "";
        let err = "";
        child.stdout.on("data", chunk => { out += chunk; });
        child.stderr.on("data", chunk => { err += chunk; });
        child.on("close", code => {
            try {
                resolve(JSON.parse(out));
            } catch {
                reject(new Error(`exit ${code}: ${err || out}`));
            }
        });
    });
}


async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const { createServer } = require(path.join(REPO, "web", "server.js"));
    const pty = fakePty();

    const server = createServer(runtime, { apiRateLimit: 1000, terminal: { ptyModule: pty } });
    const address = await server.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const settings = runtime.settings;
    const { logs } = require(path.join(REPO, "agent", "runtime", "LogStore"));

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
        let parsed = text;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            /* a download */
        }
        return { status: response.status, headers: response.headers, body: parsed };
    };

    console.log("console logs, terminal and files routes");

    await test("every operator route needs a token and refuses a project-scoped one", async () => {
        for (const [method, url] of [
            ["GET", "/api/logs"], ["DELETE", "/api/logs"], ["GET", "/api/logs/download"],
            ["GET", "/api/terminal"], ["POST", "/api/terminal"],
            ["GET", "/api/files"], ["GET", "/api/files/content?path=a"], ["POST", "/api/files/rename"]
        ]) {
            assert.equal((await call(method, url, null, null)).status, 401, `${method} ${url} without a token`);
            assert.equal((await call(method, url, null, SCOPED)).status, 403, `${method} ${url} with a scoped token`);
        }
    });

    await test("the logs routes list, accept console errors, stream, download and clear", async () => {
        logs.error("ai", "route probe failure", { status: 503 });
        const listed = await call("GET", "/api/logs?level=error&q=route%20probe");
        assert.equal(listed.status, 200);
        assert.deepEqual(listed.body.entries.map(entry => entry.message), ["route probe failure"]);
        assert.ok(listed.body.summary.counts.error >= 1);
        assert.equal((await call("GET", `/api/logs?after=${listed.body.summary.last_id}`)).body.entries.length, 0);

        const posted = await call("POST", "/api/logs", { level: "warn", message: "Console: boom", details: { line: 3 } });
        assert.equal(posted.status, 201);
        const byId = id => logs.list().find(entry => entry.id === id);
        const reported = byId(posted.body.id);
        assert.deepEqual([reported.source, reported.level, reported.details.line], ["panel", "warn", 3]);
        assert.equal((await call("POST", "/api/logs", { message: "  " })).status, 400);
        assert.equal((await call("POST", "/api/logs", "not an object")).status, 400);
        const debug = await call("POST", "/api/logs", { level: "debug", message: "x", details: ["a"] });
        assert.equal(byId(debug.body.id).level, "error", "a console report is an error unless it says warn or info");

        const stream = readStream(`${baseUrl}/api/logs/stream`, server.token, text => text.includes("streamed probe"));
        await sleep(100);
        logs.warn("run", "streamed probe");
        const streamed = await stream;
        assert.match(streamed.type, /text\/event-stream/);

        const download = await call("GET", "/api/logs/download");
        assert.equal(download.status, 200);
        assert.match(download.headers.get("content-disposition"), /attachment; filename="structured-ai-log-.*\.jsonl"/);
        assert.match(String(download.body), /route probe failure/);

        assert.equal((await call("DELETE", "/api/logs")).status, 200);
        assert.equal((await call("GET", "/api/logs?q=route%20probe")).body.entries.length, 0);
        assert.equal((await call("PUT", "/api/logs")).status, 405);
    });

    await test("a failing model request is logged with status, endpoint and a redacted response", async () => {
        const model = await stubModel();
        settings.set("AGENT_BASE_URL", `http://127.0.0.1:${model.address().port}/v1`);
        try {
            assert.equal((await call("POST", "/api/tasks", { task: "say hi" })).status, 202);
            let entry = null;
            for (let waited = 0; waited < 10000 && !entry; waited += 100) {
                await sleep(100);
                entry = (await call("GET", "/api/logs?source=ai&level=error")).body.entries.find(item => item.details && item.details.status === 401);
            }
            assert.ok(entry, "the 401 was logged");
            assert.match(entry.message, /AI request failed: HTTP 401/);
            assert.equal(entry.details.endpoint, `http://127.0.0.1:${model.address().port}/v1/chat/completions`);
            assert.equal(entry.details.retryable, false);
            assert.match(entry.details.response, /invalid_api_key/);
            assert.ok(!JSON.stringify(entry).includes("ABCDEFGHIJKLMNOPQRSTUVWX1234"), "the key in the response is masked");
            for (let waited = 0; waited < 5000; waited += 100) {
                if ((await call("GET", "/api/logs?source=run&q=Run%20failed")).body.entries.length) break;
                await sleep(100);
            }
            assert.ok((await call("GET", "/api/logs?source=run&q=Run%20failed")).body.entries.length >= 1, "the run's failure follows");
        } finally {
            settings.reset("AGENT_BASE_URL");
            await new Promise(resolve => model.close(resolve));
        }
    });

    await test("the terminal routes open, stream, type into, resize and close a shell", async () => {
        const info = await call("GET", "/api/terminal");
        assert.equal(info.status, 200);
        assert.equal(info.body.mode, "pty");
        assert.equal(info.body.cwd, WORKSPACE);
        assert.deepEqual(info.body.sessions, []);

        const created = await call("POST", "/api/terminal", { cols: 90, rows: 20 });
        assert.equal(created.status, 201);
        const id = created.body.session.id;
        assert.deepEqual([created.body.session.cols, created.body.session.rows], [90, 20]);

        const stream = readStream(`${baseUrl}/api/terminal/${id}/stream`, server.token, text => text.includes("echo:pwd"));
        await sleep(100);
        assert.equal((await call("POST", `/api/terminal/${id}/input`, { data: "pwd\r" })).status, 200);
        const streamed = await stream;
        assert.match(streamed.text, /"type":"snapshot"/);
        assert.deepEqual(pty.spawned[0].written, ["pwd\r"]);

        assert.equal((await call("POST", `/api/terminal/${id}/input`, { data: 5 })).status, 400);
        assert.deepEqual((await call("POST", `/api/terminal/${id}/resize`, { cols: 120, rows: 40 })).body, { cols: 120, rows: 40, applied: true });
        assert.equal((await call("POST", `/api/terminal/${id}/resize`, { cols: "x", rows: 1 })).status, 400);
        assert.equal((await call("GET", `/api/terminal/${id}/input`)).status, 405);
        assert.equal((await call("GET", `/api/terminal/${id}/nonsense`)).status, 404);
        assert.equal((await call("POST", "/api/terminal/unknown/input", { data: "x" })).status, 404);
        assert.equal((await call("PUT", "/api/terminal")).status, 405);

        assert.equal((await call("DELETE", `/api/terminal/${id}`)).status, 200);
        await sleep(50);
        assert.deepEqual((await call("GET", "/api/terminal")).body.sessions, []);
        assert.equal((await call("DELETE", `/api/terminal/${id}`)).status, 404);
    });

    await test("CONSOLE_TERMINAL_MAX_SESSIONS limits the open terminals", async () => {
        settings.set("CONSOLE_TERMINAL_MAX_SESSIONS", 1);
        try {
            assert.equal((await call("POST", "/api/terminal", {})).status, 201);
            const refused = await call("POST", "/api/terminal", {});
            assert.equal(refused.status, 409);
            assert.match(refused.body.error, /At most 1/);
        } finally {
            settings.reset("CONSOLE_TERMINAL_MAX_SESSIONS");
        }
    });

    await test("the files routes list, create, read, save (with conflicts), rename, download and delete", async () => {
        assert.equal((await call("POST", "/api/files", { path: "src/a.txt", type: "file" })).status, 201);
        const listing = await call("GET", "/api/files?path=src");
        assert.deepEqual([listing.status, listing.body.path, listing.body.entries.map(entry => entry.name)], [200, "src", ["a.txt"]]);

        const opened = await call("GET", "/api/files/content?path=src/a.txt");
        assert.deepEqual([opened.body.content, opened.body.binary], ["", false]);
        const saved = await call("PUT", "/api/files/content", { path: "src/a.txt", content: "one\n", expected_mtime_ms: opened.body.mtime_ms });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "src", "a.txt"), "utf8"), "one\n");

        const stale = await call("PUT", "/api/files/content", { path: "src/a.txt", content: "two\n", expected_mtime_ms: saved.body.entry.mtime_ms - 5000 });
        assert.equal(stale.status, 409);
        assert.equal(stale.body.current_mtime_ms, saved.body.entry.mtime_ms);

        const download = await call("GET", "/api/files/download?path=src/a.txt");
        assert.equal(download.status, 200);
        assert.match(download.headers.get("content-disposition"), /attachment; filename="a.txt"/);
        assert.equal(download.headers.get("x-content-type-options"), "nosniff");
        assert.equal(download.body, "one\n");

        assert.equal((await call("POST", "/api/files/rename", { from: "src", to: "lib" })).body.entry.path, "lib");
        assert.equal((await call("DELETE", "/api/files?path=lib")).status, 409, "a folder needs recursive=1");
        assert.equal((await call("DELETE", "/api/files?path=lib&recursive=1")).status, 200);
        assert.ok(!fs.existsSync(path.join(WORKSPACE, "lib")));
    });

    await test("PUT /api/files/upload stores raw bytes, refuses a clash unless overwrite=1, and caps the size", async () => {
        const put = (url, bytes, token = server.token) => fetch(`${baseUrl}${url}`, {
            method: "PUT",
            headers: { "content-type": "application/octet-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: bytes
        }).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));

        const bytes = Buffer.from([137, 80, 78, 71, 0, 0, 255, 1]);
        const created = await put("/api/files/upload?path=up/logo.png", bytes);
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.deepEqual([created.body.entry.path, created.body.entry.size], ["up/logo.png", 8]);
        assert.deepEqual(fs.readFileSync(path.join(WORKSPACE, "up", "logo.png")), bytes);

        const clash = await put("/api/files/upload?path=up/logo.png", Buffer.from("x"));
        assert.deepEqual([clash.status, clash.body.exists], [409, true]);
        const replaced = await put("/api/files/upload?path=up/logo.png&overwrite=1", Buffer.from("again"));
        assert.equal(replaced.status, 200);
        assert.equal(fs.readFileSync(path.join(WORKSPACE, "up", "logo.png"), "utf8"), "again");

        assert.equal((await put("/api/files/upload?path=../escape.bin", Buffer.from("x"))).status, 400);
        assert.equal((await put("/api/files/upload", Buffer.from("x"))).status, 400);
        assert.equal((await call("POST", "/api/files/upload", {})).status, 405);
        assert.equal((await put("/api/files/upload?path=up/x.bin", Buffer.from("x"), null)).status, 401);
        assert.equal((await put("/api/files/upload?path=up/x.bin", Buffer.from("x"), SCOPED)).status, 403);

        settings.set("CONSOLE_FILE_UPLOAD_MAX_BYTES", 1024);
        try {
            const big = await put("/api/files/upload?path=up/big.bin", Buffer.alloc(4096));
            assert.equal(big.status, 413);
            assert.match(big.body.error, /CONSOLE_FILE_UPLOAD_MAX_BYTES \(1024 bytes\)/);
            assert.ok(!fs.existsSync(path.join(WORKSPACE, "up", "big.bin")));
        } finally {
            settings.reset("CONSOLE_FILE_UPLOAD_MAX_BYTES");
        }
        assert.equal((await call("DELETE", "/api/files?path=up&recursive=1")).status, 200);
    });

    await test("the files routes refuse escapes, unknown projects and wrong methods", async () => {
        assert.equal((await call("GET", "/api/files?path=../")).status, 400);
        assert.equal((await call("GET", "/api/files?path=missing")).status, 404);
        assert.equal((await call("GET", "/api/files/content")).status, 400);
        assert.equal((await call("GET", "/api/files?projectId=prj-does-not-exist")).status, 404);
        assert.equal((await call("PATCH", "/api/files")).status, 405);
        assert.equal((await call("POST", "/api/files/content", {})).status, 405);
        assert.equal((await call("GET", "/api/files/rename")).status, 405);
        assert.equal((await call("POST", "/api/files/download")).status, 405);
        assert.equal((await call("GET", "/api/files/nonsense")).status, 404);

        settings.set("CONSOLE_FILE_MAX_BYTES", 1024);
        try {
            assert.equal((await call("PUT", "/api/files/content", { path: "big.txt", content: "x".repeat(2048) })).status, 413);
        } finally {
            settings.reset("CONSOLE_FILE_MAX_BYTES");
        }
    });

    await test("CONSOLE_TERMINAL_ENABLED and CONSOLE_FILE_MANAGER_ENABLED set to false turn both off", async () => {
        const switchedOff = await disabledServerAnswers();
        assert.equal(switchedOff.terminal.status, 403);
        assert.match(switchedOff.terminal.error, /CONSOLE_TERMINAL_ENABLED=false/);
        assert.equal(switchedOff.terminalCreate, 403);
        assert.equal(switchedOff.files.status, 403);
        assert.match(switchedOff.files.error, /CONSOLE_FILE_MANAGER_ENABLED=false/);
        assert.equal(switchedOff.logs, 200, "the log stays available");
        assert.throws(() => settings.set("CONSOLE_TERMINAL_ENABLED", true), /fixed for the lifetime/, "the console cannot switch it back on");
    });

    await server.close();
    assert.deepEqual(pty.spawned.length >= 2, true);

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    await removeTempDirs(runtime, WORKSPACE, TRUST_HOME);

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
