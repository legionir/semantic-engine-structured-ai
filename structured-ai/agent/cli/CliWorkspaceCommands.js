"use strict";

/* One-shot workspace registration, migration, and trust operations. */

function createCliWorkspaceCommands({ EXIT, fail, fs, path, repoRoot }) {
    const REPO_ROOT = repoRoot;
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


/*
| P0-1: trusting a workspace is an operator decision. It is made on the
| command line and recorded in the operator's own configuration directory,
| never in the workspace itself (agent/projects/WorkspaceTrust.js). Like
| --migrate it runs before the runtime is loaded and exits.
*/
function runTrustCommand(options, flags) {

    const operations =
        ["trust", "untrust", "listTrusted"].filter(name => options[name]);

    if (operations.length > 1) {

        fail("--trust, --untrust and --list-trusted are separate operations");

    }

    if (
        options.interactive ||
        options.serve ||
        options.untilDone ||
        options.discussion ||
        options.migrate
    ) {

        fail("--trust, --untrust and --list-trusted are one-shot operations and cannot be combined with -i, -s, --until-done, --discussion or --migrate");

    }

    const WorkspaceTrust =
        require(path.join(REPO_ROOT, "agent", "projects", "WorkspaceTrust.js"));

    const store =
        WorkspaceTrust.trustStorePath();

    if (options.listTrusted) {

        const entries = WorkspaceTrust.list();

        if (options.json) {

            process.stdout.write(
                `${JSON.stringify({ trust_file: store, workspaces: entries }, null, 2)}\n`
            );

        } else if (entries.length === 0) {

            process.stdout.write(`no trusted workspaces (${store})\n`);

        } else {

            for (const entry of entries) {

                process.stdout.write(
                    `${entry.path || entry.key}  trusted ${entry.trusted_at || "-"}\n`
                );

            }

        }

        process.exit(EXIT.SUCCESS);

    }

    /* The same folder the runtime opens: -w / --project, otherwise the
       workspace boundary's own root (cwd by default). */
    const root =
        flags.WORKSPACE_ROOT ||
        require(path.join(REPO_ROOT, "agent", "context", "WorkspaceBoundary")).WORKSPACE_ROOT ||
        process.cwd();

    if (
        !fs.existsSync(root) ||
        !fs.statSync(root).isDirectory()
    ) {

        fail(`workspace is not a directory: ${root}`);

    }

    let workspace;
    let changed;

    try {

        if (options.trust) {

            workspace = WorkspaceTrust.trust(root, { by: "cli" });
            changed = true;

        } else {

            workspace = WorkspaceTrust.canonicalRoot(root);
            changed = WorkspaceTrust.revoke(root);

        }

    } catch (error) {

        process.stderr.write(
            `agent: cannot update the trust store ${store}: ${error.message}\n`
        );

        process.exit(EXIT.FAILED);

    }

    if (options.json) {

        process.stdout.write(
            `${JSON.stringify({
                workspace,
                trusted: Boolean(options.trust),
                changed,
                trust_file: store
            }, null, 2)}\n`
        );

    } else if (options.trust) {

        process.stderr.write(
            `agent: trusted workspace ${workspace}\n` +
            `  store   : ${store}\n` +
            `  enables : ${[...WorkspaceTrust.TRUST_GATED_KEYS].join(", ")} from its project file\n` +
            "  security settings (approval, endpoints, keys, sandbox, MCP trust) stay locked\n" +
            `  revoke  : agent --untrust -w ${root}\n`
        );

    } else {

        process.stderr.write(
            changed
                ? `agent: revoked trust for ${workspace}\n`
                : `agent: workspace was not trusted: ${workspace}\n`
        );

    }

    process.exit(EXIT.SUCCESS);

}



    return { runMigration, runTrustCommand };
}

module.exports = { createCliWorkspaceCommands };
