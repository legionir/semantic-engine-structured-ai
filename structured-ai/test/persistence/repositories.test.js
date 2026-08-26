"use strict";

/*
|--------------------------------------------------------------------------
| Persistence repositories — EXECUTION_PLAN Phase 18
|--------------------------------------------------------------------------
|
| Atomic JSON writes, safe identifiers, schema-version identity migrate,
| wrapper facades, crash injection (rename throws → original file
| intact), corrupt-file fallback, and replay of an on-disk session
| written in the historical format.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(path.join(os.tmpdir(), "phase18-persist-"));

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.AGENT_VERBOSE = "0";
process.env.SESSIONS_ENABLED = "1";
process.env.EVENTSTORE_ENABLED = "1";
process.env.JOURNAL_ENABLED = "1";

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


async function main() {

    const persistDir = path.join(REPO, "agent", "persistence");

    const AtomicFile = require(path.join(persistDir, "AtomicFile.js"));
    const JsonRepository = require(path.join(persistDir, "JsonRepository.js"));
    const SafeIdentifier = require(path.join(persistDir, "SafeIdentifier.js"));
    const SchemaVersion = require(path.join(persistDir, "SchemaVersion.js"));
    const SessionRepository = require(path.join(persistDir, "SessionRepository.js"));
    const JournalRepository = require(path.join(persistDir, "JournalRepository.js"));
    const EventStoreRepository = require(path.join(persistDir, "EventStoreRepository.js"));
    const MemoryRepository = require(path.join(persistDir, "MemoryRepository.js"));
    const ArchiveRepository = require(path.join(persistDir, "ArchiveRepository.js"));

    const sessionsLib = require(path.join(REPO, "agent", "persistence", "SessionRepository"));
    const journalLib = require(path.join(REPO, "agent", "persistence", "JournalRepository"));
    const eventstoreLib = require(path.join(REPO, "agent", "persistence", "EventStoreRepository"));
    const memoryLib = require(path.join(REPO, "agent", "context", "Memory"));
    const archiveLib = require(path.join(REPO, "agent", "persistence", "ArchiveRepository"));


    await test("named Phase 18 modules exist", async () => {

        for (const name of [
            "AtomicFile.js",
            "JsonRepository.js",
            "SafeIdentifier.js",
            "SchemaVersion.js",
            "SessionRepository.js",
            "JournalRepository.js",
            "EventStoreRepository.js",
            "MemoryRepository.js",
            "ArchiveRepository.js"
        ]) {

            assert.equal(
                fs.existsSync(path.join(persistDir, name)),
                true,
                `missing agent/persistence/${name}`
            );

        }

    });


    await test("lib/sessions, journal and eventstore stay facades over the repositories", async () => {

        assert.equal(sessionsLib, SessionRepository);
        assert.equal(journalLib, JournalRepository);
        assert.equal(eventstoreLib, EventStoreRepository);
        assert.equal(archiveLib, ArchiveRepository);

        assert.equal(typeof sessionsLib.saveSession, "function");
        assert.equal(typeof sessionsLib.loadSession, "function");
        assert.equal(typeof journalLib.onEvent, "function");
        assert.equal(typeof eventstoreLib.append, "function");
        assert.equal(typeof eventstoreLib.query, "function");
        assert.equal(memoryLib.saveMemory, MemoryRepository.saveMemory);

    });


    await test("the persistence modules have no require cycle back to agent.js", async () => {

        for (const name of fs.readdirSync(persistDir)) {

            if (!name.endsWith(".js")) {
                continue;
            }

            const body = fs.readFileSync(path.join(persistDir, name), "utf8");

            assert.equal(
                /require\(["']\.\.\/agent(?:\.js)?["']\)/.test(body),
                false,
                `${name} requires agent.js`
            );

        }

    });


    await test("safeId matches the historical session file-name rule", async () => {

        assert.equal(SafeIdentifier.safeId("s-ok"), "s-ok");
        assert.equal(SafeIdentifier.safeId("a/b\\c"), "a_b_c");
        assert.equal(SafeIdentifier.safeId("../escape"), ".._escape");
        assert.equal(
            SessionRepository.sessionPath("a/b", WORKSPACE),
            path.join(
                SessionRepository.sessionsDirectory(WORKSPACE),
                "a_b.json"
            )
        );
        assert.equal(JournalRepository._safeName("main/agent"), "main_agent");

    });


    await test("an existing session file is replayed without a manual migration", async () => {

        const dir = path.join(WORKSPACE, ".agent", "sessions");
        fs.mkdirSync(dir, { recursive: true });

        const historical = {
            version: "1",
            id: "s-old-replay",
            title: "historical title",
            workspace: WORKSPACE,
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z",
            status: "idle",
            turns: 1,
            messages: [{ role: "user", content: "old hello" }],
            events: [{ type: "run:start", seq: 1 }],
            calls: []
        };

        fs.writeFileSync(
            path.join(dir, "s-old-replay.json"),
            `${JSON.stringify(historical, null, 2)}\n`,
            "utf8"
        );

        const loaded = sessionsLib.loadSession("s-old-replay");

        assert.equal(loaded.id, "s-old-replay");
        assert.equal(loaded.messages[0].content, "old hello");
        assert.equal(loaded.events[0].type, "run:start");
        assert.equal(loaded.version, "1");

        const migrated = SchemaVersion.migrate("session", historical);

        assert.equal(migrated.migrated, false);
        assert.equal(migrated.current, true);
        assert.equal(migrated.document, historical);

    });


    await test("a crash mid-write leaves the original JSON file intact", async () => {

        const file = path.join(WORKSPACE, ".agent", "crash.json");
        const original = { version: "1", value: "keep-me" };

        JsonRepository.writeJson(file, original);

        const rename = fs.renameSync;

        fs.renameSync = () => {

            throw new Error("injected crash");

        };

        let thrown = null;

        try {

            JsonRepository.writeJson(file, { version: "1", value: "new" });

        } catch (error) {

            thrown = error;

        } finally {

            fs.renameSync = rename;

        }

        assert.ok(thrown);
        assert.match(thrown.message, /injected crash/);

        const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));

        assert.equal(onDisk.value, "keep-me");

        const leftovers = fs.readdirSync(path.dirname(file))
            .filter(name => name.includes(".tmp-"));

        assert.deepEqual(leftovers, []);

    });


    await test("a corrupt JSON document does not stop the runtime", async () => {

        const sessionFile = SessionRepository.sessionPath("s-corrupt");
        fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
        fs.writeFileSync(sessionFile, "{ not json", "utf8");

        assert.equal(sessionsLib.loadSession("s-corrupt"), null);

        const memoryFile = MemoryRepository.memoryPath();
        fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
        fs.writeFileSync(memoryFile, "{ broken", "utf8");

        const memory = MemoryRepository.loadMemory();

        assert.deepEqual(memory.decisions, []);
        assert.equal(memory.chunks_absorbed, 0);

        const indexFile = ArchiveRepository.indexPath();
        fs.mkdirSync(path.dirname(indexFile), { recursive: true });
        fs.writeFileSync(indexFile, "not-json", "utf8");

        const index = ArchiveRepository.loadIndex();

        assert.deepEqual(index.records, []);

    });


    await test("eventstore skips a truncated last line after a crash mid-append", async () => {

        const day = "2026-08-26";
        const file = path.join(WORKSPACE, ".agent", "eventstore", `${day}.jsonl`);

        fs.mkdirSync(path.dirname(file), { recursive: true });

        const intact = {
            seq: 1,
            type: "run:start",
            at: Date.parse("2026-08-26T10:00:00Z"),
            run_id: "run-phase18",
            turn_id: null,
            scope: "main_agent",
            iteration: null
        };

        fs.writeFileSync(
            file,
            `${JSON.stringify(intact)}\n{"type":"run:end",truncated`,
            "utf8"
        );

        const events = eventstoreLib.readDay(day);

        assert.equal(events.length, 1);
        assert.equal(events[0].run_id, "run-phase18");

        const queried = eventstoreLib.query({
            run_id: "run-phase18",
            date: day
        });

        assert.equal(queried.length, 1);

    });


    await test("atomic session save writes valid JSON and leaves no temp file", async () => {

        const session = sessionsLib.emptySession("s-atomic");
        session.messages.push({ role: "user", content: "hello atomic" });

        sessionsLib.saveSession(session);

        const file = SessionRepository.sessionPath("s-atomic");
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

        assert.equal(parsed.messages[0].content, "hello atomic");
        assert.equal(parsed.version, SchemaVersion.CURRENT.session);

        const temps = fs.readdirSync(path.dirname(file))
            .filter(name => name.includes(".tmp-"));

        assert.deepEqual(temps, []);

        const reloaded = sessionsLib.loadSession("s-atomic");

        assert.equal(reloaded.messages[0].content, "hello atomic");

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
