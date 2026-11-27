"use strict";

/*
|--------------------------------------------------------------------------
| Application log (LogStore + LogEventMap)
|--------------------------------------------------------------------------
|
| The log the console's Logs dialog reads: levels and LOG_LEVEL, secret
| redaction, filtering and incremental reads, the bounded ring, the JSONL
| file with its rotation and restart preload, the event bus mapping and
| the crash hook. Every store here is a fresh instance; the process-wide
| singleton is left alone.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const REPO = path.resolve(__dirname, "..", "..");
const settings = require(path.join(REPO, "agent", "config"));
const { LogStore, LEVEL_RANK } = require(path.join(REPO, "agent", "runtime", "LogStore"));
const { entryForEvent, MAPPERS } = require(path.join(REPO, "agent", "runtime", "LogEventMap"));

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "log-store-"));
const results = [];


async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack}`);
    } finally {
        for (const key of ["LOG_LEVEL", "LOG_FILE_ENABLED", "LOG_FILE_MAX_MB", "LOG_FILE_KEEP", "LOG_MAX_FIELD_CHARS"]) settings.reset(key);
    }
}


async function main() {

    console.log("application log");

    await test("record() keeps level, source, run context and plain details", async () => {

        const store = new LogStore({ clock: () => Date.UTC(2026, 0, 2, 3, 4, 5) });
        const seen = [];
        store.on("entry", entry => seen.push(entry.id));

        const entry = store.error("AI", "AI request failed", {
            run_id: "run-1",
            project_id: "prj-1",
            status: 502,
            cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })
        });

        assert.deepEqual(
            { id: entry.id, at: entry.at, level: entry.level, source: entry.source, run: entry.run_id, project: entry.project_id },
            { id: 1, at: "2026-01-02T03:04:05.000Z", level: "error", source: "ai", run: "run-1", project: "prj-1" }
        );
        assert.deepEqual(entry.details.cause, { name: "Error", message: "socket hang up", code: "ECONNRESET" });
        assert.equal(store.record("nonsense", "x", "unknown level").level, "info");
        assert.equal(store.record("info", null, "no source").source, "app");
        assert.deepEqual(seen, [1, 2, 3]);
    });

    await test("secrets are masked in messages and details", async () => {

        const store = new LogStore();
        const entry = store.error("ai", "Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX1234", {
            api_key: "sk-live-secret-value-123456",
            headers: { authorization: "Bearer abcdefghijklmnop1234567890" },
            response: "{\"error\":\"Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX1234\"}"
        });
        const text = JSON.stringify(entry);

        assert.ok(!text.includes("ABCDEFGHIJKLMNOPQRSTUVWX1234"), text);
        assert.ok(!text.includes("secret-value-123456"), text);
        assert.ok(!text.includes("abcdefghijklmnop1234567890"), text);
        assert.match(entry.message, /Incorrect API key provided/);
    });

    await test("LOG_LEVEL drops quieter entries; LOG_MAX_FIELD_CHARS bounds text and details", async () => {

        const store = new LogStore();
        settings.set("LOG_LEVEL", "warn");
        assert.equal(store.info("run", "dropped"), null);
        assert.ok(store.warn("run", "kept"));
        settings.set("LOG_LEVEL", "debug");
        assert.ok(store.debug("run", "kept too"));

        settings.set("LOG_MAX_FIELD_CHARS", 1000);
        const long = store.info("run", "x".repeat(5000), { blob: "y".repeat(50000) });
        assert.ok(long.message.length < 1100 && /4000 more chars/.test(long.message), long.message.slice(-40));
        assert.ok(JSON.stringify(long.details).length < 1200);
        const many = store.info("run", "many fields", Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`k${index}`, "z".repeat(900)])));
        assert.equal(many.details.truncated, true, "an oversized whole is replaced by a preview");

        const circular = {};
        circular.self = circular;
        assert.deepEqual(store.info("run", "circular", circular).details, { note: "details could not be serialised" });
    });

    await test("list() filters by minimum level, source, text and id, newest last", async () => {

        const store = new LogStore();
        store.info("run", "Run started");
        store.warn("ai", "Retrying AI request", { attempt: 1 });
        store.error("ai", "AI request failed", { status: 429 });
        store.error("tool", "Tool failed");

        assert.deepEqual(store.list({ level: "error" }).map(entry => entry.message), ["AI request failed", "Tool failed"]);
        assert.deepEqual(store.list({ source: "AI" }).map(entry => entry.id), [2, 3]);
        assert.deepEqual(store.list({ q: "429" }).map(entry => entry.id), [3], "details are searched too");
        assert.deepEqual(store.list({ after: 2 }).map(entry => entry.id), [3, 4]);
        assert.deepEqual(store.list({ limit: 1 }).map(entry => entry.id), [4]);

        const summary = store.summary();
        assert.deepEqual(summary.counts, { debug: 0, info: 1, warn: 1, error: 2 });
        assert.deepEqual(summary.sources, ["ai", "run", "tool"]);
        assert.equal(summary.last_id, 4);
        assert.equal(summary.file, null, "nothing is written unless persistTo() was called");
        assert.deepEqual(Object.keys(LEVEL_RANK), ["debug", "info", "warn", "error"]);
    });

    await test("the ring keeps only the newest entries", async () => {

        const store = new LogStore({ capacity: 3 });
        for (let index = 1; index <= 5; index++) store.info("run", `entry ${index}`);
        assert.deepEqual(store.list().map(entry => entry.message), ["entry 3", "entry 4", "entry 5"]);
        assert.equal(store.summary().last_id, 5, "ids keep counting");
    });

    await test("persistTo() appends JSONL, preloads it after a restart, and clear() rotates it away", async () => {

        const dir = path.join(TEMP, "persist");
        const first = new LogStore().persistTo(dir);
        first.error("ai", "before restart", { status: 500 });
        first.info("run", "second");
        await first.flush();

        const file = path.join(dir, "structured-ai.jsonl");
        const lines = fs.readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
        assert.deepEqual(lines.map(line => line.message), ["before restart", "second"]);
        if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);

        fs.appendFileSync(file, "{not json\n");
        const second = new LogStore();
        second.info("server", "recorded before persistTo");
        second.persistTo(dir);
        const restored = second.list();
        assert.deepEqual(restored.map(entry => [entry.id, entry.message, Boolean(entry.restored)]), [
            [1, "before restart", true],
            [2, "second", true],
            [3, "recorded before persistTo", false]
        ]);

        assert.match(await second.exportText(), /before restart/);
        const cleared = [];
        second.on("cleared", () => cleared.push(true));
        await second.clear();
        assert.deepEqual(second.list(), []);
        assert.deepEqual(cleared, [true]);
        assert.ok(!fs.existsSync(file) && fs.existsSync(`${file}.1`), "the cleared file is kept as .1");
        assert.equal(new LogStore().persistTo(dir).list().length, 0, "cleared entries do not come back");
    });

    await test("the file rotates past LOG_FILE_MAX_MB keeping LOG_FILE_KEEP files; LOG_FILE_ENABLED=false keeps it in memory", async () => {

        const dir = path.join(TEMP, "rotate");
        const store = new LogStore().persistTo(dir);
        settings.set("LOG_FILE_MAX_MB", 1);
        const big = "z".repeat(7000);
        for (let index = 0; index < 200; index++) {
            store.info("run", `bulk ${index}`, { big });
            if (index % 20 === 0) await store.flush();
        }
        await store.flush();
        const file = path.join(dir, "structured-ai.jsonl");
        assert.ok(fs.existsSync(`${file}.1`), "rotated");
        assert.ok(fs.statSync(file).size <= 1024 * 1024);

        settings.set("LOG_FILE_KEEP", 1);
        fs.writeFileSync(`${file}.2`, "older\n");
        await store.rotate();
        assert.ok(fs.existsSync(`${file}.1`) && !fs.existsSync(`${file}.2`), "only LOG_FILE_KEEP rotated files remain");
        store.info("run", "after manual rotation");
        await store.flush();

        settings.set("LOG_FILE_ENABLED", false);
        const before = fs.statSync(file).size;
        store.info("run", "memory only");
        await store.flush();
        assert.equal(fs.statSync(file).size, before);
        assert.equal(store.list().at(-1).message, "memory only");
    });

    await test("the bus mapping turns failures into entries and ignores routine events", async () => {

        const failed = entryForEvent({ type: "run:error", message: "fetch failed", code: "ECONNREFUSED", run_id: "run-9" });
        assert.deepEqual([failed.level, failed.source, failed.message], ["error", "run", "Run failed: fetch failed"]);
        assert.equal(entryForEvent({ type: "run:error", message: "stopped", cancelled: true }).level, "warn");
        assert.equal(entryForEvent({ type: "tool:end", name: "read_file", success: true }), null);
        assert.match(entryForEvent({ type: "tool:end", name: "write_file", success: false, error: "EACCES" }).message, /write_file failed: EACCES/);
        assert.equal(entryForEvent({ type: "hook:end", ok: false, skipped: true }), null);
        assert.equal(entryForEvent({ type: "llm:token" }), null);
        assert.equal(entryForEvent(null), null);
        for (const [type, mapper] of Object.entries(MAPPERS)) {
            const mapped = mapper({ type });
            if (mapped) assert.ok(LEVEL_RANK[mapped.level] !== undefined && typeof mapped.message === "string", type);
        }

        const store = new LogStore();
        const bus = new EventEmitter();
        assert.equal(store.attachToBus(bus), true);
        assert.equal(store.attachToBus(bus), false, "attached once");
        bus.emit("event", { type: "discussion:error", error: "model down", id: "d1" });
        bus.emit("event", { type: "run:start", task: "say hi" });
        bus.emit("event", { type: "tool:start" });
        assert.deepEqual(store.list().map(entry => entry.message), ["Discussion failed: model down", "Run started: say hi"]);
    });

    await test("process hooks record crashes synchronously and warnings, and can be removed", async () => {

        const dir = path.join(TEMP, "crash");
        const store = new LogStore().persistTo(dir);
        const target = new EventEmitter();
        assert.equal(store.installProcessHooks(target), true);
        assert.equal(store.installProcessHooks(target), false);

        target.emit("uncaughtExceptionMonitor", new Error("boom"), "uncaughtException");
        target.emit("warning", { name: "DeprecationWarning", message: "old api", code: "DEP0001" });
        const text = fs.readFileSync(path.join(dir, "structured-ai.jsonl"), "utf8");
        assert.match(text, /Uncaught exception: boom/, "on disk before anything asynchronous runs");
        assert.deepEqual(store.list().map(entry => entry.level), ["error", "warn"]);

        store.removeProcessHooks();
        assert.equal(target.listenerCount("uncaughtExceptionMonitor"), 0);
        assert.equal(target.listenerCount("warning"), 0);
    });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    fs.rmSync(TEMP, { recursive: true, force: true });
    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
