"use strict";

const fs = require("fs");
const path = require("path");
const { COLOURS, OutputRenderer } = require("./OutputRenderer");

/*
|--------------------------------------------------------------------------
| Interactive REPL Commands — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Handlers for slash commands (/help, /clear, /history, /approve, /model,
| /workspace, /limits, /stats, /tools, /agents, /policy, /save, /exit).
|--------------------------------------------------------------------------
*/

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


class ReplCommands {

    static get commandsText() {

        return COMMANDS;
    }

    static async execute(line, {
        session,
        runtime,
        context,
        toolRuntime,
        inputReader,
        out = process.stdout
    } = {}) {

        const [command, ...rest] =
            line.slice(1).trim().split(/\s+/);

        const argument =
            rest.join(" ").trim();

        switch (command) {

            case "help":
                out.write(`${COMMANDS}\n`);
                return true;

            case "exit":
            case "quit":
                inputReader.requestExit();
                return true;

            case "clear":
                session.history = [];
                session.lastAnswer = null;

                out.write(
                    COLOURS.dim("  conversation cleared\n")
                );
                return true;

            case "history":
                OutputRenderer.renderHistory(session, out);
                return true;

            case "approve": {

                if (!argument) {

                    out.write(
                        `  approval mode: ${runtime.getApprovalMode()}\n`
                    );

                    return true;
                }

                try {

                    runtime.setApprovalMode(argument);

                    out.write(
                        COLOURS.dim(`  approval mode: ${argument}\n`)
                    );

                } catch (error) {

                    out.write(
                        COLOURS.red(`  ${error.message}\n`)
                    );
                }

                return true;
            }

            case "model": {

                if (!argument) {

                    out.write(
                        `  model: ${runtime.activeModel({})}\n`
                    );

                    return true;
                }

                runtime.setModelOverride(argument);

                out.write(
                    COLOURS.dim(`  model: ${argument}\n`)
                );

                return true;
            }

            case "workspace":
                out.write(
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

                    out.write(
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

                out.write(
                    `  calls: ${stats.total_calls}, failures: ${stats.total_failures}\n`
                );

                for (const tool of stats.tools) {

                    out.write(
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

                    out.write(
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

                    out.write(
                        `  ${COLOURS.bold(agent.name.padEnd(18))} ${
                            agent.description
                        }\n`
                    );
                }

                return true;
            }

            case "policy": {

                for (const rule of runtime.registries.POLICY.rules) {

                    out.write(
                        `  ${rule.action.padEnd(17)} ${
                            (rule.tools || rule.groups || []).join(", ")
                        }\n`
                    );
                }

                return true;
            }

            case "save": {

                if (!argument) {

                    out.write(
                        COLOURS.red("  /save needs a file name\n")
                    );

                    return true;
                }

                if (!session.lastAnswer) {

                    out.write(
                        COLOURS.red("  there is no answer to save yet\n")
                    );

                    return true;
                }

                fs.writeFileSync(
                    path.resolve(argument),
                    `${session.lastAnswer}\n`,
                    "utf8"
                );

                out.write(
                    COLOURS.dim(`  written to ${path.resolve(argument)}\n`)
                );

                return true;
            }

            default:
                out.write(
                    COLOURS.red(`  unknown command /${command}, try /help\n`)
                );

                return true;
        }
    }
}

module.exports = {
    COMMANDS,
    ReplCommands
};
