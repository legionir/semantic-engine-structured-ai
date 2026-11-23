"use strict";

const { spawn } = require("child_process");

const settings = require("../../config");

const childEnvironment = require("./ChildEnvironment");


/*
|--------------------------------------------------------------------------
| Process Sessions
|--------------------------------------------------------------------------
|
| terminal_exec runs a command to completion. process_start keeps a
| session alive so an agent can read incremental output, send input, and
| terminate it. Both are bound to the workspace root.
|--------------------------------------------------------------------------
*/

const SESSIONS = new Map();

let sessionCounter = 0;


function nextSessionId() {

    sessionCounter++;

    return `process_${sessionCounter}`;
}


function resolveCwd(ctx, inputCwd) {

    return inputCwd
        ? ctx.resolvePath(
            inputCwd,
            {
                mustExist: true
            }
        )
        : ctx.root;
}


function assertProcessExecutionEnabled() {

    if (settings.get("PROCESS_SANDBOX_MODE") === "deny") {
        throw new Error(
            "Process execution is disabled because no OS sandbox is configured. Set PROCESS_SANDBOX_MODE=bwrap on Linux with bubblewrap, or use the test mode only from the repository test harness."
        );
    }
}


/*
| Killing the shell leaves its children running, so a timed out
| "npm test" can keep a whole tree of processes alive. The child is
| therefore started in its own process group, and the group is what
| gets signalled.
*/

const USE_PROCESS_GROUPS =
    process.platform !== "win32";


function spawnInGroup(ctx, command, cwd) {

    const mode = settings.get("PROCESS_SANDBOX_MODE");

    if (mode === "bwrap") {
        if (process.platform !== "linux") {
            throw new Error("PROCESS_SANDBOX_MODE=bwrap is supported only on Linux.");
        }

        return spawn(
            "bwrap",
            [
                "--die-with-parent",
                "--clearenv",
                "--setenv", "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
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
            {
                cwd: ctx.root,
                windowsHide: true,
                detached: USE_PROCESS_GROUPS
            }
        );
    }

    /* test mode is only selected by the repository's own tests.
       P0-5: the command sees an allowlisted environment, never the
       runtime's API keys and tokens. */
    return spawn(
        command,
        {
            cwd,
            shell: defaultShell(),
            env: childEnvironment.build(),
            windowsHide: true,
            detached: USE_PROCESS_GROUPS
        }
    );
}


function killTree(child, signal) {

    if (!child || child.exitCode !== null) {
        return;
    }

    if (USE_PROCESS_GROUPS) {

        try {

            process.kill(-child.pid, signal);

            return;

        } catch {

            /* the group is already gone, fall through */
        }
    }

    if (process.platform === "win32") {

        try {

            spawn(
                "taskkill",
                ["/pid", String(child.pid), "/T", "/F"],
                {
                    windowsHide: true,
                    stdio: "ignore"
                }
            );

            return;

        } catch {

            /* fall through to the direct kill */
        }
    }

    try {

        child.kill(signal);

    } catch {

        /* the process is already gone */
    }
}


function defaultShell() {

    if (process.platform === "win32") {
        return process.env.COMSPEC || "cmd.exe";
    }

    return process.env.SHELL || "/bin/sh";
}


function appendOutput(session, stream, chunk) {

    session.output.push({
        stream,

        text: chunk,

        at: Date.now()
    });

    session.buffered_chars += chunk.length;

    while (
        session.buffered_chars > settings.get("MAX_PROCESS_BUFFER_CHARS") &&
        session.output.length > 1
    ) {

        const removed =
            session.output.shift();

        session.buffered_chars -= removed.text.length;

        session.dropped_chunks++;

        /* The read cursor is an index into `output`: dropping the oldest
           chunk shifts every index down by one. Without this the cursor
           pointed past unread chunks and the next read silently skipped
           them (audit REL-024). Clamped so it never goes negative. */
        if (session.read_cursor > 0) {
            session.read_cursor--;
        }
    }
}


function requireSession(processId, ctx) {

    const session =
        SESSIONS.get(processId);

    /* A session another project owns is invisible here: from the
       caller's side it simply does not exist. */
    if (
        !session ||
        (
            ctx &&
            ctx.scoped &&
            session.project_id !== ctx.projectId
        )
    ) {

        throw new Error(
            `Unknown process: ${processId}`
        );
    }

    return session;
}


function registerSession(session) {

    SESSIONS.set(session.id, session);

    return session;
}


function shutdownAll() {

    for (const session of SESSIONS.values()) {

        if (session.status === "running") {

            killTree(session.child, "SIGKILL");
        }
    }
}


module.exports = {
    SESSIONS,
    nextSessionId,
    resolveCwd,
    assertProcessExecutionEnabled,
    spawnInGroup,
    killTree,
    defaultShell,
    appendOutput,
    requireSession,
    registerSession,
    shutdownAll,
    USE_PROCESS_GROUPS
};
