"use strict";

/*
|--------------------------------------------------------------------------
| P1-5: matrix CI and portable tests
|--------------------------------------------------------------------------
|
|   1. one test runner (ci/run-tests.js) instead of the `&&` chain: it runs
|      every file of `npm test` on any OS, reports each, times out a hung
|      file and writes JUnit
|   2. the tests do not depend on POSIX-only programs (sleep, cat, sh,
|      timeout, /dev/null) so `npm test` can be green on Windows too
|   CI runs the full suite on ubuntu, windows and macos (p0-regression.yml)
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(REPO, "ci", "run-tests.js");

const results = [];

async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error && error.stack}`);
    }
}


function walk(directory, found = []) {

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {

        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== "fixtures") {
                walk(full, found);
            }
        } else if (/\.(c|m)?js$/.test(entry.name)) {
            found.push(full);
        }
    }

    return found;
}


async function main() {

    console.log("P1-5: matrix CI and portable tests");

    const runner = require(RUNNER);
    const packageJson = require(path.join(REPO, "package.json"));

    await test("the runner reads every npm test file and each exists", () => {

        const entries = runner.testFiles(packageJson);

        assert.ok(entries.length >= 10, `only ${entries.length} files`);

        for (const entry of entries) {
            assert.ok(fs.existsSync(path.join(REPO, entry.file)), `${entry.file} is listed in npm test but missing`);
        }
    });

    await test("every npm test step is a plain `node <file>` (no shell-only syntax)", () => {

        const chain = packageJson.scripts["test:files"] || packageJson.scripts.test;
        const steps = String(chain).split("&&").map(step => step.trim()).filter(Boolean);
        const odd = steps.filter(step => !/^node\s+[^\s;|&<>$`]+(\s+--?[\w-]+(=[^\s;|&<>$`]+)?)*$/.test(step));

        assert.deepEqual(odd, []);
    });

    await test("the runner reports passing, failing and hung files, and writes JUnit", () => {

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p15-"));

        try {

            fs.writeFileSync(path.join(dir, "pass.js"), "console.log('fine')\n");
            fs.writeFileSync(path.join(dir, "fail.js"), "console.log('broken <here>'); process.exit(3)\n");
            fs.writeFileSync(path.join(dir, "hang.js"), "setInterval(() => {}, 1000)\n");
            fs.writeFileSync(path.join(dir, "stdin.js"), "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))\n");
            fs.writeFileSync(
                path.join(dir, "package.json"),
                JSON.stringify({ scripts: { test: "node pass.js && node fail.js && node hang.js && node stdin.js" } })
            );

            const out = path.join(dir, "out.txt");
            const xml = path.join(dir, "junit.xml");

            const child = spawnSync(
                process.execPath,
                [RUNNER, "--package", path.join(dir, "package.json"), "--out", out, "--junit", xml, "--timeout-ms", "3000"],
                { encoding: "utf8", timeout: 60000 }
            );

            assert.equal(child.status, 1, child.stdout + child.stderr);

            const report = fs.readFileSync(out, "utf8");

            assert.match(report, /ok\s+pass\.js/);
            assert.match(report, /FAIL fail\.js \(exit 3/);
            assert.match(report, /FAIL hang\.js \(timed out/);
            assert.match(report, /ok\s+stdin\.js/, "a test reading stdin must see end of input, not hang");
            assert.match(report, /2\/4 passed/);
            assert.match(report, /broken <here>/);

            const junit = fs.readFileSync(xml, "utf8");

            assert.match(junit, /<testsuite name="structured-ai npm test" tests="4" failures="2"/);
            assert.match(junit, /broken &lt;here&gt;/);
            assert.equal((junit.match(/<testcase /g) || []).length, 4);

        } finally {

            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    await test("tests do not spawn POSIX-only programs (sleep, cat, sh, timeout) or use /dev/null", () => {

        const programs = ["sleep", "cat", "sh", "bash", "timeout", "true", "false", "yes"];
        const quote = "[\"'`]";
        const call = "(spawn|spawnSync|exec|execSync|execFile|execFileSync)\\s*\\(\\s*";
        const patterns = [
            new RegExp(call + quote + "(" + programs.join("|") + ")(\\s|" + quote + ")"),
            new RegExp(quote + "/dev/" + "null" + quote),
            new RegExp(quote + "/bin/" + "(sh|bash)" + quote)
        ];

        const self = path.resolve(__filename);
        const offenders = [];

        for (const file of walk(path.join(REPO, "test"))) {

            if (path.resolve(file) === self) {
                continue;
            }

            const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

            lines.forEach((line, index) => {
                if (patterns.some(pattern => pattern.test(line))) {
                    offenders.push(`${path.relative(REPO, file)}:${index + 1}: ${line.trim().slice(0, 160)}`);
                }
            });
        }

        if (offenders.length) {
            console.log(`       ${offenders.length} non-portable lines:\n       ${offenders.join("\n       ")}`);
        }

        assert.deepEqual(offenders, []);
    });

    const failed = results.filter(result => !result.ok);

    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    if (failed.length) {
        process.exitCode = 1;
    }
}


setTimeout(() => {
    console.log("  FAIL global timeout (120s) reached");
    process.exit(1);
}, 120000).unref();

main().then(
    () => setTimeout(() => process.exit(process.exitCode || 0), 200).unref(),
    error => {
        console.log(`  FAIL ${error && error.stack}`);
        process.exit(1);
    }
);
