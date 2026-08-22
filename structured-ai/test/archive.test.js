const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-archive-test-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;

const settings = require("../agent/lib/storage");
const archive = require("../agent/lib/archive");
const tools = require("../agent/tools");

const { findExchanges } = require("../agent/lib/context");

const results = [];


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


function reset() {

    fs.rmSync(
        path.join(WORKSPACE, ".agent"),
        { recursive: true, force: true }
    );
}


/*
| Builds a transcript the way the runtime does: an assistant message
| carrying tool_calls, then one tool message per call.
*/

function buildRun(options = {}) {

    const count = options.count || 20;

    const messages = [
        { role: "user", content: "objective" }
    ];

    for (let index = 0; index < count; index++) {

        const id = `call_${index}`;

        const tool =
            options.tool
                ? options.tool(index)
                : index % 5 === 0
                    ? "fs_write"
                    : "fs_read";

        const args =
            options.args
                ? options.args(index)
                : { path: `src/file${index % 4}.ts` };

        messages.push({
            role: "assistant",
            tool_calls: [
                {
                    id,
                    type: "function",
                    function: {
                        name: tool,
                        arguments: JSON.stringify(args)
                    }
                }
            ]
        });

        const failed =
            options.failed
                ? options.failed(index)
                : false;

        messages.push({
            role: "tool",
            tool_call_id: id,
            content:
                JSON.stringify(
                    failed
                        ? {
                            code: "Error",
                            message: `cannot resolve import in file${index % 4}.ts`,
                            retryable: false
                        }
                        : {
                            path: args.path,
                            content: "x".repeat(options.size || 400)
                        }
                )
        });
    }

    return messages;
}


function archiveRun(messages, meta) {

    return archive.archiveEvents(
        archive.eventsFromExchanges(
            messages,
            findExchanges(messages),
            meta || { agent: "main_agent", run: "run-1" }
        )
    );
}


async function main() {

    console.log("\narchive");

    await test("every folded tool call becomes a retrievable record", async () => {

        reset();

        const messages =
            buildRun({
                count: 8,
                args: index => ({ path: `src/file${index}.ts` })
            });

        const report = archiveRun(messages);

        assert.equal(report.enabled, true);
        assert.equal(report.added, 8);
        assert.equal(report.duplicates, 0);

        const index = archive.loadIndex();

        assert.equal(index.records.length, 8);

        /* the body is on disk, not in the index */
        const record = index.records[0];

        assert.ok(record.summary.length <= settings.get("ARCHIVE_SUMMARY_CHARS") + 1);
        assert.match(archive.readBody(record), /src\/file0\.ts/);
    });

    await test("identical work is counted once instead of stored twice", async () => {

        reset();

        const messages =
            buildRun({ count: 6 });

        const first = archiveRun(messages);
        const second = archiveRun(messages);

        assert.equal(first.added, 6);
        assert.equal(second.added, 0);
        assert.equal(second.duplicates, 6);

        const index = archive.loadIndex();

        assert.equal(index.records.length, 6);
        assert.ok(
            index.records.every(record => record.seen === 2)
        );
    });

    await test("importance follows what the call did, not how it reads", async () => {

        reset();

        const messages =
            buildRun({
                count: 10,

                tool: index =>
                    index === 1
                        ? "fs_write"
                        : index === 2
                            ? "terminal_exec"
                            : index === 3
                                ? "plan_update"
                                : "fs_read",

                args: index =>
                    index === 2
                        ? { command: "npm test" }
                        : { path: `src/file${index}.ts` },

                failed: index => index === 4
            });

        archiveRun(messages);

        const kinds =
            Object.fromEntries(
                archive.loadIndex().records.map(
                    record => [record.tool + ":" + record.id, record.kind]
                )
            );

        const kindOf = tool =>
            Object.entries(kinds)
                .filter(([key]) => key.startsWith(`${tool}:`))
                .map(([, value]) => value);

        assert.ok(kindOf("fs_write").includes("mutation"));
        assert.ok(kindOf("terminal_exec").includes("command"));
        assert.ok(kindOf("plan_update").includes("decision"));
        assert.ok(kindOf("fs_read").includes("failure"));
        assert.ok(kindOf("fs_read").includes("inspection"));
    });

    await test("a failure is retrievable by its error text", async () => {

        reset();

        archiveRun(
            buildRun({
                count: 12,
                failed: index => index === 7
            })
        );

        const found =
            archive.searchArchive("cannot resolve import");

        assert.ok(found.matches >= 1);
        assert.equal(found.results[0].kind, "failure");

        const opened =
            archive.getRecords([found.results[0].id]);

        assert.match(opened.records[0].body, /cannot resolve import/);
        assert.deepEqual(opened.missing, []);
    });

    await test("search can be narrowed by kind, agent and importance", async () => {

        reset();

        archiveRun(
            buildRun({ count: 10 }),
            { agent: "implementation", run: "run-2" }
        );

        archiveRun(
            buildRun({ count: 4, size: 500 }),
            { agent: "testing", run: "run-2" }
        );

        assert.ok(
            archive.searchArchive("", { agent: "testing", limit: 50 })
                .results.every(record => record.agent === "testing")
        );

        assert.ok(
            archive.searchArchive("", { kind: "mutation", limit: 50 })
                .results.every(record => record.kind === "mutation")
        );

        assert.ok(
            archive.searchArchive("", { min_importance: 0.7, limit: 50 })
                .results.every(record => record.importance >= 0.7)
        );
    });

    await test("a full index rolls up cheap records and keeps the important ones", async () => {

        reset();

        settings.set("ARCHIVE_MAX_RECORDS", 20);
        settings.set("ARCHIVE_ROLLUP_BATCH", 5);

        try {

            archiveRun(
                buildRun({
                    count: 60,

                    tool: index =>
                        index % 10 === 0
                            ? "fs_write"
                            : "fs_read",

                    args: index => ({ path: `src/file${index}.ts` }),

                    failed: index => index % 17 === 0
                })
            );

            const index = archive.loadIndex();

            assert.ok(
                index.records.length < 60,
                "the index was not rolled up"
            );

            /* nothing important was merged away */
            const kinds =
                index.records.map(record => record.kind);

            assert.ok(kinds.includes("failure"));
            assert.ok(kinds.includes("mutation"));
            assert.ok(kinds.includes("rollup"));

            const rollup =
                index.records.find(
                    record => record.kind === "rollup"
                );

            assert.ok(rollup.merged_from > 1);

            /* the merged titles are still readable */
            assert.match(
                archive.getRecords([rollup.id]).records[0].body,
                /fs_read/
            );

        } finally {

            settings.reset("ARCHIVE_MAX_RECORDS");
            settings.reset("ARCHIVE_ROLLUP_BATCH");
        }
    });

    await test("a roll up digests what it merged instead of listing part of it", async () => {

        reset();

        /*
        | Measured before this: 390 merged reads produced 50 surviving
        | titles and the last one was cut mid path.
        */

        settings.set("ARCHIVE_MAX_RECORDS", 20);
        settings.set("ARCHIVE_ROLLUP_BATCH", 10);

        try {

            const events = [];

            for (let index = 0; index < 300; index++) {

                events.push({
                    agent: "main_agent",

                    tool:
                        index % 4 === 0
                            ? "fs_list"
                            : "fs_read",

                    kind: "inspection",

                    title:
                        `${index % 4 === 0 ? "fs_list" : "fs_read"} packages/${
                            index % 2 === 0
                                ? "engine-core"
                                : "engine-runtime"
                        }/src/file${index}.ts`,

                    body: `body ${index}`
                });
            }

            archive.archiveEvents(events);

            const index = archive.loadIndex();

            archive.maintain(index);
            archive.saveIndex(index);

            const rollup =
                index.records.find(
                    record => record.kind === "rollup"
                );

            const body =
                archive.getRecords([rollup.id]).records[0].body;

            /* the digest answers the question even when the list cannot */
            assert.match(body, /merged into one record/);
            assert.match(body, /tools: fs_read x\d+, fs_list x\d+/);
            assert.match(body, /where: packages\/engine-/);

            /* it stays inside its own budget, not a single event's */
            assert.ok(
                body.length <=
                settings.get("ARCHIVE_ROLLUP_BODY_CHARS")
            );

            assert.ok(
                body.length >
                settings.get("ARCHIVE_BODY_CHARS"),
                "the roll up is still capped like one event"
            );

            /* and it says how much did not fit, in a line that is not cut */
            if (/more, counted above/.test(body)) {

                assert.match(
                    body.split("\n").pop(),
                    /^… \d+ more, counted above and summarised in the digest\.$/
                );
            }

        } finally {

            settings.reset("ARCHIVE_MAX_RECORDS");
            settings.reset("ARCHIVE_ROLLUP_BATCH");
        }
    });

    await test("merged bodies are reclaimed unless asked for", async () => {

        const build = () => {

            const events = [];

            for (let index = 0; index < 80; index++) {

                events.push({
                    agent: "main_agent",
                    tool: "fs_read",
                    kind: "inspection",
                    title: `fs_read src/file${index}.ts`,
                    body: `body ${index}`
                });
            }

            archive.archiveEvents(events);

            const index = archive.loadIndex();

            archive.maintain(index);
            archive.saveIndex(index);

            return index.records.find(
                record => record.kind === "rollup"
            );
        };

        settings.set("ARCHIVE_MAX_RECORDS", 20);
        settings.set("ARCHIVE_ROLLUP_BATCH", 10);

        try {

            /* the default reclaims the space, and promises nothing */
            reset();

            const reclaimed = build();

            assert.equal(reclaimed.merged_ids, undefined);

            /* asked to keep them, the originals stay openable by id */
            reset();

            settings.set("ARCHIVE_KEEP_MERGED_BODIES", true);

            const kept = build();

            assert.ok(kept.merged_ids.length > 0);

            const original =
                archive.getRecords([kept.merged_ids[0]]);

            assert.equal(original.missing.length, 0);
            assert.match(original.records[0].body, /body \d+/);
            assert.match(original.records[0].note, /merged into a roll up/);

        } finally {

            settings.reset("ARCHIVE_KEEP_MERGED_BODIES");
            settings.reset("ARCHIVE_MAX_RECORDS");
            settings.reset("ARCHIVE_ROLLUP_BATCH");
        }
    });

    await test("segments follow the index instead of growing forever", async () => {

        reset();

        settings.set("ARCHIVE_SEGMENT_RECORDS", 10);

        try {

            archiveRun(
                buildRun({
                    count: 40,
                    args: index => ({ path: `src/file${index}.ts` })
                })
            );

            const directory = archive.archiveDirectory();

            const segments =
                fs.readdirSync(directory)
                    .filter(name => name.endsWith(".jsonl"));

            assert.ok(segments.length >= 4, "segments did not rotate");

            /* drop every record and let maintenance reclaim the files */
            const index = archive.loadIndex();

            index.records = [];

            archive.compactSegments(index);
            archive.saveIndex(index);

            assert.deepEqual(
                fs.readdirSync(directory)
                    .filter(name => name.endsWith(".jsonl")),
                []
            );

        } finally {

            settings.reset("ARCHIVE_SEGMENT_RECORDS");
        }
    });

    await test("a corrupt index degrades to empty instead of throwing", async () => {

        reset();

        archiveRun(buildRun({ count: 3 }));

        fs.writeFileSync(archive.indexPath(), "{ not json", "utf8");

        assert.equal(archive.loadIndex().records.length, 0);

        /* and the next write still succeeds */
        const report = archiveRun(buildRun({ count: 2 }));

        assert.equal(report.added, 2);
    });

    await test("the archive can be switched off at runtime", async () => {

        reset();

        settings.set("ARCHIVE_ENABLED", false);

        try {

            const report = archiveRun(buildRun({ count: 4 }));

            assert.equal(report.enabled, false);
            assert.equal(report.added, 0);

            assert.equal(
                fs.existsSync(archive.archiveDirectory()),
                false
            );

        } finally {

            settings.reset("ARCHIVE_ENABLED");
        }
    });

    await test("compaction hands a dropped exchange over before destroying it", async () => {

        reset();

        const { compactConversation } =
            require("../agent/lib/context");

        const messages =
            buildRun({ count: 6, size: 4000 });

        const dropped = [];

        const report =
            compactConversation(messages, {
                maxChars: 2000,
                keepRecentExchanges: 1,

                onDrop: (current, exchange) => {

                    dropped.push(
                        current[exchange.start]
                            .tool_calls[0].function.name
                    );
                }
            });

        assert.ok(report.dropped_exchanges > 0);

        assert.equal(
            dropped.length,
            report.dropped_exchanges
        );
    });

    /* ---------------------------------------------------------------- */
    console.log("\nretrieval tools");

    await test("archive_search returns previews, never bodies", async () => {

        reset();

        archiveRun(
            buildRun({
                count: 10,
                size: 5000,
                failed: index => index === 3
            })
        );

        const result =
            await tools.executeTool("archive_search", {
                query: "cannot resolve import",
                limit: 3
            });

        assert.ok(result.matches >= 1);
        assert.ok(result.results.length <= 3);

        assert.ok(
            result.results.every(
                record => record.body === undefined
            )
        );

        const opened =
            await tools.executeTool("archive_get", {
                ids: [result.results[0].id]
            });

        assert.ok(opened.records[0].body.length > 0);
    });

    await test("archive_get refuses to browse without ids", async () => {

        let message = "";

        try {

            await tools.executeTool("archive_get", {});

        } catch (error) {

            message = error.message;
        }

        assert.match(message, /needs ids/);
    });

    await test("memory_get reports memory and the archive behind it", async () => {

        reset();

        const memoryStore = require("../agent/lib/memory");

        const memory = memoryStore.emptyMemory();

        memory.decisions = ["the loader lives in src/boot.ts"];

        memoryStore.saveMemory(memory);

        archiveRun(buildRun({ count: 5 }));

        const result =
            await tools.executeTool("memory_get", {});

        assert.deepEqual(
            result.memory.decisions,
            ["the loader lives in src/boot.ts"]
        );

        assert.equal(result.archive.records, 5);
        assert.equal(result.archive.enabled, true);
    });

    /* ---------------------------------------------------------------- */
    console.log("\nscale");

    await test("a half million token run fits in a bounded archive", async () => {

        reset();

        const messages =
            buildRun({
                count: 1200,
                size: 1500,

                tool: index =>
                    index % 7 === 0
                        ? "fs_write"
                        : index % 11 === 0
                            ? "terminal_exec"
                            : "fs_read",

                args: index =>
                    index % 11 === 0
                        ? { command: `npm test -- suite${index % 5}` }
                        : { path: `src/module${index % 40}/file${index % 9}.ts` },

                failed: index => index % 23 === 0
            });

        const transcript =
            JSON.stringify(messages).length;

        assert.ok(
            transcript > 1500000,
            `the fixture is too small: ${transcript}`
        );

        const report = archiveRun(messages);

        /* deduplication does the heavy lifting before any roll up */
        assert.ok(report.duplicates > report.added);

        const stats = archive.stats();

        assert.ok(stats.records <= settings.get("ARCHIVE_MAX_RECORDS"));
        assert.ok(stats.by_kind.failure > 0);

        /* and the failure from the middle of the run is still findable */
        const found =
            archive.searchArchive("cannot resolve import file3", { limit: 5 });

        assert.ok(found.matches > 0);
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
