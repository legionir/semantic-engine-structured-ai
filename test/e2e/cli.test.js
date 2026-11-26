const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

/*
| The CLI is exercised the way a user runs it: as a process, with real
| arguments, a real stub endpoint, and real exit codes.
*/

const REPO_ROOT =
    path.resolve(__dirname, "..", "..");

const BIN =
    path.join(REPO_ROOT, "bin", "agent.js");

const results = [];


function startStub(handler, { usage = null } = {}) {

    return new Promise(resolve => {

        const state = { requests: [] };

        const server =
            http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => {
                    body += chunk;
                });

                req.on("end", () => {

                    const parsed = JSON.parse(body);

                    state.requests.push(parsed);

                    res.setHeader(
                        "content-type",
                        "application/json"
                    );

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message:
                                        handler(
                                            parsed,
                                            state.requests.length
                                        )
                                }
                            ],
                            ...(usage ? { model: "gpt-4o", usage } : {})
                        })
                    );
                });
            });

        server.listen(0, "127.0.0.1", () => {

            resolve({
                state,

                port: server.address().port,

                close: () =>
                    new Promise(done => server.close(done))
            });
        });
    });
}


const action = value => ({
    role: "assistant",

    content:
        JSON.stringify({
            version: "1.0",
            tool_calls: null,
            delegations: null,
            response: null,
            data: null,
            error: null,
            ...value
        })
});


const finalAction = (text, error = null) =>
    action({
        action: "final",

        response: {
            type: "text",
            content: text
        },

        error
    });


function makeWorkspace() {

    const workspace =
        fs.mkdtempSync(
            path.join(os.tmpdir(), "agent-cli-")
        );

    fs.writeFileSync(
        path.join(workspace, "notes.txt"),
        "alpha\n"
    );

    return workspace;
}


let cliWorkspaceDir = null;

function cliWorkspace() {

    if (cliWorkspaceDir) {
        return cliWorkspaceDir;
    }

    cliWorkspaceDir =
        fs.mkdtempSync(
            path.join(os.tmpdir(), "agent-cli-root-")
        );

    return cliWorkspaceDir;
}


function runCli(args, {
    port,
    env = {},
    stdin = null
} = {}) {

    return new Promise(resolve => {

        const child =
            spawn(
                process.execPath,
                [BIN, ...args],
                {
                    cwd: REPO_ROOT,

                    env: {
                        ...process.env,

                        /* A CLI run that does not pass --workspace must not
                           write its .agent runtime state (journal, event
                           store, sessions) into the repository root; point
                           it at an isolated temp workspace instead. */
                        WORKSPACE_ROOT:
                            process.env.WORKSPACE_ROOT || cliWorkspace(),

                        MAX_EMPTY_FINAL_NUDGES: "0",

                        AGENT_BASE_URL:
                            port
                                ? `http://127.0.0.1:${port}/v1`
                                : "http://127.0.0.1:1/v1",

                        ...env
                    },

                    stdio: [
                        stdin === null
                            ? "ignore"
                            : "pipe",
                        "pipe",
                        "pipe"
                    ]
                }
            );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => {
            stdout += chunk;
        });

        child.stderr.on("data", chunk => {
            stderr += chunk;
        });

        if (stdin !== null) {

            child.stdin.write(stdin);
            child.stdin.end();
        }

        child.on(
            "close",
            code =>
                resolve({ code, stdout, stderr })
        );
    });
}


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


async function main() {

    console.log("cli");

    await test("--help exits cleanly and documents the usage", async () => {

        const run = await runCli(["--help"]);

        assert.equal(run.code, 0);
        assert.match(run.stdout, /Usage/);
        assert.match(run.stdout, /--workspace/);
        assert.match(run.stdout, /Exit codes/);
    });

    await test("--version prints the package version", async () => {

        const run = await runCli(["--version"]);

        assert.equal(run.code, 0);
        assert.match(run.stdout.trim(), /^\d+\.\d+\.\d+$/);
    });

    await test("PORT starts the web console automatically without --serve", async () => {

        const workspace = makeWorkspace();
        const dataHome = path.join(workspace, "data-home");
        const probe = http.createServer();
        await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
        const port = probe.address().port;
        await new Promise(resolve => probe.close(resolve));

        const child = spawn(process.execPath, [BIN], {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                PORT: String(port),
                WORKSPACE_ROOT: workspace,
                STRUCTURED_AI_DATA_HOME: dataHome,
                AGENT_VERBOSE: "0",
                AGENT_PRINT_FINAL: "0",
                AGENT_APPROVAL: "prompt"
            },
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        const exited = new Promise(resolve => child.once("exit", resolve));

        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`console did not start: ${stderr}`)), 10000);
                const checkReady = () => {
                    if (stdout.includes("structured-ai console")) {
                        clearTimeout(timer);
                        resolve();
                    }
                };
                child.stdout.on("data", checkReady);
                checkReady();
                child.once("error", error => {
                    clearTimeout(timer);
                    reject(error);
                });
                child.once("exit", code => {
                    clearTimeout(timer);
                    reject(new Error(`CLI exited before binding (${code}): ${stderr}`));
                });
            });

            assert.match(stdout, new RegExp(`http://localhost:${port}`));
            const status = await fetch(`http://127.0.0.1:${port}/auth/status`);
            assert.equal(status.status, 200);
            assert.equal((await status.json()).passwordRequired, false);
        } finally {
            child.kill("SIGTERM");
            await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
            fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    });

    await test("doctor reports the configured sandbox without loading the agent loop", async () => {

        const run = await runCli(["doctor"], {
            env: { PROCESS_SANDBOX_MODE: "deny" }
        });

        assert.strictEqual(run.code, 0);
        assert.match(run.stdout, /Structured AI sandbox diagnostics/);
        assert.match(run.stdout, /Mode: deny/);
        assert.match(run.stdout, /Process tools are denied/);
    });

    await test("--doctor is an alias for the doctor command", async () => {

        const run = await runCli(["--doctor"], {
            env: { PROCESS_SANDBOX_MODE: "deny" }
        });

        assert.strictEqual(run.code, 0);
        assert.match(run.stdout, /Status: disabled/);
    });

    await test("doctor rejects an extra task argument", async () => {

        const run = await runCli(["doctor", "run something"]);

        assert.strictEqual(run.code, 2);
        assert.match(run.stderr, /doctor does not accept a task/);
    });

    await test("an unknown option is a usage error", async () => {

        const run = await runCli(["--nope"]);

        assert.equal(run.code, 2);
        assert.match(run.stderr, /unknown option --nope/);
    });

    await test("an option missing its value is a usage error", async () => {

        const run = await runCli(["--workspace"]);

        assert.equal(run.code, 2);
        assert.match(run.stderr, /requires a value/);
    });

    await test("an invalid approval mode is a usage error", async () => {

        const run = await runCli(["--approve", "maybe", "task"]);

        assert.equal(run.code, 2);
        assert.match(run.stderr, /auto, prompt or deny/);
    });

    await test("a missing workspace is a usage error", async () => {

        const run =
            await runCli([
                "--workspace",
                "/definitely/not/here",
                "task"
            ]);

        assert.equal(run.code, 2);
        assert.match(run.stderr, /not a directory/);
    });

    await test("--list-tools prints the catalogue", async () => {

        const run = await runCli(["--list-tools"]);

        assert.equal(run.code, 0);
        assert.match(run.stdout, /filesystem\.read/);
        assert.match(run.stdout, /destructive/);
        assert.match(run.stdout, /\d+ tools in \d+ groups/);
        assert.match(run.stdout, /planning/);
    });

    await test("--list-agents and --list-policy print the registries", async () => {

        const agents = await runCli(["--list-agents"]);

        assert.equal(agents.code, 0);
        assert.match(agents.stdout, /git_analysis/);
        assert.match(agents.stdout, /delegation : not allowed/);

        const policy = await runCli(["--list-policy"]);

        assert.equal(policy.code, 0);
        assert.match(policy.stdout, /deny/);
        assert.match(policy.stdout, /destroys data outside the workspace/);
    });

    await test("a task given as an argument reaches the model", async () => {

        const stub =
            await startStub(() => finalAction("acknowledged"));

        const workspace = makeWorkspace();

        const run =
            await runCli(
                [
                    "--workspace", workspace,
                    "--quiet",
                    "count the files in the project"
                ],
                { port: stub.port }
            );

        await stub.close();

        assert.equal(run.code, 0);

        const userMessage =
            stub.state.requests[0].messages.find(
                message => message.role === "user"
            );

        assert.equal(
            userMessage.content,
            "count the files in the project"
        );

        /* the human readable answer lands on stdout */
        assert.match(run.stdout, /acknowledged/);

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("a task can be piped on stdin", async () => {

        const stub =
            await startStub(() => finalAction("piped ok"));

        const workspace = makeWorkspace();

        const run =
            await runCli(
                ["--workspace", workspace, "--quiet"],
                {
                    port: stub.port,
                    stdin: "review the changes\n"
                }
            );

        await stub.close();

        const userMessage =
            stub.state.requests[0].messages.find(
                message => message.role === "user"
            );

        assert.equal(
            userMessage.content,
            "review the changes"
        );

        assert.equal(run.code, 0);

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("a task can be read from a file", async () => {

        const stub =
            await startStub(() => finalAction("from file"));

        const workspace = makeWorkspace();

        const taskFile =
            path.join(workspace, "task.md");

        fs.writeFileSync(taskFile, "audit the dependencies");

        const run =
            await runCli(
                [
                    "--workspace", workspace,
                    "--quiet",
                    "--file", taskFile
                ],
                { port: stub.port }
            );

        await stub.close();

        const userMessage =
            stub.state.requests[0].messages.find(
                message => message.role === "user"
            );

        assert.equal(
            userMessage.content,
            "audit the dependencies"
        );

        assert.equal(run.code, 0);

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--json puts only the action on stdout", async () => {

        const stub =
            await startStub(() => finalAction("structured"));

        const workspace = makeWorkspace();

        const run =
            await runCli(
                [
                    "--workspace", workspace,
                    "--json",
                    "summarise"
                ],
                { port: stub.port }
            );

        await stub.close();

        assert.equal(run.code, 0);

        const parsed =
            JSON.parse(run.stdout);

        assert.equal(parsed.action, "final");
        assert.equal(parsed.response.content, "structured");

        /* progress must not pollute stdout */
        assert.equal(
            run.stdout.includes("Agent Iteration"),
            false
        );

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--workspace confines the agent", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "call_1",
                                name: "fs_list",
                                arguments: { path: "." },
                                depends_on: []
                            }
                        ]
                    });
                }

                return finalAction("listed");
            });

        const workspace = makeWorkspace();

        const run =
            await runCli(
                ["--workspace", workspace, "--quiet", "list"],
                { port: stub.port }
            );

        await stub.close();

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        const names =
            toolMessage.result.entries.map(
                entry => entry.name
            );

        /* .agent is the runtime's own bookkeeping inside the workspace */
        assert.deepEqual(
            names.filter(name => name !== ".agent"),
            ["notes.txt"]
        );

        assert.equal(run.code, 0);

        /* opening a workspace leaves a project file behind */
        assert.equal(
            fs.existsSync(
                path.join(workspace, ".agent", "project.json")
            ),
            true
        );

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("a flag belongs to the run, a setting belongs to the project", async () => {

        const stub =
            await startStub(() => finalAction("done"));

        const workspace = makeWorkspace();

        /* --quiet is a flag for this run */
        await runCli(
            ["--workspace", workspace, "--quiet", "say hello"],
            { port: stub.port }
        );

        const file =
            path.join(workspace, ".agent", "project.json");

        const saved =
            JSON.parse(fs.readFileSync(file, "utf8"));

        assert.equal(
            saved.settings.AGENT_VERBOSE,
            undefined,
            "a command line flag was written into the project file"
        );

        /* a value the project itself carries is applied on the next run */
        saved.settings.MAX_PARALLEL_TOOLS = 2;

        fs.writeFileSync(
            file,
            `${JSON.stringify(saved, null, 2)}\n`
        );

        const second =
            await runCli(
                ["--workspace", workspace, "say hello again"],
                { port: stub.port }
            );

        assert.match(
            second.stderr,
            /applied 1 saved setting/
        );

        await stub.close();

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--dry-run refuses calls that need approval", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "call_1",
                                name: "fs_write",
                                arguments: {
                                    path: "created.txt",
                                    content: "x"
                                },
                                depends_on: []
                            }
                        ]
                    });
                }

                return finalAction("nothing was written");
            });

        const workspace = makeWorkspace();

        const run =
            await runCli(
                ["--workspace", workspace, "--dry-run", "write a file"],
                { port: stub.port }
            );

        await stub.close();

        assert.match(run.stderr, /dry run/);

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        assert.match(
            toolMessage.error.message,
            /requires approval/
        );

        assert.equal(
            fs.existsSync(
                path.join(workspace, "created.txt")
            ),
            false
        );

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("a final action carrying an error exits non-zero", async () => {

        const stub =
            await startStub(() =>
                finalAction(
                    "could not finish",
                    {
                        code: "E_FAILED",
                        message: "the build is broken",
                        retryable: false
                    }
                )
            );

        const workspace = makeWorkspace();

        const run =
            await runCli(
                ["--workspace", workspace, "--quiet", "build"],
                { port: stub.port }
            );

        await stub.close();

        assert.equal(run.code, 1);

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("an unreachable endpoint fails with a clear message", async () => {

        const workspace = makeWorkspace();

        const run =
            await runCli(
                [
                    "--workspace", workspace,
                    "--quiet",
                    "--timeout", "3",
                    "anything"
                ],
                {
                    env: {
                        MAX_REQUEST_RETRIES: "0"
                    }
                }
            );

        assert.equal(run.code, 1);
        assert.match(run.stderr, /run failed/);

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--json reports a failure as a structured action", async () => {

        const workspace = makeWorkspace();

        const run =
            await runCli(
                [
                    "--workspace", workspace,
                    "--json",
                    "--timeout", "3",
                    "anything"
                ],
                {
                    env: {
                        MAX_REQUEST_RETRIES: "0"
                    }
                }
            );

        assert.equal(run.code, 1);

        const parsed =
            JSON.parse(run.stdout);

        assert.equal(parsed.action, "final");
        assert.ok(parsed.error.message.length > 0);

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("a run without --workspace does not write runtime state into the repo root", async () => {

        const stub =
            await startStub(() => finalAction("ok"));

        const repoAgent =
            path.join(REPO_ROOT, ".agent");

        fs.rmSync(repoAgent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

        try {

            const run =
                await runCli(
                    ["--quiet", "say hello"],
                    { port: stub.port }
                );

            await stub.close();

            assert.equal(run.code, 0);

            assert.equal(
                fs.existsSync(repoAgent),
                false,
                "no .agent runtime state leaked into the repository root"
            );

        } finally {

            fs.rmSync(repoAgent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    });


    /* ------------------------------------------- headless / CI (P3-07) */

    const writeSchema = workspace => {
        const file = path.join(workspace, "schema.json");
        fs.writeFileSync(file, JSON.stringify({
            type: "object",
            required: ["status", "files"],
            properties: {
                status: { enum: ["ok", "fail"] },
                files: { type: "array", items: { type: "string" } }
            }
        }));
        return file;
    };

    await test("--json-schema: a conforming answer is printed alone and exits 0", async () => {

        const stub = await startStub(() => finalAction("Here it is:\n```json\n{\"status\":\"ok\",\"files\":[\"a.js\"]}\n```"));
        const workspace = makeWorkspace();

        const run = await runCli(["--workspace", workspace, "--quiet", "--json-schema", writeSchema(workspace), "list files"], { port: stub.port });
        await stub.close();

        assert.equal(run.code, 0, run.stderr);
        assert.deepEqual(JSON.parse(run.stdout), { status: "ok", files: ["a.js"] });

        const prompt = JSON.stringify(stub.state.requests[0].messages);
        assert.ok(prompt.includes("Output contract"), "the schema travels with the task");

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--json-schema: a violating answer exits 3 with the violations", async () => {

        const stub = await startStub(() => finalAction("{\"status\":\"maybe\"}"));
        const workspace = makeWorkspace();

        const run = await runCli(["--workspace", workspace, "--quiet", "--json-schema", writeSchema(workspace), "list files"], { port: stub.port });
        await stub.close();

        assert.equal(run.code, 3, run.stderr);
        const report = JSON.parse(run.stdout);
        assert.ok(report.violations.some(item => /missing required property files/.test(item)));
        assert.ok(report.violations.some(item => /must be one of/.test(item)));

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--json-schema: an unreadable schema is a usage error", async () => {

        const workspace = makeWorkspace();
        const run = await runCli(["--workspace", workspace, "--json-schema", path.join(workspace, "missing.json"), "x"]);

        assert.equal(run.code, 2);
        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--max-cost: spending the budget exits 4", async () => {

        const stub = await startStub(
            (body, count) => action({
                action: "tool_call",
                tool_calls: [{ id: `r${count}`, name: "fs_read", arguments: { path: "notes.txt" }, depends_on: [] }]
            }),
            { usage: { prompt_tokens: 2000, completion_tokens: 500 } }
        );
        const workspace = makeWorkspace();

        const run = await runCli(
            ["--workspace", workspace, "--quiet", "--max-cost", "0.02", "read forever"],
            { port: stub.port, env: { AGENT_MODEL: "gpt-4o" } }
        );
        await stub.close();

        assert.equal(run.code, 4, run.stderr);
        assert.match(run.stderr, /cost cap of \$0\.02 was reached/);
        assert.ok(stub.state.requests.length <= 3, "the run stopped at the cap");

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("--max-cost rejects a negative budget", async () => {

        const negative = await runCli(["--max-cost", "-1", "x"]);
        assert.equal(negative.code, 2);

        const text = await runCli(["--max-cost", "lots", "x"]);
        assert.equal(text.code, 2);
    });

    await test("--plan refuses writes for the run", async () => {

        const stub = await startStub((body, count) => count === 1
            ? action({ action: "tool_call", tool_calls: [{ id: "w1", name: "fs_write", arguments: { path: "out.txt", content: "x" }, depends_on: [] }] })
            : finalAction("Plan: write out.txt"));
        const workspace = makeWorkspace();

        const run = await runCli(["--workspace", workspace, "--quiet", "--plan", "write out.txt"], { port: stub.port });
        await stub.close();

        assert.equal(run.code, 0, run.stderr);
        assert.equal(fs.existsSync(path.join(workspace, "out.txt")), false);
        assert.ok(JSON.stringify(stub.state.requests[1].messages).includes("plan mode: the plan has not been approved yet"));

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("review: usage errors and a project without git", async () => {

        const badTarget = await runCli(["review", "everything"]);
        assert.equal(badTarget.code, 2);
        assert.match(badTarget.stderr, /review target must be/);

        const noNumber = await runCli(["review", "pr"]);
        assert.equal(noNumber.code, 2);
        assert.match(noNumber.stderr, /pull request number/);

        const workspace = makeWorkspace();
        const plain = await runCli(["--workspace", workspace, "review"]);
        assert.equal(plain.code, 2);
        assert.match(plain.stderr, /not a git repository/);
        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    await test("review: findings are printed and a high finding exits 1", async () => {

        const stub = await startStub(() => ({
            role: "assistant",
            content: JSON.stringify({ summary: "risky", findings: [{ severity: "high", file: "notes.txt", line: 1, title: "wrong text", detail: "d", suggestion: "s" }] })
        }));
        const workspace = makeWorkspace();
        const git = args => require("child_process").execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
        git(["init", "-q"]);
        git(["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
        git(["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "init"]);
        fs.writeFileSync(path.join(workspace, "notes.txt"), "beta\n");

        const run = await runCli(["--workspace", workspace, "review"], { port: stub.port });
        const json = await runCli(["--workspace", workspace, "review", "--json"], { port: stub.port });
        await stub.close();

        assert.equal(run.code, 1, run.stderr);
        assert.match(run.stdout, /\[high\] notes\.txt:1/);
        assert.equal(JSON.parse(json.stdout).findings[0].severity, "high");
        assert.ok(JSON.stringify(stub.state.requests[0].messages).includes("+beta"));

        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
