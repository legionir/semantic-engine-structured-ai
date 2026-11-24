"use strict";

/* CLI listing, auto-run cycles, and discussion workflows. */

function createCliWorkflows({ EXIT, fail, readStdin, fs, path }) {
function printCatalogue(runtime, options) {

    const {
        TOOLS,
        TOOL_GROUPS,
        AGENTS,
        POLICY
    } = runtime.registries;

    if (options.listTools) {

        for (
            const [group, definition]
            of Object.entries(TOOL_GROUPS)
        ) {

            process.stdout.write(
                `\n${group}${
                    definition.destructive
                        ? " (destructive)"
                        : ""
                }\n  ${definition.description}\n`
            );

            for (const name of definition.tools) {

                const tool =
                    TOOLS.find(
                        item => item.function.name === name
                    );

                process.stdout.write(
                    `    ${name.padEnd(18)} ${
                        tool
                            ? tool.function.description.split(".")[0]
                            : ""
                    }\n`
                );
            }
        }

        process.stdout.write(
            `\n${TOOLS.length} tools in ${
                Object.keys(TOOL_GROUPS).length
            } groups\n`
        );
    }

    if (options.listAgents) {

        for (const agent of AGENTS) {

            process.stdout.write(
                `\n${agent.name}\n  ${agent.description}\n` +
                `    persona    : ${agent.persona || "-"}\n` +
                `    skills     : ${(agent.skills || []).join(", ") || "-"}\n` +
                `    tools      : ${
                    agent.tools === "*"
                        ? "all"
                        : (agent.tools || []).join(", ")
                }\n` +
                `    delegation : ${
                    agent.delegation && agent.delegation.enabled
                        ? `depth ${agent.delegation.max_depth}, children ${agent.delegation.max_children}`
                        : "not allowed"
                }\n`
            );
        }
    }

    if (options.listPolicy) {

        process.stdout.write(
            `\ndefault action: ${POLICY.default_action}\n` +
            `approval mode : ${runtime.policyEngine.summary().mode}\n\n`
        );

        for (const rule of POLICY.rules) {

            process.stdout.write(
                `  ${rule.action.padEnd(17)} ${
                    (rule.tools || rule.groups || []).join(", ")
                }\n      ${rule.reason}\n`
            );
        }
    }
}


/*
| Repeats runs while the plan still has open steps. Each cycle is a
| fresh run, because the plan on disk carries the state, not the
| conversation. It stops when the plan is complete, when a cycle makes
| no progress, at the cycle limit, or when the operator interrupts.
*/

async function runUntilDone(runtime, options, task) {

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


/*
| Discussion mode: the task goes to a group of specialist personas
| instead of the delegation tree. Round progress prints on stderr, the
| observer's final report on stdout, and --json switches the report to
| the machine-readable result.
*/

async function runDiscussion(runtime, options) {

    /* ---------------------------------------------------------------- */

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
        PERSONAS,
        transcriptRepository
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

    let projectContext = null;

    if (options.project) {
        const record = runtime.projects.registry().get(options.project);
        projectContext = runtime.projects.createProjectContext(record);
    }

    const workspace =
        projectContext?.workspaceRoot ||
        runtime.createRuntimeContext().runtime.workspace_root;

    const discussionProjectId =
        projectContext?.projectId ||
        options.project ||
        null;

    const discussionDataRoot =
        projectContext?.dataRoot ||
        require(path.join(REPO_ROOT, "agent", "persistence", "DataRoot")).legacyDataRoot();

    const workspaceContext =
        projectContext
            ? `Project: ${projectContext.projectName} (${discussionProjectId})\n` +
              `Workspace root: ${workspace}\n` +
              `Platform: ${process.platform} (${process.version})`
            : `Workspace root: ${workspace}\n` +
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
            projectId: discussionProjectId,
            projectContext,
            dataRoot: discussionDataRoot,
            discussionId: `discussion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            transcriptRepository,
            persistTranscript: true,
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
            `${JSON.stringify(result, null, 2)}\n`
        );

        return EXIT.SUCCESS;
    }

    const report = result.final_report || {};

    process.stdout.write(
        `\nDiscussion complete: ${result.total_rounds} round${result.total_rounds === 1 ? "" : "s"}${
            result.stopped_reason
                ? ` (stopped: ${result.stopped_reason})`
                : result.hit_max_rounds
                    ? " (max rounds reached)"
                    : ""
        }\n\n`
    );

    if (report.summary) {
        process.stdout.write(`Summary\n  ${report.summary}\n\n`);
    }

    if (report.agreed_points?.length) {
        process.stdout.write("Agreed\n");

        for (const point of report.agreed_points) {
            process.stdout.write(`  - ${point}\n`);
        }

        process.stdout.write("\n");
    }

    if (report.unresolved?.length) {
        process.stdout.write("Unresolved\n");

        for (const item of report.unresolved) {
            process.stdout.write(`  - ${item.topic}\n`);

            for (const side of item.sides || []) {
                process.stdout.write(
                    `      ${side.persona}: ${side.reasoning}\n`
                );
            }
        }

        process.stdout.write("\n");
    }

    if (report.next_steps?.length) {
        process.stdout.write("Next steps\n");

        for (const step of report.next_steps) {
            process.stdout.write(
                `  ${step.order}. [${step.layer}] ${step.action}\n`
            );
        }
    }

    return EXIT.SUCCESS;
}


/*
| EXECUTION_PLAN Phase 8 گام ۳: --migrate <id> copies the legacy .agent/
| state of a registered project into its central data root (idempotent,
| old files kept). The source root comes from the registry record —
| never from a flag (rule 9); with -w an id the registry does not know
| is REGISTERED at that directory first, so adopting a legacy workspace
| as a project plus migrating its state is one step.
*/

    return { printCatalogue, runUntilDone, runDiscussion };
}

module.exports = { createCliWorkflows };
