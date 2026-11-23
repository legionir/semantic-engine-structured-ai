"use strict";

/*
|--------------------------------------------------------------------------
| Sandbox provider launch contract (P1-2)
|--------------------------------------------------------------------------
|
| ProcessManager owns sessions, output and cancellation. This module owns
| the OS-specific launch boundary. Keeping launch specifications pure
| makes it possible to test isolation flags on every CI OS without having
| Docker, Podman or bubblewrap installed on the runner.
|
| Current backends preserve the existing fail-closed policy:
|   - deny: refuse process execution
|   - bwrap: Linux namespaces and a workspace-only writable bind
|   - test: repository-test harness mode with a credential-filtered env
|
| Additional production backends (Docker/Podman, Seatbelt, AppContainer)
| can be registered here without adding platform branches to ProcessManager.
|--------------------------------------------------------------------------
*/

const { spawn } = require("child_process");
const childEnvironment = require("./ChildEnvironment");


const BWRAP_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";


function bwrapLaunchSpec({ ctx, command, cwd, platform = process.platform, detached = platform !== "win32" }) {

    if (platform !== "linux") {
        throw new Error("PROCESS_SANDBOX_MODE=bwrap is supported only on Linux.");
    }

    if (!ctx || typeof ctx.root !== "string" || !ctx.root) {
        throw new Error("A workspace root is required for the bwrap sandbox.");
    }

    return {
        command: "bwrap",
        args: [
            "--die-with-parent",
            "--clearenv",
            "--setenv", "PATH", BWRAP_PATH,
            "--setenv", "HOME", "/tmp",
            "--ro-bind", "/usr", "/usr",
            "--ro-bind", "/bin", "/bin",
            "--ro-bind", "/lib", "/lib",
            "--ro-bind", "/lib64", "/lib64",
            "--proc", "/proc",
            "--dev", "/dev",
            "--tmpfs", "/tmp",
            "--bind", ctx.root, ctx.root,
            "--chdir", cwd,
            "--unshare-pid",
            "--unshare-uts",
            "--unshare-ipc",
            "--unshare-net",
            "--",
            "/bin/sh", "-c", command
        ],
        options: {
            cwd: ctx.root,
            windowsHide: true,
            detached
        }
    };
}


function testLaunchSpec({ command, cwd, platform = process.platform, shell, environment = process.env, detached = platform !== "win32" }) {

    return {
        command,
        args: null,
        options: {
            cwd,
            shell,
            env: childEnvironment.build({}, environment),
            windowsHide: true,
            detached
        }
    };
}


function buildLaunchSpec(options = {}) {

    const mode = options.mode;

    if (mode === "deny") {
        throw new Error(
            "Process execution is disabled because no OS sandbox is configured. Set PROCESS_SANDBOX_MODE=bwrap on Linux with bubblewrap, or use the test mode only from the repository test harness."
        );
    }

    if (mode === "bwrap") {
        return bwrapLaunchSpec(options);
    }

    if (mode === "test") {
        return testLaunchSpec(options);
    }

    throw new Error(`Unsupported process sandbox mode: ${String(mode)}`);
}


function spawnInSandbox(options, spawnImpl = spawn) {

    const spec = buildLaunchSpec(options);

    return spec.args
        ? spawnImpl(spec.command, spec.args, spec.options)
        : spawnImpl(spec.command, spec.options);
}


module.exports = {
    BWRAP_PATH,
    bwrapLaunchSpec,
    testLaunchSpec,
    buildLaunchSpec,
    spawnInSandbox
};
