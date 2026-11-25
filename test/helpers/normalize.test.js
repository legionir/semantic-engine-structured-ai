"use strict";

/*
|--------------------------------------------------------------------------
| Normalizer Unit Tests — EXECUTION_PLAN Phase 1
|--------------------------------------------------------------------------
|
| The normalizer defines what "equal output" means for every regression
| comparison in the plan. Its own behavior is therefore locked here, using
| realistic runtime samples rather than synthetic trivia.
|
*/

const assert = require("assert");
const path = require("path");

const { normalize, normalizeJson, VOLATILE_KEYS } =
    require(path.join(__dirname, "normalize.js"));

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

    await test("ISO timestamps, run ids, temp paths and pids collapse to tokens", async () => {

        const raw =
            'run run-2026-08-25T11:22:33.123Z-x9 at 2026-08-25T11:22:35.000Z ' +
            'read /tmp/agent-runtime-test-Abc12/notes.md pid: 4242';

        const out = normalize(raw);

        for (const token of ["<RUN_ID>", "<TSTAMP>", "<TMP>", "pid=<PID>"]) {

            assert.ok(out.includes(token), `missing token ${token} in: ${out}`);

        }

        assert.ok(!out.includes("4242"), "pid leaked past the normalizer");
        assert.ok(!out.includes("/tmp/"), "temp path leaked past the normalizer");

    });

    await test("workspace replacement wins over the temp-dir rule", async () => {

        const workspace = "/tmp/agent-runtime-test-Work99";

        const out = normalize(
            `${workspace}/src/index.js`,
            { workspace }
        );

        assert.equal(out, "<WORK>/src/index.js");

    });

    await test("volatile numbers are key-driven; contractual numbers survive", async () => {

        const raw = {
            at: 1760000000000,
            duration_ms: 350,
            seq: 12,
            iteration: 3,
            max_iterations: 50,
            count: 7
        };

        const out = normalize(raw);

        assert.equal(out.at, "<EPOCH>");
        assert.equal(out.duration_ms, "<VOL>");
        assert.equal(out.seq, "<VOL>");
        assert.equal(out.iteration, 3);
        assert.equal(out.max_iterations, 50);
        assert.equal(out.count, 7);

    });

    await test("object keys are sorted recursively and array order is preserved", async () => {

        const raw = {
            zeta: 1,
            alpha: { beta: 2, aardvark: 3 },
            list: [{ y: 1, a: 2 }, { b: 1, a: 1 }]
        };

        const out = normalize(raw);

        assert.deepStrictEqual(Object.keys(out), ["alpha", "list", "zeta"]);
        assert.deepStrictEqual(Object.keys(out.alpha), ["aardvark", "beta"]);

        /* arrays keep order — messages, tool calls and events are contractual */

        assert.equal(out.list[0].y, 1);
        assert.equal(out.list[1].b, 1);
        assert.deepStrictEqual(Object.keys(out.list[0]), ["a", "y"]);

    });

    await test("normalizeJson accepts raw provider payloads", async () => {

        const body = JSON.stringify({
            run_id: "run-2026-08-25T01:01:01.000Z-aa",
            turn_id: "t1",
            task: "read /tmp/x/file.txt",
            at: 1760000000123
        });

        const out = normalizeJson(body);

        assert.equal(out.run_id, "<RUN_ID>");
        assert.equal(out.at, "<EPOCH>");
        assert.equal(out.turn_id, "t1");

    });

    await test("epochs below the threshold are not mistaken for timestamps", async () => {

        const raw = { retries: 3, budget_remaining: 240000, at: 1760000000123 };

        const out = normalize(raw);

        assert.equal(out.retries, 3);
        assert.equal(out.budget_remaining, 240000);
        assert.equal(out.at, "<EPOCH>");

        assert.ok(VOLATILE_KEYS.has("duration_ms"));

    });

    console.log(`\n${results.filter(item => item.ok).length}/${results.length} passed`);

    if (results.some(item => !item.ok)) {

        process.exitCode = 1;

    }
}

main();
