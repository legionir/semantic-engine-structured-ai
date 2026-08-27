"use strict";

/*
| One visualizer boot, one process, one JSON trace on stdout.
|
| Running each case in its own process is what makes "a boot is a boot" true for
| all three entry shapes this phase touches — the classic web/public/visualizer.js,
| a CommonJS bridge, and the ES module graph: a per-process load cannot reuse a
| previous instance, so the trace cannot silently describe the *first* page when
| it claims to describe the second.
|
|   node test/web/visualizerScenario.js --entry <file> --case ok|fallback|empty
*/

const path = require("path");

const { runScenario } = require("./visualizerHarness.js");

const CASES = {
    ok: { projectId: "prj-a", fetchMode: "ok", selectId: "cls-a" },
    fallback: { projectId: "prj-b", fetchMode: "fail" },
    empty: { projectId: null, fetchMode: "empty" }
};

function arg(name) {

    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? null : process.argv[index + 1];
}

async function main() {

    const entry = path.resolve(arg("entry"));
    const name = arg("case") || "ok";

    if (!Object.prototype.hasOwnProperty.call(CASES, name)) {
        throw new Error(`unknown case ${name}`);
    }

    const trace = await runScenario(entry, CASES[name]);

    process.stdout.write(JSON.stringify(trace));

    process.exit(0);
}

main().catch(error => {

    process.stderr.write(`${error && error.stack || error}\n`);
    process.exit(1);
});
