"use strict";

/*
| Records the visualizer contract: for each entry the tests can point at, the
| three cases (fixture graph, failed fetch, empty graph) are booted in their own
| process and their traces stored. Run this from the implementation you consider
| the reference — phase 25 recorded it from the single-file client *before* the
| split, exactly as phase 23 recorded the routes from web/server.js.
|
|   node test/web/visualizer.record.js [entry]        default: web/public/visualizer.js
*/

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "visualizer.snapshot.json");
const entry = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO, "web", "public", "visualizer.js");

function run(caseName) {

    const out = execFileSync(
        process.execPath,
        [path.join(__dirname, "visualizerScenario.js"), "--entry", entry, "--case", caseName],
        { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );

    return JSON.parse(out);
}

const { inventory } = require(path.join(REPO, "tools", "frontend_inventory.js"));
const { clientSources } = require("./visualizerHarness.js");

const sources = clientSources(REPO);

const snapshot = {
    recordedFrom: sources.map(file => path.relative(REPO, file)),
    recordedAt: new Date().toISOString().slice(0, 10),
    inventory: inventory(sources.map(file => fs.readFileSync(file, "utf8")).join("\n\n")),
    cases: {}
};

console.log(`sources: ${snapshot.recordedFrom.join(", ")}`);

for (const caseName of ["ok", "fallback", "empty"]) {

    snapshot.cases[caseName] = run(caseName);

    const init = snapshot.cases[caseName].afterInit;

    console.log(`  ${caseName.padEnd(9)} nodes ${String(init.nodes.length).padStart(2)} · edges ${init.edges.length} · title ${JSON.stringify(init.projectTitle)}`);
}

fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");

console.log(`\nrecorded → test/web/visualizer.snapshot.json`);
