"use strict";

/*
|--------------------------------------------------------------------------
| Persistence contract tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| JSON documents are replaced atomically; JSONL stores remain append-only
| and tolerate an incomplete final line. This contract suite checks the
| extracted repository seams directly while the larger persistence tests
| continue to verify the historical workspace paths and projections.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), "phase29-persist-contract-"));

const AtomicFile = require(path.join(ROOT, "agent", "persistence", "AtomicFile"));
const JsonRepository = require(path.join(ROOT, "agent", "persistence", "JsonRepository"));
const SafeIdentifier = require(path.join(ROOT, "agent", "persistence", "SafeIdentifier"));
const SchemaVersion = require(path.join(ROOT, "agent", "persistence", "SchemaVersion"));
const sessions = require(path.join(ROOT, "agent", "persistence", "SessionRepository"));
const eventStore = require(path.join(ROOT, "agent", "persistence", "EventStoreRepository"));
const journal = require(path.join(ROOT, "agent", "persistence", "JournalRepository"));

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

async function main() {
    await test("the extracted persistence modules expose the documented boundaries", async () => {
        for (const method of ["writeFile"]) assert.equal(typeof AtomicFile[method], "function");
        for (const method of ["readJson", "writeJson"]) assert.equal(typeof JsonRepository[method], "function");
        for (const method of ["safeId", "safeName"]) assert.equal(typeof SafeIdentifier[method], "function");
        for (const method of ["versionOf", "isCurrent", "migrate"]) assert.equal(typeof SchemaVersion[method], "function");
        for (const method of ["emptySession", "loadSession", "saveSession", "listSessions"]) {
            assert.equal(typeof sessions[method], "function", `session.${method} missing`);
        }
        for (const method of ["append", "readDay", "query", "flush"]) {
            assert.equal(typeof eventStore[method], "function", `event store.${method} missing`);
        }
        for (const method of ["onEvent", "flush", "fileFor"]) {
            assert.equal(typeof journal[method], "function", `journal.${method} missing`);
        }
    });

    await test("JSON repository writes round-trip and corrupt input uses the caller fallback", async () => {
        const file = path.join(WORKSPACE, "document.json");
        const document = { version: 1, nested: { value: "kept" }, items: [1, 2] };
        assert.deepStrictEqual(JsonRepository.writeJson(file, document), document);
        assert.deepStrictEqual(JsonRepository.readJson(file, null), document);
        fs.writeFileSync(file, "{broken", "utf8");
        assert.deepStrictEqual(JsonRepository.readJson(file, { fallback: true }), { fallback: true });
        assert.deepStrictEqual(JsonRepository.readJson(path.join(WORKSPACE, "missing.json"), []), []);
    });

    await test("an interrupted atomic replacement leaves the previous JSON document intact", async () => {
        const file = path.join(WORKSPACE, "atomic.json");
        JsonRepository.writeJson(file, { revision: "old" });
        const originalRename = fs.renameSync;
        try {
            fs.renameSync = () => { throw new Error("simulated rename failure"); };
            assert.throws(
                () => AtomicFile.writeFile(file, JSON.stringify({ revision: "new" }), "utf8"),
                /simulated rename failure/
            );
        } finally {
            fs.renameSync = originalRename;
        }
        assert.deepStrictEqual(JsonRepository.readJson(file, null), { revision: "old" });
        assert.equal(fs.readdirSync(WORKSPACE).some(name => name.startsWith("atomic.json.tmp-")), false);
    });

    await test("safe identifiers and schema versions are stable and additive", async () => {
        assert.equal(SafeIdentifier.safeId("discussion/a?b"), "discussion_a_b");
        assert.equal(SafeIdentifier.safeName("main agent"), "main_agent");
        assert.equal(SchemaVersion.CURRENT.discussion, "1");
        assert.equal(SchemaVersion.versionOf({ schema_version: "1" }), "1");
        assert.equal(SchemaVersion.isCurrent("session", "1"), true);
        const migrated = SchemaVersion.migrate("discussion", { version: "1", id: "d1" });
        assert.deepStrictEqual(migrated, {
            kind: "discussion",
            document: { version: "1", id: "d1" },
            version: "1",
            current: true,
            migrated: false
        });
    });

    await test("JSONL repositories preserve valid records while skipping a truncated tail", async () => {
        const day = "2030-01-02";
        const file = eventStore.fileFor(day, WORKSPACE);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const event = { version: "1", type: "run:start", run_id: "r1", seq: 1 };
        fs.writeFileSync(file, `${JSON.stringify(event)}\n{"type":"run:end"`, "utf8");
        assert.deepStrictEqual(eventStore.readDay(day, WORKSPACE), [event]);
        assert.deepStrictEqual(eventStore.query({ date: day, root: WORKSPACE }), [event]);
        assert.equal(eventStore.dayOf("2030-01-02T12:00:00Z"), day);
        assert.match(journal.fileFor("main_agent", day, WORKSPACE), /journal/);
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
