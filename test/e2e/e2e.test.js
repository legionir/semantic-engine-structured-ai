const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

/*
| These tests drive the real agent loop against a stub OpenAI-compatible
| server, so the protocol, the execution graph, delegation, policy, and
| retry behaviour are exercised the way a real endpoint would exercise
| them. The agent runs as a child process, exactly as it ships.
*/

const REPO_ROOT =
    path.resolve(__dirname, "..", "..");

const results = [];


function startStub(handler) {

    return new Promise(resolve => {

        const state = {
            requests: [],
            log: []
        };

        const server =
            http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => {
                    body += chunk;
                });

                req.on("end", () => {

                    const parsed =
                        JSON.parse(body);

                    state.requests.push(parsed);

                    const reply =
                        handler(
                            parsed,
                            state.requests.length,
                            state
                        );

                    if (reply.delayMs) {

                        setTimeout(
                            () => {

                                res.setHeader(
                                    "content-type",
                                    "application/json"
                                );

                                res.end(
                                    JSON.stringify({
                                        choices: [
                                            {
                                                message: reply.message,
                                                finish_reason:
                                                    reply.finish_reason
                                            }
                                        ],
                                        usage: reply.usage
                                    })
                                );
                            },
                            reply.delayMs
                        );

                        return;
                    }

                    if (reply.status && reply.status !== 200) {

                        res.writeHead(
                            reply.status,
                            reply.headers || {
                                "content-type": "application/json"
                            }
                        );

                        res.end(
                            JSON.stringify(
                                reply.body || {
                                    error: "stub failure"
                                }
                            )
                        );

                        return;
                    }

                    res.setHeader(
                        "content-type",
                        "application/json"
                    );

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message: reply.message,
                                    finish_reason:
                                        reply.finish_reason
                                }
                            ],
                            usage: reply.usage
                        })
                    );
                });
            });

        server.listen(0, "127.0.0.1", () => {

            resolve({
                state,

                port:
                    server.address().port,

                close:
                    () =>
                        new Promise(
                            done => server.close(done)
                        )
            });
        });
    });
}


const action = value =>({
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


const finalAction = text =>
    action({
        action: "final",

        response: {
            type: "text",
            content: text
        }
    });


function runAgent(port, env = {}, setupWorkspace = null) {

    const workspace =
        fs.mkdtempSync(
            path.join(os.tmpdir(), "agent-e2e-")
        );

    fs.writeFileSync(
        path.join(workspace, "notes.txt"),
        "alpha\nbeta\ngamma\n"
    );

    fs.writeFileSync(
        path.join(workspace, "bulk.txt"),
        "x".repeat(40000)
    );

    if (typeof setupWorkspace === "function") {
        setupWorkspace(workspace);
    }

    return new Promise(resolve => {

        const child =
            spawn(
                process.execPath,
                [path.join(REPO_ROOT, "agent", "agent.js")],
                {
                    cwd: REPO_ROOT,

                    env: {
                        ...process.env,

                        WORKSPACE_ROOT: workspace,

                        AGENT_BASE_URL:
                            `http://127.0.0.1:${port}/v1`,

                        AGENT_VERBOSE: "1",

                        AGENT_APPROVAL: "auto",

                        PROCESS_SANDBOX_MODE: "test",

                        MAX_RUN_MS: "30000",

                        ...env
                    }
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

        child.on("close", code => {

            resolve({
                code,
                stdout,
                stderr,
                workspace,

                cleanup: () =>
                    fs.rmSync(
                        workspace,
                        {
                            recursive: true,
                            force: true
                        }
                    )
            });
        });
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

    /* the cases live in ./e2e-cases, run in this order */
    const ctx = {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    };

    await require("./e2e-cases/01-end-to-end")(ctx);
    await require("./e2e-cases/02-a-refusal-without-any-work-is")(ctx);
    await require("./e2e-cases/03-a-final-answer-is-refused-while")(ctx);
    await require("./e2e-cases/04-native-openai-tool-calls-are-accepted")(ctx);
    await require("./e2e-cases/05-the-conversation-stays-inside-the-context")(ctx);
    await require("./e2e-cases/06-a-retry-that-fixes-the-action")(ctx);
    await require("./e2e-cases/07-a-malformed-action-receives-an-exact")(ctx);
    await require("./e2e-cases/08-a-delegation-that-fails-says-so")(ctx);
    await require("./e2e-cases/09-an-agent-that-delegates-is-never")(ctx);
    await require("./e2e-cases/10-agent-hooks-use-registered-profiles-and")(ctx);


    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
