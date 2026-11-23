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
const SandboxDoctor = require("../../agent/tools/process/SandboxDoctor");
const ProcessManager = require("../../agent/tools/process/ProcessManager");

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
        command: "npm test",
        environment: {
            PATH: "/usr/bin",
            OPENAI_API_KEY: "must-not-escape"
        }
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
    assert.strictEqual(spec.options.env.PATH, "/usr/bin");
    assert.ok(!Object.hasOwn(spec.options.env, "OPENAI_API_KEY"));
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


test("Docker/Podman containers have bounded resources, no ambient secrets, and a workspace-only mount", () => {

    for (const mode of ["docker", "podman"]) {

        const spec = SandboxProvider.buildLaunchSpec({
            mode,
            ctx: { root: "/work/project" },
            cwd: "/work/project/packages/app",
            command: "npm install",
            platform: "linux",
            image: "node:22-bookworm",
            network: "none",
            cpus: 2,
            memoryMb: 2048,
            pidsLimit: 256,
            tmpMb: 512,
            uid: 1000,
            gid: 1000,
            environment: {
                PATH: "/usr/bin",
                DOCKER_HOST: "unix:///run/docker.sock",
                OPENAI_API_KEY: "host-secret"
            },
            containerName: "test-sandbox-1"
        });

        assert.strictEqual(spec.command, mode);
        assert.ok(spec.args.includes("--read-only"));
        assert.ok(spec.args.includes("--cap-drop=ALL"));
        assert.ok(spec.args.includes("--security-opt=no-new-privileges"));
        assert.ok(spec.args.includes("--network"));
        assert.strictEqual(spec.args[spec.args.indexOf("--network") + 1], "none");
        assert.strictEqual(spec.args[spec.args.indexOf("--memory") + 1], "2048m");
        assert.strictEqual(spec.args[spec.args.indexOf("--cpus") + 1], "2");
        assert.strictEqual(spec.args[spec.args.indexOf("--pids-limit") + 1], "256");
        assert.strictEqual(spec.args[spec.args.indexOf("--workdir") + 1], "/workspace/packages/app");
        assert.strictEqual(spec.args[spec.args.indexOf("--mount") + 1], "type=bind,source=/work/project,target=/workspace");
        assert.ok(!spec.args.some(arg => /OPENAI_API_KEY|GITHUB_TOKEN|host-secret/.test(arg)));
        assert.strictEqual(spec.options.env.PATH, "/usr/bin");
        assert.strictEqual(spec.options.env.DOCKER_HOST, "unix:///run/docker.sock");
        assert.ok(!Object.hasOwn(spec.options.env, "OPENAI_API_KEY"));
        assert.strictEqual(spec.options.cwd, "/work/project");
    }
});


test("container working directory translates Windows paths and refuses workspace escape", () => {

    assert.strictEqual(
        SandboxProvider.workspaceContainerPath("C:\\Users\\dev\\repo", "C:\\Users\\dev\\repo\\pkg", "win32"),
        "/workspace/pkg"
    );

    assert.strictEqual(
        SandboxProvider.workspaceContainerPath("C:\\Users\\dev\\repo", "c:\\users\\dev\\repo\\pkg", "win32"),
        "/workspace/pkg",
        "Windows path containment is case-insensitive"
    );

    assert.throws(
        () => SandboxProvider.workspaceContainerPath("/work/project", "/work/other", "linux"),
        /must stay inside the workspace/
    );
    assert.throws(
        () => SandboxProvider.workspaceContainerPath("C:\\work\\project", "C:\\work\\project-copy", "win32"),
        /must stay inside the workspace/
    );
    assert.throws(
        () => SandboxProvider.workspaceContainerPath("C:\\work\\project", "D:\\outside", "win32"),
        /must stay inside the workspace/
    );
    assert.throws(
        () => SandboxProvider.workspaceContainerPath("relative\\project", "relative\\project", "win32"),
        /must be absolute/
    );
});


test("container configuration is validated and networking defaults to isolated", () => {

    const base = {
        mode: "docker",
        ctx: { root: "/work/project" },
        cwd: "/work/project",
        command: "true",
        platform: "linux",
        containerName: "sandbox-test"
    };

    const defaults = SandboxProvider.containerLaunchSpec(base);
    assert.strictEqual(defaults.args[defaults.args.indexOf("--network") + 1], "none");
    assert.ok(defaults.args.includes("--read-only"));
    assert.ok(defaults.args.includes("--cap-drop=ALL"));
    assert.ok(defaults.args.includes("--security-opt=no-new-privileges"));
    assert.ok(defaults.args.includes("--rm"));
    assert.ok(defaults.args.includes("--init"));
    assert.ok(defaults.args.includes("--pull=missing"));
    assert.ok(!defaults.args.includes("--privileged"));
    assert.ok(!defaults.args.some(arg => arg.startsWith("/var/run/docker.sock")));

    const bridge = SandboxProvider.containerLaunchSpec({ ...base, network: "bridge" });
    assert.strictEqual(bridge.args[bridge.args.indexOf("--network") + 1], "bridge");
    assert.throws(() => SandboxProvider.containerLaunchSpec({ ...base, network: "host" }), /must be 'none' or 'bridge'/);
    assert.throws(() => SandboxProvider.containerLaunchSpec({ ...base, image: "--privileged" }), /valid image reference/);
    assert.throws(() => SandboxProvider.containerLaunchSpec({ ...base, memoryMb: 64 }), /MEMORY_MB/);
    assert.throws(() => SandboxProvider.containerLaunchSpec({ ...base, pidsLimit: 0 }), /PIDS_LIMIT/);
    assert.throws(() => SandboxProvider.containerLaunchSpec({ ...base, ctx: { root: "/work/a,b" } }), /workspace path contains/);
});


test("container resource limits validate every dimension and supported boundary", () => {

    assert.deepStrictEqual(SandboxProvider.validateContainerLimits({
        cpus: 0.25,
        memoryMb: 128,
        pidsLimit: 16,
        tmpMb: 32
    }), {
        cpus: 0.25,
        memoryMb: 128,
        pidsLimit: 16,
        tmpMb: 32
    });

    assert.deepStrictEqual(SandboxProvider.validateContainerLimits({
        cpus: 64,
        memoryMb: 65536,
        pidsLimit: 4096,
        tmpMb: 16384
    }), {
        cpus: 64,
        memoryMb: 65536,
        pidsLimit: 4096,
        tmpMb: 16384
    });

    for (const invalid of [
        { cpus: 0.24 },
        { cpus: 64.1 },
        { cpus: "not-a-number" },
        { memoryMb: 127 },
        { memoryMb: 65537 },
        { memoryMb: 128.5 },
        { pidsLimit: 15 },
        { pidsLimit: 4097 },
        { tmpMb: 31 },
        { tmpMb: 16385 }
    ]) {
        assert.throws(
            () => SandboxProvider.validateContainerLimits({
                ...SandboxProvider.DEFAULT_CONTAINER_LIMITS,
                ...invalid
            })
        );
    }
});


test("a killed container client also removes the named container", () => {

    const { EventEmitter } = require("events");
    const calls = [];
    const client = new EventEmitter();

    SandboxProvider.spawnInSandbox({
        mode: "podman",
        ctx: { root: "/work/project" },
        cwd: "/work/project",
        command: "sleep 30",
        platform: "linux",
        containerName: "sandbox-cleanup-test"
    }, (command, args, options) => {
        calls.push({ command, args, options });
        return client;
    });

    client.emit("close", null, "SIGKILL");

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].command, "podman");
    assert.strictEqual(calls[1].command, "podman");
    assert.deepStrictEqual(calls[1].args, ["rm", "--force", "sandbox-cleanup-test"]);
    assert.ok(!Object.hasOwn(calls[0].options.env, "OPENAI_API_KEY"));
    assert.deepStrictEqual(calls[1].options.env, calls[0].options.env);
});


test("Windows runaway processes are killed as a complete task tree", () => {

    const { EventEmitter } = require("events");
    const child = { pid: 4321, exitCode: null, killed: [], kill(signal) { this.killed.push(signal); } };
    const taskkill = new EventEmitter();
    const calls = [];

    ProcessManager.killTree(child, "SIGKILL", {
        platform: "win32",
        spawnImpl: (command, args, options) => {
            calls.push({ command, args, options });
            return taskkill;
        }
    });

    assert.deepStrictEqual(calls, [{
        command: "taskkill",
        args: ["/pid", "4321", "/T", "/F"],
        options: { windowsHide: true, stdio: "ignore" }
    }]);

    taskkill.emit("close", 0);
    assert.deepStrictEqual(child.killed, [], "a successful tree kill should not need a direct-child fallback");
});


test("Windows process killing falls back safely if taskkill fails", () => {

    const { EventEmitter } = require("events");
    const child = { pid: 7890, exitCode: null, killed: [], kill(signal) { this.killed.push(signal); } };
    const taskkill = new EventEmitter();

    ProcessManager.killTree(child, "SIGTERM", {
        platform: "win32",
        spawnImpl: () => taskkill
    });

    taskkill.emit("error", new Error("taskkill unavailable"));
    taskkill.emit("close", 1);
    assert.deepStrictEqual(child.killed, ["SIGTERM"], "the fallback must run exactly once");
});


test("POSIX runaway processes signal the process group before the direct child", () => {

    const child = { pid: 1234, exitCode: null, killed: [], kill(signal) { this.killed.push(signal); } };
    const calls = [];

    ProcessManager.killTree(child, "SIGKILL", {
        platform: "linux",
        killImpl: (pid, signal) => calls.push({ pid, signal })
    });

    assert.deepStrictEqual(calls, [{ pid: -1234, signal: "SIGKILL" }]);
    assert.deepStrictEqual(child.killed, []);
});


test("doctor reports deny mode as intentionally disabled without probing an engine", () => {

    const report = SandboxDoctor.diagnose({
        settingsStore: { get: key => ({
            PROCESS_SANDBOX_MODE: "deny",
            PROCESS_SANDBOX_IMAGE: "node:22-bookworm",
            PROCESS_SANDBOX_NETWORK: "none",
            PROCESS_SANDBOX_CPUS: 2,
            PROCESS_SANDBOX_MEMORY_MB: 2048,
            PROCESS_SANDBOX_PIDS_LIMIT: 256,
            PROCESS_SANDBOX_TMP_MB: 512
        })[key] },
        runner: () => { throw new Error("deny mode must not probe"); }
    });

    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.status, "disabled");
    assert.deepStrictEqual(report.capabilities, ["Process tools are denied by configuration."]);
});


test("doctor probes the configured container engine with bounded, filtered environment", () => {

    const calls = [];
    const values = {
        PROCESS_SANDBOX_MODE: "docker",
        PROCESS_SANDBOX_IMAGE: "node:22-bookworm",
        PROCESS_SANDBOX_NETWORK: "none",
        PROCESS_SANDBOX_CPUS: 2,
        PROCESS_SANDBOX_MEMORY_MB: 2048,
        PROCESS_SANDBOX_PIDS_LIMIT: 256,
        PROCESS_SANDBOX_TMP_MB: 512
    };
    const report = SandboxDoctor.diagnose({
        settingsStore: { get: key => values[key] },
        platform: "linux",
        runner: (executable, args, options) => {
            calls.push({ executable, args, options });
            return { status: 0, stdout: "27.5.1\n", stderr: "" };
        }
    });

    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.status, "ready");
    assert.strictEqual(report.engineVersion, "27.5.1");
    assert.deepStrictEqual(calls[0].args, ["info", "--format", "{{.ServerVersion}}"]);
    assert.strictEqual(calls[0].options.timeout, 3000);
    assert.ok(!Object.hasOwn(calls[0].options.env, "OPENAI_API_KEY"));
});


test("doctor fails closed when the selected container engine is unreachable", () => {

    const values = {
        PROCESS_SANDBOX_MODE: "podman",
        PROCESS_SANDBOX_IMAGE: "node:22-bookworm",
        PROCESS_SANDBOX_NETWORK: "bridge",
        PROCESS_SANDBOX_CPUS: 2,
        PROCESS_SANDBOX_MEMORY_MB: 2048,
        PROCESS_SANDBOX_PIDS_LIMIT: 256,
        PROCESS_SANDBOX_TMP_MB: 512
    };
    const report = SandboxDoctor.diagnose({
        settingsStore: { get: key => values[key] },
        runner: () => ({ status: 125, stdout: "", stderr: "daemon unavailable" })
    });

    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.status, "unavailable");
    assert.ok(report.warnings.some(warning => /no unsandboxed fallback/.test(warning)));
    assert.ok(!report.warnings.some(warning => /bridge/.test(warning)), "unavailable engines must not claim bridge is active");
});


test("doctor warns that bridge networking is broad egress", () => {

    const values = {
        PROCESS_SANDBOX_MODE: "docker",
        PROCESS_SANDBOX_IMAGE: "node:22-bookworm",
        PROCESS_SANDBOX_NETWORK: "bridge",
        PROCESS_SANDBOX_CPUS: 2,
        PROCESS_SANDBOX_MEMORY_MB: 2048,
        PROCESS_SANDBOX_PIDS_LIMIT: 256,
        PROCESS_SANDBOX_TMP_MB: 512
    };
    const report = SandboxDoctor.diagnose({
        settingsStore: { get: key => values[key] },
        runner: () => ({ status: 0, stdout: "28.0.0", stderr: "" })
    });

    assert.strictEqual(report.ok, true);
    assert.ok(report.warnings.some(warning => /general egress/.test(warning)));
});


test("doctor marks host test mode unsafe", () => {

    const values = {
        PROCESS_SANDBOX_MODE: "test",
        PROCESS_SANDBOX_IMAGE: "node:22-bookworm",
        PROCESS_SANDBOX_NETWORK: "none",
        PROCESS_SANDBOX_CPUS: 2,
        PROCESS_SANDBOX_MEMORY_MB: 2048,
        PROCESS_SANDBOX_PIDS_LIMIT: 256,
        PROCESS_SANDBOX_TMP_MB: 512
    };
    const report = SandboxDoctor.diagnose({ settingsStore: { get: key => values[key] } });

    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.status, "unsafe-test-mode");
});


test("unknown providers fail closed instead of falling back to host execution", () => {

    assert.throws(
        () => SandboxProvider.buildLaunchSpec({
            mode: "seatbelt",
            ctx: { root: "/work/project" },
            cwd: "/work/project",
            command: "echo unsafe"
        }),
        /Unsupported process sandbox mode: seatbelt/
    );
});


const failed = results.filter(ok => !ok).length;

console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed === 0 ? 0 : 1;
