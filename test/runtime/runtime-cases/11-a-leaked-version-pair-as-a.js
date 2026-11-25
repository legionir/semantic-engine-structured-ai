"use strict";

/*
| runtime.test.js: malformed answers, from "a leaked version pair as a single trailing string is recovered, prose is not"
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function aLeakedVersionPairAsACases(ctx) {

    const {
        buildConversation,
        runtime,
        test,
        throws
    } = ctx;

    await test("a leaked version pair as a single trailing string is recovered, prose is not", async () => {

        const read = structured =>
            runtime.readModelAction({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: JSON.stringify(structured)
                        }
                    }
                ]
            });

        /* The model closes the object one bracket too late and drops the
           version pair as one trailing string item inside tool_calls, e.g.
           "version": "1.0". Version is protocol-fixed, so it is recovered
           instead of wasting a malformed retry. */
        const leakedVersion = read({
            action: "tool_call",
            tool_calls: [
                {
                    id: "read_plan",
                    name: "fs_read",
                    arguments: { path: "IMPLEMENTATION_PLAN.md" },
                    depends_on: []
                },
                'version": "1.0'
            ],
            delegations: null,
            response: null,
            data: null,
            error: null,
            performed: null
        });

        assert.equal(leakedVersion.structured.version, "1.0");
        assert.equal(leakedVersion.structured.tool_calls.length, 1);

        /* Arbitrary prose can never be mapped to a call, so it must still
           be rejected rather than silently dropped. */
        throws(
            () => read({
                action: "tool_call",
                tool_calls: [
                    {
                        id: "read_plan",
                        name: "fs_read",
                        arguments: { path: "IMPLEMENTATION_PLAN.md" },
                        depends_on: []
                    },
                    "some prose"
                ],
                delegations: null,
                response: null,
                data: null,
                error: null,
                performed: null
            }),
            /Each tool call must be an object/
        );
    });

    await test("missing fixed version and linked path text are normalised", async () => {

        const missingVersion =
            runtime.repairStructuredAction({
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
            });

        assert.equal(missingVersion.repaired, true);
        assert.deepEqual(missingVersion.defaulted_fields, ["version"]);
        assert.deepEqual(
            missingVersion.removed_items,
            ["tool_calls[-1]:version"]
        );
        assert.equal(missingVersion.action.version, "1.0");
        assert.equal(missingVersion.action.tool_calls.length, 1);
        assert.equal(
            missingVersion.action.tool_calls[0].arguments.path,
            "IMPLEMENTATION_PLAN.md"
        );
        assert.deepEqual(
            missingVersion.argument_repairs,
            [
                {
                    call_id: "read_plan",
                    tool: "fs_read",
                    fields: ["path"]
                }
            ]
        );

        const repairEvents = [];
        const collectRepair = event => repairEvents.push(event);

        runtime.events.bus.on("response:repaired", collectRepair);

        try {

            const validWithoutVersion =
                runtime.readModelAction({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: JSON.stringify({
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
                        }
                    ]
                });

            assert.equal(validWithoutVersion.structured.version, "1.0");
            assert.equal(validWithoutVersion.structured.tool_calls.length, 1);
            assert.equal(repairEvents.length, 0);

            const linkedPath =
                runtime.readModelAction({
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: JSON.stringify({
                                    action: "tool_call",
                                    data: null,
                                    delegations: null,
                                    error: null,
                                    performed: null,
                                    response: null,
                                    tool_calls: [
                                        {
                                            id: "read_linked_plan",
                                            name: "fs_read",
                                            arguments: {
                                                path: "IMPLEMENTATION_[PLAN.md](http://PLAN.md)"
                                            },
                                            depends_on: []
                                        }
                                    ]
                                })
                            }
                        }
                    ]
                });

            assert.equal(
                linkedPath.structured.tool_calls[0].arguments.path,
                "IMPLEMENTATION_PLAN.md"
            );
            assert.equal(repairEvents.length, 1);
            assert.equal(repairEvents[0].tool, "action_envelope");
            assert.deepEqual(repairEvents[0].dropped, []);

        } finally {
            runtime.events.bus.off("response:repaired", collectRepair);
        }
    });

    await test("an unreadable answer is handed back instead of ending the run", async () => {

        const broken = {
            choices: [
                {
                    message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                            {
                                id: "call_1",
                                type: "function",
                                function: {
                                    name: "fs_write",
                                    arguments: '{"path":"a.ts","content":"unter'
                                }
                            }
                        ]
                    }
                }
            ]
        };

        let thrown;

        try {

            runtime.readModelAction(broken);

        } catch (error) {

            thrown = error;
        }

        assert.ok(thrown);
        assert.equal(runtime.isModelResponseError(thrown), true);
        assert.equal(thrown.code, "MALFORMED_TOOL_ARGUMENTS");
        assert.equal(thrown.details.detected_action, "tool_call");
        assert.equal(thrown.details.tool, "fs_write");
        assert.match(thrown.details.rejected_response, /call_1/);

        /* an invalid action is the model's mistake too */
        let invalid;

        try {

            runtime.readModelAction({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                version: "1.0",
                                action: "tool_call",
                                tool_calls: [],
                                delegations: null,
                                response: null,
                                data: null,
                                error: null
                            })
                        }
                    }
                ]
            });

        } catch (error) {

            invalid = error;
        }

        assert.ok(invalid);
        assert.equal(runtime.isModelResponseError(invalid), true);
        assert.equal(invalid.code, "INVALID_ACTION");
        assert.equal(invalid.details.detected_action, "tool_call");
        assert.match(invalid.details.rejected_response, /\"tool_calls\":\[\]/);

        /* inactive fields are part of the contract, not ignored payload */
        assert.throws(
            () =>
                runtime.validateAction({
                    version: "1.0",
                    action: "delegate",
                    tool_calls: null,
                    delegations: [
                        {
                            id: "analysis_1",
                            agent: "code_analysis",
                            persona: null,
                            skills: null,
                            tools: null,
                            task: "inspect",
                            depends_on: []
                        }
                    ],
                    response: null,
                    data: "I will inspect next",
                    error: null,
                    performed: null
                }),
            /data must be null/
        );

        /* a broken endpoint is not a model mistake */
        const network = new Error("socket hang up");

        assert.equal(runtime.isModelResponseError(network), false);
    });

    await test("compaction reports itself once, not twice", async () => {

        const events = require("../../../agent/events");

        const seen = [];

        const listen = event => {

            if (event.type === "context:compacted") {
                seen.push(event);
            }
        };

        events.bus.on("event", listen);

        try {

            const messages =
                buildConversation(12, 4000);

            runtime.appendToolConversation(
                messages,
                { content: null },
                [
                    {
                        id: "call_x",
                        name: "fs_read",
                        arguments: { path: "a.ts" }
                    }
                ],
                [
                    {
                        id: "call_x",
                        success: true,
                        result: { content: "y".repeat(30000) }
                    }
                ],
                "main_agent"
            );

        } finally {

            events.bus.off("event", listen);
        }

        assert.equal(
            seen.length <= 1,
            true,
            `context:compacted was emitted ${seen.length} times`
        );
    });

    await test("events carry a run/scope/iteration correlation envelope", async () => {

        const events = require("../../../agent/events");

        const seen = [];

        const listen = event => {
            if (event.type === "agent:iteration" || event.type === "tool:start") {
                seen.push(event);
            }
        };

        events.bus.on("event", listen);

        try {

            events.setContext({
                run_id: "run-2026-01-01",
                turn_id: "run-2026-01-01_t1",
                scope: null,
                iteration: null
            });

            /* the runtime sets scope/iteration before emitting the step */
            events.setContext({ scope: "main_agent", iteration: 3 });

            events.emit("agent:iteration", {
                agent: "main_agent",
                depth: 0,
                iteration: 3
            });

            events.emit("tool:start", {
                agent: "main_agent",
                id: "call_1",
                name: "fs_read"
            });

        } finally {

            events.bus.off("event", listen);

            events.setContext({
                run_id: null,
                turn_id: null,
                scope: null,
                iteration: null
            });
        }

        assert.equal(seen.length, 2);

        /* the run/turn context is attached to every event, not only run:start */
        for (const event of seen) {
            assert.equal(event.run_id, "run-2026-01-01");
            assert.equal(event.turn_id, "run-2026-01-01_t1");
        }

        /* scope/iteration fall back to the context set at agent:iteration */
        assert.equal(seen[0].scope, "main_agent");
        assert.equal(seen[0].iteration, 3);
        assert.equal(seen[1].iteration, 3);
    });
};
