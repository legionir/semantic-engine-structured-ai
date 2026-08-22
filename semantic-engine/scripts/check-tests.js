#!/usr/bin/env node
"use strict";

/*
| Test gate
| ---------
|
|   node scripts/check-tests.js
|
| Runs the suite and fails unless *every* suite ran.
|
| Why this exists: a jest suite that fails to compile contributes zero
| tests, so the "Tests:" line keeps reporting a healthy, and even a
| growing, number while suites quietly stop running. Five suites stopped
| running when a required field was added in phase 19 and stayed dead
| through two more phases, because the passing test count went up the
| whole time - 1072 passed, five suites dead.
|
| Reading the exit code is enough on its own. The point of this script is
| that it prints the two numbers next to each other, so the failure mode
| is visible rather than something you have to know to look for.
| Recorded as SE-BUILD-11.
*/

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/*
| Phase 24 removed the SQLiteExporter exclusion. That suite used to need
| a native sqlite3 build, which does not exist in every environment, so
| it was skipped - and with it the only coverage the SQLite output had.
| It now runs on the same driver the exporter uses, which prefers the
| SQLite built into Node.
*/
const result = spawnSync(
    "npx",
    ["jest", "--ci"],
    { cwd: ROOT, encoding: "utf8" }
);

/* Jest writes its summary to stderr. */
const output = `${result.stdout || ""}${result.stderr || ""}`;

const suites = output.match(/Test Suites:.*/);
const tests = output.match(/Tests:.*/);

console.log(suites ? suites[0] : "Test Suites: (not reported)");
console.log(tests ? tests[0] : "Tests: (not reported)");

/*
| Which tests failed, not just how many.
|
| Phase 36: one run in six failed with a single red test, and the only
| thing this script printed was "1 failed". Re-running turned it green
| and the evidence was gone - which is the worst outcome for a flake,
| because the next person concludes it was nothing.
|
| Jest already names them; the summary block just was not being passed
| through. Recorded as SE-BUILD-15.
*/
function failedTestNames() {
    const names = [];
    for (const line of output.split("\n")) {
        const bullet = /^\s*●\s+(.+?)\s*$/.exec(line);
        if (bullet && !/Console|Test suite failed to run/.test(bullet[1])) {
            names.push(bullet[1]);
        }
        const cross = /^\s*✕\s+(.+?)(?:\s+\(\d+\s*m?s\))?\s*$/.exec(line);
        if (cross) names.push(cross[1]);
    }
    return Array.from(new Set(names));
}

function reportFailures() {
    const names = failedTestNames();
    if (names.length === 0) return;
    console.error("\nfailing tests:");
    for (const name of names) console.error(`  ${name}`);
}

const failedSuites = /Test Suites:.*?(\d+) failed/.exec(output);

if (failedSuites) {
    reportFailures();
    console.error(
        `\nerror: ${failedSuites[1]} test suite(s) did not run.\n` +
        `A suite that fails to compile reports zero tests, so the test count\n` +
        `stays green while the suite is dead. Fix the suite, do not ignore it.`
    );
    process.exit(1);
}

if (result.status !== 0) {
    reportFailures();
    console.error("\nerror: the test run failed");
    process.exit(result.status ?? 1);
}

if (!suites) {
    console.error("\nerror: could not read the suite summary from jest output");
    process.exit(1);
}

console.log("\nall suites ran");
