"use strict";

const fs = require("fs");
const path = require("path");
const { REPO_ROOT, fail, readStdin, EXIT } = require("./ArgParser");
const { formatErrorAction, formatJsonAction, formatDiscussionReport } = require("./OutputFormatter");

/*
|--------------------------------------------------------------------------
| CLI Run Command — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Handles task resolution, single-run execution, --until-done plan cycling,
| and --discussion multi-agent deliberation.
|--------------------------------------------------------------------------
*/

class RunCommand {

    static async resolveTask(options) {

        let task =
            options.positional.join(" ").trim();

        if (options.file) {

            const resolved =
                path.resolve(options.file);

            if (!fs.existsSync(resolved)) {
                fail(`task file not found: ${options.file}`);
            }

            task =
                fs.readFileSync(resolved, "utf8").trim();
        }

        if (!task) {

            const piped =
                (await readStdin()).trim();

            if (piped) {
                task = piped;
            }
        }

        return task;
    }


    static async execute(runtime, options) {

        const task =
            await RunCommand.resolveTask(options);

        if (task) {
            process.env.AGENT_TASK = task;
        }

        if (!runtime.readTask().trim()) {
            fail("no task given: pass it as an argument, on stdin, with --file, or in AGENT_TASK");
        }

        if (
            options.dryRun &&
            !options.quiet
        ) {

            process.stderr.write(
                "agent: dry run, every call that needs approval will be refused\n"
            );
        }

        if (options.untilDone) {

            return RunCommand.runUntilDone(runtime, options, task);
        }

        let action;

        try {

            action =
                await runtime.runAgent(
                    options.project
                        ? { projectId: options.project }
                        : undefined
                );

        } catch (error) {

            if (options.json) {

                process.stdout.write(
                    formatErrorAction(error)
                );

            } else {

                process.stderr.write(
                    `\nagent: run failed\n${error.stack || error.message}\n`
                );
            }

            await runtime.application.lifecycle.shutdown({
                tools: require(path.join(REPO_ROOT, "agent", "tools")),
                eventstore: runtime.eventstore
            });

            return runtime.isRunCancelled()
                ? EXIT.INTERRUPTED
                : EXIT.FAILED;
        }

        await runtime.application.lifecycle.shutdown({
            tools: require(path.join(REPO_ROOT, "agent", "tools")),
            eventstore: runtime.eventstore
        });

        if (options.json) {

            process.stdout.write(
                formatJsonAction(action)
            );

        } else if (action?.response) {

            process.stdout.write(
                `\n${action.response.content}\n`
            );
        }

        return action?.error
            ? EXIT.FAILED
            : EXIT.SUCCESS;
    }


    static async runUntilDone(runtime, options, task) {

        const maxCycles =
            options.maxCycles ||
            runtime.settings.get("MAX_AUTO_CYCLES");

        let stopped = false;

        process.on(
            "SIGINT",
            () => {

                process.stderr.write(
                    "\nagent: stopping after the current run\n"
                );

                stopped = true;

                runtime.cancelRun("operator stop");
            }
        );

        /*
        | The same progress signature the console uses: a cycle counts as
        | progress when a step finishes, a step is added, or one becomes
        | blocked, not only when done increases.
        */

        const signatureOf = summary =>
            summary.exists
                ? `${summary.steps}:${summary.done}:${summary.blocked}`
                : "none";

        let lastSignature = null;

        for (
            let cycle = 1;
            cycle <= maxCycles;
            cycle++
        ) {

            if (stopped) {
                break;
            }

            const before =
                runtime.currentPlanSummary();

            if (
                before.exists &&
                before.complete
            ) {

                process.stdout.write(
                    `\nagent: the plan is complete, ${before.done} of ${before.steps} steps done\n`
                );

                return EXIT.SUCCESS;
            }

            process.stderr.write(
                `\nagent: cycle ${cycle}${
                    before.exists
                        ? `, ${before.done}/${before.steps} steps done`
                        : ", no plan yet"
                }\n`
            );

            try {

                const action =
                    await runtime.runAgent({
                        task:
                            cycle === 1
                                ? task
                                : "Continue the plan: read it, take the next open step, verify it, and record the result.",

                        ...(options.project
                            ? { projectId: options.project }
                            : {})
                    });

                if (
                    action.error &&
                    action.error.code === "NEEDS_INPUT"
                ) {

                    process.stdout.write(
                        `\nagent: input needed, ${action.error.message}\n`
                    );

                    return EXIT.FAILED;
                }

            } catch (error) {

                if (runtime.isRunCancelled()) {
                    break;
                }

                process.stderr.write(
                    `\nagent: cycle ${cycle} failed, ${error.message}\n`
                );

                return EXIT.FAILED;
            }

            const after =
                runtime.currentPlanSummary();

            if (!after.exists) {

                /* nothing to continue from */
                return EXIT.SUCCESS;
            }

            if (after.complete) {

                process.stdout.write(
                    `\nagent: the plan is complete, ${after.done} of ${after.steps} steps done\n`
                );

                return EXIT.SUCCESS;
            }

            const signature =
                signatureOf(after);

            if (signature === lastSignature) {

                process.stderr.write(
                    "\nagent: the plan did not move in this cycle, stopping to avoid spinning\n"
                );

                return EXIT.FAILED;
            }

            lastSignature = signature;
        }

        const final =
            runtime.currentPlanSummary();

        process.stdout.write(
            `\nagent: stopped with ${final.done || 0} of ${final.steps || 0} steps done\n`
        );

        return stopped
            ? EXIT.INTERRUPTED
            : EXIT.SUCCESS;
    }


    static async runDiscussion(runtime, options) {

        let task =
            await RunCommand.resolveTask(options);

        if (!task && process.env.AGENT_TASK) {
            task = process.env.AGENT_TASK.trim();
        }

        if (!task) {
            fail("no task given: pass it as an argument, on stdin, with --file, or in AGENT_TASK");
        }

        if (!options.personas || options.personas.length === 0) {
            fail("--discussion needs --personas, e.g. --personas security,backend,frontend");
        }

        const {
            DiscussionEngine,
            createLlmCaller,
            PERSONAS
        } =
            require(path.join(REPO_ROOT, "agent", "discussion"));

        const available = PERSONAS.map(persona => persona.id);

        for (const persona of options.personas) {

            if (!available.includes(persona)) {
                fail(`unknown persona "${persona}"; available: ${available.join(", ")}`);
            }
        }

        const maxRounds =
            options.maxRounds || 5;

        /*
        | The workspace summary is the one context the personas share, so
        | they do not need tools in the MVP: the report is reasoning, and
        | the main run can act on it afterwards.
        */

        const workspace =
            runtime.createRuntimeContext().runtime.workspace_root;

        const workspaceContext =
            `Workspace root: ${workspace}\n` +
            `Platform: ${process.platform} (${process.version})`;

        if (!options.quiet) {
            process.stderr.write(
                `agent: discussion started, ${options.personas.length} personas, max ${maxRounds} rounds\n`
            );
        }

        const engine =
            new DiscussionEngine({
                task,
                personas: options.personas,
                maxRounds,
                /* the panel shares the runtime's parallel-agent budget */
                maxParallel: runtime.settings.get("MAX_PARALLEL_AGENTS"),
                llmCaller: createLlmCaller({ callAI: runtime.callAI }),
                workspaceContext,
                onMessage: message => {

                    if (!options.quiet) {
                        process.stderr.write(
                            `  round ${message.round}: ${message.persona} contributed ${message.content.length} chars\n`
                        );
                    }
                },
                onRound: (round, observerDecision) => {

                    if (!options.quiet) {
                        process.stderr.write(
                            `agent: round ${round.round} complete, observer says ${
                                observerDecision
                                    ? observerDecision.decision
                                    : "pending"
                            }\n`
                        );
                    }
                }
            });

        let result;

        try {

            result =
                await engine.run();

        } catch (error) {

            process.stderr.write(
                `\nagent: discussion failed\n${error.stack || error.message}\n`
            );

            return EXIT.FAILED;
        }

        if (options.json) {

            process.stdout.write(
                formatJsonAction(result)
            );

            return EXIT.SUCCESS;
        }

        process.stdout.write(
            formatDiscussionReport(result)
        );

        return EXIT.SUCCESS;
    }
}

module.exports = {
    RunCommand
};
