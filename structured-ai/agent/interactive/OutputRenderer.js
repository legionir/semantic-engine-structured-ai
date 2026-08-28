"use strict";

/*
|--------------------------------------------------------------------------
| Interactive Output Renderer — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Handles terminal styling, banners, task result displays, conversation
| history formatting, and status messages for the interactive REPL.
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


function formatDuration(ms) {

    return ms < 1000
        ? `${ms} ms`
        : `${(ms / 1000).toFixed(1)} s`;
}


class OutputRenderer {

    static get colours() {

        return COLOURS;
    }

    static renderBanner(runtime, out = process.stdout) {

        const context =
            runtime.createRuntimeContext();

        out.write(
            `${COLOURS.bold("structured-ai")} interactive session\n` +
            COLOURS.dim(
                `  workspace : ${context.runtime.workspace_root}\n` +
                `  model     : ${runtime.activeModel({})}\n` +
                `  approval  : ${runtime.getApprovalMode()}\n` +
                `  type /help for commands, /exit to leave\n`
            ) +
            "\n"
        );
    }

    static renderHistory(session, out = process.stdout) {

        if (session.history.length === 0) {

            out.write(
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

            out.write(
                `  ${COLOURS.dim(label.padEnd(5))} ${
                    text.replace(/\s+/g, " ").slice(0, 140)
                }\n`
            );
        }
    }

    static renderTaskResult(action, startedAt, out = process.stdout) {

        if (action?.response) {

            out.write(
                `\n${action.response.content}\n`
            );
        }

        if (action?.error) {

            out.write(
                COLOURS.red(
                    `\n${action.error.code}: ${action.error.message}\n`
                )
            );
        }

        out.write(
            COLOURS.dim(
                `\n  ${formatDuration(Date.now() - startedAt)}\n`
            )
        );
    }

    static renderTaskCancelled(out = process.stdout) {

        out.write(
            COLOURS.yellow("\n  task cancelled\n")
        );
    }

    static renderTaskError(error, verbose = false, out = process.stdout) {

        out.write(
            COLOURS.red(`\n  ${error.message}\n`)
        );

        if (verbose && error.stack) {

            out.write(
                COLOURS.dim(`${error.stack}\n`)
            );
        }
    }

    static renderInterruptNotice(out = process.stdout) {

        out.write(
            COLOURS.dim(
                "\n  nothing is running, press Ctrl-C again or type /exit to leave\n"
            )
        );
    }

    static renderExit(session, out = process.stdout) {

        out.write(
            COLOURS.dim(
                `\n  ${session.tasks} task${
                    session.tasks === 1
                        ? ""
                        : "s"
                } in this session, goodbye\n`
            )
        );
    }
}

module.exports = {
    COLOURS,
    formatDuration,
    OutputRenderer
};
