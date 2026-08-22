const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

/*
| The interactive session is driven the way a user drives it: lines on
| stdin, in order, including the answers to approval questions.
*/

const REPO_ROOT =
    path.resolve(__dirname, "..");

const BIN =
    path.join(REPO_ROOT, "bin", "agent.js");

const results = [];


function startStub(handler) {

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

                    const reply =
                        handler(parsed, state.requests.length);

                    const send = () => {

                        res.setHeader(
                            "content-type",
                            "application/json"
                        );

                        res.end(
                            JSON.stringify({
                                choices: [
                                    { message: reply.message || reply }
                                ]
                            })
                        );
                    };

                    if (reply.delayMs) {

                        setTimeout(send, reply.delayMs);

                        return;
                    }

                    send();
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


const finalAction = text =>
    action({
        action: "final",

        response: {
            type: "text",
            content: text
        }
    });


const writeCall = fileName =>
    action({
        action: "tool_call",

        tool_calls: [
            {
                id: "w1",
                name: "fs_write",
                arguments: {
                    path: fileName,
                    content: "written\n"
                },
                depends_on: []
            }
        ]
    });


function makeWorkspace() {

    const workspace =
        fs.mkdtempSync(
            path.join(os.tmpdir(), "agent-repl-")
        );

    fs.writeFileSync(
        path.join(workspace, "app.js"),
        "const x = 1;\n"
    );

    return workspace;
}


function runSession(lines, {
    port,
    workspace,
    args = [],
    signalAfterMs = null
} = {}) {

    return new Promise(resolve => {

        const child =
            spawn(
                process.execPath,
                [
                    BIN,
                    "-i",
                    "-q",
                    "-w", workspace,
                    "--base-url", `http://127.0.0.1:${port}/v1`,
                    ...args
                ],
                {
                    cwd: REPO_ROOT,

                    env: {
                        ...process.env,

                        NO_COLOR: "1",

                        /*
                        | These tests drive the session, not the
                        | persistence nudge, and their stubs answer
                        | without touching the workspace.
                        */

                        MAX_EMPTY_FINAL_NUDGES: "0"
                    },

                    stdio: ["pipe", "pipe", "pipe"]
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

        child.stdin.write(lines.join("\n") + "\n");

        if (signalAfterMs === null) {
            child.stdin.end();
        } else {

            setTimeout(
                () => {

                    child.kill("SIGINT");

                    setTimeout(
                        () => {
                            child.stdin.write("/exit\n");
                            child.stdin.end();
                        },
                        400
                    );
                },
                signalAfterMs
            );
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

    console.log("interactive session");

    await test("the session announces its settings and exits cleanly", async () => {

        const stub =
            await startStub(() => finalAction("hello"));

        const workspace = makeWorkspace();

        const run =
            await runSession(
                ["/exit"],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /interactive session/);
        assert.match(run.stdout, /workspace : /);
        assert.match(run.stdout, /approval  : prompt/);
        assert.match(run.stdout, /goodbye/);

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("history is carried from one task to the next", async () => {

        const stub =
            await startStub(request => {

                const users =
                    request.messages.filter(
                        message => message.role === "user"
                    );

                return finalAction(`saw ${users.length} user messages`);
            });

        const workspace = makeWorkspace();

        const run =
            await runSession(
                [
                    "what is this project",
                    "and what should I change",
                    "/exit"
                ],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /saw 1 user messages/);
        assert.match(run.stdout, /saw 2 user messages/);
        assert.equal(run.code, 0);

        /* the second task must also carry the first answer */
        const secondRequest =
            stub.state.requests[1];

        assert.ok(
            secondRequest.messages.some(
                message =>
                    message.role === "assistant"
            )
        );

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("/clear starts a new conversation", async () => {

        const stub =
            await startStub(request =>
                finalAction(
                    `saw ${
                        request.messages.filter(
                            message => message.role === "user"
                        ).length
                    } user messages`
                )
            );

        const workspace = makeWorkspace();

        const run =
            await runSession(
                [
                    "first",
                    "/clear",
                    "second",
                    "/exit"
                ],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /conversation cleared/);

        const answers =
            run.stdout.match(/saw \d user messages/g);

        assert.deepEqual(
            answers,
            ["saw 1 user messages", "saw 1 user messages"]
        );

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("an approval answered with y lets the tool run", async () => {

        const stub =
            await startStub((request, index) =>
                index === 1
                    ? writeCall("approved.txt")
                    : finalAction("done")
            );

        const workspace = makeWorkspace();

        const run =
            await runSession(
                ["write a file", "y", "/exit"],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /approval required/);
        assert.match(run.stdout, /fs_write/);
        assert.match(run.stdout, /approved/);

        assert.equal(
            fs.existsSync(
                path.join(workspace, "approved.txt")
            ),
            true
        );

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("an approval answered with n refuses the tool", async () => {

        const stub =
            await startStub((request, index) =>
                index === 1
                    ? writeCall("refused.txt")
                    : finalAction("could not write")
            );

        const workspace = makeWorkspace();

        const run =
            await runSession(
                ["write a file", "n", "/exit"],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /refused/);

        assert.equal(
            fs.existsSync(
                path.join(workspace, "refused.txt")
            ),
            false
        );

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        assert.match(
            toolMessage.error.message,
            /denied by the operator/
        );

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("/approve switches the mode for the rest of the session", async () => {

        const stub =
            await startStub((request, index) =>
                index === 1
                    ? writeCall("auto.txt")
                    : finalAction("done")
            );

        const workspace = makeWorkspace();

        const run =
            await runSession(
                [
                    "/approve auto",
                    "write a file",
                    "/exit"
                ],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /approval mode: auto/);

        /* no question was asked, and the file was written */
        assert.equal(
            run.stdout.includes("approval required"),
            false
        );

        assert.equal(
            fs.existsSync(
                path.join(workspace, "auto.txt")
            ),
            true
        );

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("commands typed after a task run in order", async () => {

        const stub =
            await startStub(() => finalAction("answered"));

        const workspace = makeWorkspace();

        const run =
            await runSession(
                [
                    "do something",
                    "/history",
                    "/stats",
                    "/exit"
                ],
                { port: stub.port, workspace }
            );

        await stub.close();

        const answerAt =
            run.stdout.indexOf("answered");

        const historyAt =
            run.stdout.indexOf("do something");

        assert.ok(answerAt > 0);
        assert.ok(historyAt > answerAt, "/history ran before the task finished");
        assert.match(run.stdout, /calls: \d+, failures: \d+/);

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("/help, /tools, /agents and /policy list the runtime", async () => {

        const stub =
            await startStub(() => finalAction("x"));

        const workspace = makeWorkspace();

        const run =
            await runSession(
                ["/help", "/tools", "/agents", "/policy", "/limits", "/exit"],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /\/clear/);
        assert.match(run.stdout, /filesystem\.read/);
        assert.match(run.stdout, /git_analysis/);
        assert.match(run.stdout, /require_approval/);
        assert.match(run.stdout, /max_run_ms/);

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("an unknown command is reported without ending the session", async () => {

        const stub =
            await startStub(() => finalAction("still here"));

        const workspace = makeWorkspace();

        const run =
            await runSession(
                ["/nope", "a task", "/exit"],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /unknown command \/nope/);
        assert.match(run.stdout, /still here/);
        assert.equal(run.code, 0);

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("/save writes the last answer to a file", async () => {

        const stub =
            await startStub(() => finalAction("the answer to save"));

        const workspace = makeWorkspace();

        const target =
            path.join(workspace, "answer.txt");

        const run =
            await runSession(
                ["ask something", `/save ${target}`, "/exit"],
                { port: stub.port, workspace }
            );

        await stub.close();

        assert.match(run.stdout, /written to/);

        assert.equal(
            fs.readFileSync(target, "utf8").trim(),
            "the answer to save"
        );

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("Ctrl-C cancels the running task but keeps the session", async () => {

        const stub =
            await startStub((request, index) => ({
                message: finalAction("slow answer"),

                delayMs:
                    index === 1
                        ? 4000
                        : 0
            }));

        const workspace = makeWorkspace();

        const run =
            await runSession(
                ["a slow task"],
                {
                    port: stub.port,
                    workspace,
                    signalAfterMs: 800
                }
            );

        await stub.close();

        assert.match(run.stdout, /task cancelled/);

        /* the session survived and exited on its own terms */
        assert.match(run.stdout, /goodbye/);
        assert.equal(run.code, 0);

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    await test("--interactive cannot be combined with --json", async () => {

        const stub =
            await startStub(() => finalAction("x"));

        const workspace = makeWorkspace();

        const run =
            await runSession(
                ["/exit"],
                {
                    port: stub.port,
                    workspace,
                    args: ["--json"]
                }
            );

        await stub.close();

        assert.equal(run.code, 2);
        assert.match(run.stderr, /cannot be combined/);

        fs.rmSync(workspace, { recursive: true, force: true });
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
