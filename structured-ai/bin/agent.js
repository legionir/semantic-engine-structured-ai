#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");


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
    path.resolve(__dirname, "..");

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
  -i, --interactive         Start a session: history is kept between tasks,
                            approvals are answered inline, Ctrl-C cancels
                            the running task instead of the session
  -s, --serve [port]        Serve the web console (default port 7777)
      --host <address>      Address to bind the console to (default 127.0.0.1)
  -w, -C, --workspace <dir> Directory the agent may act in (default: cwd)
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
                            : "Continue the plan: read it, take the next open step, verify it, and record the result."
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


async function main() {

    const options =
        parseArguments(process.argv.slice(2));

    if (options.help) {

        process.stdout.write(`${USAGE}\n`);

        process.exit(EXIT.SUCCESS);
    }

    if (options.version) {

        process.stdout.write(`${PACKAGE.version}\n`);

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

        if (options.interactive) {
            fail("--serve cannot be combined with --interactive");
        }

        const { createServer } =
            require(path.join(REPO_ROOT, "web", "server.js"));

        const console_ =
            createServer(runtime, {
                ...options,
                token:
                    process.env.AGENT_CONSOLE_TOKEN ||
                    crypto.randomBytes(24).toString("base64url")
            });

        const host =
            options.host || "127.0.0.1";

        const port =
            options.port || 7777;

        const address =
            await console_.listen(port, host);

        const consoleUrl =
            `http://${
                host === "0.0.0.0"
                    ? "localhost"
                    : host
            }:${address.port}?token=${encodeURIComponent(console_.token)}`;

        process.stdout.write(
            `structured-ai console
` +
            `  url       : ${consoleUrl}
` +
            `  token     : ${console_.token}
` +
            `  workspace : ${runtime.createRuntimeContext().runtime.workspace_root}
` +
            `  approval  : ${runtime.getApprovalMode()}
`
        );

        return;
    }

    if (options.interactive) {

        if (options.json) {
            fail("--json cannot be combined with --interactive");
        }

        const { startSession } =
            require(path.join(REPO_ROOT, "bin", "interactive.js"));

        const code =
            await startSession(runtime, options);

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

        action = await runtime.runAgent();

    } catch (error) {

        if (options.json) {

            process.stdout.write(
                `${
                    JSON.stringify(
                        {
                            version: "1.0",
                            action: "final",
                            tool_calls: null,
                            delegations: null,
                            response: null,
                            data: null,
                            error: {
                                code: error.name || "RUNTIME_ERROR",
                                message: error.message,
                                retryable: false
                            }
                        },
                        null,
                        2
                    )
                }\n`
            );

        } else {

            process.stderr.write(
                `\nagent: run failed\n${error.stack || error.message}\n`
            );
        }

        require(
            path.join(REPO_ROOT, "agent", "tools")
        ).shutdown();

        process.exit(
            runtime.isRunCancelled()
                ? EXIT.INTERRUPTED
                : EXIT.FAILED
        );
    }

    require(
        path.join(REPO_ROOT, "agent", "tools")
    ).shutdown();

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


main().catch(error => {

    process.stderr.write(
        `agent: ${error.stack || error.message}\n`
    );

    process.exit(EXIT.FAILED);
});
