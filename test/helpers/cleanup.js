"use strict";

/*
|--------------------------------------------------------------------------
| Temp directory cleanup for suites that boot the runtime
|--------------------------------------------------------------------------
|
| The runtime's event store and journal write asynchronously. On Windows,
| removing a directory while one of those writes lands fails with
| ENOTEMPTY or EBUSY. That has failed suites after every test had passed.
| So: flush both stores, remove with retries, and never fail a suite over
| a temp directory.
*/

const fs = require("fs");


async function removeTempDirs(runtime, ...dirs) {

    for (const store of [runtime && runtime.eventstore, runtime && runtime.journal]) {
        try {
            if (store && typeof store.flush === "function") await store.flush();
        } catch {
            /* a failed flush is the suite's business, not the cleanup's */
        }
    }

    for (const dir of dirs) {
        if (!dir) continue;
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch (error) {
            console.error(`  (left ${dir}: ${error.code || error.message})`);
        }
    }
}


module.exports = { removeTempDirs };
