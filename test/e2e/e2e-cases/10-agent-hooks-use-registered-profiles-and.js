"use strict";

/*
| e2e.test.js: end to end, from "agent hooks use registered profiles and report their evidence"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");


module.exports = async function agentHooksUseRegisteredProfilesAndCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

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
};
