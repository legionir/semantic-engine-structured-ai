"use strict";

/*
|--------------------------------------------------------------------------
| Console terminals
|--------------------------------------------------------------------------
|
| System shells the admin opens from the web console. Each one is a real
| pseudo-terminal (node-pty) when the native module is available; without
| it, `script` provides a PTY on Linux/macOS, and plain pipes are the last
| resort. A session outlives the browser tab: closing the dialog only
| detaches, the scrollback is replayed on reattach, and the shell ends
| when it exits, is killed from the console or the server closes.
|
| The shell is intentionally not sandboxed — it is the operator's own
| terminal — but it does not inherit credential-like environment
| variables (ChildEnvironment, P0-5).
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { StringDecoder } = require("string_decoder");

const ChildEnvironment = require("../../../agent/tools/process/ChildEnvironment");
const { SseHub } = require("../SseHub");



function boundedInt(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.min(Math.max(number, min), max);
}


function defaultShell(platform = process.platform, env = process.env) {
    if (platform === "win32") return env.COMSPEC || "powershell.exe";
    for (const candidate of [env.SHELL, "/bin/bash", "/bin/zsh", "/bin/sh"]) {
        if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    }
    return "/bin/sh";
}


function loadPty() {
    try {
        return require("node-pty");
    } catch {
        return null;
    }
}


function findScript(platform = process.platform) {
    if (platform === "win32") return null;
    for (const candidate of ["/usr/bin/script", "/bin/script"]) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}


function quotePosixShellArg(value) {
    const text = String(value || "");
    if (!text) return "''";
    if (!/[^A-Za-z0-9_./:-]/.test(text)) return text;
    return `'${text.replace(/'/g, "'\\''")}'`;
}


/* the shell inside script(1) sets its own size first: script starts the pty at 0x0 */
function sizedShellCommand(shell, cols, rows) {
    return `stty rows ${rows} cols ${cols} 2>/dev/null; exec ${quotePosixShellArg(shell)} -i`;
}


/*
| A replay must not start inside an escape sequence or a half line: the
| trimmed scrollback begins at the next line when one is near.
*/
function trimScrollback(text, limit) {
    if (text.length <= limit) return text;
    const kept = text.slice(-limit);
    const newline = kept.indexOf("\n");
    return newline >= 0 && newline < 4096 ? kept.slice(newline + 1) : kept;
}


class TerminalSessions {

    constructor(options = {}) {
        this.cwd = options.cwd || process.cwd();
        this.maxSessions = options.maxSessions || (() => 4);
        this.scrollbackChars = options.scrollbackChars || (() => 256 * 1024);
        /* an exited shell stays listed this long so its last output can be read */
        this.retentionMs = options.retentionMs ?? 5 * 60_000;
        /* SIGHUP first; SIGKILL when the shell has not ended after this */
        this.killGraceMs = options.killGraceMs ?? 2000;
        /* one input request: far more than any typing or paste burst */
        this.maxInputChars = options.maxInputChars ?? 64 * 1024;
        this.ptyModule = options.ptyModule === undefined ? loadPty() : options.ptyModule;
        this.scriptPath = options.scriptPath === undefined ? findScript() : options.scriptPath;
        this.spawnImpl = options.spawnImpl || spawn;
        this.execFileImpl = options.execFileImpl || execFile;
        this.platform = options.platform || process.platform;
        this.shell = options.shell || defaultShell(this.platform);
        this.onLog = options.onLog || (() => {});
        this.sessions = new Map();
    }


    mode() {
        if (this.ptyModule) return "pty";
        if (this.scriptPath) return "script";
        return "pipe";
    }


    environment() {
        return ChildEnvironment.build({
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            STRUCTURED_AI_TERMINAL: "1"
        });
    }


    list() {
        return [...this.sessions.values()].map(session => this.describe(session));
    }


    describe(session) {
        return {
            id: session.id,
            pid: session.pid,
            shell: session.shell,
            cwd: session.cwd,
            mode: session.mode,
            cols: session.cols,
            rows: session.rows,
            created_at: session.createdAt,
            attached: session.hub.size(),
            exited: session.exited
        };
    }


    get(id) {
        return typeof id === "string" ? this.sessions.get(id) || null : null;
    }


    live() {
        return [...this.sessions.values()].filter(session => !session.exited).length;
    }


    create(options = {}) {

        if (this.live() >= this.maxSessions()) {
            throw Object.assign(
                new Error(`At most ${this.maxSessions()} terminals may be open at once; close one first.`),
                { status: 409 }
            );
        }

        const cols = boundedInt(options.cols, 100, 10, 500);
        const rows = boundedInt(options.rows, 30, 4, 200);
        const mode = this.mode();
        const env = this.environment();
        const child = this.spawnChild(mode, { cols, rows, env });

        const session = {
            id: crypto.randomBytes(8).toString("hex"),
            pid: child.pid ?? null,
            shell: this.shell,
            cwd: this.cwd,
            mode,
            cols,
            rows,
            createdAt: new Date().toISOString(),
            child,
            hub: new SseHub(),
            decoder: new StringDecoder("utf8"),
            scrollback: "",
            exited: null,
            killTimer: null
        };

        this.wire(session);
        this.sessions.set(session.id, session);
        this.onLog("info", `Terminal opened (${mode}, pid ${session.pid ?? "?"}, ${this.shell})`, { id: session.id });

        return this.describe(session);
    }


    spawnChild(mode, { cols, rows, env }) {

        if (mode === "pty") {
            return this.ptyModule.spawn(this.shell, [], {
                name: "xterm-256color",
                cols,
                rows,
                cwd: this.cwd,
                env
            });
        }

        const args = mode === "script"
            ? (this.platform === "darwin"
                ? ["-q", "/dev/null", "/bin/sh", "-c", sizedShellCommand(this.shell, cols, rows)]
                : ["-q", "-f", "-e", "-c", sizedShellCommand(this.shell, cols, rows), "/dev/null"])
            : (this.platform === "win32" ? [] : ["-i"]);

        return this.spawnImpl(mode === "script" ? this.scriptPath : this.shell, args, {
            cwd: this.cwd,
            env: { ...env, COLUMNS: String(cols), LINES: String(rows) },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true
        });
    }


    wire(session) {

        const output = chunk => {
            let text = typeof chunk === "string" ? chunk : session.decoder.write(chunk);
            if (!text) return;
            /* no tty adds the carriage return in pipe mode: a bare newline would leave a staircase */
            if (session.mode === "pipe") text = text.replace(/(?<!\r)\n/g, "\r\n");
            session.scrollback = trimScrollback(session.scrollback + text, this.scrollbackChars());
            session.hub.broadcast({ type: "output", data: text });
        };

        const exited = (code, signal) => {
            if (session.exited) return;
            clearTimeout(session.killTimer);
            const tail = session.decoder.end();
            if (tail) output(tail);
            session.exited = { code: code ?? null, signal: signal ?? null, at: new Date().toISOString() };
            session.hub.broadcast({ type: "exit", ...session.exited });
            this.onLog("info", `Terminal exited (pid ${session.pid ?? "?"}, code ${code ?? "-"}${signal ? `, signal ${signal}` : ""})`, { id: session.id });
            if (session.forgetOnExit) {
                this.forget(session.id);
                return;
            }
            session.retention = setTimeout(() => this.forget(session.id), this.retentionMs);
            session.retention.unref?.();
        };

        if (session.mode === "pty") {
            session.child.onData(output);
            session.child.onExit(({ exitCode, signal }) => exited(exitCode, signal || null));
            return;
        }

        /* writing to a shell that just exited must not crash the server */
        session.child.stdin.on("error", () => {});
        session.child.stdout.on("data", output);
        session.child.stderr.on("data", output);
        session.child.on("error", error => {
            output(`\r\n[terminal] ${error.message}\r\n`);
            exited(null, null);
        });
        session.child.on("close", exited);
    }


    attach(id, req, res) {
        const session = this.get(id);
        if (!session) return false;
        session.hub.attach(req, res, { res }, {
            type: "snapshot",
            session: this.describe(session),
            data: session.scrollback
        });
        return true;
    }


    write(id, data) {
        const session = this.get(id);
        if (!session) return null;
        if (session.exited) throw Object.assign(new Error("The terminal has exited."), { status: 409 });
        if (typeof data !== "string" || data.length === 0 || data.length > this.maxInputChars) {
            throw Object.assign(new Error(`data must be a non-empty string of at most ${this.maxInputChars} characters`), { status: 400 });
        }
        if (session.mode === "pty") session.child.write(data);
        else session.child.stdin.write(data.replace(/\r(?!\n)/g, session.mode === "pipe" ? "\n" : "\r"));
        return true;
    }


    resize(id, cols, rows) {
        const session = this.get(id);
        if (!session) return null;
        const nextCols = boundedInt(cols, NaN, 10, 500);
        const nextRows = boundedInt(rows, NaN, 4, 200);
        if (!Number.isInteger(nextCols) || !Number.isInteger(nextRows)) {
            throw Object.assign(new Error("cols and rows must be integers"), { status: 400 });
        }
        session.cols = nextCols;
        session.rows = nextRows;
        if (session.mode === "pty" && !session.exited) {
            try {
                session.child.resize(nextCols, nextRows);
            } catch {
                /* the shell is exiting */
            }
        } else if (session.mode === "script" && !session.exited) {
            this.resizeScript(session);
        }
        return { cols: nextCols, rows: nextRows, applied: session.mode !== "pipe" };
    }


    /*
    | script(1) cannot be told a new size, but its pty can: stty on the
    | shell's own tty sets it, and the kernel sends SIGWINCH to whatever runs
    | there. One resize at a time; the last size asked for wins.
    */
    resizeScript(session) {

        if (session.resizing) {
            session.resizeAgain = true;
            return session.resizing;
        }

        const run = async () => {
            do {
                session.resizeAgain = false;
                if (session.exited) return;
                if (!session.ttyPath) session.ttyPath = await this.scriptTty(session.pid);
                if (!session.ttyPath) return;
                const size = `${session.rows}x${session.cols}`;
                if (size === session.ttySize) continue;
                const flag = this.platform === "darwin" ? "-f" : "-F";
                await this.exec("stty", [flag, session.ttyPath, "rows", String(session.rows), "cols", String(session.cols)]);
                session.ttySize = size;
            } while (session.resizeAgain);
        };

        session.resizing = run().catch(() => {}).finally(() => {
            session.resizing = null;
        });

        return session.resizing;
    }


    /* the tty of the shell script(1) started: its child's controlling terminal */
    async scriptTty(pid) {

        if (!pid) return null;

        const table = await this.exec("ps", ["-A", "-o", "ppid=,tty="]).catch(() => "");
        for (const line of String(table).split("\n")) {
            const [ppid, tty] = line.trim().split(/\s+/);
            if (Number(ppid) === pid && tty && tty !== "?" && !tty.startsWith("-")) {
                return tty.startsWith("/") ? tty : `/dev/${tty}`;
            }
        }

        return null;
    }


    exec(file, args) {
        return new Promise((resolve, reject) => {
            this.execFileImpl(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => {
                if (error) reject(error);
                else resolve(String(stdout || ""));
            });
        });
    }


    kill(id) {
        const session = this.get(id);
        if (!session) return false;
        if (session.exited) {
            this.forget(id);
            return true;
        }
        /* killed on purpose: nobody needs to see it exit */
        session.forgetOnExit = true;
        this.signal(session, "SIGHUP");
        session.killTimer = setTimeout(() => this.signal(session, "SIGKILL"), this.killGraceMs);
        session.killTimer.unref?.();
        return true;
    }


    signal(session, name) {
        try {
            if (session.mode === "pty") {
                session.child.kill(this.platform === "win32" ? undefined : name);
            } else if (this.platform !== "win32" && session.pid) {
                try {
                    process.kill(session.pid, name);
                } catch {
                    session.child.kill(name);
                }
            } else if (this.platform === "win32" && session.pid && name === "SIGKILL") {
                try {
                    const killer = spawn("taskkill", ["/pid", String(session.pid), "/T", "/F"], {
                        windowsHide: true,
                        stdio: "ignore"
                    });
                    killer.on("error", () => {
                        try { session.child.kill(); } catch { /* already gone */ }
                    });
                    killer.unref?.();
                } catch {
                    session.child.kill();
                }
            } else {
                session.child.kill();
            }
        } catch {
            /* already gone */
        }
    }


    forget(id) {
        const session = this.sessions.get(id);
        if (!session) return;
        clearTimeout(session.retention);
        clearTimeout(session.killTimer);
        session.hub.close();
        this.sessions.delete(id);
    }


    shutdown() {
        for (const session of [...this.sessions.values()]) {
            if (!session.exited) this.signal(session, "SIGKILL");
            this.forget(session.id);
        }
    }
}


module.exports = {
    TerminalSessions,
    defaultShell
};
