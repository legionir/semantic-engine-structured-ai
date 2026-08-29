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

    const child =
        ProcessManager.spawnInGroup(ctx, args.command, cwd);

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

    child.on(
        "error",
        error => {

            ProcessManager.appendOutput(
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

    ProcessManager.registerSession(session);

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
    process_terminate: processTerminate,
    process_list: processList
};
