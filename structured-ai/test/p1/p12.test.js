"use strict";

/*
|--------------------------------------------------------------------------
| P1-2 SandboxProvider launch boundary
|--------------------------------------------------------------------------
|
| These tests exercise the launch contract without requiring host-level
| sandbox binaries. Real isolation and resource-limit tests remain tied to
| the backend implementation and run on the matching OS.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const SandboxProvider = require("../../agent/tools/process/SandboxProvider");

const results = [];

function test(name, fn) {

    try {
        fn();
        results.push(true);
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push(false);
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}


test("deny mode fails closed", () => {

    assert.throws(
        () => SandboxProvider.buildLaunchSpec({ mode: "deny" }),
        /Process execution is disabled/
    );
});


test("bwrap launch isolates namespaces and only makes the workspace writable", () => {

    const spec = SandboxProvider.buildLaunchSpec({
        mode: "bwrap",
        platform: "linux",
        ctx: { root: "/work/project" },
        cwd: "/work/project/src",
        command: "npm test"
    });

    assert.strictEqual(spec.command, "bwrap");
    assert.ok(spec.args.includes("--clearenv"));
    assert.ok(spec.args.includes("--unshare-net"));
    assert.ok(spec.args.includes("--unshare-pid"));
    assert.ok(spec.args.includes("--ro-bind"));
    assert.ok(spec.args.includes("--tmpfs"));

    const writableBinds = [];

    for (let i = 0; i < spec.args.length; i += 1) {
        if (spec.args[i] === "--bind") {
            writableBinds.push(spec.args.slice(i + 1, i + 3));
        }
    }

    assert.deepStrictEqual(writableBinds, [["/work/project", "/work/project"]]);
    assert.strictEqual(spec.options.cwd, "/work/project");
    assert.strictEqual(spec.options.detached, true);
});


test("bwrap refuses to silently run on non-Linux hosts", () => {

    assert.throws(
        () => SandboxProvider.buildLaunchSpec({
            mode: "bwrap",
            platform: "win32",
            ctx: { root: "C:\\work" },
            cwd: "C:\\work",
            command: "echo no"
        }),
        /supported only on Linux/
    );
});


test("test mode gets an allowlisted environment, not runtime credentials", () => {

    const spec = SandboxProvider.buildLaunchSpec({
        mode: "test",
        platform: "linux",
        cwd: "/work/project",
        command: "npm test",
        shell: "sandbox-shell",
        environment: {
            PATH: "/usr/bin",
            HOME: "/home/agent",
            OPENAI_API_KEY: "must-not-escape",
            GITHUB_TOKEN: "must-not-escape-either",
            TMPDIR: "/tmp"
        }
    });

    assert.strictEqual(spec.command, "npm test");
    assert.strictEqual(spec.args, null);
    assert.strictEqual(spec.options.cwd, "/work/project");
    assert.strictEqual(spec.options.shell, "sandbox-shell");
    assert.strictEqual(spec.options.env.PATH, "/usr/bin");
    assert.strictEqual(spec.options.env.HOME, "/home/agent");
    assert.strictEqual(spec.options.env.TMPDIR, "/tmp");
    assert.ok(!Object.hasOwn(spec.options.env, "OPENAI_API_KEY"));
    assert.ok(!Object.hasOwn(spec.options.env, "GITHUB_TOKEN"));
});


test("unknown providers fail closed instead of falling back to host execution", () => {

    assert.throws(
        () => SandboxProvider.buildLaunchSpec({
            mode: "docker",
            ctx: { root: "/work/project" },
            cwd: "/work/project",
            command: "echo unsafe"
        }),
        /Unsupported process sandbox mode: docker/
    );
});


const failed = results.filter(ok => !ok).length;

console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed === 0 ? 0 : 1;
