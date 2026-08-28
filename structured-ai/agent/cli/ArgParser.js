"use strict";

const fs = require("fs");
const path = require("path");

/*
|--------------------------------------------------------------------------
| CLI Argument Parser — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Extracted from bin/agent.js. Responsible for option parsing, flag
| validation, reading piped stdin, and translating parsed flags into the
| runtime environment before the agent subsystem is loaded.
|--------------------------------------------------------------------------
*/

const REPO_ROOT =
    path.resolve(__dirname, "..", "..");

const PACKAGE =
    require(path.join(REPO_ROOT, "package.json"));

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

    const options = {
        task: null,
        positional: []
    };

    const requireValue = (flag, value) => {

        if (
            value === undefined ||
            value.startsWith("-")
        ) {
            fail(`${flag} requires a value`);
        }

        return value;
    };

    const requireNumber = (flag, value) => {

        const parsed =
            Number(requireValue(flag, value));

        if (!Number.isFinite(parsed)) {
            fail(`${flag} expects a number`);
        }

        return parsed;
    };

    for (
        let index = 0;
        index < argv.length;
        index++
    ) {

        const argument = argv[index];

        switch (argument) {

            case "-h":
            case "--help":
                options.help = true;
                break;

            case "--version":
                options.version = true;
                break;

            case "-C":
            case "-w":
            case "--dir":
            case "--workspace":
                options.workspace =
                    requireValue(argument, argv[++index]);
                break;

            case "--project":
                options.project =
                    requireValue(argument, argv[++index]);
                break;

            case "--migrate":
                options.migrate =
                    requireValue(argument, argv[++index]);
                break;

            case "-f":
            case "--file":
                options.file =
                    requireValue(argument, argv[++index]);
                break;

            case "-a":
            case "--approve":
                options.approve =
                    requireValue(argument, argv[++index]);
                break;

            case "--dry-run":
                options.dryRun = true;
                break;

            case "-u":
            case "--until-done":
                options.untilDone = true;
                break;

            case "--max-cycles":
                options.maxCycles =
                    requireNumber(argument, argv[++index]);
                break;

            case "--discussion":
                options.discussion = true;
                break;

            case "--personas":
                options.personas =
                    requireValue(argument, argv[++index])
                        .split(",")
                        .map(id => id.trim())
                        .filter(id => id !== "");
                break;

            case "--max-rounds":
                options.maxRounds =
                    requireNumber(argument, argv[++index]);
                break;

            case "-i":
            case "--interactive":
                options.interactive = true;
                break;

            case "-s":
            case "--serve":
                options.serve = true;

                /* the port is optional */

                if (
                    argv[index + 1] &&
                    /^\d+$/.test(argv[index + 1])
                ) {
                    options.port = Number(argv[++index]);
                }
                break;

            case "--host":
                options.host =
                    requireValue(argument, argv[++index]);
                break;

            case "--json":
                options.json = true;
                break;

            case "-q":
            case "--quiet":
                options.quiet = true;
                break;

            case "-v":
            case "--verbose":
                options.quiet = false;
                break;

            case "-m":
            case "--model":
                options.model =
                    requireValue(argument, argv[++index]);
                break;

            case "-t":
            case "--temperature":
                options.temperature =
                    requireNumber(argument, argv[++index]);
                break;

            case "--base-url":
                options.baseUrl =
                    requireValue(argument, argv[++index]);
                break;

            case "--api-key":
                options.apiKey =
                    requireValue(argument, argv[++index]);
                break;

            case "--timeout":
                options.timeoutSeconds =
                    requireNumber(argument, argv[++index]);
                break;

            case "--max-iterations":
                options.maxIterations =
                    requireNumber(argument, argv[++index]);
                break;

            case "--max-agents":
                options.maxAgents =
                    requireNumber(argument, argv[++index]);
                break;

            case "--list-tools":
                options.listTools = true;
                break;

            case "--list-agents":
                options.listAgents = true;
                break;

            case "--list-policy":
                options.listPolicy = true;
                break;

            default:

                if (argument.startsWith("-")) {
                    fail(`unknown option ${argument}`);
                }

                options.positional.push(argument);
        }
    }

    return options;
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


module.exports = {
    REPO_ROOT,
    PACKAGE,
    EXIT,
    USAGE,
    fail,
    readStdin,
    parseArguments,
    applyEnvironment
};
