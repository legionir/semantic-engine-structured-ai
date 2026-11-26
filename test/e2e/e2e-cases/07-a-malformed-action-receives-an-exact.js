"use strict";

/*
| e2e.test.js: end to end, from "a malformed action receives an exact corrective contract before retry"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function aMalformedActionReceivesAnExactCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

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
};
