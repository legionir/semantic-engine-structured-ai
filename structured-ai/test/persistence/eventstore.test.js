const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-eventstore-test-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;

const eventstore = require("../../agent/lib/eventstore");
const events = require("../../agent/lib/events");

const results = [];


async function test(name, fn) {

    try {

        await fn();

        results.push({ name, ok: true });

        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false });

        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}


async function main() {

    await test("append writes one line per event to a day file", async () => {

        eventstore.attach(events.bus);

        events.setContext({ run_id: "run-test", scope: "main_agent", iteration: 1 });

        const seen = [];
        const listen = e => seen.push(e);

        events.bus.on("event", listen);

        try {

            events.emit("agent:iteration", { agent: "main_agent" });
            events.emit("tool:start", { agent: "main_agent", id: "c1", name: "fs_read" });
            events.emit("tool:end", { agent: "main_agent", id: "c1", name: "fs_read", success: true });

        } finally {

            events.bus.off("event", listen);
            eventstore.detach(events.bus);
            await eventstore.flush();
            events.setContext({ run_id: null, scope: null, iteration: null });
        }

        const file = eventstore.fileFor();
        assert.equal(fs.existsSync(file), true, "day file exists");

        const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
        assert.equal(lines.length, 3, "one line per event");

        const stored = lines.map(JSON.parse);

        /* correlation envelope is captured on every event */
        for (const e of stored) {
            assert.equal(e.run_id, "run-test");
        }
        assert.equal(stored[0].scope, "main_agent");
        assert.equal(stored[0].iteration, 1);
    });

    await test("query filters by run_id, scope and seq range", async () => {

        eventstore.attach(events.bus);

        events.setContext({ run_id: "run-q1", scope: "a", iteration: 1 });

        try {

            events.emit("agent:iteration", { agent: "main_agent", scope: "a" });
            events.emit("tool:start", { agent: "main_agent", scope: "a", id: "x", name: "fs_read" });

        } finally {

            eventstore.detach(events.bus);
            await eventstore.flush();
            events.setContext({ run_id: null, scope: null, iteration: null });
        }

        const byRun = eventstore.query({ run_id: "run-q1" });
        assert.ok(byRun.length >= 2, "finds the run's events");

        const byScope = eventstore.query({ run_id: "run-q1", scope: "a" });
        assert.equal(byScope.length, byRun.length);

        const empty = eventstore.query({ run_id: "run-other" });
        assert.equal(empty.length, 0);
    });

    await test("query can read a historical day, not just today", () => {

        /* append directly with an explicit past timestamp so it lands in a
           day file other than today. */
        const yesterday =
            new Date(Date.now() - 24 * 60 * 60 * 1000);

        eventstore.append({
            type: "agent:action",
            at: yesterday.getTime(),
            run_id: "run-old",
            turn_id: "turn-old",
            scope: "main_agent",
            iteration: 1,
            action: "tool_call"
        });

        const byDate =
            eventstore.query({
                run_id: "run-old",
                date: yesterday.toISOString()
            });

        assert.ok(byDate.length >= 1, "historical day is queryable");

        const byRange =
            eventstore.query({
                run_id: "run-old",
                date_from: yesterday.toISOString(),
                date_to: new Date().toISOString()
            });

        assert.ok(byRange.length >= 1, "date range is queryable");
    });

    await test("EVENTSTORE_ENABLED=false stops appending", () => {

        const settings = require("../../agent/lib/storage");

        settings.set("EVENTSTORE_ENABLED", false);

        const before =
            fs.existsSync(eventstore.fileFor())
                ? fs.readFileSync(eventstore.fileFor(), "utf8").split("\n").filter(Boolean).length
                : 0;

        assert.equal(eventstore.append({ type: "agent:action", at: Date.now() }), null);

        const after =
            fs.existsSync(eventstore.fileFor())
                ? fs.readFileSync(eventstore.fileFor(), "utf8").split("\n").filter(Boolean).length
                : 0;

        assert.equal(after, before, "no event was written while disabled");

        settings.set("EVENTSTORE_ENABLED", true);
    });

    await test("append never throws and skips non-events", () => {

        assert.equal(eventstore.append(null), null);
        assert.equal(eventstore.append({}), null);
        assert.equal(eventstore.append({ type: "run:start" }), true);
    });

    /* ------------------------------------------------------------------ */
    console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`);

    process.exit(results.every(r => r.ok) ? 0 : 1);
}

main();
