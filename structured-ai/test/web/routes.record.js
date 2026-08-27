"use strict";

/*
|--------------------------------------------------------------------------
| Route contract recorder — EXECUTION_PLAN Phase 23, step 1
|--------------------------------------------------------------------------
|
| Writes test/web/routes.snapshot.json: for every route in the inventory, the
| status, the content-type and the shape of the JSON body as the console
| answers them today.
|
| This is what makes step 2 reviewable. Moving ~40 handler bodies out of one
| 3,000-line function is not something to judge by eye: after each handler
| moves, `node test/web/routes.contract.test.js` says whether any response
| changed, and the snapshot says precisely which field.
|
| Re-record only when a change to the contract is intended, and read the diff:
|     node test/web/routes.record.js
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const { boot, shutdown, request } = require("./routeHarness.js");
const { probesFor } = require("./routes.js");

const SNAPSHOT = path.join(__dirname, "routes.snapshot.json");


async function main() {

    const context = await boot();

    const recorded = [];

    for (const probe of probesFor(context.workspace)) {

        let result;

        try {

            result = await request(context, probe);

        } catch (error) {

            result = { status: 0, contentType: "unreachable", body: "error", note: error.message };
        }

        recorded.push({
            name: probe.name,
            method: probe.method,
            path: probe.path,
            ...(probe.body === undefined ? {} : { request: probe.body }),
            status: result.status,
            contentType: result.contentType,
            ...(result.streamFrame === undefined ? {} : { streamFrame: result.streamFrame }),
            body: result.body
        });
    }

    fs.writeFileSync(
        SNAPSHOT,
        JSON.stringify({
            recordedAt: new Date().toISOString(),
            count: recorded.length,
            routes: recorded
        }, null, 2) + "\n"
    );

    await shutdown(context);

    console.log(`recorded ${recorded.length} routes → test/web/routes.snapshot.json`);
    for (const entry of recorded) {
        console.log(`  ${String(entry.status).padEnd(4)} ${(entry.method + " " + entry.path).padEnd(52)} ${entry.contentType}`);
    }
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
