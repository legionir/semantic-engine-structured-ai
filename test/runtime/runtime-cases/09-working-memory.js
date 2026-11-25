"use strict";

/*
| runtime.test.js: working memory
|
| Runs inside runtime.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");


module.exports = async function workingMemoryCases(ctx) {

    const {
        buildConversation,
        runtime,
        settings,
        test
    } = ctx;

    /* ---------------------------------------------------------------- */
    console.log("\nworking memory");

    const memory = require("../../../agent/context/Memory");

    await test("memory merges without duplicating and stays capped", async () => {

        settings.set("MEMORY_MAX_ITEMS", 3);

        const first =
            memory.mergeMemory(memory.emptyMemory(), {
                goals: ["Ship the API", "ship the api "],
                decisions: ["Use Node"]
            });

        assert.deepEqual(first.goals, ["ship the api"]);
        assert.equal(first.chunks_absorbed, 1);

        const second =
            memory.mergeMemory(first, {
                decisions: ["Use Postgres", "Use Redis", "Use S3"]
            });

        /* the oldest entry falls off the end, the newest survive */
        assert.equal(second.decisions.length, 3);
        assert.equal(second.decisions.includes("Use S3"), true);

        settings.reset("MEMORY_MAX_ITEMS");
    });

    await test("material is chunked so a small model is never overloaded", async () => {

        const material =
            Array.from({ length: 40 }, (_, index) =>
                `result: ${"x".repeat(500)} ${index}`
            ).join("\n");

        const chunks =
            memory.chunkText(material, 2000);

        assert.ok(chunks.length > 5);

        for (const chunk of chunks) {

            assert.ok(
                chunk.length <= 2100,
                `a chunk was ${chunk.length} chars`
            );
        }
    });

    await test("absorption is incremental: one chunk plus memory at a time", async () => {

        settings.set("MEMORY_CHUNK_CHARS", 1500);

        const seen = [];

        const material =
            Array.from({ length: 12 }, (_, index) =>
                `result: ${"y".repeat(400)} step ${index}`
            ).join("\n");

        const result =
            await memory.absorb(
                memory.emptyMemory(),
                material,
                async prompt => {

                    seen.push(prompt.length);

                    return JSON.stringify({
                        facts: [`fact ${seen.length}`]
                    });
                }
            );

        assert.ok(result.chunks > 2);
        assert.equal(result.absorbed, result.chunks);

        /* the summariser never saw the whole history */
        for (const size of seen) {

            assert.ok(
                size < 2600,
                `the summariser was handed ${size} chars`
            );
        }

        assert.equal(result.memory.facts.length, result.chunks);

        settings.reset("MEMORY_CHUNK_CHARS");
    });

    await test("one memory fold caps and parallelises summariser calls", async () => {

        settings.set("MEMORY_CHUNK_CHARS", 500);
        settings.set("MEMORY_MAX_SUMMARY_CALLS", 3);
        settings.set("MEMORY_SUMMARY_PARALLELISM", 3);

        let calls = 0;
        let active = 0;
        let widest = 0;

        const material =
            Array.from({ length: 20 }, (_, index) =>
                `result: ${"z".repeat(420)} chunk ${index}`
            ).join("\n");

        const result =
            await memory.absorb(
                memory.emptyMemory(),
                material,
                async () => {

                    calls++;
                    active++;
                    widest = Math.max(widest, active);

                    await new Promise(resolve => setTimeout(resolve, 20));

                    active--;

                    return JSON.stringify({
                        facts: [`sample ${calls}`]
                    });
                }
            );

        assert.ok(result.chunks > 10);
        assert.equal(result.attempted, 3);
        assert.equal(result.absorbed, 3);
        assert.equal(result.skipped, result.chunks - 3);
        assert.equal(calls, 3);
        assert.ok(widest > 1, "summary calls ran sequentially");

        settings.reset("MEMORY_SUMMARY_PARALLELISM");
        settings.reset("MEMORY_MAX_SUMMARY_CALLS");
        settings.reset("MEMORY_CHUNK_CHARS");
    });

    await test("cancellation stops later memory summary batches", async () => {

        settings.set("MEMORY_CHUNK_CHARS", 500);
        settings.set("MEMORY_MAX_SUMMARY_CALLS", 5);
        settings.set("MEMORY_SUMMARY_PARALLELISM", 2);

        const controller = new AbortController();
        let calls = 0;

        const material =
            Array.from({ length: 20 }, (_, index) =>
                `result: ${"q".repeat(420)} chunk ${index}`
            ).join("\n");

        try {

            await assert.rejects(
                memory.absorb(
                    memory.emptyMemory(),
                    material,
                    async () => {

                        calls++;

                        if (calls === 2) {
                            controller.abort(new Error("cancelled memory fold"));
                        }

                        await new Promise(resolve => setTimeout(resolve, 10));

                        return JSON.stringify({ facts: [`call ${calls}`] });
                    },
                    {
                        getSignal: () => controller.signal
                    }
                ),
                /cancelled memory fold/
            );

            assert.equal(calls, 2);

        } finally {
            settings.reset("MEMORY_SUMMARY_PARALLELISM");
            settings.reset("MEMORY_MAX_SUMMARY_CALLS");
            settings.reset("MEMORY_CHUNK_CHARS");
        }
    });

    await test("a summariser that fails or babbles cannot corrupt memory", async () => {

        const start =
            memory.mergeMemory(memory.emptyMemory(), {
                decisions: ["keep this"]
            });

        const broken =
            await memory.absorb(
                start,
                "result: something happened",
                async () => "I am not JSON at all"
            );

        assert.equal(broken.absorbed, 0);
        assert.deepEqual(broken.memory.decisions, ["keep this"]);

        const thrown =
            await memory.absorb(
                start,
                "result: something happened",
                async () => {
                    throw new Error("endpoint down");
                }
            );

        assert.equal(thrown.absorbed, 0);
        assert.match(thrown.failures[0], /endpoint down/);
        assert.deepEqual(thrown.memory.decisions, ["keep this"]);
    });

    await test("memory folds back into itself when it outgrows its budget", async () => {

        settings.set("MEMORY_MAX_CHARS", 500);

        const bloated =
            memory.mergeMemory(memory.emptyMemory(), {
                facts: Array.from(
                    { length: 12 },
                    (_, index) => `a fairly long remembered fact number ${index}`
                )
            });

        assert.ok(memory.memorySize(bloated) > 500);

        const result =
            await memory.condense(
                bloated,
                async () =>
                    JSON.stringify({
                        facts: ["twelve facts about the project"]
                    })
            );

        assert.equal(result.condensed, true);
        assert.deepEqual(
            result.memory.facts,
            ["twelve facts about the project"]
        );

        settings.reset("MEMORY_MAX_CHARS");
    });

    await test("the fold keeps recent exchanges and leaves one memory message", async () => {

        const http = require("http");

        const server =
            http.createServer((req, res) => {

                let body = "";

                req.on("data", chunk => {
                    body += chunk;
                });

                req.on("end", () => {

                    res.setHeader(
                        "content-type",
                        "application/json"
                    );

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message: {
                                        role: "assistant",
                                        content: JSON.stringify({
                                            facts: ["read a lot of files"],
                                            open_tasks: ["finish the router"]
                                        })
                                    }
                                }
                            ]
                        })
                    );
                });
            });

        await new Promise(
            resolve => server.listen(0, "127.0.0.1", resolve)
        );

        settings.set(
            "AGENT_BASE_URL",
            `http://127.0.0.1:${server.address().port}/v1`
        );

        settings.set("KEEP_RECENT_EXCHANGES", 2);
        settings.set("MEMORY_CHUNK_CHARS", 4000);

        const messages =
            buildConversation(10, 1500);

        const before = messages.length;

        runtime.startRun();

        const report =
            await runtime.foldIntoMemory(messages, "test");

        assert.ok(report);
        assert.equal(report.folded_exchanges, 8);
        assert.ok(report.after < report.before);

        const memoryMessages =
            messages.filter(
                item =>
                    typeof item.content === "string" &&
                    item.content.includes("working_memory")
            );

        assert.equal(memoryMessages.length, 1);

        /* the two newest exchanges are still there, untouched */
        assert.equal(
            messages.filter(item => item.role === "tool").length,
            2
        );

        assert.ok(messages.length < before);

        /* what the model wrote is what the transcript now carries */
        assert.match(
            memoryMessages[0].content,
            /finish the router/
        );

        /*
        | Memory is the lossy view; the archive is the copy. What left
        | the transcript has to be retrievable afterwards.
        */

        assert.equal(report.archived > 0, true);

        const archive =
            require("../../../agent/persistence/ArchiveRepository");

        const found =
            archive.searchArchive("fs_read", { limit: 50 });

        assert.ok(found.matches > 0);

        assert.ok(
            archive.getRecords([found.results[0].id])
                .records[0].body.length > 0
        );

        settings.reset("KEEP_RECENT_EXCHANGES");
        settings.reset("MEMORY_CHUNK_CHARS");
        settings.reset("AGENT_BASE_URL");

        await new Promise(resolve => server.close(resolve));
    });
};
