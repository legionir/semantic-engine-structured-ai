"use strict";

const path = require("path");
const { REPO_ROOT, fail, EXIT } = require("./ArgParser");
const { HelpCommand } = require("./HelpCommand");
const { ServeCommand } = require("./ServeCommand");
const { InteractiveCommand } = require("./InteractiveCommand");
const { RunCommand } = require("./RunCommand");
const { printCatalogue } = require("./OutputFormatter");

/*
|--------------------------------------------------------------------------
| CLI Command Registry — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| Routes parsed CLI options to the appropriate command handler:
| help/version, catalogue listing, project migration, web console server,
| interactive REPL, multi-agent discussion, or standard task execution.
|--------------------------------------------------------------------------
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

    return report.errors.length > 0
        ? EXIT.FAILED
        : EXIT.SUCCESS;
}


class CommandRegistry {

    constructor() {

        this.commands = new Map();
        this.registerDefaultCommands();
    }

    register(name, handler) {

        this.commands.set(name, handler);
    }

    get(name) {

        return this.commands.get(name);
    }

    registerDefaultCommands() {

        this.register("help", (runtime, options) => {
            return HelpCommand.execute(options);
        });

        this.register("migrate", (runtime, options) => {
            return runMigration(options.migrate, options);
        });

        this.register("catalogue", (runtime, options) => {
            printCatalogue(runtime, options);
            return EXIT.SUCCESS;
        });

        this.register("serve", async (runtime, options) => {
            await ServeCommand.execute(runtime, options);
            return null; // keeps running
        });

        this.register("interactive", async (runtime, options) => {
            return InteractiveCommand.execute(runtime, options);
        });

        this.register("discussion", async (runtime, options) => {
            return RunCommand.runDiscussion(runtime, options);
        });

        this.register("run", async (runtime, options) => {
            return RunCommand.execute(runtime, options);
        });
    }

    resolve(options) {

        if (options.help || options.version) {
            return "help";
        }

        if (options.migrate) {
            return "migrate";
        }

        if (options.listTools || options.listAgents || options.listPolicy) {
            return "catalogue";
        }

        if (options.serve) {
            return "serve";
        }

        if (options.interactive) {
            return "interactive";
        }

        if (options.discussion) {
            return "discussion";
        }

        return "run";
    }

    async dispatch(options, runtime) {

        const name = this.resolve(options);
        const handler = this.get(name);

        if (!handler) {
            fail(`unhandled command: ${name}`);
        }

        return handler(runtime, options);
    }
}

const defaultRegistry = new CommandRegistry();

module.exports = {
    CommandRegistry,
    defaultRegistry,
    runMigration
};
