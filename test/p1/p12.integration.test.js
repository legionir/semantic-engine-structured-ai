"use strict";

/*
| Real Docker sandbox integration tests. The ordinary unit suite exercises
| launch specifications on every platform; this file is enabled only by the
| dedicated Linux CI job which owns a Docker daemon.
*/

if (process.env.RUN_SANDBOX_INTEGRATION !== "1") {
    console.log("P1-2 sandbox integration: skipped (set RUN_SANDBOX_INTEGRATION=1)");
    process.exit(0);
}

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "p1-sandbox-workspace-"));
const outside = path.join(os.homedir(), `p1-sandbox-outside-${process.pid}-${Date.now()}.txt`);
const sshDir = path.join(os.homedir(), ".ssh");
const sshSentinel = path.join(sshDir, `p1-sandbox-${process.pid}-${Date.now()}`);
const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;

process.env.WORKSPACE_ROOT = workspace;
process.env.PROCESS_SANDBOX_MODE = "docker";
process.env.PROCESS_SANDBOX_IMAGE = process.env.PROCESS_SANDBOX_IMAGE || "structured-ai-sandbox-smoke";
process.env.PROCESS_SANDBOX_NETWORK = "none";
process.env.AGENT_VERBOSE = "0";

const settings = require("../../agent/config");
const tools = require("../../agent/tools");
const run = (name, args) => tools.executeTool(name, args, { agent: "p1-sandbox-integration" });


async function main() {

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

    try {
        fs.mkdirSync(sshDir, { recursive: true });
        fs.writeFileSync(sshSentinel, "must-not-be-visible-to-container");

        await test("the sandbox reads and writes its workspace bind", async () => {
            const result = await run("terminal_exec", {
                command: `node -e ${shellQuote("require('fs').writeFileSync('/workspace/integration.txt','workspace-ok')")}`,
                timeout_ms: 30000
            });
            assert.equal(result.exit_code, 0, result.stderr);
            assert.equal(fs.readFileSync(path.join(workspace, "integration.txt"), "utf8"), "workspace-ok");
        });

        await test("host SSH files are invisible and host paths cannot be modified", async () => {
            const probe = `try { require('fs').readFileSync(${JSON.stringify(sshSentinel)}); process.exit(11) } catch {}`;
            const write = `try { require('fs').writeFileSync(${JSON.stringify(outside)},'escaped'); process.exit(12) } catch {}`;
            const result = await run("terminal_exec", {
                command: `node -e ${shellQuote(`${probe};${write}`)}`,
                timeout_ms: 30000
            });
            assert.equal(result.exit_code, 0, result.stderr);
            assert.equal(fs.existsSync(outside), false, "the host path was modified");
        });

        await test("network=none denies outbound HTTP", async () => {
            const script = "fetch('http://1.1.1.1/', { signal: AbortSignal.timeout(2000) }).then(() => process.exit(9), () => process.exit(0))";
            const result = await run("terminal_exec", {
                command: `node -e ${shellQuote(script)}`,
                timeout_ms: 10000
            });
            assert.equal(result.exit_code, 0, "outbound HTTP unexpectedly succeeded");
        });

        await test("npm, pip, and git can run when the operator explicitly enables bridge egress", async () => {
            settings.set("PROCESS_SANDBOX_NETWORK", "bridge");
            const command = [
                "npm install --prefix /tmp/p1-npm-smoke --ignore-scripts --no-audit --no-fund is-number@7",
                "python3 -m pip install --disable-pip-version-check --break-system-packages --target /tmp/p1-pip-smoke six",
                "git clone --depth 1 https://github.com/octocat/Hello-World.git /tmp/p1-git-smoke"
            ].join(" && ");
            const result = await run("terminal_exec", { command, timeout_ms: 180000 });
            assert.equal(result.exit_code, 0, `${result.stderr}\n${result.stdout}`);
            /* git clone writes its progress/status to stderr by default. */
            assert.match(`${result.stdout}\n${result.stderr}`, /Cloning into/);
        });
    } finally {
        try {
            fs.rmSync(sshSentinel, { force: true });
            fs.rmSync(outside, { force: true });
            fs.rmSync(workspace, { recursive: true, force: true });
            tools.shutdown();
        } catch {}
    }

    const failed = results.filter(ok => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    try {
        tools.shutdown();
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(sshSentinel, { force: true });
        fs.rmSync(outside, { force: true });
    } catch {}
    process.exit(1);
});
