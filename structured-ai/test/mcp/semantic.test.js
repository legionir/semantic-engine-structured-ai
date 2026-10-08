const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
| Every test runs against a throwaway workspace so the repository is
| never touched. WORKSPACE_ROOT must be set before the tools are loaded.
*/

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "semantic-test-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.SEMANTIC_CALL_TIMEOUT_MS = "2000";

const semantic = require("../../agent/mcp/semantic");
const tools = require("../../agent/tools");
const settings = require("../../agent/config");
const { WORKSPACE_ROOT } = require("../../agent/context/WorkspaceBoundary");

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

const run = (name, args) =>
    tools.executeTool(name, args, { agent: "test" });


/*
| Create a fake sidecar script that communicates via stdio JSON-RPC
| with Content-Length framing.
|
| The engine is reached as an MCP server now, so the mock answers the
| handshake the same way a real one does and only routes tools/call to
| the behaviour a test supplies. Letting a customHandler see initialize
| as well would mean every test had to reimplement the handshake, and a
| handler that writes its answer in pieces would interleave it with the
| next one.
*/
function createMockSidecar(behaviorScript = "") {

    const scriptPath = path.join(WORKSPACE, `mock-sidecar-${Math.random().toString(36).slice(2)}.js`);

    const code = `
const fs = require("fs");

let buffer = Buffer.alloc(0);

process.stdin.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
        const sep = buffer.indexOf("\\r\\n\\r\\n");
        if (sep === -1) break;
        const header = buffer.slice(0, sep).toString("utf8");
        const match = /Content-Length:\\s*(\\d+)/i.exec(header);
        if (!match) {
            buffer = Buffer.alloc(0);
            break;
        }
        const len = parseInt(match[1], 10);
        if (buffer.length < sep + 4 + len) break;
        const body = buffer.slice(sep + 4, sep + 4 + len).toString("utf8");
        buffer = buffer.slice(sep + 4 + len);

        const msg = JSON.parse(body);
        handleRequest(msg);
    }
});

function send(res) {
    const json = JSON.stringify(res);
    process.stdout.write("Content-Length: " + Buffer.byteLength(json) + "\\r\\n\\r\\n" + json);
}

${behaviorScript}

function handleRequest(req) {

    /* the MCP handshake, which every server owes its client */

    if (req.method === "initialize") {
        return send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "mock-semantic-engine", version: "0.0.0" }
            }
        });
    }

    if (req.method === "notifications/initialized") {
        return;
    }

    if (req.method === "tools/list") {
        return send({
            jsonrpc: "2.0",
            id: req.id,
            result: { tools: [] }
        });
    }

    if (typeof customHandler === "function") {
        return customHandler(req, send);
    }

    const method = req.method === "tools/call" ? (req.params && req.params.name) : req.method;
    const params = req.method === "tools/call" ? (req.params && req.params.arguments) : req.params;

    if (method === "find_symbol") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                total: 2,
                items: [
                    { name: "AuthService", kind: "class", path: "src/auth.ts", line: 10, endLine: 40, signature: "class AuthService" },
                    { name: "login", kind: "method", path: "src/auth.ts", line: 15, endLine: 25, signature: "login(user, pass)" }
                ]
            }
        });
    } else if (method === "semantic_search") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                total: 1,
                items: [
                    { name: "AuthService", path: "src/auth.ts", score: 0.92, kind: "class", excerpt: "class AuthService { login() }" }
                ]
            }
        });
    } else if (method === "get_file_summary") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                role: "service",
                language: "typescript",
                symbolsCount: 5,
                imports: ["express"],
                exports: ["AuthService"],
                summary: "Authentication service handling logins."
            }
        });
    } else if (method === "get_dependencies") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                dependencies: [
                    { from: "src/auth.ts", to: "src/user.ts", kind: "import", confidence: 95 }
                ]
            }
        });
    } else if (method === "impact_analysis") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                impacted: [
                    { name: "UserController", path: "src/controller.ts", relation: "caller", hops: 1 }
                ]
            }
        });
    } else if (method === "find_tests") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                tests: [
                    { testFile: "src/auth.test.ts", testName: "AuthService login", line: 5 }
                ]
            }
        });
    } else if (method === "get_config_usage") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                usages: [
                    { key: "JWT_SECRET", path: "src/auth.ts", line: 20, context: "const s = process.env.JWT_SECRET;" }
                ]
            }
        });
    } else if (method === "assemble_context") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                tokenEstimate: 450,
                summary: "Context for auth task",
                files: [
                    { path: "src/auth.ts", role: "service", symbols: ["AuthService", "login"] }
                ]
            }
        });
    } else if (method === "diagnostics") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                diagnostics: [
                    { path: "src/auth.ts", line: 12, col: 5, severity: "error", message: "Type mismatch: string is not number", code: 2322 }
                ]
            }
        });
    } else if (method === "incoming_calls") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                callers: [
                    { fromSymbol: "handleLogin", path: "src/routes.ts", line: 30, callSites: [{ line: 32 }] }
                ]
            }
        });
    } else if (method === "definition") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                path: "src/auth.ts",
                line: 10,
                character: 13,
                preview: "export class AuthService {"
            }
        });
    } else if (method === "organize_imports") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                edits: [{ line: 1, text: "import { User } from './user';" }]
            }
        });
    } else if (method === "rename") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                changes: {
                    "src/auth.ts": [
                        { line: 10, oldText: "AuthService", newText: (params && params.newName) || "AuthenticationService" }
                    ]
                }
            }
        });
    } else if (method === "index_workspace") {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                filesIndexed: 50,
                symbolsIndexed: 200,
                durationMs: 120
            }
        });
    } else {
        send({
            jsonrpc: "2.0",
            id: req.id,
            result: { ok: true }
        });
    }
}
`;

    fs.writeFileSync(scriptPath, code, "utf8");
    return scriptPath;
}


async function main() {

    console.log(`workspace: ${WORKSPACE_ROOT}\n`);

    console.log("semantic-engine integration");

    /* 1. Missing binary -> graceful hint */
    await test("missing or disabled binary returns practical hint without throwing", async () => {

        settings.set("SEMANTIC_ENABLED", false);

        const res = await run("code_find_symbol", { name: "User" });

        assert.equal(res.ok, false);
        assert.match(res.hint, /Semantic engine is not available/);

        settings.reset("SEMANTIC_ENABLED");
    });

    /* 2. Mock sidecar basic symbol find */
    await test("code_find_symbol queries sidecar and maps symbols", async () => {

        const mockPath = createMockSidecar();
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const res = await run("code_find_symbol", { name: "Auth" });

        assert.equal(res.query, "Auth");
        assert.equal(res.total, 2);
        assert.equal(res.symbols.length, 2);
        assert.equal(res.symbols[0].name, "AuthService");
        assert.equal(res.symbols[0].kind, "class");
        assert.equal(res.symbols[1].name, "login");

        semantic.shutdown();
    });

    /* 3. Content-Length framing across split chunks */
    await test("Content-Length framing handles messages split across chunks", async () => {

        const mockPath = createMockSidecar(`
function customHandler(req, send) {
    const json = JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: {
            total: 1,
            items: [{ name: "ChunkedSymbol", kind: "function", path: "src/a.ts", line: 1 }]
        }
    });
    const header = "Content-Length: " + Buffer.byteLength(json) + "\\r\\n\\r\\n";
    
    process.stdout.write(header);
    const mid = Math.floor(json.length / 2);
    process.stdout.write(json.slice(0, mid));
    setTimeout(() => {
        process.stdout.write(json.slice(mid));
    }, 20);
}
`);
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const res = await run("code_find_symbol", { name: "Chunked" });

        assert.equal(res.symbols.length, 1);
        assert.equal(res.symbols[0].name, "ChunkedSymbol");

        semantic.shutdown();
    });

    /* 4. Request timeout and process kill */
    await test("sidecar call times out cleanly and kills hanging process", async () => {

        const mockPath = createMockSidecar(`
function customHandler(req, send) {
    // deliberately ignore request to trigger timeout
}
`);
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);
        settings.set("SEMANTIC_CALL_TIMEOUT_MS", 300);

        const res = await run("code_find_symbol", { name: "Hanging" });

        assert.equal(res.ok, false);
        assert.match(res.error, /timed out/);

        settings.reset("SEMANTIC_CALL_TIMEOUT_MS");
        semantic.shutdown();
    });

    /* 5. Process crash mid-call rejects pending promise */
    await test("sidecar crash mid-call rejects without hanging", async () => {

        const mockPath = createMockSidecar(`
function customHandler(req, send) {
    process.exit(1);
}
`);
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const res = await run("code_find_symbol", { name: "Crash" });

        assert.equal(res.ok, false);
        assert.match(res.error, /exited unexpectedly/);

        semantic.shutdown();
    });

    /* 6. Output bounding (max items and character truncation) */
    await test("semantic tool output enforces bounds on items and text length", async () => {

        const manyItems = [];
        for (let i = 0; i < 100; i++) {
            manyItems.push({
                name: `Symbol_${i}`,
                kind: "function",
                path: "src/big.ts",
                line: i,
                signature: "x".repeat(500)
            });
        }

        const mockPath = createMockSidecar(`
function customHandler(req, send) {
    send({
        jsonrpc: "2.0",
        id: req.id,
        result: {
            total: 100,
            items: ${JSON.stringify(manyItems)}
        }
    });
}
`);
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);
        settings.set("SEMANTIC_MAX_ITEMS", 25);
        settings.set("SEMANTIC_EXCERPT_CHARS", 50);

        const res = await run("code_find_symbol", { name: "All", limit: 100 });

        assert.equal(res.total, 100);
        assert.equal(res.symbols.length, 25);
        assert.ok(res.symbols[0].signature.length <= 51);

        settings.reset("SEMANTIC_MAX_ITEMS");
        settings.reset("SEMANTIC_EXCERPT_CHARS");
        semantic.shutdown();
    });

    /* 7. Index query tools family */
    await test("code_search, code_file_summary, code_dependencies, code_impact, code_find_tests, code_config_usage, code_context query correctly", async () => {

        const mockPath = createMockSidecar();
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const searchRes = await run("code_search", { query: "login functionality" });
        assert.equal(searchRes.results.length, 1);
        assert.equal(searchRes.results[0].name, "AuthService");

        const summary = await run("code_file_summary", { path: "src/auth.ts" });
        assert.equal(summary.role, "service");
        assert.equal(summary.language, "typescript");

        const deps = await run("code_dependencies", { path: "src/auth.ts" });
        assert.equal(deps.dependencies.length, 1);
        assert.equal(deps.dependencies[0].to, "src/user.ts");

        const impact = await run("code_impact", { symbol: "AuthService" });
        assert.equal(impact.impacted.length, 1);
        assert.equal(impact.impacted[0].name, "UserController");

        const tests = await run("code_find_tests", { symbol: "AuthService" });
        assert.equal(tests.tests.length, 1);
        assert.equal(tests.tests[0].test_file, "src/auth.test.ts");

        const config = await run("code_config_usage", { key: "JWT_SECRET" });
        assert.equal(config.usages.length, 1);
        assert.equal(config.usages[0].key, "JWT_SECRET");

        const ctx = await run("code_context", { task: "fix login bug" });
        assert.equal(ctx.task, "fix login bug");
        assert.equal(ctx.token_estimate, 450);

        semantic.shutdown();
    });

    /* 8. Index lifecycle sessions */
    await test("code_index_start and code_index_get manage index sessions", async () => {

        const mockPath = createMockSidecar();
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const startRes = await run("code_index_start", { incremental: true });
        assert.ok(startRes.session_id);
        assert.equal(startRes.status, "started");

        /*
        | Poll to the terminal state instead of sleeping a fixed 50ms.
        | The background `index_workspace` call crosses into a spawned
        | sidecar process; on an idle box 50ms was enough, under parallel
        | load (other suites sharing the CPU) it was not, and `code_index_get`
        | raced ahead and returned `running`. That was a test-timing
        | assumption, not a product bug — indexing is intentionally async.
        */
        let getRes;
        const deadline = Date.now() + 4000;
        for (;;) {
            getRes = await run("code_index_get", { session_id: startRes.session_id });
            if (getRes.status === "completed" || getRes.status === "failed") break;
            if (Date.now() > deadline) break;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(getRes.session_id, startRes.session_id);
        assert.equal(getRes.status, "completed");

        semantic.shutdown();
    });

    /* 9. code_index_status on missing index reports state missing */
    await test("code_index_status returns state missing when project-index does not exist", async () => {

        const status = await run("code_index_status", {});

        assert.equal(status.state, "missing");
        assert.equal(status.file_count, 0);
        assert.equal(status.symbol_count, 0);
    });

    /* 10. Live LSP diagnostics return errors with line numbers */
    await test("code_diagnostics returns compiler errors with line and column", async () => {

        const mockPath = createMockSidecar();
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const res = await run("code_diagnostics", { path: "src/auth.ts" });

        assert.equal(res.live, true);
        assert.equal(res.diagnostics.length, 1);
        assert.equal(res.diagnostics[0].path, "src/auth.ts");
        assert.equal(res.diagnostics[0].line, 12);
        assert.equal(res.diagnostics[0].severity, "error");
        assert.match(res.diagnostics[0].message, /Type mismatch/);

        semantic.shutdown();
    });

    /* 11. Live LSP callers, definition, organize_imports */
    await test("code_callers, code_definition, code_organize_imports resolve live compiler queries", async () => {

        const mockPath = createMockSidecar();
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const callers = await run("code_callers", { symbol: "login", path: "src/auth.ts" });
        assert.equal(callers.live, true);
        assert.equal(callers.callers[0].from_symbol, "handleLogin");
        assert.equal(callers.callers[0].path, "src/routes.ts");

        const def = await run("code_definition", { symbol: "AuthService", path: "src/routes.ts" });
        assert.equal(def.live, true);
        assert.equal(def.path, "src/auth.ts");
        assert.equal(def.line, 10);

        const org = await run("code_organize_imports", { path: "src/auth.ts" });
        assert.equal(org.live, true);
        assert.equal(org.edits_count, 1);

        semantic.shutdown();
    });

    /* 12. code_rename dry_run vs apply */
    await test("code_rename previews with dry_run and applies only when requested", async () => {

        const mockPath = createMockSidecar();
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        // Create auth.ts in workspace
        const targetFile = path.join(WORKSPACE, "src", "auth.ts");
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.writeFileSync(targetFile, "export class AuthService {}\n", "utf8");

        // Dry run: should NOT modify file
        const preview = await run("code_rename", {
            path: "src/auth.ts",
            line: 10,
            character: 13,
            new_name: "AuthenticationService",
            dry_run: true
        });

        assert.equal(preview.dry_run, true);
        assert.equal(preview.applied, false);
        assert.equal(fs.readFileSync(targetFile, "utf8"), "export class AuthService {}\n");

        // Apply run
        const applied = await run("code_rename", {
            path: "src/auth.ts",
            line: 10,
            character: 13,
            new_name: "AuthenticationService",
            apply: true
        });

        assert.equal(applied.dry_run, false);
        assert.equal(applied.applied, true);
        assert.equal(fs.readFileSync(targetFile, "utf8"), "export class AuthenticationService {}\n");

        semantic.shutdown();
    });

    /* 12b. SA-F-004 — repeated identifier must be renamed at ITS line,
       not at the first textual occurrence elsewhere in the file. */
    await test("SA-F-004: a line-anchored rename hits the designated occurrence, not the first match", async () => {

        const mockPath = createMockSidecar(`
function customHandler(req, send) {
    if (req.method === "tools/call") {
        return send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                changes: {
                    "src/dup.ts": [
                        { line: 3, oldText: "AuthService", newText: "RenamedService" }
                    ]
                }
            }
        });
    }
    send({ jsonrpc: "2.0", id: req.id, result: { ok: true } });
}
`);
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const targetFile = path.join(WORKSPACE, "src", "dup.ts");
        fs.writeFileSync(
            targetFile,
            "const a = AuthService;\nconst b = 1;\nconst c = AuthService;\n",
            "utf8"
        );

        const applied = await run("code_rename", {
            path: "src/dup.ts",
            line: 3,
            character: 10,
            new_name: "RenamedService",
            apply: true
        });

        assert.equal(applied.applied, true);
        assert.equal(applied.edits_applied, 1);
        /* the OLD code replaced the FIRST occurrence; line 3 must change, line 1 must not */
        assert.equal(
            fs.readFileSync(targetFile, "utf8"),
            "const a = AuthService;\nconst b = 1;\nconst c = RenamedService;\n"
        );

        semantic.shutdown();
    });

    /* 12c. SA-F-004 — a range-bearing edit applies exactly at the range. */
    await test("SA-F-004: a range-based edit is applied at its designated span", async () => {

        const mockPath = createMockSidecar(`
function customHandler(req, send) {
    if (req.method === "tools/call") {
        return send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                changes: {
                    "src/rng.ts": [
                        {
                            range: { start: { line: 1, character: 4 }, end: { line: 1, character: 15 } },
                            newText: "RenamedService"
                        }
                    ]
                }
            }
        });
    }
    send({ jsonrpc: "2.0", id: req.id, result: { ok: true } });
}
`);
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const targetFile = path.join(WORKSPACE, "src", "rng.ts");
        /* second line (index 1): "AuthService" occupies chars 6..15 */
        fs.writeFileSync(targetFile, "let AuthService = 1;\nlet AuthService = 2;\n", "utf8");

        const applied = await run("code_rename", {
            path: "src/rng.ts",
            line: 2,
            character: 7,
            new_name: "RenamedService",
            apply: true
        });

        assert.equal(applied.applied, true);
        assert.equal(
            fs.readFileSync(targetFile, "utf8"),
            "let AuthService = 1;\nlet RenamedService = 2;\n"
        );

        semantic.shutdown();
    });

    /* 12d. SA-F-004 — an unlocatable edit is skipped and declared; the tool
       must NOT claim applied:true when nothing was written. */
    await test("SA-F-004: an unlocatable ambiguous edit is skipped, applied is false, file untouched", async () => {

        const mockPath = createMockSidecar(`
function customHandler(req, send) {
    if (req.method === "tools/call") {
        return send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
                changes: {
                    "src/amb.ts": [
                        { line: 99, oldText: "AuthService", newText: "RenamedService" }
                    ]
                }
            }
        });
    }
    send({ jsonrpc: "2.0", id: req.id, result: { ok: true } });
}
`);
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        const targetFile = path.join(WORKSPACE, "src", "amb.ts");
        const original = "AuthService AuthService AuthService\n";
        fs.writeFileSync(targetFile, original, "utf8");

        const applied = await run("code_rename", {
            path: "src/amb.ts",
            line: 1,
            character: 0,
            new_name: "RenamedService",
            apply: true
        });

        /* line 99 is out of range AND oldText occurs 3 times → ambiguous →
           the tool refuses to guess. Honest zero-effect result. */
        assert.equal(applied.applied, false);
        assert.equal(applied.edits_applied, 0);
        assert.equal(applied.edits_skipped, 1);
        assert.match(applied.note, /skipped/);
        assert.equal(fs.readFileSync(targetFile, "utf8"), original);

        semantic.shutdown();
    });

    /* 13. Clean shutdown verification */
    await test("shutdown leaves zero running sidecar processes", async () => {

        const mockPath = createMockSidecar();
        settings.set("SEMANTIC_ENGINE_BIN", mockPath);

        await run("code_find_symbol", { name: "Test" });
        assert.equal(semantic._pendingCount(), 0);

        semantic.shutdown();
        tools.shutdown();
    });

    /* 14. HTTP REST Client Transport */
    await test("HTTP client transport queries remote Semantic Engine when SEMANTIC_ENGINE_URL is configured", async () => {

        const http = require("http");
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", c => body += c);
            req.on("end", () => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    result: {
                        total: 1,
                        items: [{ name: "HttpSymbol", kind: "class", path: "src/remote.ts", line: 5 }]
                    }
                }));
            });
        });

        await new Promise(r => server.listen(0, "127.0.0.1", r));
        const port = server.address().port;
        settings.set("SEMANTIC_ENGINE_URL", `http://127.0.0.1:${port}`);

        const res = await run("code_find_symbol", { name: "Http" });
        assert.equal(res.symbols.length, 1);
        assert.equal(res.symbols[0].name, "HttpSymbol");

        settings.reset("SEMANTIC_ENGINE_URL");
        await new Promise(r => server.close(r));
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    settings.reset("SEMANTIC_ENGINE_BIN");
    settings.reset("SEMANTIC_ENGINE_URL");
    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
