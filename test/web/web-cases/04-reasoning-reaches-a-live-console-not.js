"use strict";

/*
| web.test.js: from "reasoning reaches a live console, not only the history"
|
| Runs inside web.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function reasoningReachesALiveConsoleNotCases(ctx) {

    const {
        WORKSPACE,
        action,
        collectEvents,
        finalAction,
        request,
        runtime,
        startModelStub,
        test,
        waitFor,
        waitForRunEnd
    } = ctx;

    await test("reasoning reaches a live console, not only the history", async () => {

        /*
        | The thinking bubble was pushed straight into the session, so it
        | appeared when a conversation was reopened and never while the
        | agent was working.
        */

        const stub =
            await startModelStub(() => ({
                role: "assistant",

                reasoning_content:
                    "first I will read the plan, then the input package",

                content:
                    JSON.stringify({
                        version: "1.0",
                        action: "final",
                        tool_calls: null,
                        delegations: null,
                        response: { type: "text", content: "done" },
                        data: null,
                        error: null
                    })
            }));

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/sessions", {});

        const stream = collectEvents();

        await waitFor(() => stream.seen.length > 0);

        await request("POST", "/api/tasks", { task: "think about it" });

        /* wait for the run to end, not for its first beat */
        await waitForRunEnd(stream);

        const thinking =
            stream.seen.filter(
                event =>
                    event.type === "session:message" &&
                    event.message.kind === "thinking"
            );

        assert.equal(
            thinking.length,
            1,
            "the reasoning never reached the live stream"
        );

        assert.match(
            thinking[0].message.content,
            /read the plan/
        );

        assert.equal(thinking[0].message.agent, "main_agent");

        /* and it is in the stored conversation as well */
        const state =
            await request("GET", "/api/state");

        assert.ok(
            state.body.messages.some(
                message => message.kind === "thinking"
            )
        );

        stream.stop();

        await stub.close();
    });

    await test("the project file remembers this workspace's settings", async () => {

        const file =
            path.join(WORKSPACE, ".agent", "project.json");

        runtime.openProject();

        runtime.settings.set("MAX_PARALLEL_TOOLS", 3);

        await request("POST", "/api/settings", {
            key: "KEEP_RECENT_EXCHANGES",
            value: 5
        });

        /* the watcher writes shortly after a change */
        await waitFor(() => {

            if (!fs.existsSync(file)) {
                return false;
            }

            const saved =
                JSON.parse(fs.readFileSync(file, "utf8"));

            return (
                saved.settings.MAX_PARALLEL_TOOLS === 3 &&
                saved.settings.KEEP_RECENT_EXCHANGES === 5
            );
        });

        const saved =
            JSON.parse(fs.readFileSync(file, "utf8"));

        /* a default is not written, only what was actually changed */
        assert.equal(saved.settings.MAX_ITERATIONS, undefined);

        /* and a secret stays out of the workspace */
        runtime.settings.set("AGENT_API_KEY", "supersecretvalue");

        await new Promise(resolve => setTimeout(resolve, 350));

        assert.equal(
            JSON.parse(fs.readFileSync(file, "utf8"))
                .settings.AGENT_API_KEY,
            undefined
        );

        /* reopening applies what was remembered */
        runtime.settings.reset("MAX_PARALLEL_TOOLS");

        assert.equal(runtime.settings.get("MAX_PARALLEL_TOOLS"), 8);

        const opened = runtime.openProject();

        assert.ok(opened.applied.includes("MAX_PARALLEL_TOOLS"));
        assert.equal(runtime.settings.get("MAX_PARALLEL_TOOLS"), 3);

        runtime.settings.reset("MAX_PARALLEL_TOOLS");
        runtime.settings.reset("KEEP_RECENT_EXCHANGES");
        runtime.settings.reset("AGENT_API_KEY");
    });

    await test("the console can keep cycling until the plan is done", async () => {

        /* the model finishes one step per run, as a real one would */

        const stub =
            await startModelStub(request => {

                const context =
                    JSON.parse(
                        request.messages.find(
                            message =>
                                typeof message.content === "string" &&
                                message.content.startsWith("{") &&
                                message.content.includes("runtime_context")
                        ).content
                    ).context;

                const plan = context.plan || {};

                if (!plan.exists) {

                    return action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "s",
                                name: "plan_set",
                                arguments: {
                                    objective: "three small things",
                                    phases: [
                                        {
                                            id: "P1",
                                            title: "work",
                                            steps: [
                                                { id: "P1.1", title: "one" },
                                                { id: "P1.2", title: "two" }
                                            ]
                                        }
                                    ]
                                },
                                depends_on: []
                            }
                        ]
                    });
                }

                /*
                | One step per run: once this run has a tool result it
                | stops, which is what forces the console to start the
                | next cycle by itself.
                */

                const workedAlready =
                    request.messages.some(
                        message => message.role === "tool"
                    );

                if (workedAlready) {

                    return finalAction("one step done, stopping this run");
                }

                if (plan.next_step) {

                    return action({
                        action: "tool_call",

                        tool_calls: [
                            {
                                id: "u",
                                name: "plan_update",
                                arguments: {
                                    updates: [
                                        {
                                            id: plan.next_step.id,
                                            status: "done",
                                            evidence: "finished in this cycle"
                                        }
                                    ]
                                },
                                depends_on: []
                            }
                        ]
                    });
                }

                return finalAction("nothing open");
            });

        process.env.AGENT_BASE_URL =
            `http://127.0.0.1:${stub.port}/v1`;

        await request("POST", "/api/clear");

        await request("POST", "/api/settings", {
            key: "AUTO_CONTINUE",
            value: true
        });

        /*
        | In-run continuation would finish the plan inside a single run,
        | which is the better path but not what this test is about, so
        | it is switched off to isolate the console's own cycling.
        */

        await request("POST", "/api/settings", {
            key: "MAX_PLAN_CONTINUATIONS",
            value: 0
        });

        /* one push, then the console keeps itself going */
        await request("POST", "/api/tasks", {
            task: "do the whole plan"
        });

        await waitFor(async () => {

            const state =
                await request("GET", "/api/state");

            return (
                state.body.plan &&
                state.body.plan.complete === true
            );

        }, 20000);

        const state =
            await request("GET", "/api/state");

        assert.equal(state.body.plan.done, 2);
        assert.equal(Array.isArray(state.body.plan.phases), true);
        assert.equal(state.body.plan.phases[0].steps.length, 2);
        assert.ok(
            state.body.cycles >= 1,
            "no automatic cycle was started"
        );

        /* each cycle starts a fresh conversation, the plan carries state */
        assert.ok(
            state.body.turns <= 2,
            `the transcript accumulated across cycles: ${state.body.turns} turns`
        );

        await request("POST", "/api/settings", {
            key: "AUTO_CONTINUE",
            reset: true
        });

        await request("POST", "/api/settings", {
            key: "MAX_PLAN_CONTINUATIONS",
            reset: true
        });

        await stub.close();
    });

    await test("statistics report what the runtime executed", async () => {

        const stats =
            await request("GET", "/api/stats");

        assert.equal(stats.status, 200);
        assert.ok(stats.body.total_calls > 0);
    });
};
