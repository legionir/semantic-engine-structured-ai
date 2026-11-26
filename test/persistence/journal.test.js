const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-journal-test-"));

process.env.WORKSPACE_ROOT = WORKSPACE;

const settings = require("../../agent/config");
const journal = require("../../agent/persistence/JournalRepository");

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


function readLines(file) {

    return fs.readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));
}


async function main() {

    console.log("journal");

    await test("thinking and tools are written as per-agent JSONL", async () => {

        settings.set("JOURNAL_ENABLED", true);
        settings.set("JOURNAL_MAX_FIELD_CHARS", 500);

        const bus = new EventEmitter();
        journal.attach(bus);

        const at = Date.parse("2026-08-17T20:36:33.123Z");
        const emit = event => bus.emit("event", { at, ...event });

        emit({
            seq: 1,
            type: "run:start",
            run_id: "run-123",
            task: "Implement the plan"
        });

        emit({
            seq: 2,
            type: "agent:start",
            agent: "code_analysis",
            scope: "code_analysis#1",
            depth: 1,
            parent: "main_agent",
            parent_scope: "main_agent",
            task: "Inspect the implementation plan"
        });

        emit({
            seq: 3,
            type: "request:start",
            agent: "code_analysis",
            role: "L1",
            model: "review-model"
        });

        emit({
            seq: 4,
            type: "agent:thinking",
            agent: "code_analysis",
            scope: "code_analysis#1",
            depth: 1,
            iteration: 1,
            content: "I should read IMPLEMENTATION_PLAN.md first.",
            chars: 43
        });

        emit({
            seq: 5,
            type: "tool:start",
            agent: "code_analysis#1",
            id: "read_plan",
            name: "fs_read",
            graph_id: "graph_1",
            shape: "single",
            wave: 0,
            depends_on: [],
            iteration: 1,
            arguments: { path: "IMPLEMENTATION_PLAN.md" }
        });

        emit({
            seq: 6,
            type: "tool:end",
            agent: "code_analysis#1",
            id: "read_plan",
            name: "fs_read",
            graph_id: "graph_1",
            wave: 0,
            iteration: 1,
            arguments: { path: "IMPLEMENTATION_PLAN.md" },
            success: true,
            duration_ms: 12,
            result: { content: "x".repeat(2000) }
        });

        emit({
            seq: 7,
            type: "agent:end",
            agent: "code_analysis",
            scope: "code_analysis#1",
            depth: 1,
            success: true
        });

        journal.detach(bus);
        await journal.flush();

        const main =
            readLines(
                path.join(
                    WORKSPACE,
                    ".agent",
                    "journal",
                    "2026-08-17",
                    "main_agent.jsonl"
                )
            );

        const child =
            readLines(
                path.join(
                    WORKSPACE,
                    ".agent",
                    "journal",
                    "2026-08-17",
                    "code_analysis.jsonl"
                )
            );

        assert.equal(main[0].kind, "run_start");
        assert.equal(main[0].run_id, "run-123");
        assert.equal(main[0].date, "2026-08-17");
        assert.equal(main[0].time, "20:36:33.123");
        assert.equal(main[0].timezone, "UTC");

        const thinking = child.find(item => item.kind === "thinking");

        assert.equal(thinking.role, "sub-agent");
        assert.equal(thinking.agent, "code_analysis");
        assert.equal(thinking.scope, "code_analysis#1");
        assert.equal(thinking.model, "review-model");
        assert.equal(thinking.endpoint_role, "L1");
        assert.match(thinking.thinking, /IMPLEMENTATION_PLAN/);
        assert.deepEqual(thinking.tools, []);

        const tool = child.find(item => item.kind === "tool");

        assert.equal(tool.tools.length, 1);
        assert.equal(tool.tools[0].name, "fs_read");
        assert.equal(tool.tools[0].success, true);
        assert.equal(tool.tools[0].started_event_seq, 5);
        assert.equal(tool.tools[0].completed_event_seq, 6);
        assert.deepEqual(
            tool.tools[0].arguments,
            { path: "IMPLEMENTATION_PLAN.md" }
        );
        assert.equal(tool.tools[0].result.truncated, true);
        assert.equal(tool.run_id, "run-123");
        assert.equal(tool.task, "Implement the plan");

        settings.reset("JOURNAL_MAX_FIELD_CHARS");
        settings.reset("JOURNAL_ENABLED");
    });

    await test("journaling can be disabled without creating files", () => {

        settings.set("JOURNAL_ENABLED", false);

        const before =
            fs.readdirSync(journal.journalRoot()).length;

        journal.onEvent({
            type: "agent:thinking",
            at: Date.parse("2026-08-18T00:00:00Z"),
            agent: "main_agent",
            scope: "main_agent",
            content: "not persisted"
        });

        const after =
            fs.readdirSync(journal.journalRoot()).length;

        assert.equal(after, before);

        settings.reset("JOURNAL_ENABLED");
    });

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {
        process.exitCode = 1;
    }
}

main();
