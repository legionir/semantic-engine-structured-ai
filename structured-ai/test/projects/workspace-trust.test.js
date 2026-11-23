"use strict";

/*
| P0-1 — WorkspaceTrust unit tests: key classification, the trust store
| (user config dir, revocable, canonical paths) and trust-gated settings
| in WorkspaceProfile.openProject().
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "agent-trust-"));
const WORKSPACE = path.join(BASE, "workspace");
const DATA_HOME = path.join(BASE, "data");
const TRUST_FILE = path.join(BASE, "config", "structured-ai", "trusted-workspaces.json");

fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(DATA_HOME, { recursive: true });

for (const key of ["AGENT_APPROVAL", "HOOKS_ENABLED", "MCP_AUTO_DISCOVER", "PROJECT_FILE_ENABLED"]) {
    delete process.env[key];
}

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.STRUCTURED_AI_TRUST_FILE = TRUST_FILE;

const settings = require(path.join(REPO, "agent", "config"));
const WorkspaceTrust = require(path.join(REPO, "agent", "projects", "WorkspaceTrust.js"));
const WorkspaceProfile = require(path.join(REPO, "agent", "projects", "WorkspaceProfile.js"));

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

function plant(values) {
    fs.mkdirSync(path.join(WORKSPACE, ".agent"), { recursive: true });
    fs.writeFileSync(
        path.join(WORKSPACE, ".agent", "project.json"),
        `${JSON.stringify({ version: WorkspaceProfile.PROJECT_VERSION, settings: values }, null, 2)}\n`,
        "utf8"
    );
}

function readPlanted() {
    return JSON.parse(fs.readFileSync(path.join(WORKSPACE, ".agent", "project.json"), "utf8"));
}

function reset(keys) {
    for (const key of keys) {
        try { settings.reset(key); } catch { /* fixed */ }
    }
}

async function main() {

    console.log("P0-1 workspace trust store");

    await test("classify: security keys are locked, code-running switches are trust-gated", async () => {
        for (const key of ["AGENT_APPROVAL", "AGENT_BASE_URL", "AGENT_API_KEY", "ENDPOINT_MAIN_BASE_URL",
            "ENDPOINT_L2_API_KEY", "PROCESS_SANDBOX_MODE", "MCP_APPROVAL", "MCP_TRUST_PROJECT_CONFIG", "MCP_SERVERS"]) {
            assert.strictEqual(WorkspaceTrust.classify(key, settings), "locked", key);
        }
        assert.strictEqual(WorkspaceTrust.classify("HOOKS_ENABLED", settings), "trust");
        assert.strictEqual(WorkspaceTrust.classify("MCP_AUTO_DISCOVER", settings), "trust");
        assert.strictEqual(WorkspaceTrust.classify("AGENT_MODEL", settings), "allowed");
    });

    await test("trust store lives at the configured user path, not in the workspace", async () => {
        assert.strictEqual(WorkspaceTrust.trustStorePath(), path.resolve(TRUST_FILE));
        assert.ok(!WorkspaceTrust.trustStorePath().startsWith(WORKSPACE));
        assert.strictEqual(WorkspaceTrust.isTrusted(WORKSPACE), false);
    });

    await test("trust() is persisted and revoke() removes it", async () => {
        WorkspaceTrust.trust(WORKSPACE, { by: "test" });
        assert.ok(fs.existsSync(TRUST_FILE), "trust file written");
        assert.strictEqual(WorkspaceTrust.isTrusted(WORKSPACE), true);
        assert.strictEqual(WorkspaceTrust.isTrusted(path.join(WORKSPACE, "..", "workspace")), true, "canonical path");
        if (process.platform !== "win32") {
            assert.strictEqual(fs.statSync(TRUST_FILE).mode & 0o777, 0o600, "trust file is 0600");
        }
        assert.strictEqual(WorkspaceTrust.list().length, 1);
        assert.strictEqual(WorkspaceTrust.revoke(WORKSPACE), true);
        assert.strictEqual(WorkspaceTrust.isTrusted(WORKSPACE), false);
        assert.strictEqual(WorkspaceTrust.revoke(WORKSPACE), false);
    });

    await test("untrusted workspace: HOOKS_ENABLED is refused with a reason, harmless tuning applies", async () => {
        const keys = ["HOOKS_ENABLED"];
        reset(keys);
        const before = settings.get("HOOKS_ENABLED");
        plant({ HOOKS_ENABLED: true, AGENT_APPROVAL: "auto" });
        try {
            const opened = WorkspaceProfile.openProject();
            assert.strictEqual(opened.trusted, false);
            assert.strictEqual(settings.get("HOOKS_ENABLED"), before);
            assert.ok(!opened.applied.includes("HOOKS_ENABLED"));
            const refused = opened.blocked.map(item => item.key).sort();
            assert.deepStrictEqual(refused, ["AGENT_APPROVAL", "HOOKS_ENABLED"]);
            assert.strictEqual(settings.get("AGENT_APPROVAL"), "prompt");
            const onDisk = readPlanted();
            assert.strictEqual(onDisk.settings.HOOKS_ENABLED, true, "opening must not rewrite the repository's settings");
            assert.strictEqual(onDisk.settings.AGENT_APPROVAL, "auto", "opening must not rewrite the repository's settings");
        } finally {
            reset(keys);
        }
    });

    await test("trusted workspace: HOOKS_ENABLED applies, AGENT_APPROVAL stays locked", async () => {
        reset(["HOOKS_ENABLED", "AGENT_APPROVAL"]);
        plant({ HOOKS_ENABLED: true, AGENT_APPROVAL: "auto" });
        WorkspaceTrust.trust(WORKSPACE);
        try {
            const opened = WorkspaceProfile.openProject();
            assert.strictEqual(opened.trusted, true);
            assert.strictEqual(settings.get("HOOKS_ENABLED"), true);
            assert.ok(opened.applied.includes("HOOKS_ENABLED"));
            assert.strictEqual(settings.get("AGENT_APPROVAL"), "prompt");
            assert.ok(opened.blocked.some(item => item.key === "AGENT_APPROVAL"));
        } finally {
            WorkspaceTrust.revoke(WORKSPACE);
            reset(["HOOKS_ENABLED", "AGENT_APPROVAL"]);
        }
    });

    await test("persist() never writes a locked key into the project file", async () => {
        reset(["AGENT_BASE_URL"]);
        plant({});
        WorkspaceProfile.openProject();
        settings.set("AGENT_BASE_URL", "http://127.0.0.1:9/v1");
        try {
            WorkspaceProfile.persist();
            const onDisk = readPlanted();
            assert.ok(!("AGENT_BASE_URL" in (onDisk.settings || {})), JSON.stringify(onDisk.settings));
        } finally {
            reset(["AGENT_BASE_URL"]);
        }
    });

    await new Promise(resolve => setTimeout(resolve, 400));

    fs.rmSync(BASE, { recursive: true, force: true });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
