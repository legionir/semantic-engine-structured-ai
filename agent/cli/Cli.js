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
const { resolveWebServerOptions } = require("./WebServerOptions");
const { InteractiveCommand } = require("./InteractiveCommand");
const { actionError } = require("./OutputFormatter");
const { createCliWorkflows } = require("./CliWorkflows");
const { createCliOptions } = require("./CliOptions");
const { createCliWorkspaceCommands } = require("./CliWorkspaceCommands");


const EXIT = {
    SUCCESS: 0,
    FAILED: 1,
    USAGE: 2,
    INTERRUPTED: 130
};

const { printCatalogue, runUntilDone, runDiscussion } = createCliWorkflows({
    EXIT,
    fail,
    readStdin,
    fs,
    path
});

const { applyEnvironment } = createCliOptions({
    fail,
    repoRoot: REPO_ROOT,
    fs,
    path
});

const { runMigration, runTrustCommand } = createCliWorkspaceCommands({
    EXIT,
    fail,
    fs,
    path,
    repoRoot: REPO_ROOT
});


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
  PORT=<port>               Automatically start the web console and bind 0.0.0.0
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
      --proxy-url <url>     Proxy for provider requests (http:// or socks5://)

      --timeout <seconds>   Wall-clock budget for the whole run
      --max-iterations <n>  Iterations per agent
      --max-agents <n>      Sub-agents a run may spawn

      --list-tools          Print the tool catalogue and exit
      --list-agents         Print the agent profiles and exit
      --list-policy         Print the policy rules and exit
      doctor, --doctor      Report process sandbox backend and capabilities
      init                  Write AGENTS.md (instructions for coding agents)
                            for the workspace; same as the task /init
      --trust               Trust the workspace (-w, --project or cwd): its
                            project file may then enable hooks and MCP auto
                            discovery; security settings always stay locked
      --untrust             Revoke the trust of the workspace
      --list-trusted        Print the trusted workspaces and exit
  -h, --help                Print this help and exit
      --version             Print the version and exit

Exit codes
  0 completed        1 failed        2 usage error        130 interrupted

Environment
  AGENT_BASE_URL, AGENT_API_KEY, AGENT_PROXY_URL, AGENT_MODEL, AGENT_APPROVAL,
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

    if (options.doctor) {

        if (options.positional.length > 0) {
            fail("doctor does not accept a task");
        }

        const doctor =
            require(path.join(REPO_ROOT, "agent", "tools", "process", "SandboxDoctor"));
        const report = doctor.diagnose();

        process.stdout.write(doctor.formatReport(report));
        process.exit(report.ok ? EXIT.SUCCESS : EXIT.FAILED);
    }

    try {
        resolveWebServerOptions(options);
    } catch (error) {
        fail(error.message);
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

    if (
        options.trust ||
        options.untrust ||
        options.listTrusted
    ) {

        runTrustCommand(options, flags);

    }

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

    /*
    | P0-1: a project file is workspace input. What it may not change is
    | refused, and the operator is told, never silently obeyed.
    */
    for (const refused of opened.blocked || []) {

        process.stderr.write(
            `project: refused ${refused.key} from ${opened.path} (${refused.reason})\n`
        );
    }

    const untrusted =
        (opened.blocked || [])
            .filter(refused => refused.reason === "workspace is not trusted")
            .map(refused => refused.key);

    if (untrusted.length > 0) {

        process.stderr.write(
            `project: to apply ${untrusted.join(", ")}, trust this workspace: ` +
            `agent --trust -w ${opened.workspace_root || "<dir>"}\n`
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
