"use strict";

const assert = require("assert");
const path = require("path");

/*
|--------------------------------------------------------------------------
| Event Layer & Observability Tests — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Validates the modular agent/events subsystem: EventBus, EventTypes,
| EventValidator, EventContext, EventProjector, and EventRedactor.
|--------------------------------------------------------------------------
*/

const ROOT = path.resolve(__dirname, "..", "..");

const events = require(path.join(ROOT, "agent", "events"));
const legacyEvents = require(path.join(ROOT, "agent", "lib", "events.js"));

const {
    EventBus,
    EventTypes,
    EventValidator,
    EventContext,
    EventProjector,
    EventRedactor,
    KNOWN_EVENT_TYPES,
    TURN_ID_DEFINITION
} = events;

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

    console.log("event subsystem layer");

    await test("EventTypes contains all 64 known types and categorizes correctly", () => {

        assert.equal(KNOWN_EVENT_TYPES.length, 64);

        assert.equal(EventTypes.isKnownType("run:start"), true);
        assert.equal(EventTypes.isKnownType("agent:iteration"), true);
        assert.equal(EventTypes.isKnownType("unknown:nonsense"), false);

        assert.equal(EventTypes.categoryOf("run:start"), "run");
        assert.equal(EventTypes.categoryOf("tool:start"), "tool");
        assert.equal(EventTypes.categoryOf("mcp:call"), "mcp");
    });

    await test("EventTypes differentiates business events from telemetry", () => {

        assert.equal(EventTypes.isTelemetryEvent("request:start"), true);
        assert.equal(EventTypes.isTelemetryEvent("request:end"), true);
        assert.equal(EventTypes.isTelemetryEvent("agent:thinking"), true);

        assert.equal(EventTypes.isBusinessEvent("run:start"), true);
        assert.equal(EventTypes.isBusinessEvent("tool:end"), true);
        assert.equal(EventTypes.isBusinessEvent("approval:request"), true);
    });

    await test("TURN_ID_DEFINITION documents format and hierarchy", () => {

        assert.ok(TURN_ID_DEFINITION.description.includes("conversational turn"));
        assert.ok(TURN_ID_DEFINITION.format.includes("<run_id>_t<N>"));
        assert.equal(TURN_ID_DEFINITION.hierarchy, "project_id ⊃ run_id ⊃ turn_id ⊃ iteration");
    });

    await test("EventContext isolates correlation per async chain", async () => {

        const ctx = new EventContext();

        await ctx.runWithScope({ run_id: "run-alpha", project_id: "prj-alpha" }, async () => {

            ctx.setContext({ turn_id: "turn-1", scope: "main_agent", iteration: 1 });

            const resolved = ctx.resolveCorrelation({});

            assert.equal(resolved.run_id, "run-alpha");
            assert.equal(resolved.turn_id, "turn-1");
            assert.equal(resolved.project_id, "prj-alpha");

            await ctx.withProjectId("prj-sub", async () => {

                const subResolved = ctx.resolveCorrelation({});

                assert.equal(subResolved.run_id, "run-alpha");
                assert.equal(subResolved.turn_id, "turn-1");
                assert.equal(subResolved.project_id, "prj-sub");
            });

            const restored = ctx.resolveCorrelation({});
            assert.equal(restored.project_id, "prj-alpha");
        });
    });

    await test("EventValidator detects valid and invalid envelopes", () => {

        const validEvent = {
            seq: 1,
            type: "agent:iteration",
            at: Date.now(),
            run_id: "r1",
            turn_id: "t1",
            scope: "main",
            iteration: 1
        };

        const result = EventValidator.validate(validEvent);
        assert.equal(result.valid, true);
        assert.equal(result.errors.length, 0);

        const invalidEvent = {
            seq: "not-a-number",
            type: "",
            at: -1
        };

        const badResult = EventValidator.validate(invalidEvent);
        assert.equal(badResult.valid, false);
        assert.ok(badResult.errors.length >= 3);
    });

    await test("EventValidator validates key payloads from contract", () => {

        const incompleteRunStart = {
            seq: 1,
            type: "run:start",
            at: Date.now(),
            run_id: "r1",
            turn_id: "t1",
            scope: "main",
            iteration: null
            /* missing task */
        };

        const check = EventValidator.validate(incompleteRunStart);
        assert.equal(check.valid, false);
        assert.ok(check.errors.some(e => e.includes("missing documented key payload field: task")));

        const completeRunStart = {
            ...incompleteRunStart,
            task: "build feature"
        };

        assert.equal(EventValidator.validate(completeRunStart).valid, true);
    });

    await test("EventRedactor masks sensitive keys, bearer tokens and URL tokens", () => {

        const raw = {
            event: "test",
            apiKey: "sk-secret-12345",
            token: "tok-abc",
            password: "supersecretpass",
            headers: {
                authorization: "Bearer my-secret-jwt-token-value"
            },
            url: "https://example.com/api?token=query-secret-token",
            safe_field: "normal content"
        };

        const redacted = EventRedactor.redact(raw);

        assert.equal(redacted.apiKey, "[REDACTED]");
        assert.equal(redacted.token, "[REDACTED]");
        assert.equal(redacted.password, "[REDACTED]");
        assert.equal(redacted.headers.authorization, "[REDACTED]");
        assert.equal(redacted.url, "https://example.com/api?token=[REDACTED]");
        assert.equal(redacted.safe_field, "normal content");

        /* original object is not modified */
        assert.equal(raw.apiKey, "sk-secret-12345");
    });

    await test("EventProjector isolates streams and aggregates metadata", () => {

        const eventA = {
            seq: 10,
            type: "tool:start",
            at: 1000,
            run_id: "r1",
            turn_id: "t1",
            scope: "main",
            iteration: 1,
            project_id: "prj-a",
            name: "fs_read"
        };

        const eventB = {
            ...eventA,
            project_id: "prj-b"
        };

        const eventGlobal = {
            ...eventA,
            project_id: undefined
        };

        /* Project A stream */
        assert.equal(EventProjector.visibleOnProjectStream(eventA, "prj-a"), eventA);
        assert.equal(EventProjector.visibleOnProjectStream(eventB, "prj-a"), null);

        const agg = EventProjector.visibleOnProjectStream(eventGlobal, "prj-a");
        assert.equal(agg.aggregate, true);
        assert.equal(agg.type, "tool:start");
        assert.equal(agg.name, undefined); /* sensitive tool name omitted from aggregate metadata */
    });

    await test("EventProjector deduplicates events by run_id and seq", () => {

        const list = [
            { run_id: "r1", seq: 1, payload: "first" },
            { run_id: "r1", seq: 2, payload: "second" },
            { run_id: "r1", seq: 1, payload: "duplicate" }
        ];

        const deduplicated = EventProjector.deduplicate(list);
        assert.equal(deduplicated.length, 2);
        assert.equal(deduplicated[0].payload, "first");
        assert.equal(deduplicated[1].payload, "second");
    });

    await test("EventBus manages monotonic sequence, envelopes and dispatching", () => {

        const busInstance = new EventBus();
        const eventsCaptured = [];

        busInstance.on("event", e => eventsCaptured.push(e));

        const emitted = busInstance.emit("run:start", { task: "bus test" });

        assert.equal(emitted.seq, 1);
        assert.equal(emitted.type, "run:start");
        assert.equal(emitted.task, "bus test");
        assert.equal(eventsCaptured.length, 1);
        assert.equal(eventsCaptured[0], emitted);

        busInstance.resetSequence();
        assert.equal(busInstance.getSequence(), 0);
    });

    await test("legacy wrapper agent/lib/events.js exports identically to agent/events", () => {

        assert.equal(legacyEvents.bus, events.bus);
        assert.equal(typeof legacyEvents.emit, "function");
        assert.equal(typeof legacyEvents.setContext, "function");
        assert.equal(typeof legacyEvents.runWithScope, "function");
        assert.equal(typeof legacyEvents.withProjectId, "function");
        assert.equal(typeof legacyEvents.resetSequence, "function");
        assert.equal(typeof legacyEvents.aggregateMetadata, "function");
        assert.equal(typeof legacyEvents.visibleOnProjectStream, "function");
    });

    const failed =
        results.filter(item => !item.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} passed`
    );

    process.exit(failed.length === 0 ? 0 : 1);
}

main();
