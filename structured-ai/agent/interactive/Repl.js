"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { colours, formatDuration } = require("./OutputRenderer");
const { COMMANDS, splitCommand } = require("./ReplCommands");
const { createApprovalHandler } = require("./ApprovalPrompt");


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
            output: process.stdout
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

    function showHistory() {

        if (session.history.length === 0) {

            process.stdout.write(
                colours.dim("  the conversation is empty\n")
            );

            return;
        }

        for (const message of session.history) {

            if (message.role === "system") {
                continue;
            }

            const label =
                message.role === "user"
                    ? "you"
                    : message.role === "tool"
                        ? "tool"
                        : "agent";

            const text =
                typeof message.content === "string"
                    ? message.content
                    : JSON.stringify(message.tool_calls || "");

            process.stdout.write(
                `  ${colours.dim(label.padEnd(5))} ${
                    text.replace(/\s+/g, " ").slice(0, 140)
                }\n`
            );
        }
    }


    async function handleCommand(line) {

        const { command, argument } =
            splitCommand(line);

        switch (command) {

            case "help":
                process.stdout.write(`${COMMANDS}\n`);
                return true;

            case "exit":
            case "quit":
                exitRequested = true;
                rl.close();
                return true;

            case "clear":
                session.history = [];
                session.lastAnswer = null;

                process.stdout.write(
                    colours.dim("  conversation cleared\n")
                );
                return true;

            case "history":
                showHistory();
                return true;

            case "approve": {

                if (!argument) {

                    process.stdout.write(
                        `  approval mode: ${runtime.getApprovalMode()}\n`
                    );

                    return true;
                }

                try {

                    runtime.setApprovalMode(argument);

                    process.stdout.write(
                        colours.dim(`  approval mode: ${argument}\n`)
                    );

                } catch (error) {

                    process.stdout.write(
                        colours.red(`  ${error.message}\n`)
                    );
                }

                return true;
            }

            case "model": {

                if (!argument) {

                    process.stdout.write(
                        `  model: ${runtime.activeModel({})}\n`
                    );

                    return true;
                }

                runtime.setModelOverride(argument);

                process.stdout.write(
                    colours.dim(`  model: ${argument}\n`)
                );

                return true;
            }

            case "workspace":
                process.stdout.write(
                    `  ${context.runtime.workspace_root}\n` +
                    colours.dim(
                        "  the workspace is fixed for the session, restart with -w to change it\n"
                    )
                );
                return true;

            case "limits": {

                const limits =
                    runtime.createRuntimeContext().runtime;

                for (
                    const [key, value]
                    of Object.entries(limits)
                ) {

                    process.stdout.write(
                        `  ${key.padEnd(20)} ${value}\n`
                    );
                }

                return true;
            }

            case "stats": {

                const stats =
                    await toolRuntime.telemetry.runtime_stats({
                        recent_limit: 5
                    });

                process.stdout.write(
                    `  calls: ${stats.total_calls}, failures: ${stats.total_failures}\n`
                );

                for (const tool of stats.tools) {

                    process.stdout.write(
                        `  ${tool.tool.padEnd(18)} ${
                            String(tool.calls).padStart(3)
                        } calls, avg ${tool.average_ms} ms\n`
                    );
                }

                return true;
            }

            case "tools": {

                for (
                    const [group, definition]
                    of Object.entries(runtime.registries.TOOL_GROUPS)
                ) {

                    process.stdout.write(
                        `  ${colours.bold(group)}${
                            definition.destructive
                                ? colours.dim(" (destructive)")
                                : ""
                        }\n    ${definition.tools.join(", ")}\n`
                    );
                }

                return true;
            }

            case "agents": {

                for (const agent of runtime.registries.AGENTS) {

                    process.stdout.write(
                        `  ${colours.bold(agent.name.padEnd(18))} ${
                            agent.description
                        }\n`
                    );
                }

                return true;
            }

            case "policy": {

                for (const rule of runtime.registries.POLICY.rules) {

                    process.stdout.write(
                        `  ${rule.action.padEnd(17)} ${
                            (rule.tools || rule.groups || []).join(", ")
                        }\n`
                    );
                }

                return true;
            }

            case "save": {

                if (!argument) {

                    process.stdout.write(
                        colours.red("  /save needs a file name\n")
                    );

                    return true;
                }

                if (!session.lastAnswer) {

                    process.stdout.write(
                        colours.red("  there is no answer to save yet\n")
                    );

                    return true;
                }

                fs.writeFileSync(
                    path.resolve(argument),
                    `${session.lastAnswer}\n`,
                    "utf8"
                );

                process.stdout.write(
                    colours.dim(`  written to ${path.resolve(argument)}\n`)
                );

                return true;
            }

            default:
                process.stdout.write(
                    colours.red(`  unknown command /${command}, try /help\n`)
                );

                return true;
        }
    }


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

    let exitRequested = false;

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
            !exitRequested
        ) {

            const line = queue.shift();

            if (line.startsWith("/")) {

                await handleCommand(line);

            } else {

                await runTask(line);
            }

            if (!exitRequested) {
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

        drain();
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
