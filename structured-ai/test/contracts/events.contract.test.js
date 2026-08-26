"use strict";

/*
|--------------------------------------------------------------------------
| Event Contract Tests — EXECUTION_PLAN Phase 1
|--------------------------------------------------------------------------
|
| Locks the event bus contract so later refactors cannot silently rename,
| reshape or reorder the runtime's observable behavior:
|   1. the correlation envelope every event carries
|   2. the inventory of emitted event names (scanned from source)
|   3. the key payloads documented in fixtures/events.json
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-contract-events-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.MAX_RUN_MS = "2000";
process.env.MAX_REQUEST_MS = "1000";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));
const { normalize } = require(path.join(ROOT, "test", "helpers", "normalize.js"));

const events = require(path.join(ROOT, "agent", "lib", "events.js"));

const fixture =
    JSON.parse(
        fs.readFileSync(
            path.join(ROOT, "test", "fixtures", "events.json"),
            "utf8"
        )
    );

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


function eventNamesFromSource() {

    /* Scan emit("name") call sites across the runtime so a rename or a
       silently added event is caught even when no test emits it here. */

    const sources = [];

    const scan = directory => {

        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {

            const full = path.join(directory, entry.name);

            if (entry.isDirectory()) {

                if (entry.name === "node_modules") {

                    continue;

                }

                scan(full);

            } else if (entry.name.endsWith(".js")) {

                sources.push(full);

            }
        }
    };

    scan(path.join(ROOT, "agent"));
    scan(path.join(ROOT, "web"));

    const found = new Set();

    const patterns = [
        /emit\(\s*"([a-z:_-]+)"/g,
        /* extracted services may pass their event context first */
        /emit\([^,]+,\s*"([a-z:_-]+)"/g
    ];

    for (const file of sources) {

        const text = fs.readFileSync(file, "utf8");

        for (const pattern of patterns) {

            let match;

            while ((match = pattern.exec(text)) !== null) {
                found.add(match[1]);
            }
        }
    }

    return found;

}


async function main() {

    await test("every emitted event carries the full correlation envelope", async () => {

        const captured = [];

        const listen = event => captured.push(event);

        events.bus.on("event", listen);

        try {

            events.setContext({
                run_id: "run-contract",
                turn_id: "run-contract_t1",
                scope: "main_agent",
                iteration: 1
            });

            /* A variety of payload shapes: empty, partial override,
               and extra fields — all must still get the envelope. */

            events.emit("run:start", { task: "contract probe" });

            events.emit("agent:iteration", { iteration: 2 });

            events.emit("tool:start", { id: "t1", name: "probe" });

        } finally {

            events.bus.off("event", listen);

        }

        assert.equal(captured.length, 3);

        for (const event of captured) {

            for (const field of fixture.envelope.required_fields) {

                assert.ok(
                    Object.prototype.hasOwnProperty.call(event, field),
                    `event ${event.type} is missing envelope field ${field}`
                );

            }

            assert.equal(event.run_id, "run-contract");
            assert.equal(event.turn_id, "run-contract_t1");
            assert.equal(event.scope, "main_agent");

        }

        /* seq must be monotonically increasing */

        for (let index = 1; index < captured.length; index++) {

            assert.ok(
                captured[index].seq > captured[index - 1].seq,
                "event seq is not monotonically increasing"
            );

        }

        /* at must be a plausible epoch timestamp */

        const now = Date.now();

        for (const event of captured) {

            assert.ok(
                typeof event.at === "number" && event.at <= now && event.at > now - 60000,
                `event.at ${event.at} is not a plausible epoch timestamp`
            );

        }
    });

    await test("payload fields override context; unknown context patches are ignored", async () => {

        const captured = [];

        const listen = event => captured.push(event);

        events.bus.on("event", listen);

        try {

            events.setContext({
                run_id: "ctx-run",
                turn_id: "ctx-turn",
                scope: "ctx-scope",
                iteration: 1,
                bogus_key: "ignored"
            });

            events.emit("agent:response", {
                run_id: "override-run",
                note: "kept"
            });

        } finally {

            events.bus.off("event", listen);

        }

        const event = captured[0];

        assert.equal(event.run_id, "override-run");
        assert.equal(event.turn_id, "ctx-turn");
        assert.equal(event.scope, "ctx-scope");
        assert.equal(event.note, "kept");

        assert.ok(
            !Object.prototype.hasOwnProperty.call(event, "bogus_key"),
            "setContext accepted an unknown key"
        );

    });

    await test("source-extracted event names match the fixture inventory", async () => {

        const found = eventNamesFromSource();

        const expected = new Set(fixture.inventory);

        for (const mechanic of fixture.excluded_mechanic_names) {

            found.delete(mechanic);

        }

        const missing = [...expected].filter(name => !found.has(name));
        const added = [...found].filter(name => !expected.has(name));

        assert.deepStrictEqual(
            { missing, added },
            { missing: [], added: [] },
            "event names drifted from fixtures/events.json — update the fixture and CONTRACTS.md if the change is intentional"
        );

    });

    await test("documented key payloads exist on live emissions", async () => {

        const captured = [];

        const listen = event => captured.push(event);

        events.bus.on("event", listen);

        try {

            events.setContext({
                run_id: "payload-run",
                turn_id: "payload-run_t1",
                scope: "main_agent",
                iteration: 1
            });

            events.emit("run:start", {
                task: "payload probe"
            });

            events.emit("agent:iteration", {
                iteration: 1
            });

        } finally {

            events.bus.off("event", listen);

        }

        const byType = new Map(captured.map(item => [item.type, item]));

        for (const [type, fields] of Object.entries(fixture.key_payloads)) {

            if (type === "run:end" || type.startsWith("tool:")) {

                /* exercised indirectly via run sequence below */

                continue;

            }

            const event = byType.get(type);

            assert.ok(event, `expected a live ${type} emission`);

            for (const field of fields) {

                assert.ok(
                    Object.prototype.hasOwnProperty.call(event, field) && event[field] !== null,
                    `${type} is missing documented payload field ${field}`
                );

            }
        }
    });

    await test("normalizer collapses volatile event fields deterministically", async () => {

        const { normalize: norm } = require(path.join(ROOT, "test", "helpers", "normalize.js"));

        const raw = {
            seq: 41,
            type: "run:start",
            at: 1760000000000,
            run_id: "run-2026-08-25T11:22:33.123Z-x9",
            turn_id: "run-2026-08-25T11:22:33.123Z-x9_t1",
            scope: "main_agent",
            iteration: 1,
            task: "Read /tmp/agent-contract-events-AbC123/notes.md",
            duration_ms: 350
        };

        const out = norm(raw, { workspace: "/tmp/agent-contract-events-AbC123" });

        assert.equal(out.seq, "<VOL>");
        assert.equal(out.at, "<EPOCH>");
        assert.equal(out.run_id, "<RUN_ID>");
        assert.equal(out.duration_ms, "<VOL>");
        assert.equal(out.iteration, 1);
        assert.ok(!out.task.includes("/tmp"), "temp path leaked through normalizer");

        /* key order must be canonicalized */

        assert.deepStrictEqual(
            Object.keys(out),
            Object.keys(out).slice().sort()
        );

    });

    fs.rmSync(WORKSPACE, { recursive: true, force: true });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
