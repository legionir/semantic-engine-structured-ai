"use strict";

/*
|--------------------------------------------------------------------------
| P0-5 extra checks: secret isolation edge cases
|--------------------------------------------------------------------------
|
| Complements test/p0/p05.test.js:
|   - ChildEnvironment allowlist (credential names never pass, explicit
|     env does, Windows-cased names are matched)
|   - project .mcp.json placeholders are rejected, operator config
|     (MCP_SERVERS) still expands them, and a repository .agent/mcp.json
|     expands them only in a trusted workspace (P0-8)
|   - after writing events with a fake key, nothing under the event store
|     or journal roots contains it, and the files are owner-only (POSIX)
|   - counters such as max_tokens survive redaction
| No network, no LLM.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "p05data-"));

/* P0-8: workspace trust is read from a store of this suite's own,
   never from the developer's ~/.config. */
process.env.STRUCTURED_AI_TRUST_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "p05data-trust-")),
    "trusted-workspaces.json"
);

const FAKE = "sk-p05dataFAKEkeyVALUE0123456789abcdefXYZ";
process.env.P05DATA_API_KEY = FAKE;
process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.AGENT_VERBOSE = "0";

const settings = require(path.join(REPO, "agent", "config"));
const childEnvironment = require(path.join(REPO, "agent", "tools", "process", "ChildEnvironment.js"));
const validator = require(path.join(REPO, "agent", "mcp", "McpConfigValidator.js"));
const eventstore = require(path.join(REPO, "agent", "persistence", "EventStoreRepository.js"));
const journal = require(path.join(REPO, "agent", "persistence", "JournalRepository.js"));
const EventRedactor = require(path.join(REPO, "agent", "events", "EventRedactor.js"));
const WorkspaceTrust = require(path.join(REPO, "agent", "projects", "WorkspaceTrust.js"));

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

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

async function main() {

    await test("ChildEnvironment keeps PATH, drops credential-named variables", () => {
        const env = childEnvironment.build({}, {
            PATH: "/usr/bin",
            HOME: "/home/u",
            OPENAI_API_KEY: "x",
            GITHUB_TOKEN: "x",
            AWS_SECRET_ACCESS_KEY: "x",
            DB_PASSWORD: "x",
            RANDOM_APP_SETTING: "x"
        });
        assert.strictEqual(env.PATH, "/usr/bin");
        assert.strictEqual(env.HOME, "/home/u");
        for (const name of ["OPENAI_API_KEY", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "DB_PASSWORD", "RANDOM_APP_SETTING"]) {
            assert.ok(!(name in env), `${name} must not be inherited`);
        }
    });

    await test("ChildEnvironment matches Windows-cased names and LC_* prefixes", () => {
        const env = childEnvironment.build({}, { Path: "C:\\bin", SystemRoot: "C:\\Windows", LC_ALL: "C" });
        assert.strictEqual(env.Path, "C:\\bin");
        assert.strictEqual(env.SystemRoot, "C:\\Windows");
        assert.strictEqual(env.LC_ALL, "C");
    });

    await test("ChildEnvironment passes explicitly configured env, even credential-named", () => {
        const env = childEnvironment.build({ SERVER_TOKEN: "configured", N: 3 }, { PATH: "/bin" });
        assert.strictEqual(env.SERVER_TOKEN, "configured");
        assert.strictEqual(env.N, "3");
    });

    await test("project .mcp.json with ${OPENAI_API_KEY} in url is rejected", () => {
        assert.throws(
            () => validator.normalize("p05d", { url: "https://x.invalid/?k=${OPENAI_API_KEY}" }, {
                source: validator.SOURCES.PROJECT, origin: path.join(WORKSPACE, ".mcp.json"), workspaceRoot: WORKSPACE
            }),
            /placeholders/
        );
    });

    await test("project .mcp.json without placeholders still loads", () => {
        const config = validator.normalize("p05d", { url: "https://x.invalid/mcp" }, {
            source: validator.SOURCES.PROJECT, origin: path.join(WORKSPACE, ".mcp.json"), workspaceRoot: WORKSPACE
        });
        assert.strictEqual(config.url, "https://x.invalid/mcp");
    });

    await test("operator config expands ${ENV}; a repository .agent/mcp.json only once the workspace is trusted", () => {
        /* P0-8: .agent/mcp.json is committed with the repository like
           .mcp.json, so it is operator configuration only after
           `agent --trust`. MCP_SERVERS (environment) always expands. */
        process.env.P05DATA_HOST = "expanded.invalid";
        const definition = () => ({ url: "https://${P05DATA_HOST}/mcp" });
        const context = source => ({ source, origin: "test", workspaceRoot: WORKSPACE });

        const fromEnvironment = validator.normalize("p05d", definition(), context(validator.SOURCES.ENVIRONMENT));
        assert.strictEqual(fromEnvironment.url, "https://expanded.invalid/mcp", "environment must expand");

        WorkspaceTrust.revoke(WORKSPACE);
        assert.throws(
            () => validator.normalize("p05d", definition(), context(validator.SOURCES.WORKSPACE)),
            /placeholders/,
            ".agent/mcp.json of an untrusted workspace must not expand"
        );

        WorkspaceTrust.trust(WORKSPACE, { by: "p05data" });
        try {
            const trusted = validator.normalize("p05d", definition(), context(validator.SOURCES.WORKSPACE));
            assert.strictEqual(trusted.url, "https://expanded.invalid/mcp", "a trusted workspace must expand");
        } finally {
            WorkspaceTrust.revoke(WORKSPACE);
        }
    });

    await test("redactSecrets keeps numbers and structure (max_tokens, usage)", () => {
        const out = EventRedactor.redactSecrets({
            type: "request:end", max_tokens: 4000, usage: { input_tokens: 10, output_tokens: 5 },
            token: "hi", api_key: FAKE, text: `key is ${FAKE}`
        });
        assert.strictEqual(out.max_tokens, 4000);
        assert.deepStrictEqual(out.usage, { input_tokens: 10, output_tokens: 5 });
        assert.strictEqual(out.token, "hi", "short streamed text under 'token' is kept");
        assert.strictEqual(out.api_key, "****");
        assert.ok(!out.text.includes(FAKE));
    });

    await test("nothing under the data root contains the fake key after a run", async () => {
        settings.set("EVENTSTORE_ENABLED", true);
        settings.set("JOURNAL_ENABLED", true);
        const event = {
            type: "tool:end", seq: 1, at: Date.now(), run_id: "run-p05data", turn_id: null,
            scope: "main_agent", iteration: 1, agent: "main_agent", id: "p05data-1", name: "terminal_exec",
            success: true, arguments: { command: "printenv" },
            result: { stdout: `P05DATA_API_KEY=${FAKE}\nother=${FAKE}x` }
        };
        eventstore.append(event);
        await eventstore.appendQueued({ ...event, seq: 2 });
        await eventstore.flush();
        await journal.onEventQueued({ ...event, seq: 3 });
        await journal.flush();
        const files = [...walk(eventstore.storeRoot()), ...walk(journal.journalRoot())];
        assert.ok(files.length >= 2, `expected store and journal files, got ${files.length}`);
        for (const file of files) {
            assert.ok(!fs.readFileSync(file, "utf8").includes(FAKE), `${file} contains the fake key`);
        }
    });

    await test("event store and journal files are owner-only (POSIX)", () => {
        if (process.platform === "win32") return;
        const files = [...walk(eventstore.storeRoot()), ...walk(journal.journalRoot())];
        assert.ok(files.length >= 1);
        for (const file of files) {
            const mode = fs.statSync(file).mode & 0o777;
            assert.strictEqual(mode & 0o077, 0, `${file} has mode ${mode.toString(8)}`);
        }
    });

    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed`);
    try { fs.rmSync(WORKSPACE, { recursive: true, force: true }); } catch { /* ignore */ }
    if (passed !== results.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
