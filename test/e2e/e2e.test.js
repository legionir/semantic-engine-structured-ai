const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

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

    console.log("end to end");

    await test("a direct final answer completes the run", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("nothing to do")
            }));

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /FINAL RESPONSE/);
        assert.match(run.stdout, /nothing to do/);

        run.cleanup();
    });

    await test("a tool graph runs in dependency order and feeds the model", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_list",
                                    arguments: { path: "." },
                                    depends_on: []
                                },
                                {
                                    id: "call_2",
                                    name: "fs_read",
                                    arguments: {
                                        /* journal creates .agent; entries are .agent, bulk.txt, notes.txt */
                                        path: "${call_1.result.entries.2.name}"
                                    },
                                    depends_on: ["call_1"]
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("read the file")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        const toolMessages =
            stub.state.requests[1].messages.filter(
                message => message.role === "tool"
            );

        assert.equal(toolMessages.length, 2);

        const second =
            JSON.parse(toolMessages[1].content);

        /* the reference resolved to the file created by the harness */
        assert.equal(second.success, true);
        assert.equal(second.name, "fs_read");
        assert.match(second.result.content, /alpha/);

        run.cleanup();
    });

    await test("independent tools in one action run in parallel", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [1, 2, 3].map(number => ({
                                id: `call_${number}`,
                                name: "terminal_exec",
                                arguments: {
                                    command: `"${process.execPath}" -e "setTimeout(() => {}, 600)"`
                                },
                                depends_on: []
                            }))
                        })
                    };
                }

                return {
                    message: finalAction("all three finished")
                };
            });

        const startedAt = Date.now();

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        const elapsed =
            Date.now() - startedAt;

        await stub.close();

        assert.equal(run.code, 0);

        const toolMessages =
            stub.state.requests[1].messages.filter(
                message => message.role === "tool"
            );

        assert.equal(toolMessages.length, 3);

        for (const message of toolMessages) {

            assert.equal(
                JSON.parse(message.content).success,
                true
            );
        }

        /* three sleeps of 600 ms in sequence could not finish this fast */
        assert.ok(
            elapsed < 1600,
            `three parallel sleeps took ${elapsed} ms, they were not parallel`
        );

        run.cleanup();
    });

    await test("a dependency chain is executed in order", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "make_dir",
                                    name: "fs_mkdir",
                                    arguments: { path: "generated" },
                                    depends_on: []
                                },
                                {
                                    id: "write_file",
                                    name: "fs_write",
                                    arguments: {
                                        path: "generated/report.txt",
                                        content: "step two\n"
                                    },
                                    depends_on: ["make_dir"]
                                },
                                {
                                    id: "read_back",
                                    name: "fs_read",
                                    arguments: {
                                        path: "${write_file.result.path}"
                                    },
                                    depends_on: ["write_file"]
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("chain complete")
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        const toolMessages =
            stub.state.requests[1].messages
                .filter(message => message.role === "tool")
                .map(message => JSON.parse(message.content));

        assert.deepEqual(
            toolMessages.map(result => result.id),
            ["make_dir", "write_file", "read_back"]
        );

        for (const result of toolMessages) {

            assert.equal(
                result.success,
                true,
                `${result.id} failed: ${
                    result.error && result.error.message
                }`
            );
        }

        /* the third call read what the second wrote, through a reference */
        assert.match(
            toolMessages[2].result.content,
            /step two/
        );

        run.cleanup();
    });

    await test("a sub-agent can also run a parallel tool graph", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {

                    const answered =
                        request.messages.some(
                            message => message.role === "tool"
                        );

                    if (!answered) {

                        return {
                            message: action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "s1",
                                        name: "git_status",
                                        arguments: { cwd: "." },
                                        depends_on: []
                                    },
                                    {
                                        id: "s2",
                                        name: "git_log",
                                        arguments: { cwd: ".", limit: 1 },
                                        depends_on: []
                                    }
                                ]
                            })
                        };
                    }

                    return {
                        message: finalAction("two inspections done")
                    };
                }

                const delegated =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                return {
                    message:
                        delegated
                            ? finalAction("reported")
                            : action({
                                action: "delegate",

                                delegations: [
                                    {
                                        id: "d1",
                                        agent: "git_analysis",
                                        persona: null,
                                        skills: null,
                                        tools: null,
                                        task: "inspect the repository",
                                        depends_on: []
                                    }
                                ]
                            })
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        assert.equal(run.code, 0);

        /* the sub-agent's second request carries both tool answers */
        const subFollowUp =
            stub.state.requests.find(
                request =>
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    ) &&
                    request.messages.filter(
                        message => message.role === "tool"
                    ).length === 2
            );

        assert.ok(
            subFollowUp,
            "the sub-agent did not receive two tool results in one exchange"
        );

        run.cleanup();
    });

    await test("every agent is told how the tool graph works", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {
                    return { message: finalAction("sub done") };
                }

                const delegated =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                return {
                    message:
                        delegated
                            ? finalAction("done")
                            : action({
                                action: "delegate",

                                delegations: [
                                    {
                                        id: "d1",
                                        agent: "git_analysis",
                                        persona: null,
                                        skills: null,
                                        tools: null,
                                        task: "look at the repository",
                                        depends_on: []
                                    }
                                ]
                            })
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        for (const request of stub.state.requests) {

            const system =
                request.messages
                    .filter(message => message.role === "system")
                    .map(message => message.content)
                    .join("\n");

            assert.match(
                system,
                /TOOL EXECUTION IS A GRAPH/,
                "an agent was not told that tool calls form a graph"
            );

            assert.match(
                system,
                /depends_on/,
                "an agent was not told about depends_on"
            );

            assert.match(
                system,
                /\$\{call_id/,
                "an agent was not told about dependency references"
            );
        }

        run.cleanup();
    });

    await test("a refusal without any work is handed back once", async () => {

        const stub =
            await startStub((request, index) => {

                const nudged =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("unfinished_run")
                    );

                if (index === 1) {

                    /* the shape of a real refusal: a plan instead of work */
                    return {
                        message: finalAction(
                            "That is beyond this environment. Which task should I start with?"
                        )
                    };
                }

                if (nudged && index === 2) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "c1",
                                    name: "fs_list",
                                    arguments: { path: "." },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("started the first item")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /handing the objective back once/);
        assert.match(run.stdout, /started the first item/);

        /* the nudge carried a budget so the model can size its slice */
        const second =
            stub.state.requests[1].messages
                .filter(message => message.role === "user")
                .pop();

        const notice =
            JSON.parse(second.content);

        assert.equal(notice.notice, "unfinished_run");
        assert.ok(notice.budget.iterations_remaining > 0);

        run.cleanup();
    });

    await test("a declared block is accepted without a nudge", async () => {

        const stub =
            await startStub(() => ({
                message: action({
                    action: "final",

                    response: {
                        type: "text",
                        content: "I need the API token to continue."
                    },

                    error: {
                        code: "NEEDS_INPUT",
                        message: "which staging token should I use?",
                        retryable: true
                    }
                })
            }));

        const run =
            await runAgent(stub.port);

        await stub.close();

        /* one request only: the runtime did not argue with a real block */
        assert.equal(stub.state.requests.length, 1);
        assert.equal(
            run.stdout.includes("handing the objective back"),
            false
        );

        /* an error in the final action is still a failed run */
        assert.equal(run.code, 1);

        run.cleanup();
    });

    await test("the runtime nudges at most once", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("I would rather not.")
            }));

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(stub.state.requests.length, 2);
        assert.equal(run.code, 0);

        run.cleanup();
    });

    await test("a run that did work is never nudged", async () => {

        const stub =
            await startStub((request, index) =>
                index === 1
                    ? {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "c1",
                                    name: "fs_list",
                                    arguments: { path: "." },
                                    depends_on: []
                                }
                            ]
                        })
                    }
                    : { message: finalAction("inspected the workspace") }
            );

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(stub.state.requests.length, 2);
        assert.equal(
            run.stdout.includes("handing the objective back"),
            false
        );

        run.cleanup();
    });

    await test("template literals in file content are not treated as references", async () => {

        /* the exact shape that looped in a real run */

        const code =
            "export const padId = (index) => `gamepad-${index}`;\n";

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "write_manager",
                                    name: "fs_write",
                                    arguments: {
                                        path: "InputManager.js",
                                        content: code
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("written")
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        const result =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        assert.equal(
            result.success,
            true,
            `the write failed: ${
                result.error && result.error.message
            }`
        );

        /* the file on disk must contain the literal template */
        const written =
            fs.readFileSync(
                path.join(run.workspace, "InputManager.js"),
                "utf8"
            );

        assert.equal(written, code);

        run.cleanup();
    });

    await test("a real reference still resolves next to literal code", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "make",
                                    name: "fs_write",
                                    arguments: {
                                        path: "generated.js",
                                        content: "const t = `${value}`;\n"
                                    },
                                    depends_on: []
                                },
                                {
                                    id: "verify",
                                    name: "fs_read",
                                    arguments: {
                                        path: "${make.result.path}"
                                    },
                                    depends_on: ["make"]
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("done")
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        const results =
            stub.state.requests[1].messages
                .filter(message => message.role === "tool")
                .map(message => JSON.parse(message.content));

        assert.equal(results[0].success, true);
        assert.equal(results[1].success, true);
        assert.match(results[1].result.content, /\$\{value\}/);

        run.cleanup();
    });

    await test("the same failure is not repeated forever", async () => {

        const stub =
            await startStub(() => {

                /* a stubborn model: always the same impossible call */
                return {
                    message: action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "stuck",
                                name: "fs_read",
                                arguments: { path: "missing.txt" },
                                depends_on: []
                            }
                        ]
                    })
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        /* the runtime warned, then stopped instead of burning 50 iterations */
        assert.match(run.stdout, /The same failure repeated 3 times/);
        assert.equal(run.code, 1);
        assert.match(
            run.stderr,
            /repeated the same failing call/
        );

        assert.ok(
            stub.state.requests.length <= 6,
            `the loop ran ${stub.state.requests.length} times`
        );

        const notice =
            stub.state.requests
                .flatMap(request => request.messages)
                .find(
                    message =>
                        typeof message.content === "string" &&
                        message.content.includes("repeated_failure")
                );

        assert.ok(notice, "the model was never told it was looping");

        run.cleanup();
    });

    await test("a final answer is refused while the plan has open steps", async () => {

        const stub =
            await startStub((request, index) => {

                const nudges =
                    request.messages.filter(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("plan_incomplete")
                    ).length;

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "s",
                                    name: "plan_set",
                                    arguments: {
                                        objective: "two things",
                                        phases: [
                                            {
                                                id: "P1",
                                                title: "work",
                                                steps: [
                                                    { id: "P1.1", title: "a" },
                                                    { id: "P1.2", title: "b" }
                                                ]
                                            }
                                        ]
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                /* the model tries to stop after writing the plan */
                if (index === 2) {

                    return {
                        message: finalAction("the plan is written, the rest is a lot of work")
                    };
                }

                if (nudges > 0 && index === 3) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "u1",
                                    name: "plan_update",
                                    arguments: {
                                        updates: [
                                            {
                                                id: "P1.1",
                                                status: "done",
                                                evidence: "did a"
                                            }
                                        ]
                                    },
                                    depends_on: []
                                },
                                {
                                    id: "u2",
                                    name: "plan_update",
                                    arguments: {
                                        updates: [
                                            {
                                                id: "P1.2",
                                                status: "done",
                                                evidence: "did b"
                                            }
                                        ]
                                    },
                                    depends_on: ["u1"]
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("both steps are done")
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        assert.match(run.stdout, /Plan still has 2 open step\(s\)/);
        assert.match(run.stdout, /both steps are done/);
        assert.equal(run.code, 0);

        /* the notice carried the next step, not just a complaint */
        const notice =
            JSON.parse(
                stub.state.requests[2].messages
                    .filter(message => message.role === "user")
                    .pop().content
            );

        assert.equal(notice.notice, "plan_incomplete");
        assert.equal(notice.next_step.id, "P1.1");
        assert.equal(notice.progress.open, 2);

        run.cleanup();
    });

    await test("a completed plan lets the run finish", async () => {

        const stub =
            await startStub((request, index) =>
                index === 1
                    ? {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "s",
                                    name: "plan_set",
                                    arguments: {
                                        objective: "one thing",
                                        phases: [
                                            {
                                                id: "P1",
                                                title: "work",
                                                steps: [
                                                    {
                                                        id: "P1.1",
                                                        title: "a",
                                                        status: "done",
                                                        evidence: "already done"
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    }
                    : { message: finalAction("nothing left to do") }
            );

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        assert.equal(
            run.stdout.includes("Plan still has"),
            false
        );

        assert.equal(run.code, 0);

        run.cleanup();
    });

    await test("the runtime context is refreshed every iteration", async () => {

        const stub =
            await startStub((request, index) =>
                index < 3
                    ? {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: `c${index}`,
                                    name: "fs_list",
                                    arguments: { path: "." },
                                    depends_on: []
                                }
                            ]
                        })
                    }
                    : { message: finalAction("done") }
            );

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto"
            });

        await stub.close();

        const remaining =
            stub.state.requests.map(request => {

                const context =
                    JSON.parse(
                        request.messages.find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.startsWith("{") &&
                                message.content.includes("runtime_context")
                        ).content
                    ).context;

                return context.runtime.run_remaining_ms;
            });

        assert.ok(
            remaining[1] < remaining[0],
            "the deadline in the context never moved"
        );

        run.cleanup();
    });

    await test("a long run compacts before the ceiling and keeps going", async () => {

        /* every answer reads a big file, so the transcript grows fast */

        const stub =
            await startStub((request, index) =>
                index <= 8
                    ? {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: `c${index}`,
                                    name: "fs_read",
                                    arguments: { path: "bulk.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    }
                    : { message: finalAction("read enough") }
            );

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto",
                MAX_CONTEXT_CHARS: "80000",
                CONTEXT_COMPACT_AT: "0.7",
                MAX_TOOL_RESULT_CHARS: "20000"
            });

        await stub.close();

        assert.equal(run.code, 0);

        const sizes =
            stub.state.requests.map(
                request =>
                    JSON.stringify(request.messages).length
            );

        /*
        | The static prompt is about 26k on its own, so the test is not
        | about an absolute number: it is that growth stops. Without
        | maintenance each read would add 20k for ever.
        */

        const early = sizes[2];
        const late = sizes[sizes.length - 1];

        assert.ok(
            late < early * 1.4,
            `the conversation kept growing: ${sizes.join(" then ")}`
        );

        assert.ok(
            Math.max(...sizes) < 140000,
            `the conversation reached ${Math.max(...sizes)} chars`
        );

        assert.match(run.stdout, /Context \d+k of 80k, compacted/);

        run.cleanup();
    });

    await test("raising the timeout from the store extends a running deadline", async () => {

        const stub =
            await startStub((request, index) => {

                const context =
                    JSON.parse(
                        request.messages.find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.startsWith("{") &&
                                message.content.includes("runtime_context")
                        ).content
                    ).context;

                /* the model can see the budget move */
                return {
                    message:
                        index === 1
                            ? action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "c1",
                                        name: "fs_list",
                                        arguments: { path: "." },
                                        depends_on: []
                                    }
                                ]
                            })
                            : finalAction(
                                `remaining ${context.runtime.run_remaining_ms}`
                            )
                };
            });

        const run =
            await runAgent(stub.port, {
                AGENT_APPROVAL: "auto",
                MAX_RUN_MS: "30000"
            });

        await stub.close();

        const first =
            JSON.parse(
                stub.state.requests[0].messages.find(
                    message =>
                        typeof message.content === "string" &&
                        message.content.startsWith("{") &&
                        message.content.includes("runtime_context")
                ).content
            ).context.runtime;

        assert.equal(first.max_run_ms, 30000);
        assert.ok(first.run_remaining_ms <= 30000);

        assert.equal(run.code, 0);

        run.cleanup();
    });

    await test("a failing tool is reported without ending the run", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_read",
                                    arguments: { path: "missing.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("handled the failure")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        assert.equal(toolMessage.success, false);
        assert.match(toolMessage.error.message, /does not exist/);
        assert.equal(run.code, 0);

        run.cleanup();
    });

    await test("native OpenAI tool calls are accepted", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "native_1",
                                    type: "function",
                                    function: {
                                        name: "fs_list",
                                        arguments: "{\"path\":\".\"}"
                                    }
                                }
                            ]
                        }
                    };
                }

                return {
                    message: finalAction("listed")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        const toolMessage =
            stub.state.requests[1].messages.find(
                message => message.role === "tool"
            );

        assert.equal(
            toolMessage.tool_call_id,
            "native_1"
        );

        run.cleanup();
    });

    await test("delegation runs a sub-agent and returns its report", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {

                    return {
                        message: finalAction("sub-agent report")
                    };
                }

                const alreadyDelegated =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                if (alreadyDelegated) {

                    return {
                        message: finalAction("aggregated")
                    };
                }

                return {
                    message: action({
                        action: "delegate",

                        delegations: [
                            {
                                id: "task_1",
                                agent: "git_analysis",
                                persona: null,
                                skills: null,
                                tools: null,
                                task: "inspect the repository",
                                depends_on: []
                            }
                        ]
                    })
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /git_analysis#1/);
        assert.match(run.stdout, /aggregated/);

        run.cleanup();
    });

    await test("a tool outside the profile is refused", async () => {

        const stub =
            await startStub(request => {

                const isSub =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_profile")
                    );

                if (isSub) {

                    const asked =
                        request.messages.some(
                            message => message.role === "tool"
                        );

                    if (!asked) {

                        return {
                            message: action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "call_1",
                                        name: "fs_delete",
                                        arguments: { path: "notes.txt" },
                                        depends_on: []
                                    }
                                ]
                            })
                        };
                    }

                    return {
                        message: finalAction("could not delete")
                    };
                }

                const done =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("sub_agent_results")
                    );

                return {
                    message:
                        done
                            ? finalAction("reported")
                            : action({
                                action: "delegate",

                                delegations: [
                                    {
                                        id: "task_1",
                                        agent: "git_analysis",
                                        persona: null,
                                        skills: null,
                                        tools: null,
                                        task: "try to delete a file",
                                        depends_on: []
                                    }
                                ]
                            })
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.match(
            run.stdout,
            /is not allowed for this agent/
        );

        /* the file must still be there */
        assert.equal(
            fs.existsSync(
                path.join(run.workspace, "notes.txt")
            ),
            true
        );

        run.cleanup();
    });

    await test("policy denies a destructive shell command", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "terminal_exec",
                                    arguments: {
                                        command: "rm -rf /"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("denied as expected")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(
                        message => message.role === "tool"
                    )[0].content
            );

        assert.equal(toolMessage.success, false);
        assert.match(
            toolMessage.error.message,
            /denied by policy/
        );

        run.cleanup();
    });

    await test("unattended approval mode blocks tools that need approval", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_write",
                                    arguments: {
                                        path: "new.txt",
                                        content: "x"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("could not write")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {
                    AGENT_APPROVAL: "deny"
                }
            );

        await stub.close();

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
                path.join(run.workspace, "new.txt")
            ),
            false
        );

        run.cleanup();
    });

    await test("a transient server error is retried", async () => {

        let failures = 0;

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    failures++;

                    return {
                        status: 503,
                        body: { error: "upstream unavailable" }
                    };
                }

                return {
                    message: finalAction("recovered")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {
                    RETRY_BASE_MS: "50"
                }
            );

        await stub.close();

        assert.equal(failures, 1);
        assert.equal(run.code, 0);
        assert.match(run.stdout, /retrying in/);
        assert.match(run.stdout, /recovered/);

        run.cleanup();
    });

    await test("a permanent client error is not retried", async () => {

        const stub =
            await startStub(() => ({
                status: 400,
                body: { error: "bad request" }
            }));

        const run =
            await runAgent(
                stub.port,
                {
                    RETRY_BASE_MS: "50"
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.equal(stub.state.requests.length, 1);
        assert.match(run.stderr, /API Error 400/);

        run.cleanup();
    });

    await test("the run deadline stops a slow endpoint", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("too late"),

                /* slower than the deadline below */
                delayMs: 5000
            }));

        const run =
            await runAgent(
                stub.port,
                {
                    MAX_RUN_MS: "1500",
                    MAX_REQUEST_MS: "60000",
                    MAX_REQUEST_RETRIES: "0"
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.match(
            run.stderr,
            /run budget of 1500 ms \(MAX_RUN_MS\)/i
        );

        run.cleanup();
    });

    await test("the conversation stays inside the context budget", async () => {

        const stub =
            await startStub((request, index) => {

                if (index <= 6) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: `call_${index}`,
                                    name: "fs_read",
                                    arguments: { path: "bulk.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("done reading")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {
                    MAX_CONTEXT_CHARS: "60000",
                    MAX_TOOL_RESULT_CHARS: "20000"
                }
            );

        await stub.close();

        const sizes =
            stub.state.requests.map(
                request =>
                    JSON.stringify(request.messages).length
            );

        assert.ok(
            sizes[sizes.length - 1] < 120000,
            `conversation grew to ${sizes[sizes.length - 1]} chars`
        );

        assert.match(run.stdout, /Context compacted/);

        run.cleanup();
    });

    await test("what leaves the conversation is recalled from the archive", async () => {

        /*
        | The point of the archive is that a fact survives compaction. The
        | model reads a large file, the exchange is folded out of the
        | transcript, and the only way the model can still name that file
        | is by searching the archive.
        */

        const stub =
            await startStub((request, index, state) => {

                const system =
                    request.messages[0]?.content || "";

                /* the summariser shares the endpoint in this test */
                if (system.includes("working memory of a software agent")) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    facts: ["read a large file"],
                                    open_tasks: []
                                })
                        }
                    };
                }

                /*
                | Compaction removes assistant messages, so the turn is
                | counted here rather than read off the transcript.
                */

                state.turns = (state.turns || 0) + 1;

                const calls = state.turns - 1;

                if (calls === 0) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "read_bulk",
                                    name: "fs_read",
                                    arguments: { path: "bulk.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                if (calls === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "read_missing",
                                    name: "fs_read",
                                    arguments: { path: "missing.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                if (calls === 2) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "recall",
                                    name: "archive_search",
                                    arguments: { query: "bulk.txt" },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                /*
                | Whatever the archive returned is echoed back, so the
                | assertion is about what actually reached the model.
                */

                const last =
                    [...request.messages]
                        .reverse()
                        .find(message => message.role === "tool");

                return {
                    message:
                        finalAction(
                            `recalled ${last ? last.content : "nothing"}`
                        )
                };
            });

        const run =
            await runAgent(
                stub.port,
                {
                    MAX_CONTEXT_CHARS: "20000",
                    CONTEXT_COMPACT_AT: "0.2",
                    KEEP_RECENT_EXCHANGES: "1",
                    MAX_TOOL_RESULT_CHARS: "20000"
                }
            );

        await stub.close();

        if (process.env.DEBUG_ARCHIVE) {
            console.log(run.stdout.slice(-6000), run.stderr.slice(-3000));
        }

        assert.equal(run.code, 0);

        /* the exchange really did leave the transcript */
        assert.match(run.stdout, /[1-9]\d* exchanges dropped/);

        /* and the archive gave it back */
        assert.match(run.stdout, /recalled/);
        assert.match(run.stdout, /bulk\.txt/);

        const index =
            JSON.parse(
                fs.readFileSync(
                    path.join(
                        run.workspace,
                        ".agent",
                        "archive",
                        "index.json"
                    ),
                    "utf8"
                )
            );

        assert.ok(index.records.length > 0);

        run.cleanup();
    });

    await test("a version pair misplaced in tool_calls is repaired and executed", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    data: null,
                                    delegations: null,
                                    error: null,
                                    performed: null,
                                    response: null,
                                    tool_calls: [
                                        {
                                            id: "list_root",
                                            name: "fs_list",
                                            arguments: { path: "." },
                                            depends_on: []
                                        },
                                        {
                                            id: "search_plan",
                                            name: "search_start",
                                            arguments: {
                                                path: ".",
                                                query: "IMPLEMENTATION_PLAN.md",
                                                mode: "files"
                                            },
                                            depends_on: []
                                        },
                                        "version",
                                        "1.0"
                                    ]
                                }),
                            reasoning_content:
                                "I will locate the implementation plan first."
                        }
                    };
                }

                return {
                    message: finalAction("repaired action completed")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.match(run.stdout, /Repaired the action envelope: moved version out of tool_calls/);
        assert.equal(/Unreadable answer/.test(run.stdout), false);

        const toolMessages =
            stub.state.requests[1].messages.filter(
                message => message.role === "tool"
            );

        assert.equal(toolMessages.length, 2);
        assert.match(run.stdout, /repaired action completed/);

        run.cleanup();
    });

    await test("missing version and a Markdown-linked file path are repaired", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    data: null,
                                    delegations: null,
                                    error: null,
                                    performed: null,
                                    response: null,
                                    tool_calls: [
                                        {
                                            id: "read_plan",
                                            name: "fs_read",
                                            arguments: {
                                                path: "IMPLEMENTATION_[PLAN.md](http://PLAN.md)"
                                            },
                                            depends_on: []
                                        },
                                        "version"
                                    ]
                                })
                        }
                    };
                }

                return {
                    message: finalAction("read corrected plan path")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {},
                workspace => {
                    fs.writeFileSync(
                        path.join(workspace, "IMPLEMENTATION_PLAN.md"),
                        "phase one\n"
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(/Unreadable answer/.test(run.stdout), false);
        assert.match(run.stdout, /defaulted version/);
        assert.match(run.stdout, /cleaned Markdown links from fs_read\.path/);

        const result =
            JSON.parse(
                stub.state.requests[1].messages.find(
                    message => message.role === "tool"
                ).content
            );

        assert.equal(result.success, true);
        assert.match(result.result.content, /phase one/);

        run.cleanup();
    });

    await test("a retry that fixes the action but still omits version can proceed", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "delegate",
                                    data: null,
                                    delegations: null,
                                    error: null,
                                    performed: null,
                                    response: null,
                                    tool_calls: null
                                })
                        }
                    };
                }

                if (index === 2) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    data: null,
                                    delegations: null,
                                    error: null,
                                    performed: null,
                                    response: null,
                                    tool_calls: [
                                        {
                                            id: "read_plan",
                                            name: "fs_read",
                                            arguments: { path: "IMPLEMENTATION_PLAN.md" },
                                            depends_on: []
                                        }
                                    ]
                                })
                        }
                    };
                }

                return {
                    message: finalAction("continued after one correction")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {},
                workspace => {
                    fs.writeFileSync(
                        path.join(workspace, "IMPLEMENTATION_PLAN.md"),
                        "phase one\n"
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(
            (run.stdout.match(/Unreadable answer/g) || []).length,
            1
        );
        assert.match(run.stdout, /delegations must contain at least one/);
        assert.equal(
            /missing required top-level field "version"/.test(run.stdout),
            false
        );
        assert.equal(/Repaired the action envelope/.test(run.stdout), false);
        assert.match(run.stdout, /continued after one correction/);

        run.cleanup();
    });

    await test("omitted fixed envelope fields do not spend a retry", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "read_plan",
                                            name: "fs_read",
                                            arguments: {
                                                path: "IMPLEMENTATION_PLAN.md"
                                            },
                                            depends_on: []
                                        }
                                    ]
                                })
                        }
                    };
                }

                return {
                    message: finalAction("read with fixed defaults")
                };
            });

        const run =
            await runAgent(
                stub.port,
                {},
                workspace => {
                    fs.writeFileSync(
                        path.join(workspace, "IMPLEMENTATION_PLAN.md"),
                        "phase one\n"
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(stub.state.requests.length, 2);
        assert.equal(/Unreadable answer/.test(run.stdout), false);
        assert.equal(/Repaired the action envelope/.test(run.stdout), false);
        assert.match(run.stdout, /read with fixed defaults/);

        const result =
            JSON.parse(
                stub.state.requests[1].messages.find(
                    message => message.role === "tool"
                ).content
            );

        assert.equal(result.success, true);

        run.cleanup();
    });

    await test("a truncated write receives a bounded-payload correction", async () => {

        let notice;

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "write_big",
                                            name: "fs_write"
                                        }
                                    ]
                                })
                        }
                    };
                }

                if (index === 2) {

                    return {
                        message: {
                            role: "assistant",
                            content:
                                JSON.stringify({
                                    action: "tool_call",
                                    tool_calls: ["fs_write"]
                                })
                        }
                    };
                }

                if (index === 3) {

                    return {
                        finish_reason: "length",
                        usage: { completion_tokens: 2048 },
                        message: {
                            role: "assistant",
                            content:
                                '{"action":"tool_call","tool_calls":[{' +
                                '"id":"write_big","name":"fs_write",' +
                                '"arguments":{"path":"BIG.test.ts","content":"import'
                        }
                    };
                }

                if (index === 4) {

                    notice =
                        JSON.parse(
                            request.messages[request.messages.length - 1].content
                        );

                    return {
                        message:
                            action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "write_small",
                                        name: "fs_write",
                                        arguments: {
                                            path: "SMALL.test.ts",
                                            content: "export const ok = true;\n",
                                            mode: "overwrite"
                                        },
                                        depends_on: []
                                    }
                                ]
                            })
                    };
                }

                return {
                    message: finalAction("recovered from truncation")
                };
            });

        const run = await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(stub.state.requests.length, 5);
        assert.equal(notice.error.code, "TRUNCATED_RESPONSE");
        assert.equal(notice.correction_attempt.attempt, 1);
        assert.match(notice.error.message, /2048 completion tokens/);
        assert.equal(notice.response_diagnostics.finish_reason, "length");
        assert.equal(notice.response_diagnostics.completion_tokens, 2048);
        assert.equal(notice.detected_action, "tool_call");
        assert.match(notice.repair.issue_specific, /much smaller complete action/);
        assert.match(notice.repair.issue_specific, /temporary path/);
        assert.equal(/neither structured JSON/.test(run.stdout), false);
        assert.equal(
            fs.readFileSync(
                path.join(run.workspace, "SMALL.test.ts"),
                "utf8"
            ),
            "export const ok = true;\n"
        );

        run.cleanup();
    });

    await test("a successful correction resets the malformed retry budget", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1 || index === 3) {

                    return {
                        message: {
                            role: "assistant",
                            content: `not json ${index}`
                        }
                    };
                }

                if (index === 2) {

                    return {
                        message:
                            action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "list_root",
                                        name: "fs_list",
                                        arguments: { path: "." },
                                        depends_on: []
                                    }
                                ]
                            })
                    };
                }

                return {
                    message: finalAction("two independent corrections succeeded")
                };
            });

        const run =
            await runAgent(
                stub.port,
                { MAX_MALFORMED_RESPONSES: "1" }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.equal(stub.state.requests.length, 4);
        assert.equal(
            (run.stdout.match(/Unreadable answer/g) || []).length,
            2
        );
        assert.match(run.stdout, /two independent corrections succeeded/);

        run.cleanup();
    });

    await test("a badly serialised tool call does not end the run", async () => {

        /*
        | Reproduces a real failure: a 20B model appended the shape of
        | the previous tool result to the arguments of the next call.
        | The run used to die on the spot.
        */

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "call_write",
                                    type: "function",
                                    function: {
                                        name: "fs_write",
                                        arguments:
                                            '{"path":"NOTES.md","content":"# notes\\n","mode":"overwrite","created":false,"bytes_written":8,"size_bytes":8},"name":"fs_write"}'
                                    }
                                }
                            ]
                        }
                    };
                }

                if (index === 2) {

                    /* this one cannot be salvaged at all */
                    return {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "call_broken",
                                    type: "function",
                                    function: {
                                        name: "fs_write",
                                        arguments: '{"path":"X.md","content":"unter'
                                    }
                                }
                            ]
                        }
                    };
                }

                return {
                    message: finalAction("wrote the notes and recovered")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        /* the salvaged call really ran */
        assert.equal(
            fs.readFileSync(
                path.join(run.workspace, "NOTES.md"),
                "utf8"
            ),
            "# notes\n"
        );

        /* the unsalvageable one was handed back, not fatal */
        assert.match(run.stdout, /Unreadable answer/);
        assert.match(run.stdout, /wrote the notes and recovered/);

        run.cleanup();
    });

    await test("a malformed action receives an exact corrective contract before retry", async () => {

        let notice;

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message:
                            action({
                                action: "delegate",
                                delegations: [],
                                data:
                                    "I'll start by reading the implementation plan."
                            })
                    };
                }

                const correction =
                    [...request.messages]
                        .reverse()
                        .find(message => {

                            if (
                                message.role !== "user" ||
                                typeof message.content !== "string"
                            ) {
                                return false;
                            }

                            try {

                                return JSON.parse(message.content).notice ===
                                    "malformed_response";

                            } catch {
                                return false;
                            }
                        });

                notice =
                    correction
                        ? JSON.parse(correction.content)
                        : null;

                return {
                    message:
                        finalAction("corrected the malformed response")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.ok(notice, "the retry did not receive a correction notice");
        assert.equal(notice.error.code, "INVALID_ACTION");
        assert.match(notice.error.message, /delegations must contain/);
        assert.match(notice.rejected_response, /\"delegations\":\[\]/);
        assert.equal(notice.detected_action, "delegate");
        assert.equal(notice.correction_attempt.attempt, 1);
        assert.equal(notice.correction_attempt.maximum_attempts, 3);
        assert.equal(notice.correction_attempt.attempts_left, 2);
        assert.match(notice.repair.instruction, /Do not repeat it/);
        assert.match(notice.repair.issue_specific, /reading, searching, running, or writing/);
        assert.equal(
            notice.repair.closest_valid_shape.delegations.length,
            1
        );

        for (const kind of ["tool_call", "delegate", "final"]) {

            const example =
                notice.repair.canonical_complete_examples[kind];

            assert.deepEqual(
                Object.keys(example).sort(),
                [
                    "action",
                    "data",
                    "delegations",
                    "error",
                    "performed",
                    "response",
                    "tool_calls",
                    "version"
                ].sort(),
                `${kind} correction example is not a complete envelope`
            );
        }

        assert.match(run.stdout, /Unreadable answer/);
        assert.match(run.stdout, /\[1\/3\]/);

        run.cleanup();
    });

    await test("unreadable answers stop the run once the budget is spent", async () => {

        const stub =
            await startStub(() => ({
                message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            id: "call_broken",
                            type: "function",
                            function: {
                                name: "fs_write",
                                arguments: '{"path":"X.md","content":"unter'
                            }
                        }
                    ]
                }
            }));

        const run =
            await runAgent(
                stub.port,
                { MAX_MALFORMED_RESPONSES: "1" }
            );

        await stub.close();

        assert.notEqual(run.code, 0);
        assert.match(run.stdout + run.stderr, /not valid JSON/);

        /* one retry, then the run gives up */
        const attempts =
            (run.stdout.match(/Unreadable answer/g) || []).length;

        assert.equal(attempts, 2, `saw ${attempts} attempts`);

        run.cleanup();
    });

    await test("an endpoint that rejects the schema is answered without it", async () => {

        /*
        | A real gateway validated the answer against the json_schema we
        | sent and returned 500 when the model replied with a native tool
        | call. Retrying the identical request could only fail again.
        */

        const withSchema = [];

        const stub =
            await startStub((request, index, state) => {

                withSchema.push(
                    Boolean(request.response_format)
                );

                if (request.response_format) {

                    return {
                        status: 500,
                        body: {
                            error: {
                                message:
                                    "regolo.JSONSchemaValidationError: model=, returned an invalid response for the expected schema."
                            }
                        }
                    };
                }

                state.served = (state.served || 0) + 1;

                if (state.served === 1) {

                    return {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "call_list",
                                    type: "function",
                                    function: {
                                        name: "fs_list",
                                        arguments: '{"path":"."}'
                                    }
                                }
                            ]
                        }
                    };
                }

                return {
                    message: finalAction("answered without the schema")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /rejected the response schema/);
        assert.match(run.stdout, /answered without the schema/);

        /* the first request carried it, and nothing after that did */
        assert.equal(withSchema[0], true);

        assert.deepEqual(
            [...new Set(withSchema.slice(1))],
            [false],
            "the schema was sent again after the endpoint refused it"
        );

        run.cleanup();
    });

    await test("the schema can be left out from the start", async () => {

        const seen = [];

        const stub =
            await startStub(request => {

                seen.push(Boolean(request.response_format));

                return { message: finalAction("no schema was sent") };
            });

        const run =
            await runAgent(
                stub.port,
                { RESPONSE_FORMAT_MODE: "never" }
            );

        await stub.close();

        assert.equal(run.code, 0);
        assert.deepEqual([...new Set(seen)], [false]);

        run.cleanup();
    });

    await test("a run nearly out of time is asked to finish, not killed", async () => {

        /*
        | Without the wrap-up slice this run ends as
        | "CANCELLED: Run cancelled (deadline)" and everything it learned
        | is thrown away.
        */

        let wrapped = false;

        const stub =
            await startStub(request => {

                const notice =
                    [...request.messages]
                        .reverse()
                        .find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.includes("budget_almost_spent")
                        );

                if (notice) {

                    wrapped = true;

                    return {
                        message:
                            finalAction(
                                "read two files, wrote none; next step is the router"
                            )
                    };
                }

                /* until then it keeps working, slowly */
                return {
                    message: action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: `call_${request.messages.length}`,
                                name: "fs_read",
                                arguments: { path: "notes.txt" },
                                depends_on: []
                            }
                        ]
                    }),

                    delayMs: 700
                };
            });

        const run =
            await runAgent(
                stub.port,
                {
                    MAX_RUN_MS: "6000",
                    RUN_WRAPUP_MS: "3000",
                    RUN_WRAPUP_FRACTION: "0.5",
                    MAX_REQUEST_MS: "5000"
                }
            );

        await stub.close();

        assert.equal(wrapped, true, "the agent was never asked to wrap up");

        assert.equal(run.code, 0);
        assert.match(run.stdout, /Run budget nearly spent/);
        assert.match(run.stdout, /next step is the router/);

        run.cleanup();
    });

    await test("a run that overruns says which budget stopped it", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("too late"),
                delayMs: 5000
            }));

        const run =
            await runAgent(
                stub.port,
                {
                    MAX_RUN_MS: "1200",
                    RUN_WRAPUP_MS: "0",
                    MAX_REQUEST_MS: "60000",
                    MAX_REQUEST_RETRIES: "0"
                }
            );

        await stub.close();

        assert.notEqual(run.code, 0);

        /* the message names the limit, its setting and what was spent */
        assert.match(
            run.stdout + run.stderr,
            /run budget of 1200 ms \(MAX_RUN_MS\)|run deadline of 1200 ms reached/i
        );

        run.cleanup();
    });

    await test("an argument the tool does not take is reported, not swallowed", async () => {

        /*
        | A real run called fs_read with a content field, the runtime
        | ignored it silently, and the log showed a clean read.
        */

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "call_1",
                                    name: "fs_read",
                                    arguments: {
                                        path: "notes.txt",
                                        content: "this belongs to fs_write"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return { message: finalAction("read it") };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        /* the call still ran */
        assert.match(run.stdout, /alpha/);

        /* and the mistake is visible to both the operator and the model */
        assert.match(run.stdout, /fs_read does not take content; ignored/);

        const toolMessage =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(message => message.role === "tool")[0]
                    .content
            );

        assert.deepEqual(
            toolMessage.result.ignored_arguments,
            ["content"]
        );

        run.cleanup();
    });

    await test("a delegation that fails says so instead of vanishing", async () => {

        /*
        | In a real run an ad-hoc delegation failed before its agent
        | started: no agent:start, no agent:end, nothing in the log
        | between delegation:graph and the parent's next iteration.
        */

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "delegate",

                            delegations: [
                                {
                                    id: "doomed",
                                    agent: null,
                                    persona: "general_engineer",
                                    skills: ["file_management"],

                                    /* a tool the parent does not have */
                                    tools: ["nonexistent_tool"],

                                    task: "do something",
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return { message: finalAction("carried on alone") };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /Delegation "doomed" to .* failed/);

        /* the parent was told, in the results it reads */
        const results =
            stub.state.requests[1].messages
                .filter(message => message.role === "user")
                .map(message => message.content)
                .join("\n");

        assert.match(results, /sub_agent_results/);
        assert.match(results, /doomed/);

        run.cleanup();
    });

    await test("a command that exits non-zero is not reported as ok", async () => {

        /*
        | In a real run "cd /workspace && npx tsc --build" produced
        | "terminal_exec ok 112 ms" in the console, and the build had
        | never run at all.
        */

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "build",
                                    name: "terminal_exec",
                                    arguments: {
                                        command: "exit 3",
                                        timeout_ms: 5000
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return { message: finalAction("saw the exit code") };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        const result =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(message => message.role === "tool")[0]
                    .content
            );

        /* the model still receives it as data, not as a failure */
        assert.equal(result.success, true);
        assert.equal(result.result.exit_code, 3);

        run.cleanup();
    });

    await test("an overwrite that removes most of a file says so", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "shrink",
                                    name: "fs_write",
                                    arguments: {
                                        path: "bulk.txt",
                                        content: "x"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return { message: finalAction("rewrote it") };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        const result =
            JSON.parse(
                stub.state.requests[1].messages
                    .filter(message => message.role === "tool")[0]
                    .content
            ).result;

        assert.equal(result.replaced.previous_bytes, 40000);
        assert.equal(result.bytes_written, 1);
        assert.match(result.warning, /removed 100% of bulk\.txt/);

        run.cleanup();
    });

    await test("an ad-hoc sub-agent composed the way the prompt shows it works", async () => {

        /*
        | The run that started all of this delegated once, to an ad-hoc
        | agent, and lost it instantly. This is that delegation, written
        | exactly the way the system prompt teaches it.
        */

        const stub =
            await startStub((request, index, state) => {

                /* only a sub-agent is given the agent runtime rules */
                const isChild =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_runtime_rules")
                    );

                if (isChild) {

                    state.child = (state.child || 0) + 1;

                    if (state.child === 1) {

                        return {
                            message: action({
                                action: "tool_call",

                                tool_calls: [
                                    {
                                        id: "look",
                                        name: "search_start",
                                        arguments: {
                                            path: ".",
                                            query: "*.txt",
                                            mode: "files",
                                            wait_ms: 2000
                                        },
                                        depends_on: []
                                    }
                                ]
                            })
                        };
                    }

                    return {
                        message: finalAction("the loader is in notes.txt")
                    };
                }

                if (!state.delegated) {

                    state.delegated = true;

                    return {
                        message: action({
                            action: "delegate",

                            delegations: [
                                {
                                    id: "analysis_2",
                                    agent: null,
                                    persona: "general_engineer",
                                    skills: ["file_management"],
                                    tools: ["fs_read", "search_start", "search_get"],
                                    task: "Locate the configuration loader.",
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                return {
                    message: finalAction("the sub-agent reported back")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0);

        /* the sub-agent really ran, and its report reached the parent */
        assert.match(run.stdout, /adhoc:general_engineer/);
        assert.match(run.stdout, /the loader is in notes\.txt/);
        assert.match(run.stdout, /the sub-agent reported back/);

        /* the glob search inside the sub-agent found the file */
        assert.match(run.stdout, /notes\.txt/);

        run.cleanup();
    });

    await test("an agent working alone with a full agent budget is reminded", async () => {

        /*
        | A real run spent 28 iterations implementing alone while all 15
        | sub-agents went unused. Saying so in the prompt did not work,
        | so the runtime says it at the moment it is true.
        */

        let hinted = false;
        let hintNotice = null;

        const stub =
            await startStub((request, index, state) => {

                const notice =
                    [...request.messages]
                        .reverse()
                        .find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.includes("delegation_available")
                        );

                if (notice) {

                    hinted = true;
                    hintNotice = JSON.parse(notice.content);

                    return {
                        message: finalAction("noted, carrying on alone")
                    };
                }

                if (index === 1) {

                    return {
                        message: action({
                            action: "tool_call",

                            tool_calls: [
                                {
                                    id: "plan",
                                    name: "plan_set",
                                    arguments: {
                                        objective: "three independent things",
                                        phases: [
                                            {
                                                id: "P1",
                                                title: "work",
                                                steps: [
                                                    { id: "P1.1", title: "one", agent: "implementation" },
                                                    { id: "P1.2", title: "two", agent: "testing" },
                                                    { id: "P1.3", title: "three", agent: null }
                                                ]
                                            }
                                        ]
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                state.calls = (state.calls || 0) + 1;

                return {
                    message: action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: `read_${state.calls}`,
                                name: "fs_read",
                                arguments: { path: "notes.txt" },
                                depends_on: []
                            }
                        ]
                    })
                };
            });

        const run =
            await runAgent(
                stub.port,
                { DELEGATION_NUDGE_AFTER: "3" }
            );

        await stub.close();

        assert.equal(hinted, true, "the agent was never reminded");
        assert.deepEqual(
            hintNotice.assigned_steps.map(step => `${step.id}:${step.agent}`),
            ["P1.1:implementation", "P1.2:testing"]
        );
        assert.match(hintNotice.instruction, /P1\.1 → implementation/);
        assert.equal(run.code, 0);
        assert.match(run.stdout, /suggesting delegation/);
        assert.match(run.stdout, /agents unused/);

        run.cleanup();
    });

    await test("an agent that delegates is never reminded", async () => {

        let hinted = false;

        const stub =
            await startStub((request, index, state) => {

                if (
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("delegation_available")
                    )
                ) {
                    hinted = true;
                }

                const isChild =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes("agent_runtime_rules")
                    );

                if (isChild) {
                    return { message: finalAction("child done") };
                }

                if (index === 1) {

                    return {
                        message: action({
                            action: "delegate",

                            delegations: [
                                {
                                    id: "d1",
                                    agent: "git_analysis",
                                    persona: null,
                                    skills: null,
                                    tools: null,
                                    task: "report the repository state",
                                    depends_on: []
                                }
                            ]
                        })
                    };
                }

                state.calls = (state.calls || 0) + 1;

                if (state.calls > 6) {
                    return { message: finalAction("done") };
                }

                return {
                    message: action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: `read_${state.calls}`,
                                name: "fs_read",
                                arguments: { path: "notes.txt" },
                                depends_on: []
                            }
                        ]
                    })
                };
            });

        const run =
            await runAgent(
                stub.port,
                { DELEGATION_NUDGE_AFTER: "2" }
            );

        await stub.close();

        assert.equal(hinted, false, "an agent that delegated was still nagged");

        run.cleanup();
    });

    await test("the runtime journals endpoint thinking and tools per agent", async () => {

        const stub =
            await startStub((request, index) => {

                if (index === 1) {

                    return {
                        message: {
                            ...action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "journal_read",
                                        name: "fs_read",
                                        arguments: { path: "notes.txt" },
                                        depends_on: []
                                    }
                                ]
                            }),
                            reasoning_content:
                                "I should inspect notes.txt before answering."
                        }
                    };
                }

                return {
                    message: finalAction("journalled")
                };
            });

        const run =
            await runAgent(stub.port);

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);

        const root =
            path.join(run.workspace, ".agent", "journal");
        const day = fs.readdirSync(root)[0];
        const records =
            fs.readFileSync(
                path.join(root, day, "main_agent.jsonl"),
                "utf8"
            )
                .trim()
                .split("\n")
                .map(line => JSON.parse(line));

        assert.ok(
            records.some(
                item =>
                    item.kind === "thinking" &&
                    String(item.thinking).includes("inspect notes.txt")
            )
        );
        assert.ok(
            records.some(
                item =>
                    item.kind === "tool" &&
                    item.tools[0].name === "fs_read" &&
                    item.tools[0].success === true
            )
        );

        run.cleanup();
    });

    await test("a required before_task hook stops the model loop", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("model should not be called")
            }));

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [
                                    {
                                        id: "precondition",
                                        type: "tool",
                                        tool: "fs_read",
                                        arguments: { path: "missing-precondition.txt" },
                                        on_failure: "stop"
                                    }
                                ],
                                after_task: []
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.equal(stub.state.requests.length, 0);
        assert.match(run.stderr, /Required before_task hook "precondition" failed/);

        run.cleanup();
    });

    await test("after_task tool hooks run only after files changed", async () => {

        const stub =
            await startStub((request, index) => ({
                message:
                    index === 1
                        ? action({
                            action: "tool_call",
                            tool_calls: [
                                {
                                    id: "write",
                                    name: "fs_write",
                                    arguments: {
                                        path: "hooked.txt",
                                        content: "changed\n"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                        : finalAction("main work finished")
            }));

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "inspect_change",
                                        type: "tool",
                                        tool: "fs_info",
                                        when: "files_changed",
                                        arguments: { path: "hooked.txt" },
                                        on_failure: "stop"
                                    }
                                ]
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0);
        assert.match(run.stdout, /Automated routine/);
        assert.match(run.stdout, /inspect_change: ok/);
        assert.match(run.stdout, /hooked\.txt/);

        run.cleanup();
    });

    await test("a required after_task hook marks the final answer incomplete", async () => {

        const stub =
            await startStub((request, index) => ({
                message:
                    index === 1
                        ? action({
                            action: "tool_call",
                            tool_calls: [
                                {
                                    id: "write",
                                    name: "fs_write",
                                    arguments: {
                                        path: "changed.txt",
                                        content: "changed\n"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                        : finalAction("claimed success")
            }));

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "required_check",
                                        type: "tool",
                                        tool: "fs_read",
                                        when: "files_changed",
                                        arguments: { path: "does-not-exist.txt" },
                                        on_failure: "stop"
                                    }
                                ]
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.match(run.stdout + run.stderr, /HOOK_FAILED/);
        assert.match(run.stdout + run.stderr, /required_check: failed/);

        run.cleanup();
    });

    await test("after_task hooks still report when the main run throws", async () => {

        const stub =
            await startStub(() => ({
                message:
                    action({
                        action: "final",
                        response: null
                    })
            }));

        const run =
            await runAgent(
                stub.port,
                {
                    HOOKS_ENABLED: "true",
                    MAX_MALFORMED_RESPONSES: "0"
                },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "failure_diagnostic",
                                        type: "tool",
                                        tool: "fs_list",
                                        arguments: { path: "." },
                                        on_failure: "report"
                                    }
                                ]
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 1);
        assert.match(run.stderr, /Final response is missing/);
        assert.match(run.stderr, /Automated routine/);
        assert.match(run.stderr, /failure_diagnostic: ok/);

        run.cleanup();
    });

    await test("agent hooks use registered profiles and report their evidence", async () => {

        const stub =
            await startStub((request, index) => {

                const isTesting =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes('"type":"agent_profile","name":"testing"')
                    );

                if (isTesting) {

                    const inspected =
                        request.messages.some(message => message.role === "tool");

                    return {
                        message:
                            inspected
                                ? finalAction("npm test passed with exit code 0")
                                : action({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "inspect_change",
                                            name: "fs_read",
                                            arguments: { path: "agent-hook.txt" },
                                            depends_on: []
                                        }
                                    ]
                                })
                    };
                }

                return {
                    message:
                        index === 1
                            ? action({
                                action: "tool_call",
                                tool_calls: [
                                    {
                                        id: "write",
                                        name: "fs_write",
                                        arguments: {
                                            path: "agent-hook.txt",
                                            content: "changed\n"
                                        },
                                        depends_on: []
                                    }
                                ]
                            })
                            : finalAction("main work finished")
                };
            });

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "verify",
                                        type: "agent",
                                        agent: "testing",
                                        when: "files_changed",
                                        task: "Verify ${files_changed} for ${objective}",
                                        on_failure: "stop"
                                    }
                                ]
                            }
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);
        assert.match(run.stdout, /verify: ok/);
        assert.match(run.stdout, /npm test passed with exit code 0/);

        run.cleanup();
    });

    await test("git_commit hooks commit only paths changed by this run", async () => {

        const stub =
            await startStub((request, index) => ({
                message:
                    index === 1
                        ? action({
                            action: "tool_call",
                            tool_calls: [
                                {
                                    id: "write",
                                    name: "fs_write",
                                    arguments: {
                                        path: "committed.txt",
                                        content: "from this run\n"
                                    },
                                    depends_on: []
                                }
                            ]
                        })
                        : finalAction("ready to record")
            }));

        const run =
            await runAgent(
                stub.port,
                { HOOKS_ENABLED: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "project.json"),
                        JSON.stringify({
                            version: "1",
                            settings: {},
                            hooks: {
                                before_task: [],
                                after_task: [
                                    {
                                        id: "record",
                                        type: "git_commit",
                                        when: "files_changed",
                                        message: "record automated run",
                                        paths: "${files_changed}",
                                        on_failure: "stop"
                                    }
                                ]
                            }
                        })
                    );

                    execFileSync("git", ["init", "-q"], { cwd: workspace });
                    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
                    execFileSync("git", ["config", "user.name", "test"], { cwd: workspace });
                    execFileSync("git", ["add", "."], { cwd: workspace });
                    execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd: workspace });

                    fs.writeFileSync(
                        path.join(workspace, "operator-staged.txt"),
                        "must remain staged\n"
                    );
                    execFileSync("git", ["add", "operator-staged.txt"], { cwd: workspace });
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);

        const latest =
            execFileSync("git", ["log", "-1", "--pretty=%s"], {
                cwd: run.workspace,
                encoding: "utf8"
            }).trim();

        assert.equal(latest, "record automated run");

        const committed =
            execFileSync("git", ["show", "--name-only", "--pretty="], {
                cwd: run.workspace,
                encoding: "utf8"
            }).trim().split(/\r?\n/).filter(Boolean);

        assert.deepEqual(committed, ["committed.txt"]);

        const stillStaged =
            execFileSync("git", ["diff", "--cached", "--name-only"], {
                cwd: run.workspace,
                encoding: "utf8"
            }).trim().split(/\r?\n/).filter(Boolean);

        assert.deepEqual(stillStaged, ["operator-staged.txt"]);

        run.cleanup();
    });

    await test("PLAN_AUTOROUTE delegates an assigned step and records evidence", async () => {

        const stub =
            await startStub(request => {

                const isImplementation =
                    request.messages.some(
                        message =>
                            typeof message.content === "string" &&
                            message.content.includes('"type":"agent_profile","name":"implementation"')
                    );

                if (isImplementation) {

                    const inspected =
                        request.messages.some(message => message.role === "tool");

                    return {
                        message:
                            inspected
                                ? finalAction("implementation evidence")
                                : action({
                                    action: "tool_call",
                                    tool_calls: [
                                        {
                                            id: "inspect",
                                            name: "fs_read",
                                            arguments: { path: "notes.txt" },
                                            depends_on: []
                                        }
                                    ]
                                })
                    };
                }

                return {
                    message: finalAction("reported autorouted work")
                };
            });

        const run =
            await runAgent(
                stub.port,
                { PLAN_AUTOROUTE: "true" },
                workspace => {

                    fs.mkdirSync(path.join(workspace, ".agent"), { recursive: true });
                    fs.writeFileSync(
                        path.join(workspace, ".agent", "plan.json"),
                        JSON.stringify({
                            objective: "build assigned work",
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                            phases: [
                                {
                                    id: "P1",
                                    title: "work",
                                    status: "pending",
                                    steps: [
                                        {
                                            id: "P1.1",
                                            title: "implement it",
                                            agent: "implementation",
                                            status: "pending",
                                            evidence: null,
                                            updated_at: null
                                        }
                                    ]
                                }
                            ]
                        })
                    );
                }
            );

        await stub.close();

        assert.equal(run.code, 0, run.stdout + run.stderr);

        const plan =
            JSON.parse(
                fs.readFileSync(
                    path.join(run.workspace, ".agent", "plan.json"),
                    "utf8"
                )
            );

        assert.equal(plan.phases[0].steps[0].status, "done");
        assert.match(plan.phases[0].steps[0].evidence, /implementation evidence/);
        assert.match(run.stdout, /reported autorouted work/);

        run.cleanup();
    });

    await test("the strict schema can be switched on and still runs", async () => {

        const stub =
            await startStub(() => ({
                message: finalAction("answered under the strict schema")
            }));

        const run =
            await runAgent(
                stub.port,
                { AGENT_SCHEMA: "strict" }
            );

        await stub.close();

        assert.equal(run.code, 0);

        const sent =
            stub.state.requests[0].response_format;

        assert.equal(sent.json_schema.strict, true);
        assert.ok(sent.json_schema.schema.required.includes("performed"));

        assert.match(run.stdout, /answered under the strict schema/);

        run.cleanup();
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
