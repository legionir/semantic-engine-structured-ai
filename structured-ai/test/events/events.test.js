"use strict";

/*
|--------------------------------------------------------------------------
| Event boundary — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| The existing contract suite locks the public event envelope. This suite
| locks the extracted producer/context/validator/projector/redactor modules
| and the separation between business events and observability snapshots.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const EVENTS_DIR = path.join(REPO, "agent", "events");
const fixture = require(path.join(REPO, "test", "fixtures", "events.json"));
const eventKit = require(path.join(EVENTS_DIR));
const legacy = require(path.join(REPO, "agent", "lib", "events"));
const { Observability } = require(path.join(REPO, "agent", "runtime", "Observability"));

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
  await test("the event module inventory and legacy facade are present", () => {
    [
      "EventBus.js", "EventTypes.js", "EventValidator.js", "EventContext.js",
      "EventProjector.js", "EventRedactor.js", "index.js"
    ].forEach(name => assert.equal(fs.existsSync(path.join(EVENTS_DIR, name)), true, name));
    assert.equal(legacy.EventBus, eventKit.EventBus);
    assert.equal(legacy.EventContext, eventKit.EventContext);
    assert.equal(legacy.EventValidator, eventKit.EventValidator);
    assert.equal(legacy.EventProjector, eventKit.EventProjector);
  });

  await test("EventTypes exactly covers the documented event inventory", () => {
    assert.deepEqual([...eventKit.EVENT_TYPES].sort(), [...fixture.inventory].sort());
    assert.equal(eventKit.EVENT_TYPES.length, fixture.inventory.length);
    assert.equal(eventKit.isKnownEventType("run:start"), true);
    assert.equal(eventKit.isKnownEventType("event"), false);
  });

  await test("EventContext isolates concurrent scope and project attribution", async () => {
    const context = new eventKit.EventContext();
    const seen = [];
    await Promise.all([
      context.runWithScope({ run_id: "a", turn_id: "a_t1", scope: "a", project_id: "prj-a" }, async () => {
        await new Promise(resolve => setTimeout(resolve, 4));
        seen.push({ ...context.current() });
      }),
      context.runWithScope({ run_id: "b", turn_id: "b_t1", scope: "b", project_id: "prj-b" }, async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        await context.withProjectId("prj-b-child", async () => {
          seen.push({ ...context.current() });
        });
      })
    ]);
    assert.deepEqual(seen.map(item => item.project_id).sort(), ["prj-a", "prj-b-child"]);
    assert.equal(context.current(), null);
  });

  await test("EventValidator enforces the envelope but permits additive unknown names", () => {
    const validator = new eventKit.EventValidator();
    const valid = {
      seq: 1,
      type: "future:event",
      at: Date.now(),
      run_id: null,
      turn_id: null,
      scope: null,
      iteration: null,
      extra: true
    };
    assert.equal(validator.validate(valid), true);
    assert.throws(() => validator.validate({ type: "run:start" }), /Event validation failed/);
    assert.throws(() => validator.validate({ ...valid, project_id: 42 }), /project_id/);
  });

  await test("EventBus preserves payload precedence, sequence and legacy shape", async () => {
    let now = 1000;
    const bus = new eventKit.EventBus({ clock: { now: () => now++ } });
    const captured = [];
    bus.bus.on("event", event => captured.push(event));
    bus.setContext({ run_id: "global-run", turn_id: "global-turn", scope: "global", iteration: 0 });
    const legacyEvent = bus.emit("run:start", { task: "legacy" });
    assert.equal(Object.prototype.hasOwnProperty.call(legacyEvent, "project_id"), false);
    const scoped = await bus.runWithScope({ run_id: "scoped-run", turn_id: "scoped-turn", scope: "worker", project_id: "prj-a" }, async () =>
      bus.emit("tool:start", { run_id: "override-run", id: "t1", name: "fs_read" })
    );
    assert.equal(scoped.run_id, "override-run");
    assert.equal(scoped.project_id, "prj-a");
    assert.equal(captured[1].seq, captured[0].seq + 1);
    assert.equal(captured[1].turn_id, "scoped-turn");
  });

  await test("EventProjector filters cross-project events and aggregates global metadata", () => {
    const projector = new eventKit.EventProjector();
    const own = { seq: 1, type: "tool:end", at: 1, run_id: "a", turn_id: "a_t1", scope: "a", iteration: 1, project_id: "prj-a", result: "secret" };
    const other = { ...own, seq: 2, project_id: "prj-b" };
    const global = { ...own, seq: 3, project_id: undefined };
    assert.equal(projector.project(own, { projectId: "prj-a" }), own);
    assert.equal(projector.project(other, { projectId: "prj-a" }), null);
    assert.equal(projector.project(global, { projectId: "prj-a" }).aggregate, true);
    assert.deepEqual(projector.replay([own, other], { projectId: "prj-a" }), [own]);
  });

  await test("EventRedactor masks secrets and bounds source material without mutating events", () => {
    const event = {
      type: "request:end",
      token: "bearer-secret",
      authorization: "Bearer abc",
      content: "x".repeat(400),
      nested: { api_key: "key", value: "kept" }
    };
    const redacted = eventKit.EventRedactor.redactForLog(event);
    assert.equal(event.token, "bearer-secret");
    assert.equal(redacted.token, "****");
    assert.equal(redacted.nested.api_key, "****");
    assert.ok(redacted.content.length < event.content.length);
    assert.equal(redacted.nested.value, "kept");
  });

  await test("Observability remains a consumer boundary, not an event producer", () => {
    const observability = new Observability();
    observability.observe({ type: "run:start", at: 1, project_id: "prj-a" });
    observability.observe({ type: "tool:end", at: 2, project_id: "prj-a", name: "fs_read", success: true });
    observability.observe({ type: "run:end", at: 3, project_id: "prj-a", success: true });
    observability.recordMemory("prj-a", 123);
    const snapshot = observability.snapshot();
    assert.equal(snapshot.projects["prj-a"].project_runs_total, 1);
    assert.equal(snapshot.projects["prj-a"].project_tool_calls_total, 1);
    assert.equal(snapshot.projects["prj-a"].project_memory_bytes, 123);
    assert.equal(snapshot.gateway.gateway_active_runs, 0);
  });

  const failed = results.filter(item => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
  console.error(error);
  process.exit(1);
});
