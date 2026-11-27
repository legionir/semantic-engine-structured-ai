"use strict";

const settings = require("../../config");

const { truncateText } = require("../../context/WorkspaceBoundary");

const ToolContext = require("../ToolContext");

const ProcessManager = require("./ProcessManager");


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


function cancelledError(command) {
    const error = new Error(`Run cancelled: the command was not started (${command}).`);
    error.code = "RUN_CANCELLED";
    return error;
}


function terminalExec(args, context) {

    const ctx = ToolContext.from(context);


    try {
        ProcessManager.assertProcessExecutionEnabled();
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
        ProcessManager.resolveCwd(ctx, args.cwd);

    const timeout =
        Number.isInteger(args.timeout_ms)
            ? args.timeout_ms
            : settings.get("TERMINAL_TIMEOUT_MS");

    /* Stop pressed before the command even started */
    if (ctx.signal && ctx.signal.aborted) {
        return Promise.reject(cancelledError(args.command));
    }

    return new Promise(resolve => {

        const child =
            ProcessManager.spawnInGroup(ctx, args.command, cwd);

        /*
        | Stop (or the run deadline) aborts the run's signal: the whole
        | process group gets SIGTERM, and SIGKILL after a short grace, so a
        | build or a `sleep` started by the agent does not outlive the run.
        */
        let cancelled = false;
        let graceTimer = null;

        const onAbort = () => {
            if (cancelled) return;
            cancelled = true;
            ProcessManager.killTree(child, "SIGTERM");
            graceTimer = setTimeout(
                () => ProcessManager.killTree(child, "SIGKILL"),
                settings.get("TERMINAL_CANCEL_GRACE_MS")
            );
            if (typeof graceTimer.unref === "function") graceTimer.unref();
        };

        const detachAbort = () => {
            clearTimeout(graceTimer);
            if (ctx.signal) ctx.signal.removeEventListener("abort", onAbort);
        };

        if (ctx.signal) ctx.signal.addEventListener("abort", onAbort, { once: true });

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

                    ProcessManager.killTree(child, "SIGKILL");
                },
                timeout
            );

        /* stdout is bounded exactly like stderr (audit F-004): an unbounded
           `stdout +=` let a chatty command grow the buffer without limit */
        child.stdout.on(
            "data",
            chunk => {
                stdout = capture(stdout, chunk);
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
                detachAbort();

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
                detachAbort();

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

                    cancelled,

                    stdout:
                        truncateText(stdout).text,

                    stderr:
                        truncateText(stderr).text,

                    output_truncated: outputTruncated,

                    success:
                        code === 0 && !timedOut && !cancelled
                });
            }
        );
    });
}


module.exports = {
    terminal_exec: terminalExec
};
