"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

/*
|--------------------------------------------------------------------------
| Persistence Contract Tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| Locks the persistence subsystem contract: atomic writes, fallback reads,
| safe identifier sanitization, dataRoot resolution order, and scaffolding.
|--------------------------------------------------------------------------
*/

const ROOT = path.resolve(__dirname, "..", "..");

const AtomicFile =
    require(path.join(ROOT, "agent", "persistence", "AtomicFile.js"));

const JsonRepository =
    require(path.join(ROOT, "agent", "persistence", "JsonRepository.js"));

const SafeIdentifier =
    require(path.join(ROOT, "agent", "persistence", "SafeIdentifier.js"));

const SchemaVersion =
    require(path.join(ROOT, "agent", "persistence", "SchemaVersion.js"));

const dataRoot =
    require(path.join(ROOT, "agent", "lib", "dataRoot.js"));

const results = [];

async function test(name, fn) {

    try {

        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack || error.message}`);
    }
}

async function main() {

    console.log("persistence contract tests");

    await test("AtomicFile writes atomically and leaves no temporary files", () => {

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-contract-"));

        try {

            const target = path.join(dir, "atomic.json");
            AtomicFile.writeFile(target, '{"test":true}\n');

            assert.equal(fs.existsSync(target), true);
            const content = JSON.parse(fs.readFileSync(target, "utf8"));
            assert.equal(content.test, true);

            const files = fs.readdirSync(dir);
            assert.deepEqual(files, ["atomic.json"], "temporary file leaked");

        } finally {

            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    await test("JsonRepository safely reads existing and fallback documents", () => {

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-repo-contract-"));

        try {

            const target = path.join(dir, "doc.json");
            JsonRepository.writeJson(target, { key: "value" });

            const loaded = JsonRepository.readJson(target, { key: "default" });
            assert.equal(loaded.key, "value");

            const missing = JsonRepository.readJson(path.join(dir, "none.json"), { fallback: true });
            assert.equal(missing.fallback, true);

            /* corrupt JSON yields fallback instead of throwing */
            fs.writeFileSync(target, "INVALID JSON CONTENT {{{");
            const recovered = JsonRepository.readJson(target, { safe: true });
            assert.equal(recovered.safe, true);

        } finally {

            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    await test("SafeIdentifier prevents directory traversal characters", () => {

        assert.equal(SafeIdentifier.safeId("../../etc/passwd"), ".._.._etc_passwd");
        assert.equal(SafeIdentifier.safeId("session:alpha*1"), "session_alpha_1");
        assert.equal(SafeIdentifier.safeName("user/sub/agent"), "user_sub_agent");
    });

    await test("SchemaVersion handles current schemas as identity migrations", () => {

        const doc = { version: "1", payload: "data" };
        const result = SchemaVersion.migrate("session", doc);
        assert.equal(result.current, true);
        assert.equal(result.document, doc);
    });

    await test("dataRoot resolution order and scaffold directories are preserved", () => {

        assert.ok(Array.isArray(dataRoot.SCAFFOLD_DIRS));
        assert.ok(dataRoot.SCAFFOLD_DIRS.includes("sessions"));
        assert.ok(dataRoot.SCAFFOLD_DIRS.includes("archive"));
        assert.ok(dataRoot.SCAFFOLD_DIRS.includes("eventstore"));
        assert.ok(dataRoot.SCAFFOLD_DIRS.includes("journal"));
        assert.ok(dataRoot.SCAFFOLD_DIRS.includes("discussions"));

        const explicit = "/explicit/path";
        assert.equal(dataRoot.resolveRoot(explicit), explicit);
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
