"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { colours, formatDuration } = require("./OutputRenderer");
const { COMMANDS, splitCommand } = require("./ReplCommands");
const { createApprovalHandler } = require("./ApprovalPrompt");
const { createReplCommandHandlers } = require("./ReplCommandHandlers");


/*
|--------------------------------------------------------------------------
| Interactive Session
|--------------------------------------------------------------------------
|
| A session keeps one conversation across many tasks, so a follow-up like
| "now fix it" carries the previous findings. The session owns stdin, so
| approvals are answered inline instead of by a second reader, and an
| interrupt cancels the running task without ending the session.
|--------------------------------------------------------------------------
*/

async function startSession(runtime, options) {

    const toolRuntime =
        require(
            path.join(
                path.resolve(__dirname, "../.."),
                "agent",
                "tools"
            )
        );

    const rl =
        readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: colours.bold("› "),
            historySize: runtime.settings.get("SESSION_HISTORY_SIZE")
        });

    const session = {
        history: [],
        lastAnswer: null,
        running: false,
        tasks: 0
    };

    /*
    | Approvals are answered on the session's own reader, so the prompt
    | and the question never fight over stdin.
    */

    runtime.setApprovalHandler(
        createApprovalHandler({
            readAnswer,
            colours,
            output: process.stdout,
            interactive: Boolean(process.stdin.isTTY)
        })
    );

    const context =
        runtime.createRuntimeContext();

    process.stdout.write(
        `${colours.bold("structured-ai")} interactive session\n` +
        colours.dim(
            `  workspace : ${context.runtime.workspace_root}\n` +
            `  model     : ${runtime.activeModel({})}\n` +
            `  approval  : ${runtime.getApprovalMode()}\n` +
            `  type /help for commands, /exit to leave\n`
        ) +
        "\n"
    );

    /* ------------------------------------------------------------------ */

    const { handleCommand, shouldExit } = createReplCommandHandlers({
        runtime,
        options,
        session,
        rl,
        context,
        toolRuntime,
        colours,
        COMMANDS,
        splitCommand,
        fs,
        path
    });


    async function runTask(task) {

        session.running = true;
        session.tasks++;

        const startedAt = Date.now();

        try {

            const action =
                await runtime.runAgent({
                    task,

                    history:
                        session.history
                });

            if (action.response) {

                session.lastAnswer =
                    action.response.content;

                process.stdout.write(
                    `\n${action.response.content}\n`
                );
            }

            if (action.error) {

                process.stdout.write(
                    colours.red(
                        `\n${action.error.code}: ${action.error.message}\n`
                    )
                );
            }

            process.stdout.write(
                colours.dim(
                    `\n  ${formatDuration(Date.now() - startedAt)}\n`
                )
            );

        } catch (error) {

            const cancelled =
                runtime.isRunCancelled() ||
                /\b(?:run|task|request) cancelled\b|\baborted\b/i.test(error.message || "");

            process.stdout.write(
                cancelled
                    ? colours.yellow("\n  task cancelled\n")
                    : colours.red(`\n  ${error.message}\n`)
            );

            if (!cancelled && options.verbose) {

                process.stdout.write(
                    colours.dim(`${error.stack}\n`)
                );
            }

        } finally {

            session.running = false;
        }
    }


    /* ------------------------------------------------------------------ */

    let interruptedAt = 0;

    process.on("SIGINT", () => {

        if (session.running) {

            /* Signal callbacks run outside the run's async-local scope.
               Address the one active interactive run explicitly instead
               of accidentally cancelling only the process-level fallback. */
            const active =
                typeof runtime.runManager?.activeRuns === "function"
                    ? runtime.runManager.activeRuns()
                    : [];
            const current = active[active.length - 1];

            if (current && typeof runtime.cancelRunById === "function") {
                runtime.cancelRunById(current.id, "interrupt");
            } else {
                runtime.cancelRun("interrupt");
            }

            return;
        }

        const now = Date.now();

        if (now - interruptedAt < 2000) {

            rl.close();

            return;
        }

        interruptedAt = now;

        process.stdout.write(
            colours.dim(
                "\n  nothing is running, press Ctrl-C again or type /exit to leave\n"
            )
        );

        rl.prompt();
    });


    /*
    | Every line goes into one ordered queue. A worker drains it one
    | entry at a time, so a command typed while a task is running is
    | handled after that task, and an approval question consumes the
    | next line instead of racing the prompt.
    */

    const queue = [];

    let waitingForAnswer = null;

    let inputClosed = false;

    let draining = false;


    let onDrained = null;


    function readAnswer() {

        return new Promise(resolve => {

            if (queue.length > 0) {

                resolve(queue.shift());

                return;
            }

            if (inputClosed) {

                resolve("n");

                return;
            }

            waitingForAnswer = resolve;
        });
    }


    async function drain() {

        if (draining) {
            return;
        }

        draining = true;

        while (
            queue.length > 0 &&
            !shouldExit()
        ) {

            const line = queue.shift();

            /*
            | P0-7: a failing entry (a /save into a missing directory, a
            | stats call that throws) is reported and the queue moves on;
            | it must not leave draining stuck or escape as an unhandled
            | rejection that ends the session.
            */

            try {

                if (line.startsWith("/")) {

                    await handleCommand(line);

                } else {

                    await runTask(line);
                }

            } catch (error) {

                process.stdout.write(
                    colours.red(`  ${(error && error.message) || String(error)}\n`)
                );

                if (options && options.verbose && error && error.stack) {

                    process.stdout.write(
                        colours.dim(`${error.stack}\n`)
                    );
                }
            }

            if (!shouldExit()) {
                rl.prompt();
            }
        }

        draining = false;

        if (onDrained) {

            const done = onDrained;

            onDrained = null;

            done();
        }
    }


    rl.on("line", line => {

        const trimmed = line.trim();

        /* an approval question owns the next line */

        if (waitingForAnswer) {

            const resolve = waitingForAnswer;

            waitingForAnswer = null;

            resolve(trimmed);

            return;
        }

        if (trimmed === "") {

            if (!draining) {
                rl.prompt();
            }

            return;
        }

        queue.push(trimmed);

        drain().catch(error => {

            process.stdout.write(
                colours.red(`  ${(error && error.message) || String(error)}\n`)
            );
        });
    });

    rl.prompt();

    return new Promise(resolve => {

        const finish = () => {

            process.stdout.write(
                colours.dim(
                    `\n  ${session.tasks} task${
                        session.tasks === 1
                            ? ""
                            : "s"
                    } in this session, goodbye\n`
                )
            );

            toolRuntime.shutdown();

            resolve(0);
        };

        rl.on("close", () => {

            inputClosed = true;

            if (waitingForAnswer) {

                const answer = waitingForAnswer;

                waitingForAnswer = null;

                answer("n");
            }

            /*
            | End of input is not the end of the work: whatever is still
            | queued or running finishes first.
            */

            if (
                draining ||
                queue.length > 0
            ) {

                onDrained = finish;

                drain();

                return;
            }

            finish();
        });
    });
}


module.exports = {
    startSession
};
