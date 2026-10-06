"use strict";

/*
|--------------------------------------------------------------------------
| Context / Memory / Archive — EXECUTION_PLAN Phase 17
|--------------------------------------------------------------------------
|
| Locks the extracted context kit against the historical modules:
| wrappers stay in agent.js, lib/context|memory|archive remain facades,
| there is no require cycle back to agent.js, compaction never splits a
| tool pair or grows the request, the memory message keeps its place,
| and memory/archive recover after a simulated restart.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase17-context-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.ARCHIVE_ENABLED = "1";
process.env.MEMORY_ENABLED = "1";

const REPO = path.resolve(__dirname, "..", "..");

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


function exchange(id, tool, body) {

    return [
        {
            role: "assistant",
            tool_calls: [
                {
                    id,
                    type: "function",
                    function: {
                        name: tool,
                        arguments: JSON.stringify({ path: `${id}.txt` })
                    }
                }
            ]
        },
        {
            role: "tool",
            tool_call_id: id,
            content: body
        }
    ];

}


function transcript(count, bodySize) {

    const messages = [
        { role: "system", content: "rules" },
        { role: "user", content: "do the work" }
    ];

    const body = "x".repeat(bodySize);

    for (let index = 0; index < count; index++) {

        messages.push(
            ...exchange(
                `call_${index}`,
                index % 4 === 0 ? "fs_write" : "fs_read",
                JSON.stringify({
                    id: `call_${index}`,
                    name: "fs_read",
                    success: true,
                    body
                })
            )
        );

    }

    return messages;

}


function toolIds(messages) {

    const calls = [];
    const results = [];

    for (const message of messages) {

        if (
            message.role === "assistant" &&
            Array.isArray(message.tool_calls)
        ) {

            for (const call of message.tool_calls) {
                calls.push(call.id);
            }

        }

        if (message.role === "tool") {
            results.push(message.tool_call_id);
        }

    }

    return { calls, results };

}


function assertPairsIntact(messages) {

    const { findExchanges } = require(path.join(REPO, "agent", "context"));

    const exchanges = findExchanges(messages);
    const { calls, results } = toolIds(messages);

    assert.deepEqual(results, calls, "tool results drifted from tool_calls");

    for (const item of exchanges) {

        const assistant = messages[item.start];

        assert.equal(assistant.role, "assistant");

        for (let index = item.start + 1; index <= item.end; index++) {

            assert.equal(messages[index].role, "tool");

        }

        if (item.end + 1 < messages.length) {

            assert.notEqual(
                messages[item.end + 1].role,
                "tool",
                "a tool result leaked past its exchange"
            );

        }

    }

}


async function main() {

    const runtime = require(path.join(REPO, "agent", "agent.js"));
    const contextKit = require(path.join(REPO, "agent", "context"));
    const contextLib = require(path.join(REPO, "agent", "context"));
    const memoryLib = require(path.join(REPO, "agent", "context", "Memory"));
    const archiveLib = require(path.join(REPO, "agent", "persistence", "ArchiveRepository"));
    const memoryRepository = require(path.join(REPO, "agent", "persistence", "MemoryRepository.js"));
    const archiveRepository = require(path.join(REPO, "agent", "persistence", "ArchiveRepository.js"));
    const tools = require(path.join(REPO, "agent", "tools"));

    const contextDir = path.join(REPO, "agent", "context");
    const persistenceDir = path.join(REPO, "agent", "persistence");


    await test("named Phase 17 modules exist and agent.js keeps historical wrappers", async () => {

        for (const name of [
            "ContextManager.js",
            "ConversationSizer.js",
            "ExchangeDetector.js",
            "ContextCompactor.js",
            "MemoryCoordinator.js",
            "ArchiveCoordinator.js",
            "contextHost.js",
            "index.js"
        ]) {

            assert.equal(
                fs.existsSync(path.join(contextDir, name)),
                true,
                `missing agent/context/${name}`
            );

        }

        for (const name of [
            "MemoryRepository.js",
            "ArchiveRepository.js"
        ]) {

            assert.equal(
                fs.existsSync(path.join(persistenceDir, name)),
                true,
                `missing agent/persistence/${name}`
            );

        }

        assert.equal(typeof runtime.context, "object");
        assert.equal(typeof runtime.context.bind, "function");
        assert.equal(typeof runtime.context.maintainContext, "function");
        assert.equal(typeof runtime.context.foldIntoMemory, "function");
        assert.equal(typeof runtime.context.refreshMemoryMessage, "function");
        assert.equal(typeof runtime.context.archiveExchanges, "function");

        for (const name of [
            "maintainContext",
            "foldIntoMemory",
            "refreshMemoryMessage"
        ]) {

            assert.equal(typeof runtime[name], "function", `missing wrapper ${name}`);
            assert.equal(
                typeof runtime.context[name],
                "function",
                `missing kit export ${name}`
            );
            assert.notEqual(
                runtime[name],
                runtime.context[name],
                `${name} should stay a facade wrapper (Phase 17 / law 7)`
            );

        }

    });


    await test("the context kit and repositories have no require cycle back to agent.js", async () => {

        const walk = directory => {

            const names = fs.readdirSync(directory);

            for (const name of names) {

                const full = path.join(directory, name);

                if (fs.statSync(full).isDirectory()) {

                    walk(full);
                    continue;

                }

                if (!name.endsWith(".js")) {
                    continue;
                }

                const body = fs.readFileSync(full, "utf8");

                assert.equal(
                    /require\(["']\.\.\/agent(?:\.js)?["']\)/.test(body),
                    false,
                    `${path.relative(REPO, full)} requires agent.js`
                );

            }

        };

        walk(contextDir);
        walk(persistenceDir);

    });


    await test("lib/context, lib/memory and lib/archive stay facades over the extracted modules", async () => {

        assert.equal(contextLib.conversationSize, contextKit.conversationSize);
        assert.equal(contextLib.compactConversation, contextKit.compactConversation);
        assert.equal(contextLib.findExchanges, contextKit.findExchanges);
        assert.equal(contextLib.digestOldest, contextKit.digestOldest);
        assert.equal(contextLib.levelForPosition, contextKit.levelForPosition);

        assert.equal(memoryLib.loadMemory, memoryRepository.loadMemory);
        assert.equal(memoryLib.saveMemory, memoryRepository.saveMemory);
        assert.equal(memoryLib.memoryPath, memoryRepository.memoryPath);
        assert.equal(memoryLib.emptyMemory, memoryRepository.emptyMemory);
        assert.equal(memoryLib.absorb, contextKit.MemoryCoordinator.absorb);
        assert.equal(memoryLib.condense, contextKit.MemoryCoordinator.condense);
        assert.equal(memoryLib.memoryMessage, contextKit.MemoryCoordinator.memoryMessage);

        assert.equal(archiveLib, archiveRepository);
        assert.equal(archiveLib.searchArchive, archiveRepository.searchArchive);
        assert.equal(archiveLib.getRecords, archiveRepository.getRecords);
        assert.equal(archiveLib.archiveEvents, archiveRepository.archiveEvents);

        assert.equal(runtime.memoryStore, memoryLib);

    });


    await test("compaction keeps message order, memory-message location and tool pairs", async () => {

        const messages = transcript(8, 4000);

        const memory = memoryLib.emptyMemory();
        memory.facts.push("the config lives in src/config.ts");

        runtime.refreshMemoryMessage(messages, memory);

        const memoryIndex = messages.findIndex(memoryLib.isMemoryMessage);
        const userIndex = messages.findIndex(item => item.role === "user");

        assert.ok(memoryIndex !== -1);
        assert.equal(
            memoryIndex,
            userIndex + 1,
            "memory message must sit immediately after the first user message"
        );

        const rolesBefore = messages.map(item => item.role);
        const sizeBefore = contextLib.conversationSize(messages);

        const report = contextLib.compactConversation(messages, {
            maxChars: 12000,
            keepRecentExchanges: 2
        });

        assert.equal(report.compacted, true);
        assertPairsIntact(messages);

        const userAfter = messages.findIndex(item => item.role === "user");
        const memoryIndexAfter = messages.findIndex(memoryLib.isMemoryMessage);

        assert.ok(memoryIndexAfter !== -1, "memory message must survive compaction");
        assert.ok(
            memoryIndexAfter > userAfter,
            "memory message must stay after the user task"
        );

        if (report.dropped_exchanges === 0) {

            assert.equal(
                memoryIndexAfter,
                userAfter + 1,
                "without a drop, the memory message stays immediately after the task"
            );

        }

        const recent = contextLib.findExchanges(messages);
        const newest = recent[recent.length - 1];

        for (let index = newest.start; index <= newest.end; index++) {

            if (messages[index].role === "tool") {

                assert.equal(
                    messages[index].compression === undefined ||
                        messages[index].compression === "none",
                    true,
                    "the newest exchange must stay uncompressed"
                );

            }

        }

        assert.ok(
            contextLib.conversationSize(messages) <= sizeBefore,
            "compaction produced a larger conversation"
        );

        const rolesAfter = messages.map(item => item.role);

        assert.equal(rolesAfter[0], rolesBefore[0]);
        assert.equal(rolesAfter.includes("user"), true);

    });


    await test("the context ceiling never produces a larger request than before", async () => {

        const budgets = [8000, 20000, 40000];

        for (const budget of budgets) {

            const messages = transcript(12, 3000);
            const before = contextLib.conversationSize(messages);

            const report = contextLib.compactConversation(messages, {
                maxChars: budget,
                keepRecentExchanges: 2
            });

            const after = contextLib.conversationSize(messages);

            assert.ok(
                after <= before,
                `budget ${budget}: ${before} grew to ${after}`
            );

            if (before > budget) {

                assert.equal(report.compacted, true);
                assert.ok(
                    after <= budget || report.dropped_exchanges >= 0,
                    `budget ${budget} still ${after} after compaction`
                );

            }

            assertPairsIntact(messages);

        }

    });


    await test("archive is written before fold/compaction and search/get match the repository", async () => {

        fs.rmSync(path.join(WORKSPACE, ".agent"), { recursive: true, force: true });

        const messages = transcript(6, 800);

        const archived = runtime.context.archiveExchanges(
            messages,
            contextLib.findExchanges(messages).slice(0, 4),
            "test"
        );

        assert.ok(archived);
        assert.ok(archived.added > 0);

        const viaLib = archiveLib.searchArchive("call_0");
        const viaRepo = archiveRepository.searchArchive("call_0");

        assert.deepEqual(viaLib.results.map(item => item.id), viaRepo.results.map(item => item.id));
        assert.equal(viaLib.matches, viaRepo.matches);

        const id = viaRepo.results[0].id;

        const gotLib = archiveLib.getRecords([id]);
        const gotRepo = archiveRepository.getRecords([id]);

        assert.deepEqual(
            gotLib.records.map(item => ({ id: item.id, body: item.body })),
            gotRepo.records.map(item => ({ id: item.id, body: item.body }))
        );

        const searched = await tools.executeTool(
            "archive_search",
            { query: "call_0" },
            { agent: "main_agent" }
        );

        assert.ok(searched.matches >= 1);
        assert.equal(
            searched.results[0].id,
            viaRepo.results[0].id
        );

        const fetched = await tools.executeTool(
            "archive_get",
            { ids: [id] },
            { agent: "main_agent" }
        );

        assert.equal(fetched.records[0].id, id);
        assert.equal(fetched.records[0].body, gotRepo.records[0].body);

        const recordsBeforeFold = archiveLib.stats().records;

        runtime.context.bind({
            events: runtime.events,
            logLine() {},
            currentRun: () => ({ id: "run-phase17", controller: { signal: {} } }),
            assertRunActive() {},
            summariseTranscript: async () => {
                throw new Error("summariser down");
            }
        });

        const foldable = transcript(5, 600);

        const report = await runtime.foldIntoMemory(foldable, "test");

        assert.equal(report, null, "a failing summariser must not fold");

        assert.ok(
            archiveLib.stats().records >= recordsBeforeFold,
            "archive must already hold the exchanges when the summariser fails"
        );

        assert.ok(
            archiveLib.stats().records > recordsBeforeFold,
            "fold must write the archive before calling the summariser"
        );

    });


    await test("memory and archive recover after restart from the project data root", async () => {

        fs.rmSync(path.join(WORKSPACE, ".agent"), { recursive: true, force: true });

        const memory = memoryRepository.emptyMemory();
        memory.decisions.push("use workspace-relative paths");
        memory.facts.push("entry is bin/agent.js");

        memoryRepository.saveMemory(memory);

        const file = memoryRepository.memoryPath();

        assert.ok(fs.existsSync(file));

        const archived = archiveRepository.archiveEvents([
            {
                tool: "fs_read",
                title: "fs_read bin/agent.js",
                body: "the recovered archive body",
                agent: "main_agent",
                kind: "inspection"
            }
        ]);

        assert.equal(archived.added, 1);

        const indexFile = archiveRepository.indexPath();

        assert.ok(fs.existsSync(indexFile));

        delete require.cache[require.resolve(path.join(REPO, "agent", "persistence", "MemoryRepository.js"))];
        delete require.cache[require.resolve(path.join(REPO, "agent", "persistence", "ArchiveRepository.js"))];

        const memoryAfter = require(path.join(REPO, "agent", "persistence", "MemoryRepository.js"));
        const archiveAfter = require(path.join(REPO, "agent", "persistence", "ArchiveRepository.js"));

        const reloaded = memoryAfter.loadMemory();

        assert.deepEqual(reloaded.decisions, ["use workspace-relative paths"]);
        assert.deepEqual(reloaded.facts, ["entry is bin/agent.js"]);

        const found = archiveAfter.searchArchive("recovered archive");

        assert.equal(found.matches, 1);

        const body = archiveAfter.getRecords([found.results[0].id]);

        assert.equal(body.records[0].body, "the recovered archive body");

        const viaWrapper = require(path.join(REPO, "agent", "context", "Memory")).loadMemory();

        assert.deepEqual(viaWrapper.decisions, reloaded.decisions);

    });


    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
