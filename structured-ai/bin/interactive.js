"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");


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

const COLOURS =
    process.stdout.isTTY &&
    process.env.NO_COLOR === undefined
        ? {
            dim: text => `\u001b[2m${text}\u001b[0m`,
            bold: text => `\u001b[1m${text}\u001b[0m`,
            green: text => `\u001b[32m${text}\u001b[0m`,
            red: text => `\u001b[31m${text}\u001b[0m`,
            yellow: text => `\u001b[33m${text}\u001b[0m`
        }
        : {
            dim: text => text,
            bold: text => text,
            green: text => text,
            red: text => text,
            yellow: text => text
        };


const COMMANDS = `
Commands
  /help                 show this list
  /exit, /quit          leave the session
  /clear                start a new conversation, keeping the settings
  /history              show the conversation so far
  /approve [mode]       show or set auto | prompt | deny
  /model [name]         show or set the model for the next task
  /workspace            show the directory the agent may act in
  /limits               show the execution limits
  /stats                show what the runtime has executed
  /tools, /agents, /policy   show the registries
  /save <file>          write the last answer to a file

Anything else is sent to the agent as a task.
Ctrl-C cancels the running task, Ctrl-D leaves the session.
`.trim();


function formatDuration(ms) {

    return ms < 1000
        ? `${ms} ms`
        : `${(ms / 1000).toFixed(1)} s`;
}


async function startSession(runtime, options) {

    const toolRuntime =
        require(
            path.join(
                path.resolve(__dirname, ".."),
                "agent",
                "tools"
            )
        );

    const rl =
        readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: COLOURS.bold("› "),
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

    runtime.setApprovalHandler((evaluation, args) => {

        const summary =
            JSON.stringify(args || {}).slice(0, 200);

        process.stdout.write(
            `\n${COLOURS.yellow("approval required")}\n` +
            `  agent : ${evaluation.agent}\n` +
            `  tool  : ${COLOURS.bold(evaluation.tool)}\n` +
            `  reason: ${evaluation.reason}\n` +
            `  args  : ${summary}\n` +
            `  allow? [y/N] `
        );

        return readAnswer().then(answer => {

            const allowed =
                /^y(es)?$/i.test(answer.trim());

            process.stdout.write(
                allowed
                    ? COLOURS.green("  approved\n")
                    : COLOURS.red("  refused\n")
            );

            return allowed;
        });
    });

    const context =
        runtime.createRuntimeContext();

    process.stdout.write(
        `${COLOURS.bold("structured-ai")} interactive session\n` +
        COLOURS.dim(
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
                COLOURS.dim("  the conversation is empty\n")
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
                `  ${COLOURS.dim(label.padEnd(5))} ${
                    text.replace(/\s+/g, " ").slice(0, 140)
                }\n`
            );
        }
    }


    async function handleCommand(line) {

        const [command, ...rest] =
            line.slice(1).trim().split(/\s+/);

        const argument =
            rest.join(" ").trim();

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
                    COLOURS.dim("  conversation cleared\n")
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
                        COLOURS.dim(`  approval mode: ${argument}\n`)
                    );

                } catch (error) {

                    process.stdout.write(
                        COLOURS.red(`  ${error.message}\n`)
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
                    COLOURS.dim(`  model: ${argument}\n`)
                );

                return true;
            }

            case "workspace":
                process.stdout.write(
                    `  ${context.runtime.workspace_root}\n` +
                    COLOURS.dim(
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
                        `  ${COLOURS.bold(group)}${
                            definition.destructive
                                ? COLOURS.dim(" (destructive)")
                                : ""
                        }\n    ${definition.tools.join(", ")}\n`
                    );
                }

                return true;
            }

            case "agents": {

                for (const agent of runtime.registries.AGENTS) {

                    process.stdout.write(
                        `  ${COLOURS.bold(agent.name.padEnd(18))} ${
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
                        COLOURS.red("  /save needs a file name\n")
                    );

                    return true;
                }

                if (!session.lastAnswer) {

                    process.stdout.write(
                        COLOURS.red("  there is no answer to save yet\n")
                    );

                    return true;
                }

                fs.writeFileSync(
                    path.resolve(argument),
                    `${session.lastAnswer}\n`,
                    "utf8"
                );

                process.stdout.write(
                    COLOURS.dim(`  written to ${path.resolve(argument)}\n`)
                );

                return true;
            }

            default:
                process.stdout.write(
                    COLOURS.red(`  unknown command /${command}, try /help\n`)
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
                    COLOURS.red(
                        `\n${action.error.code}: ${action.error.message}\n`
                    )
                );
            }

            process.stdout.write(
                COLOURS.dim(
                    `\n  ${formatDuration(Date.now() - startedAt)}\n`
                )
            );

        } catch (error) {

            const cancelled =
                runtime.isRunCancelled();

            process.stdout.write(
                cancelled
                    ? COLOURS.yellow("\n  task cancelled\n")
                    : COLOURS.red(`\n  ${error.message}\n`)
            );

            if (!cancelled && options.verbose) {

                process.stdout.write(
                    COLOURS.dim(`${error.stack}\n`)
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

            runtime.cancelRun("interrupt");

            return;
        }

        const now = Date.now();

        if (now - interruptedAt < 2000) {

            rl.close();

            return;
        }

        interruptedAt = now;

        process.stdout.write(
            COLOURS.dim(
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
                COLOURS.dim(
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
