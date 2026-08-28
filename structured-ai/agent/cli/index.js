"use strict";

const path = require("path");
const {
    REPO_ROOT,
    PACKAGE,
    EXIT,
    USAGE,
    fail,
    readStdin,
    parseArguments,
    applyEnvironment
} = require("./ArgParser");

const {
    formatDuration,
    formatJsonAction,
    formatErrorAction,
    printCatalogue,
    formatDiscussionReport
} = require("./OutputFormatter");

const { HelpCommand } = require("./HelpCommand");
const { ServeCommand } = require("./ServeCommand");
const { InteractiveCommand } = require("./InteractiveCommand");
const { RunCommand } = require("./RunCommand");
const { CommandRegistry, defaultRegistry, runMigration } = require("./CommandRegistry");

/*
|--------------------------------------------------------------------------
| CLI Subsystem — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Entry point for the CLI module. Orchestrates option parsing, environment
| setup, runtime loading, project overlay application, and command dispatch.
|--------------------------------------------------------------------------
*/

async function main(argv = process.argv.slice(2)) {

    const options =
        parseArguments(argv);

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

    /* migration is handled before the runtime is loaded: it only
       needs the registry and the two data roots. */
    if (options.migrate) {

        const code = runMigration(options.migrate, options);

        process.exit(code);
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

    const code =
        await defaultRegistry.dispatch(options, runtime);

    if (typeof code === "number") {

        process.exit(code);
    }
}

module.exports = {
    main,
    parseArguments,
    applyEnvironment,
    readStdin,
    fail,
    EXIT,
    USAGE,
    PACKAGE,
    REPO_ROOT,
    formatDuration,
    formatJsonAction,
    formatErrorAction,
    printCatalogue,
    formatDiscussionReport,
    HelpCommand,
    ServeCommand,
    InteractiveCommand,
    RunCommand,
    CommandRegistry,
    defaultRegistry,
    runMigration
};
