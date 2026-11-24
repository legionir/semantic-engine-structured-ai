"use strict";

/* Interactive-session slash command handlers. */

function createReplCommandHandlers({ runtime, options, session, rl, context, toolRuntime, colours, COMMANDS, splitCommand, fs, path }) {
    let exitRequested = false;

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



    return { handleCommand, shouldExit: () => exitRequested };
}

module.exports = { createReplCommandHandlers };
