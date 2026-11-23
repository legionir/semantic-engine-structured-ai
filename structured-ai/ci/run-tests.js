#!/usr/bin/env node
"use strict";

/*
|--------------------------------------------------------------------------
| One test runner for every OS (roadmap P1-5)
|--------------------------------------------------------------------------
|
| `npm test` used to be a long `node a && node b && ...` chain: the first
| failure hid every later file, and the shell chain behaves differently
| under cmd.exe. This runner reads the same list of files from
| package.json (scripts.test, or scripts["test:files"] when present), runs
| each in its own Node process with empty stdin and a time limit, and
| reports every file:
|
|   node ci/run-tests.js [--out out.txt] [--junit junit.xml]
|                        [--timeout-ms 600000] [--only <substring>]
|
| Exit code 0 only when every file passed. Nothing here needs a POSIX
| shell, `sleep`, `cat` or `timeout`.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");


function parseArguments(argv) {

    const options = { out: null, junit: null, timeoutMs: 600000, only: null, packageFile: path.join(ROOT, "package.json") };

    for (let index = 0; index < argv.length; index += 1) {

        const arg = argv[index];
        const value = () => argv[++index];

        if (arg === "--out") options.out = value();
        else if (arg === "--junit") options.junit = value();
        else if (arg === "--timeout-ms") options.timeoutMs = Number(value()) || options.timeoutMs;
        else if (arg === "--only") options.only = value();
        else if (arg === "--package") options.packageFile = path.resolve(value());
        else if (arg === "--help" || arg === "-h") options.help = true;
        else throw new Error(`unknown option ${arg}`);
    }

    return options;
}


/*
| "node a.js && node b.js --flag" -> [{ file: "a.js", args: [] }, { file: "b.js", args: ["--flag"] }]
*/
function testFiles(packageJson) {

    const scripts = (packageJson && packageJson.scripts) || {};
    const chain = scripts["test:files"] || scripts.test || "";

    return String(chain)
        .split("&&")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => part.split(/\s+/))
        .filter(words => words[0] === "node" && words.length > 1)
        .map(words => ({ file: words[1], args: words.slice(2) }));
}


function tail(text, lines) {

    const all = String(text || "").split(/\r?\n/);

    return all.slice(Math.max(0, all.length - lines)).join("\n");
}


function xmlEscape(text) {

    return String(text)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


function junit(results, seconds) {

    const failures = results.filter(result => !result.ok).length;

    const cases = results.map(result =>
        `  <testcase classname="structured-ai" name="${xmlEscape(result.file)}" time="${result.seconds.toFixed(3)}">` +
        (result.ok
            ? ""
            : `\n    <failure message="${xmlEscape(result.status)}">${xmlEscape(tail(result.output, 200))}</failure>\n  `) +
        "</testcase>"
    );

    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<testsuite name="structured-ai npm test" tests="${results.length}" failures="${failures}" time="${seconds.toFixed(3)}">\n` +
        `${cases.join("\n")}\n</testsuite>\n`;
}


function runOne(entry, options) {

    const started = Date.now();

    const child = spawnSync(process.execPath, [entry.file, ...entry.args], {
        cwd: path.dirname(options.packageFile),
        input: "",
        encoding: "utf8",
        timeout: options.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, CI: process.env.CI || "true" }
    });

    const seconds = (Date.now() - started) / 1000;
    const output = `${child.stdout || ""}${child.stderr ? `\n${child.stderr}` : ""}`;

    let status;

    if (child.error && child.error.code === "ETIMEDOUT") {
        status = `timed out after ${options.timeoutMs}ms`;
    } else if (child.error) {
        status = `could not start: ${child.error.message}`;
    } else if (child.signal) {
        status = `killed by ${child.signal}`;
    } else {
        status = `exit ${child.status}`;
    }

    return {
        file: entry.file,
        ok: !child.error && !child.signal && child.status === 0,
        status,
        seconds,
        output
    };
}


function main() {

    const options = parseArguments(process.argv.slice(2));

    if (options.help) {
        process.stdout.write(fs.readFileSync(__filename, "utf8").split("*/")[0]);
        return 0;
    }

    const packageJson = JSON.parse(fs.readFileSync(options.packageFile, "utf8"));

    let entries = testFiles(packageJson);

    if (options.only) {
        entries = entries.filter(entry => entry.file.includes(options.only));
    }

    if (!entries.length) {
        throw new Error("no test files found in package.json scripts.test");
    }

    const started = Date.now();
    const results = [];
    const lines = [];

    const log = line => {
        lines.push(line);
        process.stdout.write(`${line}\n`);
    };

    log(`structured-ai tests on ${process.platform} (Node ${process.versions.node}), ${entries.length} files`);

    for (const entry of entries) {

        const result = runOne(entry, options);

        results.push(result);

        log(`${result.ok ? "ok  " : "FAIL"} ${entry.file} (${result.ok ? "" : `${result.status}, `}${result.seconds.toFixed(1)}s)`);
    }

    const seconds = (Date.now() - started) / 1000;
    const failed = results.filter(result => !result.ok);

    log("");
    log(`${results.length - failed.length}/${results.length} passed in ${seconds.toFixed(1)}s`);

    for (const result of failed) {
        log("");
        log(`----- ${result.file} (${result.status}) -----`);
        log(tail(result.output, 80));
    }

    if (options.out) {
        fs.writeFileSync(options.out, `${lines.join("\n")}\n`, "utf8");
    }

    if (options.junit) {
        fs.writeFileSync(options.junit, junit(results, seconds), "utf8");
    }

    return failed.length === 0 ? 0 : 1;
}


if (require.main === module) {

    try {
        process.exitCode = main();
    } catch (error) {
        process.stderr.write(`run-tests: ${error.message}\n`);
        process.exitCode = 2;
    }
}


module.exports = { testFiles, parseArguments, junit, runOne };
