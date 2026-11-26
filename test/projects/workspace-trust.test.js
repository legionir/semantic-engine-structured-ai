"use strict";

/*
| P0-1 — WorkspaceTrust unit tests: key classification, the trust store
| (user config dir, revocable, canonical paths), trust-gated settings
| in WorkspaceProfile.openProject() and the CLI trust commands
| (--trust, --untrust, --list-trusted).
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

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

const BIN = path.join(REPO, "bin", "agent.js");

const CLI_WORKSPACE = path.join(BASE, "cli-workspace");

fs.mkdirSync(CLI_WORKSPACE, { recursive: true });

function runCli(args) {
    return new Promise(resolve => {
        const env = {
            ...process.env,
            WORKSPACE_ROOT: CLI_WORKSPACE,
            STRUCTURED_AI_DATA_HOME: DATA_HOME,
            STRUCTURED_AI_TRUST_FILE: TRUST_FILE,
            MCP_ENABLED: "false"
        };
        const child = spawn(process.execPath, [BIN, ...args], {
            cwd: REPO,
            env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        const killer = setTimeout(() => {
            try { child.kill(); } catch { /* already gone */ }
        }, 60000);
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("close", code => {
            clearTimeout(killer);
            resolve({ code, stdout, stderr });
        });
    });
}

function parseJson(result, label) {
    try {
        return JSON.parse(result.stdout);
    } catch {
        throw new Error(`${label}: stdout is not JSON (exit ${result.code}):\n${result.stdout.slice(0, 400)}\n${result.stderr.slice(0, 400)}`);
    }
}

async function main() {

    console.log("P0-1 workspace trust store");

    await test("classify: security keys are locked, code-running switches are trust-gated", async () => {
        for (const key of ["AGENT_APPROVAL", "AGENT_BASE_URL", "AGENT_API_KEY", "AGENT_CONSOLE_PASSWORD_REQUIRED", "AGENT_CONSOLE_PASSWORD", "ENDPOINT_MAIN_BASE_URL",
            "ENDPOINT_L2_API_KEY", "PROCESS_SANDBOX_MODE", "PROCESS_SANDBOX_IMAGE", "PROCESS_SANDBOX_NETWORK",
            "PROCESS_SANDBOX_CPUS", "PROCESS_SANDBOX_MEMORY_MB", "PROCESS_SANDBOX_PIDS_LIMIT", "PROCESS_SANDBOX_TMP_MB",
            "MCP_APPROVAL", "MCP_TRUST_PROJECT_CONFIG", "MCP_SERVERS"]) {
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

    await test("CLI --trust / --list-trusted / --untrust manage the user trust store", async () => {
        const expected = WorkspaceTrust.canonicalRoot(CLI_WORKSPACE);

        const empty = await runCli(["--list-trusted", "--json"]);
        assert.strictEqual(empty.code, 0, empty.stderr.slice(0, 400));
        const before = parseJson(empty, "--list-trusted");
        assert.strictEqual(before.trust_file, path.resolve(TRUST_FILE));
        assert.ok(!before.workspaces.some(entry => entry.key === expected), "not trusted yet");

        const trusted = await runCli(["--trust", "--json", "-w", CLI_WORKSPACE]);
        assert.strictEqual(trusted.code, 0, trusted.stderr.slice(0, 400));
        const granted = parseJson(trusted, "--trust");
        assert.strictEqual(granted.workspace, expected);
        assert.strictEqual(granted.trusted, true);
        assert.strictEqual(WorkspaceTrust.isTrusted(CLI_WORKSPACE), true, "trust recorded in the user store");
        assert.ok(!fs.existsSync(path.join(CLI_WORKSPACE, ".agent", "trusted-workspaces.json")), "nothing written into the workspace");

        const listed = parseJson(await runCli(["--list-trusted", "--json"]), "--list-trusted");
        assert.ok(listed.workspaces.some(entry => entry.key === expected), JSON.stringify(listed));

        const revoked = await runCli(["--untrust", "--json", "-w", CLI_WORKSPACE]);
        assert.strictEqual(revoked.code, 0, revoked.stderr.slice(0, 400));
        const removed = parseJson(revoked, "--untrust");
        assert.strictEqual(removed.changed, true);
        assert.strictEqual(removed.trusted, false);
        assert.strictEqual(WorkspaceTrust.isTrusted(CLI_WORKSPACE), false, "trust revoked");

        const again = parseJson(await runCli(["--untrust", "--json", "-w", CLI_WORKSPACE]), "--untrust again");
        assert.strictEqual(again.changed, false);
    });

    await test("CLI --trust is a one-shot operation (usage error with -i or --untrust)", async () => {
        const interactive = await runCli(["--trust", "-i", "-w", CLI_WORKSPACE]);
        assert.strictEqual(interactive.code, 2, interactive.stderr.slice(0, 400));
        const both = await runCli(["--trust", "--untrust", "-w", CLI_WORKSPACE]);
        assert.strictEqual(both.code, 2, both.stderr.slice(0, 400));
        assert.strictEqual(WorkspaceTrust.isTrusted(CLI_WORKSPACE), false);
    });

    await test("CLI tells the operator how to trust a workspace whose trust-gated keys were refused", async () => {
        fs.mkdirSync(path.join(CLI_WORKSPACE, ".agent"), { recursive: true });
        fs.writeFileSync(
            path.join(CLI_WORKSPACE, ".agent", "project.json"),
            `${JSON.stringify({ version: WorkspaceProfile.PROJECT_VERSION, settings: { HOOKS_ENABLED: true } }, null, 2)}\n`,
            "utf8"
        );
        const result = await runCli(["--list-policy", "-w", CLI_WORKSPACE]);
        assert.strictEqual(result.code, 0, result.stderr.slice(0, 400));
        assert.ok(/refused HOOKS_ENABLED/.test(result.stderr), result.stderr.slice(0, 600));
        assert.ok(/agent --trust -w /.test(result.stderr), result.stderr.slice(0, 600));
    });

    await new Promise(resolve => setTimeout(resolve, 400));

    fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

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
