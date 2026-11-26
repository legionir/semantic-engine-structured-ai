"use strict";

/*
| e2e.test.js: end to end, from "the conversation stays inside the context budget"
|
| Runs inside e2e.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function theConversationStaysInsideTheContextCases(ctx) {

    const {
        action,
        finalAction,
        runAgent,
        startStub,
        test
    } = ctx;

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
};
