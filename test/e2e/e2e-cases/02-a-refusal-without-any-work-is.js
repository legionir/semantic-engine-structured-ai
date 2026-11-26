"use strict";

/*
| e2e.test.js: end to end, from "a refusal without any work is handed back once"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function aRefusalWithoutAnyWorkIsCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

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
};
