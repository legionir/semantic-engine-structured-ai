"use strict";

/*
|--------------------------------------------------------------------------
| P0-8: close remaining P0 gaps
|--------------------------------------------------------------------------
|
|   (a) a repository-committed MCP configuration (.mcp.json and
|       .agent/mcp.json) does not expand ${ENV} placeholders unless the
|       operator trusted the workspace; operator configuration
|       (MCP_SERVERS, registry, runtime) still does
|   (b) AGENT_APPROVAL=prompt denies, never auto-approves, when there is
|       no TTY and no interactive approver; an approver that fails, gives
|       a non-boolean answer, or a terminal that closes, is a refusal
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "p08-"));
const WORKSPACE = path.join(BASE, "workspace");
const DATA_HOME = path.join(BASE, "data");
const TRUST_FILE = path.join(BASE, "config", "trusted-workspaces.json");

fs.mkdirSync(path.join(WORKSPACE, ".agent"), { recursive: true });
fs.mkdirSync(DATA_HOME, { recursive: true });

for (const key of ["AGENT_APPROVAL", "MCP_SERVERS", "MCP_TRUST_PROJECT_CONFIG"]) {
    delete process.env[key];
}

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.STRUCTURED_AI_TRUST_FILE = TRUST_FILE;

const SECRET = "p08-s3cret-value";
process.env.P08_TOKEN = SECRET;

const results = [];

async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.stack}`);
    }
}


/* Every place a definition can carry a value: url, header, token,
   command argument and child environment. */
function repositoryDocument(prefix) {

    return {
        mcpServers: {
            [`${prefix}_http`]: {
                url: "https://example.com/mcp?key=${P08_TOKEN}",
                headers: { authorization: "Bearer ${env:P08_TOKEN}" }
            },
            [`${prefix}_token`]: {
                url: "https://example.com/mcp",
                token: "${env:P08_TOKEN}"
            },
            [`${prefix}_stdio`]: {
                command: "node",
                args: ["server.js", "--key=${P08_TOKEN}"],
                env: { API_KEY: "${env:P08_TOKEN}" }
            },
            [`${prefix}_plain`]: {
                url: "https://example.com/plain"
            }
        }
    };
}


function writeRepositoryFiles() {

    fs.writeFileSync(
        path.join(WORKSPACE, ".mcp.json"),
        JSON.stringify(repositoryDocument("repo")),
        "utf8"
    );

    fs.writeFileSync(
        path.join(WORKSPACE, ".agent", "mcp.json"),
        JSON.stringify(repositoryDocument("agent")),
        "utf8"
    );
}


function runChild(script, env = {}) {

    return new Promise((resolve, reject) => {

        const child = spawn(process.execPath, ["-e", script], {
            cwd: REPO,
            env: {
                ...process.env,
                WORKSPACE_ROOT: WORKSPACE,
                STRUCTURED_AI_DATA_HOME: DATA_HOME,
                STRUCTURED_AI_TRUST_FILE: TRUST_FILE,
                ...env
            },
            stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });

        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`child timed out\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, 20000);

        child.on("error", reject);

        child.on("close", code => {

            clearTimeout(timer);

            const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";

            try {
                resolve({ code, result: JSON.parse(line), stdout, stderr });
            } catch {
                reject(new Error(`child printed no result (exit ${code})\nstdout: ${stdout}\nstderr: ${stderr}`));
            }
        });

        /* no TTY and no input: the operator is not there */
        child.stdin.end();
    });
}


async function main() {

    console.log("P0-8: close remaining P0 gaps");

    const WorkspaceTrust = require(path.join(REPO, "agent", "projects", "WorkspaceTrust"));
    const validator = require(path.join(REPO, "agent", "mcp", "McpConfigValidator"));
    const loader = require(path.join(REPO, "agent", "mcp", "McpConfigLoader"));
    const { createApprovalHandler } = require(path.join(REPO, "agent", "interactive", "ApprovalPrompt"));

    /* ----------------------------------------------------------- (a) */

    await test("(a) untrusted workspace: neither .mcp.json nor .agent/mcp.json expands ${ENV}", () => {

        WorkspaceTrust.revoke(WORKSPACE);
        writeRepositoryFiles();

        assert.equal(WorkspaceTrust.isTrusted(WORKSPACE), false);

        const loaded = loader.load(WORKSPACE);
        const names = loaded.servers.map(server => server.name);

        for (const prefix of ["repo", "agent"]) {

            for (const kind of ["http", "token", "stdio"]) {

                assert.equal(
                    names.includes(`${prefix}_${kind}`),
                    false,
                    `${prefix}_${kind} was loaded from an untrusted repository file`
                );
            }

            assert.ok(
                names.includes(`${prefix}_plain`),
                `${prefix}_plain (no placeholder) should still load`
            );
        }

        assert.match(loaded.problems.join("\n"), /placeholder/);
        assert.match(loaded.problems.join("\n"), /mcp\.json/);
        assert.doesNotMatch(JSON.stringify(loaded), new RegExp(SECRET));
    });

    await test("(a) the validator refuses placeholders for both repository sources of an untrusted workspace", () => {

        WorkspaceTrust.revoke(WORKSPACE);

        for (const source of [validator.SOURCES.PROJECT, validator.SOURCES.WORKSPACE]) {

            const context = { source, origin: "p08", workspaceRoot: WORKSPACE };

            assert.equal(validator.expandsEnvironment(context), false, source);

            assert.throws(
                () => validator.normalize(
                    "x",
                    { url: "https://example.com/mcp", headers: { a: "${P08_TOKEN}" } },
                    context
                ),
                /placeholder/,
                source
            );

            /* no workspace root at all: still untrusted */
            assert.equal(validator.expandsEnvironment({ source }), false, `${source} without root`);
        }
    });

    await test("(a) a trusted workspace expands placeholders in both repository files", () => {

        writeRepositoryFiles();
        WorkspaceTrust.trust(WORKSPACE, { by: "p08" });

        try {

            const loaded = loader.load(WORKSPACE);
            const byName = new Map(loaded.servers.map(server => [server.name, server]));

            for (const prefix of ["repo", "agent"]) {

                assert.equal(byName.get(`${prefix}_http`).headers.authorization, `Bearer ${SECRET}`, prefix);
                assert.equal(byName.get(`${prefix}_http`).url, `https://example.com/mcp?key=${SECRET}`, prefix);
                assert.equal(byName.get(`${prefix}_token`).token, SECRET, prefix);
                assert.deepEqual(byName.get(`${prefix}_stdio`).args, ["server.js", `--key=${SECRET}`], prefix);
                assert.equal(byName.get(`${prefix}_stdio`).env.API_KEY, SECRET, prefix);
            }

            /* the files keep the placeholder, never the value */
            assert.doesNotMatch(fs.readFileSync(path.join(WORKSPACE, ".mcp.json"), "utf8"), new RegExp(SECRET));
            assert.doesNotMatch(fs.readFileSync(path.join(WORKSPACE, ".agent", "mcp.json"), "utf8"), new RegExp(SECRET));

        } finally {

            WorkspaceTrust.revoke(WORKSPACE);
        }
    });

    await test("(a) revoking trust refuses the placeholders again", () => {

        writeRepositoryFiles();
        WorkspaceTrust.trust(WORKSPACE);
        assert.ok(WorkspaceTrust.revoke(WORKSPACE));

        const loaded = loader.load(WORKSPACE);

        assert.equal(loaded.servers.some(server => server.name === "agent_http"), false);
        assert.equal(loaded.servers.some(server => server.name === "repo_http"), false);
        assert.doesNotMatch(JSON.stringify(loaded), new RegExp(SECRET));
    });

    await test("(a) operator configuration (MCP_SERVERS, registry, runtime) still expands", () => {

        WorkspaceTrust.revoke(WORKSPACE);

        for (const source of [
            validator.SOURCES.ENVIRONMENT,
            validator.SOURCES.REGISTRY,
            validator.SOURCES.RUNTIME
        ]) {

            const config =
                validator.normalize(
                    "operator",
                    { url: "https://example.com/mcp", headers: { authorization: "Bearer ${env:P08_TOKEN}" } },
                    { source, origin: "p08", workspaceRoot: WORKSPACE }
                );

            assert.equal(config.headers.authorization, `Bearer ${SECRET}`, source);
        }

        const runtimeConfig =
            validator.normalizeOne("rt", { url: "https://example.com/mcp", token: "${P08_TOKEN}" }, WORKSPACE);

        assert.equal(runtimeConfig.token, SECRET);
    });

    await test("(a) MCP_SERVERS in the environment expands for an untrusted workspace", async () => {

        WorkspaceTrust.revoke(WORKSPACE);

        const { result } = await runChild(
            `
            const loader = require("./agent/mcp/McpConfigLoader");
            const loaded = loader.load(process.env.WORKSPACE_ROOT);
            const server = loaded.servers.find(s => s.name === "from_env");
            console.log(JSON.stringify({ header: server ? server.headers.authorization : null }));
            `,
            {
                MCP_SERVERS: JSON.stringify({
                    mcpServers: {
                        from_env: {
                            url: "https://example.com/mcp",
                            headers: { authorization: "Bearer ${env:P08_TOKEN}" }
                        }
                    }
                })
            }
        );

        assert.equal(result.header, `Bearer ${SECRET}`);
    });

    /* ----------------------------------------------------------- (b) */

    const managerScript = body => `
        const { ApprovalManager } = require("./agent/policy/ApprovalManager");
        const { ApprovalStore } = require("./agent/policy/ApprovalStore");
        const out = {};
        (async () => {
            ${body}
        })().then(
            () => console.log(JSON.stringify(out)),
            error => console.log(JSON.stringify({ crashed: String(error && error.stack) }))
        );
    `;

    await test("(b) AGENT_APPROVAL=prompt with no TTY and no approver denies (real settings)", async () => {

        const { result } = await runChild(
            managerScript(`
                const manager = new ApprovalManager({ store: new ApprovalStore() });
                manager.setHandler(null);
                out.mode = manager.getMode();
                out.isTTY = Boolean(process.stdin.isTTY);
                try {
                    await manager.request({ tool: "process_start", agent: "main_agent", reason: "p08" }, { command: "echo hi" });
                    out.approved = true;
                } catch (error) {
                    out.approved = false;
                    out.error = error.message;
                }
                out.records = manager.approvals.map(r => ({ approved: r.approved, mode: r.mode }));
            `),
            { AGENT_APPROVAL: "prompt" }
        );

        assert.equal(result.crashed, undefined, result.crashed);
        assert.equal(result.mode, "prompt");
        assert.equal(result.isTTY, false);
        assert.equal(result.approved, false, "prompt mode approved without a TTY");
        assert.match(result.error, /interactive approval|TTY/i);
        assert.deepEqual(result.records, [{ approved: false, mode: "prompt (no tty)" }]);
    });

    await test("(b) the policy engine refuses an approval-needing tool under prompt with no TTY", async () => {

        const { result } = await runChild(
            `
            const { PolicyEngine } = require("./agent/policy/PolicyEngine");
            const decisions = [];
            const engine = new PolicyEngine({
                policy: require("./agent/registry/policy.json"),
                toolGroups: require("./agent/registry/tool_groups.json"),
                onDecision: d => decisions.push({ decision: d.decision, approved: d.approved })
            });
            engine.approvalManager.setHandler(null);
            (async () => {
                const out = { mode: engine.approvalManager.getMode() };
                try {
                    await engine.enforce("process_start", { command: "echo p08" }, "main_agent");
                    out.allowed = true;
                } catch (error) {
                    out.allowed = false;
                    out.error = error.message;
                }
                out.decisions = decisions;
                console.log(JSON.stringify(out));
            })();
            `,
            { AGENT_APPROVAL: "prompt" }
        );

        assert.equal(result.mode, "prompt");
        assert.equal(result.allowed, false, "a shell command ran under prompt mode with nobody to ask");
        assert.ok(
            result.decisions.some(d => d.approved === false),
            `the denial is audited: ${JSON.stringify(result.decisions)}`
        );
    });

    await test("(b) a closed terminal answers no instead of hanging", async () => {

        const { result } = await runChild(
            managerScript(`
                const manager = new ApprovalManager({ store: new ApprovalStore() });
                const started = Date.now();
                out.answer = await manager.prompt({ tool: "fs_write", agent: "a", reason: "p08" }, {});
                out.ms = Date.now() - started;
            `)
        );

        assert.equal(result.crashed, undefined, result.crashed);
        assert.equal(result.answer, false);
        assert.ok(result.ms < 10000, `took ${result.ms}ms`);
    });

    await test("(b) only an explicit true from the approver approves; failures are recorded refusals", async () => {

        const { ApprovalManager } = require(path.join(REPO, "agent", "policy", "ApprovalManager"));
        const { ApprovalStore } = require(path.join(REPO, "agent", "policy", "ApprovalStore"));

        const promptSettings = { get: key => (key === "AGENT_APPROVAL" ? "prompt" : null), set() {} };
        const manager = new ApprovalManager({ settingsStore: promptSettings, store: new ApprovalStore() });
        const evaluation = { tool: "fs_write", agent: "main_agent", reason: "p08" };

        try {

            for (const answer of ["yes", 1, {}, "true", null, undefined]) {

                manager.setHandler(async () => answer);

                await assert.rejects(
                    () => manager.request(evaluation, {}),
                    error => /denied|refused|approval/i.test(error.message),
                    `answer ${JSON.stringify(answer)} approved`
                );
            }

            manager.setHandler(async () => { throw new Error("approver crashed"); });

            await assert.rejects(() => manager.request(evaluation, {}), /approver crashed/);

            const last = manager.approvals[manager.approvals.length - 1];

            assert.equal(last.approved, false);
            assert.equal(last.mode, "prompt (approver failed)");

            manager.setHandler(async () => true);

            const approved = await manager.request(evaluation, {});

            assert.equal(approved.approved, true);
            assert.equal(approved.mode, "prompt");

        } finally {

            manager.setHandler(null);
        }
    });

    await test("(b) an unknown approval mode fails closed; auto still approves", async () => {

        const { ApprovalManager } = require(path.join(REPO, "agent", "policy", "ApprovalManager"));
        const { ApprovalStore } = require(path.join(REPO, "agent", "policy", "ApprovalStore"));

        const evaluation = { tool: "fs_write", agent: "main_agent", reason: "p08" };

        for (const mode of ["Prompt", "ask", "", null, undefined, "AUTO"]) {

            const manager =
                new ApprovalManager({
                    settingsStore: { get: key => (key === "AGENT_APPROVAL" ? mode : null), set() {} },
                    store: new ApprovalStore()
                });

            manager.setHandler(null);

            await assert.rejects(
                () => manager.request(evaluation, {}),
                /refused|denied|approval|TTY/i,
                `mode ${JSON.stringify(mode)} approved`
            );

            assert.equal(manager.approvals[0].approved, false, `mode ${JSON.stringify(mode)}`);
        }

        const auto =
            new ApprovalManager({
                settingsStore: { get: key => (key === "AGENT_APPROVAL" ? "auto" : null), set() {} },
                store: new ApprovalStore()
            });

        const record = await auto.request(evaluation, {});

        assert.equal(record.approved, true);
        assert.equal(record.mode, "auto");
    });

    await test("(b) the interactive session refuses approvals when it reads a pipe, not a TTY", async () => {

        const written = [];
        let asked = 0;

        const colours = new Proxy({}, { get: () => text => text });

        const piped =
            createApprovalHandler({
                readAnswer: async () => { asked += 1; return "y"; },
                colours,
                output: { write: text => written.push(text) },
                interactive: false
            });

        assert.equal(await piped({ tool: "fs_write", agent: "a", reason: "r" }, {}), false);
        assert.equal(asked, 0, "a piped 'y' was read as an approval");
        assert.match(written.join(""), /refused/);

        const tty =
            createApprovalHandler({
                readAnswer: async () => { asked += 1; return "y"; },
                colours,
                output: { write: text => written.push(text) }
            });

        assert.equal(await tty({ tool: "fs_write", agent: "a", reason: "r" }, {}), true);
        assert.equal(asked, 1);
    });

    const failed = results.filter(result => !result.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length) {
        process.exitCode = 1;
    }
}


setTimeout(() => {
    console.log("  FAIL global timeout (120s) reached");
    process.exit(1);
}, 120000).unref();

main().then(
    () => {
        try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best effort */ }
        setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
    },
    error => {
        console.log(`  FAIL ${error && error.stack}`);
        process.exit(1);
    }
);
