"use strict";

const fs = require("fs");
const path = require("path");


/*
|--------------------------------------------------------------------------
| Command Line Interface
|--------------------------------------------------------------------------
|
| The runtime is configured through environment variables that are read
| when agent.js is loaded. The CLI therefore parses its options first,
| translates them into that environment, and only then loads the runtime.
|--------------------------------------------------------------------------
*/

const REPO_ROOT =
    path.resolve(__dirname, "../..");

const PACKAGE =
    require(path.join(REPO_ROOT, "package.json"));

const { parseArguments: parseCliArguments } = require("./ArgParser");
const { CommandRegistry } = require("./CommandRegistry");
const { HelpCommand } = require("./HelpCommand");
const { ServeCommand } = require("./ServeCommand");
const { InteractiveCommand } = require("./InteractiveCommand");
const { actionError } = require("./OutputFormatter");


const EXIT = {
    SUCCESS: 0,
    FAILED: 1,
    USAGE: 2,
    INTERRUPTED: 130
};


const USAGE = `
${PACKAGE.name} ${PACKAGE.version} - hierarchical multi-agent runtime

Usage
  agent [options] [task]
  agent -i                  interactive session, keeps one conversation
  agent -s [port]           web console with a live agent tree
  agent -f task.md
  echo "review the diff" | agent

Task
  Given as an argument, with --file, or on stdin. When no task is given,
  AGENT_TASK is used.

Options
  -u, --until-done          Keep starting runs while the plan has open steps,
                            until it is complete or Ctrl-C stops it
      --max-cycles <n>      Safety limit for --until-done (default 20)
      --discussion          Run a multi-agent discussion instead of a run:
                            selected specialist personas deliberate in rounds
                            and an observer writes the final synthesis
      --personas <ids>      Comma-separated personas for --discussion,
                            e.g. security,backend,frontend
      --max-rounds <n>      Discussion round limit for --discussion (1-10,
                            default 5)
  -i, --interactive         Start a session: history is kept between tasks,
                            approvals are answered inline, Ctrl-C cancels
                            the running task instead of the session
  -s, --serve [port]        Serve the web console (default port 7777)
      --host <address>      Address to bind the console to (default 127.0.0.1)
  -w, -C, --workspace <dir> Directory the agent may act in (default: cwd)
      --project <id>      Run inside the registered project <id>: the root
                          comes from the project registry (-w must match it
                          or be omitted), and the run becomes project-aware
      --migrate <id>      Copy the legacy .agent/ state of registered
                          project <id> into the central project store
                          (idempotent, old files are kept; with -w the id
                          is registered at that directory first)
  -f, --file <path>         Read the task from a file
  -a, --approve <mode>      auto | prompt | deny (default: prompt)
      --dry-run             Refuse anything needing approval, so nothing is changed
      --json                Print only the final JSON action on stdout
  -q, --quiet               Suppress progress output
  -v, --verbose             Show progress output (default)

  -m, --model <name>        Model to request
  -t, --temperature <n>     Sampling temperature
      --base-url <url>      OpenAI-compatible base URL
      --api-key <key>       API key (prefer AGENT_API_KEY in the environment)

      --timeout <seconds>   Wall-clock budget for the whole run
      --max-iterations <n>  Iterations per agent
      --max-agents <n>      Sub-agents a run may spawn

      --list-tools          Print the tool catalogue and exit
      --list-agents         Print the agent profiles and exit
      --list-policy         Print the policy rules and exit
  -h, --help                Print this help and exit
      --version             Print the version and exit

Exit codes
  0 completed        1 failed        2 usage error        130 interrupted

Environment
  AGENT_BASE_URL, AGENT_API_KEY, AGENT_MODEL, AGENT_APPROVAL,
  WORKSPACE_ROOT, MAX_RUN_MS, MAX_CONTEXT_CHARS, MAX_TOTAL_AGENTS

Running through npm
  npm takes -w for itself and fails with "No workspaces found". Put -- first,
  or call the file directly:

    npm start -- -w /path/to/project "the task"
    node bin/agent.js -w /path/to/project "the task"
    WORKSPACE_ROOT=/path/to/project npm start "the task"
`.trim();


function fail(message) {

    process.stderr.write(
        `agent: ${message}\nTry 'agent --help'.\n`
    );

    process.exit(EXIT.USAGE);
}


function readStdin() {

    if (process.stdin.isTTY) {
        return Promise.resolve("");
    }

    return new Promise(resolve => {

        let data = "";

        process.stdin.setEncoding("utf8");

        process.stdin.on(
            "data",
            chunk => {
                data += chunk;
            }
        );

        process.stdin.on(
            "end",
            () => resolve(data)
        );

        process.stdin.on(
            "error",
            () => resolve("")
        );
    });
}


function parseArguments(argv) {

    return parseCliArguments(argv, { fail });
}

function applyEnvironment(options) {

    const environment = {};

    if (options.workspace) {

        const resolved =
            path.resolve(options.workspace);

        if (
            !fs.existsSync(resolved) ||
            !fs.statSync(resolved).isDirectory()
        ) {
            fail(`workspace is not a directory: ${options.workspace}`);
        }

        environment.WORKSPACE_ROOT = resolved;
    }

    /*
    | EXECUTION_PLAN Phase 7 گام ۱: --project <id> binds the run to a
    | registered project. The root is ALWAYS taken from the registry —
    | a -w that disagrees with the registered root is an error, and
    | without -w the registered root becomes the workspace (rule: never
    | trust identity arguments over registry data).
    */
    if (options.project) {

        const projects =
            require(path.join(REPO_ROOT, "agent", "projects", "index.js"));

        const { canonicalizeRoot } =
            require(path.join(REPO_ROOT, "agent", "projects", "ProjectRegistry.js"));

        let record;

        try {

            record =
                projects.registry().get(options.project);

        } catch (error) {

            fail(
                `${error.message} ` +
                "(--project names a record of the central project registry; " +
                "register the project there first)"
            );

        }

        const projectRoot = record.rootPath;

        if (options.workspace) {

            if (
                canonicalizeRoot(environment.WORKSPACE_ROOT) !==
                projectRoot
            ) {

                fail(
                    `--project ${options.project} is rooted at ${projectRoot}, ` +
                    `which does not match --workspace ${options.workspace}; ` +
                    "the project root always comes from the registry, not from flags " +
                    "(drop -w to run on the registered root)"
                );

            }

        } else {

            if (
                !fs.existsSync(projectRoot) ||
                !fs.statSync(projectRoot).isDirectory()
            ) {

                fail(
                    `--project ${options.project} is rooted at ${projectRoot}, ` +
                    "but that directory does not exist"
                );

            }

            environment.WORKSPACE_ROOT = projectRoot;

        }

        /* Selecting a project asks for the project-aware execution
           bundle: scoped run context (Phase 2/3), per-run isolation and
           the project_context prompt message (Phase 5) engage together.
           Without --project every flag stays untouched, so today's
           single-project behavior is bit-identical. */
        environment.PROJECT_CONTEXT_MODE = "modular";
        environment.RUN_CONTEXT_MODE = "modular";
        environment.PROMPT_BUILDER_MODE = "modular";

    }

    if (options.approve) {

        if (
            !["auto", "prompt", "deny"].includes(options.approve)
        ) {
            fail(
                `--approve expects auto, prompt or deny, received "${options.approve}"`
            );
        }

        environment.AGENT_APPROVAL = options.approve;
    }

    if (options.dryRun) {

        /*
        | A dry run still inspects the project; it simply refuses every
        | call the policy sends for approval, so nothing is modified.
        */

        environment.AGENT_APPROVAL = "deny";
    }

    if (options.model) {
        environment.AGENT_MODEL = options.model;
    }

    if (options.temperature !== undefined) {
        environment.AGENT_TEMPERATURE = String(options.temperature);
    }

    if (options.baseUrl) {
        environment.AGENT_BASE_URL = options.baseUrl;
    }

    if (options.apiKey) {
        environment.AGENT_API_KEY = options.apiKey;
    }

    if (options.timeoutSeconds !== undefined) {
        environment.MAX_RUN_MS = String(
            Math.round(options.timeoutSeconds * 1000)
        );
    }

    if (options.maxIterations !== undefined) {
        environment.MAX_ITERATIONS = String(options.maxIterations);
    }

    if (options.maxAgents !== undefined) {
        environment.MAX_TOTAL_AGENTS = String(options.maxAgents);
    }

    if (options.quiet) {
        environment.AGENT_VERBOSE = "0";
    }

    if (options.json) {

        /*
        | stdout carries the result, so progress and the runtime's own
        | final dump move out of the way.
        */

        environment.AGENT_LOG_STREAM = "stderr";
        environment.AGENT_PRINT_FINAL = "0";
    }

    if (options.interactive) {

        /*
        | The session prints the answer itself, so the runtime's raw
        | dump would only repeat it.
        */

        environment.AGENT_PRINT_FINAL = "0";
    }

    Object.assign(process.env, environment);

    return environment;
}


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
function runMigration(projectId, options) {

    if (options.project) {

        fail("--migrate and --project are separate operations");

    }

    if (
        options.interactive ||
        options.serve ||
        options.untilDone ||
        options.discussion
    ) {

        fail("--migrate is a one-shot operation and cannot be combined with -i, -s, --until-done or --discussion");

    }

    const projects =
        require(path.join(REPO_ROOT, "agent", "projects", "index.js"));

    const registry = projects.registry();

    let record;

    try {

        record = registry.get(projectId);

    } catch {

        /* An id the registry does not know can still be adopted: -w
           names the directory it should be registered at. Without -w
           there is no source root we are allowed to assume. */

        if (!options.workspace) {

            fail(
                `Unknown project: ${projectId} ` +
                "(--migrate names a record of the central project registry; " +
                "pass -w <dir> to register that directory under the id first)"
            );

        }

        record = registry.register({
            id: projectId,
            name: projectId,
            rootPath: options.workspace
        });

        process.stderr.write(
            `agent: registered project ${record.id} at ${record.rootPath}\n`
        );

    }

    const report =
        projects.ProjectMigration.migrateProject(record);

    const summary =
        `agent: migration for ${report.project_id}\n` +
        `  source : ${report.source}${report.source_present ? "" : " (no legacy state found)"}\n` +
        `  target : ${report.target}\n` +
        `  copied : ${report.copied.length} file(s), ` +
        `skipped ${report.skipped.length} (already migrated), ` +
        `errors ${report.errors.length}\n`;

    process.stderr.write(summary);

    for (const entry of report.errors) {

        process.stderr.write(
            `  error : ${entry.file || "target"} — ${entry.error}\n`
        );

    }

    if (report.copied.length > 0) {

        process.stderr.write(
            `  files : ${report.copied.join(", ")}\n`
        );

    } else if (report.errors.length === 0) {

        process.stderr.write(
            "  nothing new to migrate (idempotent re-run)\n"
        );

    }

    process.exit(
        report.errors.length > 0
            ? EXIT.FAILED
            : EXIT.SUCCESS
    );

}


function commandRegistry() {

    return new CommandRegistry({
        help: new HelpCommand({
            usage: USAGE,
            version: PACKAGE.version
        }),
        serve: new ServeCommand({ repoRoot: REPO_ROOT }),
        interactive: new InteractiveCommand({ repoRoot: REPO_ROOT })
    });
}


async function main() {

    const options =
        parseArguments(process.argv.slice(2));

    const commands =
        commandRegistry();

    if (options.help) {
        await commands.execute("help", "help");
        process.exit(EXIT.SUCCESS);
    }

    if (options.version) {
        await commands.execute("help", "version");
        process.exit(EXIT.SUCCESS);
    }

    if (
        (options.interactive || options.serve) &&
        !options.approve &&
        !options.dryRun &&
        !process.env.AGENT_APPROVAL
    ) {

        /*
        | A session has a human at the keyboard, so the safe default is
        | to ask rather than to approve silently.
        */

        options.approve = "prompt";
    }

    const flags =
        applyEnvironment(options);

    /* گام ۳ migration is handled before the runtime is loaded: it only
       needs the registry and the two data roots. */
    if (options.migrate) {

        runMigration(options.migrate, options);

    }

    if (
        !options.interactive &&
        !options.serve &&
        !options.untilDone
    ) {

        /*
        | A single run is abandoned on interrupt. A session installs its
        | own handler instead, so Ctrl-C only cancels the running task.
        */

        process.on(
            "SIGINT",
            () => {

                process.stderr.write("\nagent: interrupted\n");

                process.exit(EXIT.INTERRUPTED);
            }
        );
    }

    const listing =
        options.listTools ||
        options.listAgents ||
        options.listPolicy;

    /*
    | The runtime is loaded only after the environment is in place.
    */

    const runtime =
        require(path.join(REPO_ROOT, "agent", "agent.js"));

    /*
    | The workspace remembers how it was tuned, and applies it as an
    | override. A flag typed on this command line is more specific than
    | anything a file remembers, so it is re-applied on top.
    */

    const opened =
        runtime.openProject();

    /*
    | A flag is applied on top of the project file, and marked as
    | belonging to this run so it is never written back: --quiet once
    | should not make the workspace quiet for ever.
    */

    runtime.project.sessionOnly(Object.keys(flags));

    for (const [key, value] of Object.entries(flags)) {

        try {

            runtime.settings.set(key, value);

        } catch {

            /* fixed at startup, such as the workspace root */
        }
    }

    if (
        opened.applied.length > 0 &&
        !options.quiet
    ) {

        process.stderr.write(
            `project: applied ${
                opened.applied.length
            } saved setting(s) from ${opened.path}\n`
        );
    }

    for (const skipped of opened.skipped) {

        process.stderr.write(
            `project: ignored ${skipped.key} (${skipped.reason})\n`
        );
    }

    if (listing) {

        printCatalogue(runtime, options);

        process.exit(EXIT.SUCCESS);
    }

    if (options.serve) {

        await commands.execute("serve", runtime, options);
        return;
    }

    if (options.interactive) {

        if (options.json) {
            fail("--json cannot be combined with --interactive");
        }

        const code =
            await commands.execute("interactive", runtime, options);

        process.exit(code);
    }

    if (options.discussion) {

        const code =
            await runDiscussion(runtime, options);

        process.exit(code);
    }

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

    /* ---------------------------------------------------------------- */

    if (options.untilDone) {

        const code =
            await runUntilDone(runtime, options, task);

        process.exit(code);
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
                `${JSON.stringify(actionError(error), null, 2)}\n`
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

        process.exit(
            runtime.isRunCancelled()
                ? EXIT.INTERRUPTED
                : EXIT.FAILED
        );
    }

    await runtime.application.lifecycle.shutdown({
        tools: require(path.join(REPO_ROOT, "agent", "tools")),
        eventstore: runtime.eventstore
    });

    if (options.json) {

        process.stdout.write(
            `${JSON.stringify(action, null, 2)}\n`
        );

    } else if (action.response) {

        process.stdout.write(
            `\n${action.response.content}\n`
        );
    }

    process.exit(
        action.error
            ? EXIT.FAILED
            : EXIT.SUCCESS
    );
}


module.exports = {
    EXIT,
    PACKAGE,
    USAGE,
    fail,
    readStdin,
    parseArguments,
    applyEnvironment,
    printCatalogue,
    runUntilDone,
    runDiscussion,
    runMigration,
    main
};
