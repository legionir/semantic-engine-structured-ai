"use strict";

/*
|--------------------------------------------------------------------------
| Run Context Tests — EXECUTION_PLAN Phase 3
|--------------------------------------------------------------------------
|
| Locks the phase-3 acceptance criteria:
|   1. a single in-process run keeps the established output and lifecycle
|      as before the phase, and the RunManager stays out of the way
|   2. normalized single-run output in modular mode equals the same run
|      in the phase-1 baseline behavior, with only the
|      additive project_id field extra
|   3. two concurrent runs on two different projects do not mix their
|      messages, budgets, or event attribution
|   4. cancelling run A does not affect run B
|
| Boundary kept from Phase 2 (assertWorkspaceMatch): cross-ROOT
| execution lands with the project-aware tool runtime in Phase 4, so
| the concurrent projects here are two DISTINCT projects sharing this
| process workspace — one registered, one the synthesized default.
|
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");

const WORKSPACE =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-run-context-ws-")
    );

const DATA_HOME =
    fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-run-context-data-")
    );

process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.MAX_RUN_MS = "15000";
process.env.MAX_REQUEST_MS = "10000";

const ROOT = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(ROOT, "agent", "agent.js"));
const events = require(path.join(ROOT, "agent", "events"));
const { normalize } = require(path.join(ROOT, "test", "helpers", "normalize.js"));

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


/* Distinctive markers so prompt constants can never collide with them. */
const MARKER_ALPHA = "zzrunlpha7f3d9a";
const MARKER_BETA = "zzrunbeta41e8c2";


function finalAction(content) {

    return {
        version: "1.0",
        tool_calls: null,
        delegations: null,
        response: { type: "text", content },
        data: null,
        error: null,
        action: "final",
        performed: null
    };

}


/* One stub endpoint for the whole file; the active handler is swappable
   per test so each scenario shapes its own responses and delays. */
const stub = {
    handler: null,
    requests: [],
    server: null
};


async function startStub() {

    stub.server =

        http.createServer((req, res) => {

            let body = "";

            req.on("data", chunk => {
                body += chunk;
            });

            req.on("end", () => {

                const parsed = JSON.parse(body);

                const text = JSON.stringify(parsed.messages || []);

                const marker =
                    text.includes(MARKER_ALPHA)
                        ? "alpha"
                        : text.includes(MARKER_BETA)
                            ? "beta"
                            : "none";

                stub.requests.push({ marker, body: parsed });

                const reply =
                    stub.handler
                        ? stub.handler(parsed, marker)
                        : { message: {
                                role: "assistant",
                                content: JSON.stringify(finalAction("done"))
                            } };

                const respond = () => {

                    res.setHeader("content-type", "application/json");

                    res.end(
                        JSON.stringify({
                            choices: [
                                {
                                    message: reply.message
                                }
                            ]
                        })
                    );
                };

                if (reply.delayMs) {
                    setTimeout(respond, reply.delayMs);
                } else {
                    respond();
                }
            });
        });

    await new Promise(
        resolve => stub.server.listen(0, "127.0.0.1", resolve)
    );

}


function setModes() {

    /* Phase 30 removed rollout flags. The canonical runtime is always
       project- and run-context aware; keep this helper as a no-op so the
       existing scenario ordering remains explicit. */

}



/* runAgent resolves with the final action object, not a string. */
function finalText(result) {

    return (
        result && result.response && typeof result.response.content === "string"
            ? result.response.content
            : JSON.stringify(result)
    );

}

function runIdsOf(captured) {

    return new Set(
        captured
            .filter(event => event.type === "run:start")
            .map(event => event.run_id)
    );

}


/* Normalized comparison form: volatile values collapsed, the additive
   project_id field of scoped (modular) events removed, keys sorted. */
function comparable(captured) {

    return captured.map(event => {

        const copy = { ...event };

        delete copy.project_id;

        return normalize(copy, { workspace: WORKSPACE });

    });

}


async function main() {

    await startStub();

    const settings = runtime.settings;

    settings.set("AGENT_BASE_URL", `http://127.0.0.1:${stub.server.address().port}/v1`);
    settings.set("AGENT_MODEL", "stub-model");


    await test("the canonical run context is always tracked by RunManager", async () => {

        setModes();

        assert.equal(typeof runtime.runManager.createRun, "function");
        assert.throws(
            () => settings.definitionOf("RUN_CONTEXT_MODE"),
            /Unknown setting/
        );
        assert.equal(settings.get("RUN_HISTORY_LIMIT"), 100);

        stub.handler = (parsed) => ({
            message: {
                role: "assistant",
                content: JSON.stringify(finalAction("legacy-done"))
            }
        });

        const captured = [];
        const listen = event => captured.push(event);
        events.bus.on("event", listen);

        let outcome;

        try {
            outcome = await runtime.runAgent({ task: "legacy probe task" });
        } finally {
            events.bus.off("event", listen);
        }

        assert.match(finalText(outcome), /legacy-done/);

        /* Every canonical run is retained long enough to query its
           outcome, including the synthetic default project. */

        for (const runId of runIdsOf(captured)) {
            assert.ok(
                runtime.runManager.get(runId),
                "a canonical run must enter the RunManager"
            );
        }

        assert.equal(runtime.runManager.activeRuns().length, 0);

        /* Project attribution is part of every scoped event envelope. */
        assert.ok(
            captured.some(
                event => Object.prototype.hasOwnProperty.call(event, "project_id")
            ),
            "canonical events must carry project attribution"
        );

    });


    await test("normalized modular single-run output equals the legacy baseline", async () => {

        /* A static final answer: the empty-work nudge hands the
           objective back once, then the identical final is accepted —
           the exact sequence captured in the phase-1 baseline. */

        stub.handler = () => ({
            message: {
                role: "assistant",
                content: JSON.stringify(finalAction("parity-done"))
            }
        });

        /* Warm-up so registry loading cannot differ between the two
           measured runs. */
        setModes(null, null);
        await runtime.runAgent({ task: "parity probe task" });

        const legacyEvents = [];
        const listenLegacy = event => legacyEvents.push(event);
        events.bus.on("event", listenLegacy);

        try {
            await runtime.runAgent({ task: "parity probe task" });
        } finally {
            events.bus.off("event", listenLegacy);
        }

        setModes("modular", null);

        const modularEvents = [];
        const listenModular = event => modularEvents.push(event);
        events.bus.on("event", listenModular);

        try {
            await runtime.runAgent({ task: "parity probe task" });
        } finally {
            events.bus.off("event", listenModular);
            setModes(null, null);
        }

        assert.deepStrictEqual(
            comparable(modularEvents),
            comparable(legacyEvents),
            "modular run does not reproduce the normalized legacy baseline"
        );

        /* The only allowed drift is additive, and it must be there. */
        assert.ok(
            modularEvents.every(
                event => Object.prototype.hasOwnProperty.call(event, "project_id")
            ),
            "modular events must carry the additive project_id"
        );

    });


    await test("two concurrent runs on two projects share nothing", async () => {

        setModes("modular", "modular");

        /* Two distinct ProjectContexts over one root: the synthesized
           default record and a registered project (cross-ROOT execution
           is the Phase-4 boundary, see header). The default record must
           be captured before registering — once a project owns this
           root it becomes the default for it, and run A passes the
           frozen record explicitly via the documented project option. */
        const defaultRecord =
            runtime.projects.registry().resolveDefault(WORKSPACE);

        assert.equal(
            defaultRecord.synthetic,
            true,
            "expected the unregistered workspace default to be synthetic"
        );

        const registered =
            runtime.projects.registry().register({
                name: "Concurrent Beta",
                rootPath: WORKSPACE
            });

        assert.notEqual(
            registered.id,
            defaultRecord.id,
            "the two runs must address different projects for this test to mean anything"
        );

        stub.handler = (parsed, marker) => ({
            delayMs: marker === "alpha" ? 300 : 0,
            message: {
                role: "assistant",
                content: JSON.stringify(
                    finalAction(`done-${marker}`)
                )
            }
        });

        const captured = [];
        const listen = event => captured.push(event);
        events.bus.on("event", listen);

        const historyA = [];
        const historyB = [];

        let resultA;
        let resultB;

        try {

            [resultA, resultB] =
                await Promise.all([
                    runtime.runAgent({
                        task: `slow task ${MARKER_ALPHA}`,
                        history: historyA,
                        project: defaultRecord
                    }),
                    runtime.runAgent({
                        task: `fast task ${MARKER_BETA}`,
                        history: historyB,
                        projectId: registered.id
                    })
                ]);

        } finally {
            events.bus.off("event", listen);
        }

        assert.match(finalText(resultA), /done-alpha/);
        assert.match(finalText(resultB), /done-beta/);

        /* --- message isolation ------------------------------------- */

        assert.ok(
            JSON.stringify(historyA).includes(MARKER_ALPHA) &&
            !JSON.stringify(historyA).includes(MARKER_BETA),
            "run A history leaked into or from run B"
        );

        assert.ok(
            JSON.stringify(historyB).includes(MARKER_BETA) &&
            !JSON.stringify(historyB).includes(MARKER_ALPHA),
            "run B history leaked into or from run A"
        );

        /* --- request isolation (model-facing boundaries) ------------ */

        for (const request of stub.requests) {

            if (request.marker === "none") {
                continue;
            }

            const text = JSON.stringify(request.body.messages);

            if (request.marker === "alpha") {

                assert.ok(
                    !text.includes(MARKER_BETA),
                    "a model request of run A contains run B material"
                );

            } else {

                assert.ok(
                    !text.includes(MARKER_ALPHA),
                    "a model request of run B contains run A material"
                );

            }
        }

        /* --- per-run contexts and budgets --------------------------- */

        const runIds = {};

        for (const event of captured) {

            if (event.type !== "run:start") {
                continue;
            }

            const side =
                String(event.task).includes(MARKER_ALPHA)
                    ? "A"
                    : "B";

            runIds[side] = event.run_id;

        }

        assert.ok(runIds.A && runIds.B && runIds.A !== runIds.B);

        const ctxA = runtime.runManager.get(runIds.A);
        const ctxB = runtime.runManager.get(runIds.B);

        assert.ok(ctxA && ctxB, "settled runs must stay queryable");
        assert.equal(ctxA.status, "completed");
        assert.equal(ctxB.status, "completed");
        assert.ok(ctxA.finishedAt > 0 && ctxB.finishedAt > 0);

        assert.strictEqual(ctxA.messages, historyA);
        assert.strictEqual(ctxB.messages, historyB);

        assert.notStrictEqual(
            ctxA.cancellation,
            ctxB.cancellation,
            "the two runs share a cancellation state"
        );

        assert.notStrictEqual(ctxA.budget, ctxB.budget);
        assert.notStrictEqual(ctxA.agentBudget, ctxB.agentBudget);

        assert.equal(ctxA.agentBudget.spawned, 0);
        assert.equal(ctxB.agentBudget.spawned, 0);

        /* --- event attribution never crosses ------------------------ */

        const projectIds = {
            A: ctxA.projectId,
            B: ctxB.projectId
        };

        assert.ok(projectIds.A && projectIds.B);
        assert.notEqual(projectIds.A, projectIds.B);

        for (const event of captured) {

            if (event.run_id === runIds.A) {

                assert.ok(
                    !event.turn_id ||
                        String(event.turn_id).startsWith(`${runIds.A}_`),
                    `event ${event.type} of run A carries run B's turn: ${event.turn_id}`
                );

                if (Object.prototype.hasOwnProperty.call(event, "project_id")) {
                    assert.equal(event.project_id, projectIds.A);
                }

            } else if (event.run_id === runIds.B) {

                assert.ok(
                    !event.turn_id ||
                        String(event.turn_id).startsWith(`${runIds.B}_`),
                    `event ${event.type} of run B carries run A's turn: ${event.turn_id}`
                );

                if (Object.prototype.hasOwnProperty.call(event, "project_id")) {
                    assert.equal(event.project_id, projectIds.B);
                }

            }
        }

        assert.ok(
            captured.some(
                event =>
                    Object.prototype.hasOwnProperty.call(event, "project_id")
            ),
            "the additive project attribution is missing entirely"
        );

        setModes(null, null);

    });


    await test("cancelling run A leaves run B unharmed", async () => {

        setModes("modular", null);

        stub.handler = (parsed, marker) => ({
            delayMs: marker === "alpha" ? 900 : 0,
            message: {
                role: "assistant",
                content: JSON.stringify(
                    finalAction(`done-${marker}`)
                )
            }
        });

        const captured = [];
        const listen = event => captured.push(event);
        events.bus.on("event", listen);

        const outcomeA = { settled: null, error: null };

        const promiseA =
            runtime
                .runAgent({ task: `stoppable task ${MARKER_ALPHA}` })
                .then(
                    value => { outcomeA.settled = ["resolved", value]; },
                    error => { outcomeA.settled = ["rejected", error]; }
                );

        const promiseB =
            runtime.runAgent({ task: `surviving task ${MARKER_BETA}` });

        /* Wait until run A exists in the manager, then stop only it. */

        let runIdA = null;

        for (let attempt = 0; attempt < 100 && !runIdA; attempt++) {

            await new Promise(resolve => setTimeout(resolve, 10));

            const starter =
                captured.find(
                    event =>
                        event.type === "run:start" &&
                        String(event.task).includes(MARKER_ALPHA)
                );

            if (starter) {
                runIdA = starter.run_id;
            }
        }

        assert.ok(runIdA, "run A never started");

        assert.equal(
            runtime.cancelRunById(`${runIdA}-bogus`, "user"),
            false,
            "cancelling an unknown run must report a miss"
        );

        assert.equal(runtime.cancelRunById(runIdA, "user"), true);

        assert.ok(
            runtime.runManager.get(runIdA).cancellation.isCancelled,
            "run A's own cancellation state did not flip"
        );

        const resultB = await promiseB;
        await promiseA;

        events.bus.off("event", listen);

        /* A failed because it was cancelled, not because of timing. */

        assert.ok(outcomeA.settled, "run A never settled");
        assert.equal(outcomeA.settled[0], "rejected");

        assert.match(
            String(outcomeA.settled[1].message || outcomeA.settled[1]),
            /cancel|abort/i
        );

        assert.equal(
            runtime.runManager.get(runIdA).status,
            "cancelled"
        );

        /* B completed with its own final answer and its own run. */

        assert.match(finalText(resultB), /done-beta/);

        const starterB =
            captured.find(
                event =>
                    event.type === "run:start" &&
                    String(event.task).includes(MARKER_BETA)
            );

        assert.ok(starterB);
        assert.notEqual(starterB.run_id, runIdA);

        const ctxB = runtime.runManager.get(starterB.run_id);

        assert.equal(ctxB.status, "completed");
        assert.equal(ctxB.cancellation.isCancelled, false);

        setModes(null, null);

    });


    await test("scope-free lifecycle helpers remain available for direct callers", async () => {

        setModes(null, null);

        /* The exported lifecycle the console and web server call must
           keep working on the shared RUN object, scope-free. */

        runtime.startRun();

        assert.ok(
            !runtime.isRunCancelled(),
            "fresh global run starts cancelled"
        );

        assert.ok(
            typeof runtime.runRemainingMs() === "number",
            "runRemainingMs stopped reporting"
        );

        runtime.cancelRun("user");

        assert.ok(
            runtime.isRunCancelled(),
            "cancelRun no longer flips the global run"
        );

    });


    settings.reset("AGENT_BASE_URL");
    settings.reset("AGENT_MODEL");

    await new Promise(resolve => stub.server.close(resolve));

    fs.rmSync(WORKSPACE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(DATA_HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
