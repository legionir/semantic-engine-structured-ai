"use strict";

/*
|--------------------------------------------------------------------------
| Sandbox provider launch contract (P1-2)
|--------------------------------------------------------------------------
|
| ProcessManager owns sessions, output and cancellation. This module owns
| the OS-specific launch boundary. Launch specifications are pure data so
| sandbox flags can be tested on every CI OS without requiring a sandbox
| binary or a running container daemon.
|
| Current backends:
|   - deny: refuse process execution
|   - bwrap: Linux namespaces and a workspace-only writable bind
|   - docker / podman: locked-down Linux containers, usable from Linux,
|     macOS and Windows when the selected engine is installed and running
|   - test: repository-test harness mode with a credential-filtered env
|
| Container networking defaults to none. Bridge networking is an explicit
| operator choice; it allows general container egress and is not an
| allowlist-based firewall.
|--------------------------------------------------------------------------
*/

const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const childEnvironment = require("./ChildEnvironment");


const BWRAP_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const CONTAINER_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const DEFAULT_IMAGE = "node:22-bookworm";
const DEFAULT_CONTAINER_LIMITS = Object.freeze({
    cpus: 2,
    memoryMb: 2048,
    pidsLimit: 256,
    tmpMb: 512
});


function bwrapLaunchSpec({ ctx, command, cwd, platform = process.platform, environment = process.env, detached = platform !== "win32" }) {

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
            env: childEnvironment.build({}, environment),
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


function containerPathApi(platform) {
    return platform === "win32" ? path.win32 : path.posix;
}


function workspaceContainerPath(root, cwd, platform = process.platform) {

    if (typeof root !== "string" || !root || typeof cwd !== "string" || !cwd) {
        throw new Error("A workspace root and working directory are required for container execution.");
    }

    if (root.includes(",") || root.includes("\n") || root.includes("\r")) {
        throw new Error("The workspace path contains characters not supported by the container bind mount.");
    }

    const pathApi = containerPathApi(platform);

    if (!pathApi.isAbsolute(root) || !pathApi.isAbsolute(cwd)) {
        throw new Error("Container workspace paths must be absolute.");
    }

    const relative = pathApi.relative(root, cwd);

    if (
        relative === ".." ||
        relative.startsWith(`..${pathApi.sep}`) ||
        pathApi.isAbsolute(relative)
    ) {
        throw new Error("The container working directory must stay inside the workspace.");
    }

    const relativePosix = relative.split(pathApi.sep).join("/");

    return relativePosix ? path.posix.join("/workspace", relativePosix) : "/workspace";
}


function validateContainerLimits({ cpus, memoryMb, pidsLimit, tmpMb }) {

    const limits = {
        cpus: Number(cpus),
        memoryMb: Number(memoryMb),
        pidsLimit: Number(pidsLimit),
        tmpMb: Number(tmpMb)
    };

    if (!Number.isFinite(limits.cpus) || limits.cpus < 0.25 || limits.cpus > 64) {
        throw new Error("PROCESS_SANDBOX_CPUS must be between 0.25 and 64.");
    }

    if (!Number.isInteger(limits.memoryMb) || limits.memoryMb < 128 || limits.memoryMb > 65536) {
        throw new Error("PROCESS_SANDBOX_MEMORY_MB must be an integer between 128 and 65536.");
    }

    if (!Number.isInteger(limits.pidsLimit) || limits.pidsLimit < 16 || limits.pidsLimit > 4096) {
        throw new Error("PROCESS_SANDBOX_PIDS_LIMIT must be an integer between 16 and 4096.");
    }

    if (!Number.isInteger(limits.tmpMb) || limits.tmpMb < 32 || limits.tmpMb > 16384) {
        throw new Error("PROCESS_SANDBOX_TMP_MB must be an integer between 32 and 16384.");
    }

    return limits;
}


function containerUser({ platform, uid, gid }) {

    if (Number.isInteger(uid) && Number.isInteger(gid) && uid >= 0 && gid >= 0) {
        return `${uid}:${gid}`;
    }

    if (platform !== "win32" && typeof process.getuid === "function" && typeof process.getgid === "function") {
        return `${process.getuid()}:${process.getgid()}`;
    }

    /* Official Node images provide an unprivileged UID 1000 user. */
    return "1000:1000";
}


function containerLaunchSpec({
    mode,
    ctx,
    command,
    cwd,
    platform = process.platform,
    detached = platform !== "win32",
    image = DEFAULT_IMAGE,
    network = "none",
    cpus = DEFAULT_CONTAINER_LIMITS.cpus,
    memoryMb = DEFAULT_CONTAINER_LIMITS.memoryMb,
    pidsLimit = DEFAULT_CONTAINER_LIMITS.pidsLimit,
    tmpMb = DEFAULT_CONTAINER_LIMITS.tmpMb,
    uid,
    gid,
    environment = process.env,
    containerName = `structured-ai-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
}) {

    if (mode !== "docker" && mode !== "podman") {
        throw new Error(`Unsupported container sandbox mode: ${String(mode)}`);
    }

    if (!ctx || typeof ctx.root !== "string" || !ctx.root) {
        throw new Error("A workspace root is required for container execution.");
    }

    if (typeof image !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(image)) {
        throw new Error("PROCESS_SANDBOX_IMAGE must be a valid image reference.");
    }

    if (network !== "none" && network !== "bridge") {
        throw new Error("PROCESS_SANDBOX_NETWORK must be 'none' or 'bridge'.");
    }

    if (typeof containerName !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(containerName)) {
        throw new Error("The generated container name is invalid.");
    }

    const limits = validateContainerLimits({ cpus, memoryMb, pidsLimit, tmpMb });
    const workdir = workspaceContainerPath(ctx.root, cwd, platform);
    const user = containerUser({ platform, uid, gid });

    return {
        command: mode,
        args: [
            "run",
            "--rm",
            "--init",
            "--pull=missing",
            "--name", containerName,
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit", String(limits.pidsLimit),
            "--memory", `${limits.memoryMb}m`,
            "--cpus", String(limits.cpus),
            "--network", network,
            "--tmpfs", `/tmp:rw,nosuid,nodev,size=${limits.tmpMb}m`,
            "--mount", `type=bind,source=${ctx.root},target=/workspace`,
            "--workdir", workdir,
            "--user", user,
            "--env", "HOME=/tmp",
            "--env", `PATH=${CONTAINER_PATH}`,
            "--",
            image,
            "/bin/sh", "-lc", command
        ],
        options: {
            cwd: ctx.root,
            env: childEnvironment.build({}, environment),
            windowsHide: true,
            detached
        },
        containerName
    };
}


function buildLaunchSpec(options = {}) {

    const mode = options.mode;

    if (mode === "deny") {
        throw new Error(
            "Process execution is disabled because no OS sandbox is configured. Select bwrap on Linux, or configure a Docker/Podman sandbox; test mode is only for the repository test harness."
        );
    }

    if (mode === "bwrap") {
        return bwrapLaunchSpec(options);
    }

    if (mode === "docker" || mode === "podman") {
        return containerLaunchSpec(options);
    }

    if (mode === "test") {
        return testLaunchSpec(options);
    }

    throw new Error(`Unsupported process sandbox mode: ${String(mode)}`);
}


function cleanupContainer(spec, spawnImpl) {

    let cleanup;

    try {
        cleanup = spawnImpl(
            spec.command,
            ["rm", "--force", spec.containerName],
            {
                stdio: "ignore",
                windowsHide: true,
                env: spec.options.env
            }
        );
    } catch {
        return;
    }

    if (cleanup && typeof cleanup.once === "function") {
        cleanup.once("error", () => {});
    }
}


function spawnInSandbox(options, spawnImpl = spawn) {

    const spec = buildLaunchSpec(options);
    const child = spec.args
        ? spawnImpl(spec.command, spec.args, spec.options)
        : spawnImpl(spec.command, spec.options);

    if ((options.mode === "docker" || options.mode === "podman") && child && typeof child.once === "function") {
        /* If the client is killed on timeout/cancellation, remove the named
           container too; --rm alone does not cover a disconnected CLI. */
        child.once("close", () => cleanupContainer(spec, spawnImpl));
    }

    return child;
}


module.exports = {
    BWRAP_PATH,
    DEFAULT_IMAGE,
    DEFAULT_CONTAINER_LIMITS,
    bwrapLaunchSpec,
    testLaunchSpec,
    workspaceContainerPath,
    validateContainerLimits,
    containerLaunchSpec,
    buildLaunchSpec,
    cleanupContainer,
    spawnInSandbox
};
