const { spawn } = require("child_process");

const settings = require("../lib/storage");

const {
    WORKSPACE_ROOT,
    toRelativeInRoot,
    truncateText
} = require("../lib/workspace");

const ToolContext = require("./ToolContext");


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

    /* test mode is only selected by the repository's own tests. */
    return spawn(
        command,
        {
            cwd,
            shell: defaultShell(),
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
    }
}


/*
|--------------------------------------------------------------------------
| terminal_exec
|--------------------------------------------------------------------------
|
| A non-zero exit code is a runtime observation, not a tool failure: the
| result is returned so the agent can analyse it.
|--------------------------------------------------------------------------
*/

/*
| Models like to write "cd /workspace && npm test", which is wrong twice:
| the command already starts in the workspace, and the path they invent
| rarely exists, least of all on Windows. The shell then reports its own
| failure as ordinary output and the agent reads the wrong error. The
| prefix is therefore refused with the real root and the argument that
| does what it wanted.
*/

const LEADING_CD =
    /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;|]+))\s*(?:&&|;|&)/i;


function assertNoForeignCd(ctx, command) {

    const match = LEADING_CD.exec(command);

    if (!match) {
        return;
    }

    const target =
        match[1] || match[2] || match[3];

    try {

        ctx.resolvePath(target, { mustExist: true });

    } catch {

        throw new Error(
            `The command starts with "cd ${target}", which is not inside the workspace. Every command already starts in ${ctx.root}; use the cwd argument to enter a subdirectory instead.`
        );
    }
}


function terminalExec(args, context) {

    const ctx = ToolContext.from(context);


    try {
        assertProcessExecutionEnabled();
    } catch (error) {
        return Promise.reject(error);
    }

    if (
        typeof args.command !== "string" ||
        args.command.trim() === ""
    ) {

        return Promise.reject(
            new Error("command is required.")
        );
    }

    try {

        assertNoForeignCd(ctx, args.command);

    } catch (error) {

        return Promise.reject(error);
    }

    const cwd =
        resolveCwd(ctx, args.cwd);

    const timeout =
        Number.isInteger(args.timeout_ms)
            ? args.timeout_ms
            : settings.get("TERMINAL_TIMEOUT_MS");

    return new Promise(resolve => {

        const child =
            spawnInGroup(ctx, args.command, cwd);

        let stdout = "";
        let stderr = "";
        let capturedChars = 0;
        let outputTruncated = false;
        const outputLimit = settings.get("MAX_TOOL_RESULT_TOTAL_CHARS");
        let timedOut = false;

        const capture = (current, chunk) => {
            if (capturedChars >= outputLimit) {
                outputTruncated = true;
                return current;
            }

            const text = chunk.toString();
            const remaining = outputLimit - capturedChars;
            const kept = text.slice(0, remaining);
            capturedChars += kept.length;
            if (kept.length < text.length) {
                outputTruncated = true;
            }
            return current + kept;
        };

        const timer =
            setTimeout(
                () => {

                    timedOut = true;

                    killTree(child, "SIGKILL");
                },
                timeout
            );

        child.stdout.on(
            "data",
            chunk => {
                stdout += chunk.toString();
            }
        );

        child.stderr.on(
            "data",
            chunk => {
                stderr = capture(stderr, chunk);
            }
        );

        child.on(
            "error",
            error => {

                clearTimeout(timer);

                resolve({
                    cwd:
                        ctx.relative(cwd),

                    /*
                    | Where the command actually ran. The agent works in
                    | relative paths, so without this it cannot tell
                    | that "." was already the project root.
                    */

                    cwd_absolute: cwd,

                    command:
                        args.command,

                    exit_code: null,

                    signal: null,

                    timed_out: false,

                    stdout: "",

                    stderr:
                        error.message,

                    success: false
                });
            }
        );

        child.on(
            "close",
            (code, signal) => {

                clearTimeout(timer);

                resolve({
                    cwd:
                        ctx.relative(cwd),

                    /*
                    | Where the command actually ran. The agent works in
                    | relative paths, so without this it cannot tell
                    | that "." was already the project root.
                    */

                    cwd_absolute: cwd,

                    command:
                        args.command,

                    exit_code: code,

                    signal,

                    timed_out: timedOut,

                    stdout:
                        truncateText(stdout).text,

                    stderr:
                        truncateText(stderr).text,

                    output_truncated: outputTruncated,

                    success:
                        code === 0 && !timedOut
                });
            }
        );
    });
}


/*
|--------------------------------------------------------------------------
| process_start
|--------------------------------------------------------------------------
*/

async function processStart(args, context) {

    const ctx = ToolContext.from(context);


    assertProcessExecutionEnabled();

    if (
        typeof args.command !== "string" ||
        args.command.trim() === ""
    ) {

        throw new Error(
            "command is required."
        );
    }

    const cwd =
        resolveCwd(ctx, args.cwd);

    sessionCounter++;

    const child =
        spawnInGroup(ctx, args.command, cwd);

    const session = {
        id:
            `process_${sessionCounter}`,

        /* Ownership (modular mode): a session belongs to the project
           and run that started it; other projects cannot see or steer
           it (EXECUTION_PLAN Phase 4, per-project sessions). */
        run_id:
            ctx.runId,

        project_id:
            ctx.scoped ? ctx.projectId : null,

        root:
            ctx.root,

        command:
            args.command,

        cwd,

        pid:
            child.pid,

        child,

        status: "running",

        exit_code: null,

        signal: null,

        output: [],

        buffered_chars: 0,

        dropped_chunks: 0,

        read_cursor: 0,

        started_at: Date.now(),

        finished_at: null
    };

    child.stdout.on(
        "data",
        chunk =>
            appendOutput(
                session,
                "stdout",
                chunk.toString()
            )
    );

    child.stderr.on(
        "data",
        chunk =>
            appendOutput(
                session,
                "stderr",
                chunk.toString()
            )
    );

    child.on(
        "error",
        error => {

            appendOutput(
                session,
                "stderr",
                error.message
            );

            session.status = "failed";
            session.finished_at = Date.now();
        }
    );

    child.on(
        "close",
        (code, signal) => {

            session.status = "exited";
            session.exit_code = code;
            session.signal = signal;
            session.finished_at = Date.now();
        }
    );

    SESSIONS.set(session.id, session);

    const waitMs =
        Number.isInteger(args.wait_ms)
            ? args.wait_ms
            : 1000;

    await new Promise(
        resolve =>
            setTimeout(resolve, waitMs)
    );

    return readSessionOutput(session, {
        peek: false
    });
}


/*
|--------------------------------------------------------------------------
| process_read
|--------------------------------------------------------------------------
*/

function readSessionOutput(session, options) {

    const chunks =
        session.output.slice(
            options.peek
                ? 0
                : session.read_cursor
        );

    if (!options.peek) {

        session.read_cursor =
            session.output.length;
    }

    const stdout =
        chunks
            .filter(
                chunk => chunk.stream === "stdout"
            )
            .map(chunk => chunk.text)
            .join("");

    const stderr =
        chunks
            .filter(
                chunk => chunk.stream === "stderr"
            )
            .map(chunk => chunk.text)
            .join("");

    return {
        process_id:
            session.id,

        pid:
            session.pid,

        command:
            session.command,

        cwd:
            toRelativeInRoot(session.root || WORKSPACE_ROOT, session.cwd),

        status:
            session.status,

        exit_code:
            session.exit_code,

        signal:
            session.signal,

        runtime_ms:
            (session.finished_at || Date.now()) -
            session.started_at,

        dropped_chunks:
            session.dropped_chunks,

        stdout:
            truncateText(stdout).text,

        stderr:
            truncateText(stderr).text
    };
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


async function processRead(args, context) {

    const ctx = ToolContext.from(context);


    const session =
        requireSession(args.process_id, ctx);

    const waitMs =
        Number.isInteger(args.wait_ms)
            ? args.wait_ms
            : 0;

    if (
        waitMs > 0 &&
        session.status === "running"
    ) {

        const deadline =
            Date.now() + waitMs;

        while (
            Date.now() < deadline &&
            session.status === "running" &&
            session.output.length === session.read_cursor
        ) {

            await new Promise(
                resolve =>
                    setTimeout(resolve, 50)
            );
        }
    }

    return readSessionOutput(
        session,
        {
            peek: args.peek === true
        }
    );
}


/*
|--------------------------------------------------------------------------
| process_write
|--------------------------------------------------------------------------
*/

async function processWrite(args, context) {

    const ctx = ToolContext.from(context);


    const session =
        requireSession(args.process_id, ctx);

    if (session.status !== "running") {

        throw new Error(
            `Process is not running: ${args.process_id}`
        );
    }

    if (typeof args.input !== "string") {

        throw new Error(
            "input must be a string."
        );
    }

    const payload =
        args.append_newline === false
            ? args.input
            : `${args.input}\n`;

    session.child.stdin.write(payload);

    return {
        process_id:
            session.id,

        bytes_written:
            Buffer.byteLength(payload, "utf8"),

        status:
            session.status
    };
}


/*
|--------------------------------------------------------------------------
| process_terminate
|--------------------------------------------------------------------------
*/

async function processTerminate(args, context) {

    const ctx = ToolContext.from(context);


    const session =
        requireSession(args.process_id, ctx);

    if (session.status !== "running") {

        return {
            process_id:
                session.id,

            status:
                session.status,

            already_stopped: true
        };
    }

    killTree(session.child, "SIGTERM");

    const graceMs =
        Number.isInteger(args.grace_ms)
            ? args.grace_ms
            : 2000;

    const deadline =
        Date.now() + graceMs;

    while (
        Date.now() < deadline &&
        session.status === "running"
    ) {

        await new Promise(
            resolve =>
                setTimeout(resolve, 50)
        );
    }

    let forced = false;

    if (session.status === "running") {

        killTree(session.child, "SIGKILL");

        forced = true;

        await new Promise(
            resolve =>
                setTimeout(resolve, 100)
        );
    }

    return {
        process_id:
            session.id,

        status:
            session.status,

        forced,

        exit_code:
            session.exit_code,

        signal:
            session.signal
    };
}


/*
|--------------------------------------------------------------------------
| process_list
|--------------------------------------------------------------------------
*/

async function processList(args, context) {

    const ctx = ToolContext.from(context);


    const sessions =
        [...SESSIONS.values()]
            .filter(
                session =>
                    (
                        !ctx.scoped ||
                        session.project_id === ctx.projectId
                    ) &&
                    (
                        args.include_finished === true ||
                        session.status === "running"
                    )
            )
            .map(
                session => ({
                    process_id:
                        session.id,

                    pid:
                        session.pid,

                    command:
                        session.command,

                    cwd:
                        toRelativeInRoot(session.root || WORKSPACE_ROOT, session.cwd),

                    status:
                        session.status,

                    exit_code:
                        session.exit_code,

                    runtime_ms:
                        (session.finished_at || Date.now()) -
                        session.started_at,

                    unread_chunks:
                        session.output.length -
                        session.read_cursor
                })
            );

    return {
        count:
            sessions.length,

        processes:
            sessions
    };
}


function shutdownAll() {

    for (const session of SESSIONS.values()) {

        if (session.status === "running") {

            killTree(session.child, "SIGKILL");
        }
    }
}


module.exports = {
    terminal_exec: terminalExec,
    process_start: processStart,
    process_read: processRead,
    process_write: processWrite,
    process_terminate: processTerminate,
    process_list: processList,

    shutdownAll,

    _sessions: SESSIONS
};
