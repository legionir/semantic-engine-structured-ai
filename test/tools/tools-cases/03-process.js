"use strict";

/*
| tools.test.js: process, plan
|
| Runs inside tools.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function processCases(ctx) {

    const {
        WORKSPACE,
        cleanupTree,
        processTreeCommand,
        readTreePids,
        rejects,
        run,
        test,
        waitForTreeStopped
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nprocess");

    await test("terminal_exec returns a non-zero exit as data", async () => {

        const result =
            await run("terminal_exec", {
                command: "exit 3"
            });

        assert.equal(result.exit_code, 3);
        assert.equal(result.success, false);
    });

    await test("terminal_exec captures stdout", async () => {

        const result =
            await run("terminal_exec", {
                command: "echo hello-runtime"
            });

        assert.match(result.stdout, /hello-runtime/);
        assert.equal(result.success, true);
    });

    await test("terminal_exec children see no secrets; CHILD_ENV_PASSTHROUGH adds plain names only (roadmap P2-02)", async () => {

        const settings = require("../../../agent/config");
        const names = ["OPENAI_API_KEY", "AGENT_CONSOLE_TOKEN", "P202_DB_PASSWORD", "P202_PLAIN"];
        const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
        const script = path.join(WORKSPACE, "p202-env.js");
        fs.writeFileSync(script, `console.log(JSON.stringify(Object.keys(process.env).filter(n => ${JSON.stringify(names)}.includes(n.toUpperCase()))))`);

        try {
            for (const name of names) process.env[name] = "p202-value";
            const show = async () => JSON.parse((await run("terminal_exec", { command: `"${process.execPath}" p202-env.js` })).stdout.trim()).sort();

            assert.deepEqual(await show(), []);
            settings.set("CHILD_ENV_PASSTHROUGH", "P202_PLAIN,P202_DB_PASSWORD,OPENAI_API_KEY");
            assert.deepEqual(await show(), ["P202_PLAIN"]);
        } finally {
            settings.reset("CHILD_ENV_PASSTHROUGH");
            for (const name of names) {
                if (saved[name] === undefined) delete process.env[name];
                else process.env[name] = saved[name];
            }
            fs.rmSync(script, { force: true });
        }
    });

    await test("terminal_exec times out instead of hanging", async () => {

        const result =
            await run("terminal_exec", {
                command: `"${process.execPath}" -e "setTimeout(() => {}, 5000)"`,
                timeout_ms: 300
            });

        assert.equal(result.timed_out, true);
    });

    await test("process_start, read, write and terminate a session", async () => {

        const started =
            await run("process_start", {
                command: `"${process.execPath}" -e "process.stdin.pipe(process.stdout)"`,
                wait_ms: 200
            });

        assert.equal(started.status, "running");

        await run("process_write", {
            process_id: started.process_id,
            input: "ping"
        });

        const output =
            await run("process_read", {
                process_id: started.process_id,
                wait_ms: 1000
            });

        assert.match(output.stdout, /ping/);

        const list =
            await run("process_list", {});

        assert.ok(list.count >= 1);

        const stopped =
            await run("process_terminate", {
                process_id: started.process_id
            });

        assert.notEqual(stopped.status, "running");
    });

    await test("an oversized result is shortened as a whole, not only per string", async () => {

        /* many short strings can still blow up a conversation */

        for (let index = 0; index < 300; index++) {

            fs.mkdirSync(
                path.join(WORKSPACE, "wide", `dir${index}`),
                { recursive: true }
            );

            for (let file = 0; file < 6; file++) {

                fs.writeFileSync(
                    path.join(WORKSPACE, "wide", `dir${index}`, `file${file}.ts`),
                    "x"
                );
            }
        }

        const tree =
            await run("fs_tree", { path: "wide", max_depth: 4 });

        const size =
            JSON.stringify(tree).length;

        assert.ok(
            size <= 45000,
            `the result was ${size} chars`
        );

        assert.equal(tree.result_truncated, true);
        assert.match(tree.truncation_note, /Narrow the request/);
    });

    await test("a batch read is bounded in total", async () => {

        const paths = [];

        for (let index = 0; index < 6; index++) {

            const name = `bulk${index}.txt`;

            fs.writeFileSync(
                path.join(WORKSPACE, name),
                "y".repeat(19000)
            );

            paths.push(name);
        }

        const result =
            await run("fs_read_many", { paths });

        assert.ok(
            JSON.stringify(result).length <= 45000,
            "the batch read was not bounded"
        );
    });

    await test("a small result is returned untouched", async () => {

        const listing =
            await run("fs_list", { path: "src" });

        assert.equal(listing.result_truncated, undefined);
        assert.equal(listing.output_truncated, undefined);
    });

    await test("a timed out command does not leave its children running", async () => {

        const pidFile = path.join(WORKSPACE, "timeout-tree-pids.txt");

        try {

            await run("terminal_exec", {
                command: processTreeCommand(pidFile),
                timeout_ms: 1000
            });

            assert.equal(readTreePids(pidFile).length, 2, "the test process tree did not start");
            await waitForTreeStopped(pidFile);

        } finally {
            cleanupTree(pidFile);
        }
    });

    await test("terminating a background process kills its whole tree", async () => {

        const pidFile = path.join(WORKSPACE, "background-tree-pids.txt");
        let started;

        try {

            started = await run("process_start", {
                command: processTreeCommand(pidFile),
                wait_ms: 400
            });

            assert.equal(readTreePids(pidFile).length, 2, "the test process tree did not start");

            await run("process_terminate", {
                process_id: started.process_id,
                grace_ms: 300
            });

            await waitForTreeStopped(pidFile);

        } finally {
            cleanupTree(pidFile);
        }
    });

    /* ---------------------------------------------------------------- */
    console.log("\nplan");

    await test("a plan is written, read back and summarised", async () => {

        const created =
            await run("plan_set", {
                objective: "Build the thing",
                phases: [
                    {
                        id: "P1",
                        title: "Core",
                        steps: [
                            { id: "P1.1", title: "first", agent: "implementation" },
                            { id: "P1.2", title: "second", agent: "testing" }
                        ]
                    },
                    {
                        id: "P2",
                        title: "Docs",
                        steps: ["write the readme"]
                    }
                ]
            });

        assert.equal(created.summary.steps, 3);
        assert.equal(created.summary.done, 0);
        assert.equal(created.summary.next_step.id, "P1.1");
        assert.equal(created.summary.next_step.agent, "implementation");
        assert.deepEqual(
            created.summary.assigned_open_steps.map(step => step.agent),
            ["implementation", "testing"]
        );
        assert.deepEqual(created.summary.routine.before_task, []);

        /* a bare string becomes a step with a generated id */
        const plan = await run("plan_get", {});

        assert.equal(plan.phases[1].steps[0].id, "P2.1");
        assert.equal(plan.phases[1].steps[0].title, "write the readme");
        assert.equal(plan.phases[1].steps[0].agent, null);
    });

    await test("an agent assignment survives plan_set and can be rerouted", async () => {

        let plan = await run("plan_get", {});

        assert.equal(plan.phases[0].steps[0].agent, "implementation");

        await run("plan_update", {
            id: "P1.1",
            agent: "code_analysis"
        });

        plan = await run("plan_get", {});

        assert.equal(plan.phases[0].steps[0].agent, "code_analysis");
        assert.equal(plan.summary.next_step.agent, "code_analysis");
    });

    await test("a step cannot be marked done without evidence", async () => {

        await rejects(
            run("plan_update", {
                updates: [
                    { id: "P1.1", status: "done" }
                ]
            }),
            /without evidence/
        );
    });

    await test("progress is recorded and the phase follows its steps", async () => {

        await run("plan_update", {
            updates: [
                {
                    id: "P1.1",
                    status: "done",
                    evidence: "tests passed"
                }
            ]
        });

        const afterFirst =
            await run("plan_get", { summary_only: true });

        assert.equal(afterFirst.summary.done, 1);
        assert.equal(afterFirst.summary.next_step.id, "P1.2");

        const plan = await run("plan_get", {});

        assert.equal(plan.phases[0].status, "in_progress");

        await run("plan_update", {
            updates: [
                {
                    id: "P1.2",
                    status: "done",
                    evidence: "tests passed"
                }
            ]
        });

        const finished = await run("plan_get", {});

        assert.equal(finished.phases[0].status, "done");
        assert.equal(finished.summary.complete, false);
    });

    await test("steps can be added to a phase before it starts", async () => {

        const updated =
            await run("plan_update", {
                add_steps: [
                    {
                        phase_id: "P2",
                        steps: [
                            { title: "add an example" }
                        ]
                    }
                ]
            });

        assert.equal(updated.summary.steps, 4);
    });

    await test("rewriting the plan keeps the progress already recorded", async () => {

        const rewritten =
            await run("plan_set", {
                objective: "Build the thing, revised",
                phases: [
                    {
                        id: "P1",
                        title: "Core",
                        steps: [
                            { id: "P1.1", title: "first" },
                            { id: "P1.2", title: "second" },
                            { id: "P1.3", title: "third" }
                        ]
                    }
                ]
            });

        assert.equal(rewritten.summary.done, 2);
        assert.equal(rewritten.summary.next_step.id, "P1.3");
    });

    await test("the plan is complete only when nothing is open", async () => {

        await run("plan_update", {
            updates: [
                {
                    id: "P1.3",
                    status: "done",
                    evidence: "done and verified"
                }
            ]
        });

        const summary =
            await run("plan_get", { summary_only: true });

        assert.equal(summary.summary.complete, true);
        assert.equal(summary.summary.next_step, null);
    });

    await test("an unknown id is rejected rather than silently ignored", async () => {

        await rejects(
            run("plan_update", {
                updates: [
                    { id: "nope", status: "done", evidence: "x" }
                ]
            }),
            /Unknown plan id/
        );
    });
};
