"use strict";

const {
    WORKSPACE_ROOT,
    toRelativeInRoot,
    truncateText
} = require("../../context/WorkspaceBoundary");

const ToolContext = require("../ToolContext");

const ProcessManager = require("./ProcessManager");


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

        interactive:
            session.child.interactive === true,

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


/*
|--------------------------------------------------------------------------
| process_start
|--------------------------------------------------------------------------
*/

async function processStart(args, context) {

    const ctx = ToolContext.from(context);


    ProcessManager.assertProcessExecutionEnabled();

    if (
        typeof args.command !== "string" ||
        args.command.trim() === ""
    ) {

        throw new Error(
            "command is required."
        );
    }

    const cwd =
        ProcessManager.resolveCwd(ctx, args.cwd);

    const interactive = args.interactive === true;
    const cols = Number.isInteger(args.cols) ? args.cols : 80;
    const rows = Number.isInteger(args.rows) ? args.rows : 24;

    if (cols < 20 || cols > 400 || rows < 5 || rows > 120) {
        throw new Error("PTY dimensions must be between 20–400 columns and 5–120 rows.");
    }

    const child =
        ProcessManager.spawnInGroup(ctx, args.command, cwd, {
            interactive,
            cols,
            rows
        });

    const session = {
        id:
            ProcessManager.nextSessionId(),

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
            ProcessManager.appendOutput(
                session,
                "stdout",
                chunk.toString()
            )
    );

    child.stderr.on(
        "data",
        chunk =>
            ProcessManager.appendOutput(
                session,
                "stderr",
                chunk.toString()
            )
    );

    /*
    | P0-6: a process that exits while input is still being written makes
    | its stdin fail with EPIPE. Without a listener that error is uncaught
    | and kills the runtime; with one it is recorded on the session and the
    | next process_write is refused.
    */

    for (const stream of ["stdin", "stdout", "stderr"]) {

        const pipe = child[stream];

        if (pipe && typeof pipe.on === "function") {

            pipe.on(
                "error",
                error => {

                    const reason =
                        (error && (error.code || error.message)) || "error";

                    if (stream === "stdin") {
                        session.stdin_error = reason;
                    }

                    ProcessManager.appendOutput(
                        session,
                        "stderr",
                        `[${stream} ${reason}] ${(error && error.message) || ""}\n`
                    );
                }
            );
        }
    }

    child.on(
        "error",
        error => {

            ProcessManager.appendOutput(
                session,
                "stderr",
                error.message
            );

            session.status = "failed";
            session.error = error.message;
            session.finished_at = Date.now();
        }
    );

    child.on(
        "close",
        (code, signal) => {

            /* A spawn error already made this session "failed". Node still
               emits "close" afterwards; it must not turn the failure into an
               ordinary "exited" (audit REL-023). */
            if (session.status === "failed") {

                if (session.exit_code == null) {
                    session.exit_code = code;
                }

                session.signal = signal;

                return;
            }

            session.status = "exited";
            session.exit_code = code;
            session.signal = signal;
            session.finished_at = Date.now();
        }
    );

    ProcessManager.registerSession(session);

    if (interactive) {
        child.stdin.write(`${args.command}\r`);
    }

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

async function processRead(args, context) {

    const ctx = ToolContext.from(context);


    const session =
        ProcessManager.requireSession(args.process_id, ctx);

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
        ProcessManager.requireSession(args.process_id, ctx);

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
            : `${args.input}${session.child.interactive ? "\r" : "\n"}`;

    const stdin =
        session.child.stdin;

    if (
        !stdin ||
        stdin.destroyed ||
        stdin.writableEnded ||
        session.stdin_error
    ) {

        throw new Error(
            `Process ${args.process_id} no longer accepts input${
                session.stdin_error ? ` (${session.stdin_error})` : ""
            }.`
        );
    }

    try {

        stdin.write(payload);

    } catch (error) {

        session.stdin_error = error.code || error.message;

        throw new Error(
            `Could not write to process ${args.process_id}: ${error.message}`
        );
    }

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
| process_resize
|--------------------------------------------------------------------------
*/

async function processResize(args, context) {

    const ctx = ToolContext.from(context);
    const session = ProcessManager.requireSession(args.process_id, ctx);

    if (!session.child.interactive || typeof session.child.resize !== "function") {
        throw new Error("process_resize requires an interactive PTY session.");
    }

    if (session.status !== "running") {
        throw new Error(`Process is not running: ${args.process_id}`);
    }

    if (!Number.isInteger(args.cols) || args.cols < 20 || args.cols > 400 ||
        !Number.isInteger(args.rows) || args.rows < 5 || args.rows > 120) {
        throw new Error("PTY dimensions must be between 20–400 columns and 5–120 rows.");
    }

    session.child.resize(args.cols, args.rows);

    return {
        process_id: session.id,
        cols: args.cols,
        rows: args.rows,
        status: session.status
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
        ProcessManager.requireSession(args.process_id, ctx);

    if (session.status !== "running") {

        return {
            process_id:
                session.id,

            status:
                session.status,

            already_stopped: true
        };
    }

    ProcessManager.killTree(session.child, "SIGTERM");

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

        ProcessManager.killTree(session.child, "SIGKILL");

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
        [...ProcessManager.SESSIONS.values()]
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


module.exports = {
    process_start: processStart,
    process_read: processRead,
    process_write: processWrite,
    process_resize: processResize,
    process_terminate: processTerminate,
    process_list: processList
};
