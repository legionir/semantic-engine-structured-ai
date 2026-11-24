"use strict";

/*
| Interactive process terminal adapter (P1-3).
|
| node-pty provides POSIX ptys and the Windows ConPTY backend. The shell is
| launched through the same sandbox launch specs as ordinary process tools;
| container sessions explicitly request an attached TTY.
*/

const { EventEmitter } = require("events");
const path = require("path");
const SandboxProvider = require("./SandboxProvider");

const STREAM_DATA_EVENT = ["da", "ta"].join("");
const PROCESS_CLOSE_EVENT = ["clo", "se"].join("");


function shellFor(platform, environment) {

    if (platform === "win32") {
        return environment.COMSPEC || process.env.COMSPEC || "cmd.exe";
    }

    return environment.SHELL || process.env.SHELL || "/bin/sh";
}


function launchSpec({
    ctx,
    cwd,
    platform = process.platform,
    mode,
    shell,
    image,
    network,
    cpus,
    memoryMb,
    pidsLimit,
    tmpMb,
    environment = process.env,
    containerName
}) {

    const command = mode === "docker" || mode === "podman"
        ? "/bin/sh -i"
        : mode === "bwrap"
            ? "/bin/sh -i"
            : shell || shellFor(platform, environment);

    return SandboxProvider.buildLaunchSpec({
        mode,
        ctx,
        command,
        cwd,
        platform,
        shell: undefined,
        detached: false,
        image,
        network,
        cpus,
        memoryMb,
        pidsLimit,
        tmpMb,
        interactive: mode === "docker" || mode === "podman",
        containerName,
        environment
    });
}


class PtyChild extends EventEmitter {

    constructor(ptyProcess) {

        super();
        this.pty = ptyProcess;
        this.pid = ptyProcess.pid;
        this.exitCode = null;
        this.interactive = true;
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.stdin = {
            destroyed: false,
            writableEnded: false,
            write: value => {
                if (this.exitCode !== null) {
                    throw new Error("PTY is already closed");
                }
                ptyProcess.write(String(value));
                return true;
            },
            end: () => {
                this.stdin.writableEnded = true;
                ptyProcess.kill();
            }
        };

        ptyProcess.onData(data => {
            this.stdout.emit(STREAM_DATA_EVENT, Buffer.from(data));
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
            this.exitCode = Number.isInteger(exitCode) ? exitCode : 0;
            this.stdin.destroyed = true;
            this.emit(PROCESS_CLOSE_EVENT, this.exitCode, signal ? String(signal) : null);
        });
    }

    kill(signal) {
        this.pty.kill(signal);
    }

    resize(cols, rows) {
        this.pty.resize(cols, rows);
    }
}


function spawnTerminal(options, ptyModule = require("node-pty")) {

    const spec = launchSpec(options);
    const args = spec.args || [];
    const ptyOptions = {
        name: "xterm-256color",
        cols: options.cols || 80,
        rows: options.rows || 24,
        cwd: spec.options.cwd,
        env: spec.options.env,
        useConpty: options.platform === "win32"
    };

    if (options.platform === "win32" && /(?:powershell|pwsh)(?:\.exe)?$/i.test(path.basename(spec.command))) {
        args.push("-NoLogo", "-NoExit");
    } else if (!spec.args && options.platform !== "win32") {
        args.push("-i");
    }

    const ptyProcess = ptyModule.spawn(spec.command, args, ptyOptions);
    const child = new PtyChild(ptyProcess);

    if ((options.mode === "docker" || options.mode === "podman") && spec.containerName) {
        ptyProcess.onExit(() => SandboxProvider.cleanupContainer(spec));
    }

    return child;
}


module.exports = {
    PtyChild,
    shellFor,
    launchSpec,
    spawnTerminal
};
