"use strict";

/*
|--------------------------------------------------------------------------
| Process / terminal reliability (plan phase 7 / step 4)
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "proc-rel-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.AGENT_VERBOSE = "0";

const ROOT = path.resolve(__dirname, "..", "..");
const settings = require(path.join(ROOT, "agent", "config"));
const ProcessManager = require(path.join(ROOT, "agent", "tools", "process", "ProcessManager.js"));
const Background = require(path.join(ROOT, "agent", "tools", "process", "BackgroundSession.js"));
const Foreground = require(path.join(ROOT, "agent", "tools", "process", "ForegroundCommand.js"));

const results = [];

async function test(name, fn) {

    try {

        await fn();
        results.push(true);
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push(false);
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}


function fakeChild() {

    const child = new EventEmitter();

    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 999999;
    child.exitCode = null;
    child.stdin = { write() {}, end() {} };

    return child;
}


async function main() {

    await test("a spawn error stays 'failed'; the following close does not turn it into 'exited'", async () => {

        const original = ProcessManager.spawnInGroup;

        const child = fakeChild();

        ProcessManager.spawnInGroup = () => child;

        try {

            const started = Background.process_start({ command: "whatever", wait_ms: 30 }, undefined);

            setTimeout(() => {

                child.emit("error", new Error("spawn ENOENT"));
                child.emit("close", -2, null);

            }, 5);

            const result = await started;

            assert.strictEqual(result.status, "failed");

            const session = ProcessManager.requireSession(result.process_id);

            assert.strictEqual(session.status, "failed");
            assert.strictEqual(session.error, "spawn ENOENT");
            assert.ok(session.finished_at);

            const later = await Background.process_read({ process_id: result.process_id, peek: true }, undefined);

            assert.strictEqual(later.status, "failed");

        } finally {

            ProcessManager.spawnInGroup = original;
        }
    });

    await test("a normal exit is still 'exited'", async () => {

        const original = ProcessManager.spawnInGroup;

        const child = fakeChild();

        ProcessManager.spawnInGroup = () => child;

        try {

            const started = Background.process_start({ command: "x", wait_ms: 30 }, undefined);

            setTimeout(() => child.emit("close", 0, null), 5);

            const result = await started;

            assert.strictEqual(result.status, "exited");
            assert.strictEqual(result.exit_code, 0);

        } finally {

            ProcessManager.spawnInGroup = original;
        }
    });

    await test("trimming old chunks moves the read cursor so unread output is not skipped", () => {

        const previous = settings.get("MAX_PROCESS_BUFFER_CHARS");

        settings.set("MAX_PROCESS_BUFFER_CHARS", 1000);

        try {

            const session = { output: [], buffered_chars: 0, dropped_chunks: 0, read_cursor: 0 };

            ProcessManager.appendOutput(session, "stdout", "A".repeat(400));   // c1
            ProcessManager.appendOutput(session, "stdout", "B".repeat(400));   // c2

            /* the reader has consumed c1 only */
            session.read_cursor = 1;

            ProcessManager.appendOutput(session, "stdout", "C".repeat(400));   // drops c1

            assert.strictEqual(session.dropped_chunks, 1);
            assert.strictEqual(session.read_cursor, 0, "cursor must follow the shift");

            const unread = session.output.slice(session.read_cursor).map(chunk => chunk.text);

            assert.deepStrictEqual(unread, ["B".repeat(400), "C".repeat(400)], "c2 was unread and must survive");

            /* never negative even when the reader had nothing consumed */

            const fresh = { output: [], buffered_chars: 0, dropped_chunks: 0, read_cursor: 0 };

            for (let i = 0; i < 6; i++) {
                ProcessManager.appendOutput(fresh, "stdout", "Z".repeat(400));
            }

            assert.strictEqual(fresh.read_cursor, 0);

        } finally {

            settings.set("MAX_PROCESS_BUFFER_CHARS", previous);
        }
    });

    await test("foreground terminal output is capped for stdout as well as stderr", async () => {

        const previous = settings.get("MAX_TOOL_RESULT_TOTAL_CHARS");

        settings.set("MAX_TOOL_RESULT_TOTAL_CHARS", 1000);

        try {

            const command = `"${process.execPath}" -e "process.stdout.write('x'.repeat(200000))"`;

            const result = await Foreground.terminal_exec({ command }, undefined);

            assert.strictEqual(result.exit_code, 0);
            assert.ok(result.stdout.length <= 1200, `stdout was ${result.stdout.length} chars`);
            assert.strictEqual(result.output_truncated, true);

        } finally {

            settings.set("MAX_TOOL_RESULT_TOTAL_CHARS", previous);
        }
    });

    const failed = results.filter(ok => !ok).length;

    console.log(`\n${results.length - failed}/${results.length} passed`);

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {

    console.error(error);
    process.exit(1);
});
