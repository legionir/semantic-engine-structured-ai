"use strict";

/*
|--------------------------------------------------------------------------
| Web route contract — EXECUTION_PLAN Phase 23, step 1
|--------------------------------------------------------------------------
|
| Asserts that every route in the inventory answers with the status, the
| content-type and the JSON shape recorded in routes.snapshot.json.
|
| This is the net step 2 has to be dragged across the floor on: handlers move
| out of createServer one at a time, and after each move this file says whether
| any response changed and which field of it. It is not a style check — a
| dropped field, a 200 that became a 204, a JSON body that turned into text, or
| an approval prompt that stopped being asked all fail here.
|
| Re-record deliberately:  node test/web/routes.record.js
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { boot, shutdown, request } = require("./routeHarness.js");
const { probesFor } = require("./routes.js");

const SNAPSHOT =
    JSON.parse(fs.readFileSync(path.join(__dirname, "routes.snapshot.json"), "utf8"));

const results = [];


async function test(name, fn) {

    try {

        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);

    } catch (error) {

        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.message.split("\n")[0]}`);
    }
}


function firstDifference(expected, actual, trail = "body") {

    if (JSON.stringify(expected) === JSON.stringify(actual)) {
        return null;
    }

    if (!expected || !actual || typeof expected !== "object" || typeof actual !== "object") {
        return `${trail}: recorded ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    }

    const eKeys = Object.keys(expected);
    const aKeys = Object.keys(actual);

    for (const key of eKeys) {
        if (!(key in actual)) {
            return `${trail}.${key}: recorded in the response, now missing`;
        }

        const nested = firstDifference(expected[key], actual[key], `${trail}.${key}`);

        if (nested) return nested;
    }

    for (const key of aKeys) {
        if (!(key in expected)) {
            return `${trail}.${key}: not in the recorded contract (new field — update the snapshot on purpose or drop it)`;
        }
    }

    return `${trail}: recorded ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}


async function main() {

    console.log(`web route contract (${SNAPSHOT.count} routes)`);

    const context = await boot();

    const probes = probesFor(context.workspace);

    assert.equal(
        probes.length,
        SNAPSHOT.count,
        "the inventory and the snapshot disagree — re-record after updating routes.js"
    );

    for (let index = 0; index < probes.length; index += 1) {

        const probe = probes[index];
        const recorded = SNAPSHOT.routes[index];

        assert.equal(
            probe.name,
            recorded.name,
            `probe order changed at ${probe.name}: the snapshot is positional`
        );

        await test(`${recorded.method} ${recorded.path} — ${recorded.name}`, async () => {

            const actual = await request(context, probe);

            assert.equal(
                actual.status,
                recorded.status,
                `status drifted: recorded ${recorded.status}, got ${actual.status}`
            );

            assert.equal(
                actual.contentType,
                recorded.contentType,
                `content-type drifted: recorded ${recorded.contentType}, got ${actual.contentType}`
            );

            if (recorded.streamFrame !== undefined) {

                /*
                | SSE framing is part of the contract — the first frame, its
                | fields and the shape of its payload — because a handler that
                | forgets to send the snapshot still answers 200.
                */
                assert.deepEqual(
                    actual.streamFrame,
                    recorded.streamFrame,
                    "the stream's opening frame changed"
                );
                return;
            }

            /*
            | The harness already reduces a body to its shape — re-shaping it
            | here would compare "text" to "string" and call it a contract
            | break, which is how a harness starts lying about the code.
            */
            const difference =
                firstDifference(recorded.body, actual.body);

            assert.ok(!difference, difference || "");
        });
    }

    await shutdown(context);

    const failed = results.filter(item => !item.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length) {
        console.log("\n" + failed.map(f => f.name).join("\n"));
    }

    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {

    console.error(error);
    process.exit(1);

});
