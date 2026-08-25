"use strict";

/*
|--------------------------------------------------------------------------
| Legacy State Migration — EXECUTION_PLAN, Phase 8 گام ۳
|--------------------------------------------------------------------------
|
| Single-project era state lives under `<workspace>/.agent/`; registered
| projects keep it centrally under `<dataHome>/projects/<id>/`. This
| module copies the legacy state forward:
|
|   .agent/memory.json     -> projects/<id>/memory.json
|   .agent/plan.json       -> projects/<id>/plan.json
|   .agent/project.json    -> projects/<id>/project.json
|   .agent/sessions/       -> projects/<id>/sessions/
|   .agent/archive/        -> projects/<id>/archive/
|   .agent/journal/        -> projects/<id>/journal/
|   .agent/eventstore/     -> projects/<id>/eventstore/
|   .agent/searches/       -> projects/<id>/searches/
|   .agent/processes/      -> projects/<id>/processes/
|   .agent/logs/           -> projects/<id>/logs/
|
| Properties the phase demands:
|
|   idempotent   a copy only ever fills a gap: a file that already
|                exists at the target is reported as skipped, never
|                overwritten, so re-running migration neither
|                duplicates nor corrupts newer central state
|
|   non-destructive
|                the legacy files are NEVER deleted (they remain the
|                compatibility layer legacy mode still reads)
|
|   resilient    one unreadable or corrupt file is one error entry in
|                the report, not a stopped migration
|
| The legacy source root comes from the REGISTRY record's rootPath —
| never from CLI/model arguments (rule 9); --migrate without -w only
| ever touches roots the operator previously registered.
|
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");

const dataRoot = require("../lib/dataRoot");


const FILES = [
    "memory.json",
    "plan.json",
    "project.json"
];

const DIRECTORIES = [
    "sessions",
    "archive",
    "journal",
    "eventstore",
    "searches",
    "processes",
    "logs"
];


/* Every regular file under `dir`, relative to it (recursive). */
function walkFiles(dir) {

    const found = [];

    if (!fs.existsSync(dir)) {
        return found;
    }

    const stack = [""];

    while (stack.length > 0) {

        const relative = stack.pop();
        const absolute = path.join(dir, relative);

        let entries;

        try {

            entries = fs.readdirSync(absolute, { withFileTypes: true });

        } catch {

            continue;
        }

        for (const entry of entries) {

            const child = path.join(relative, entry.name);

            if (entry.isDirectory()) {

                stack.push(child);

            } else if (entry.isFile()) {

                found.push(child);

            }

        }
    }

    return found.sort();
}


/* Copy-missing-only: fills the target file iff it does not exist. The
   result distinguishes copy/skip/error so the report is honest about
   what a rerun changed (nothing). */
function copyMissing(source, target) {

    try {

        if (fs.existsSync(target)) {
            return "skipped";
        }

        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);

        return "copied";

    } catch (error) {

        return error.message;

    }
}


/*
| Migrates the legacy `.agent` state of `record` (a registry record
| shape: { id, rootPath }) into its central data root. Returns the
| report — it never throws: a broken legacy tree is data for the
| report, not a reason to kill the process.
*/
function migrateProject(record) {

    if (
        !record ||
        typeof record.id !== "string" ||
        typeof record.rootPath !== "string"
    ) {

        throw new Error(
            "migrateProject needs a registry record ({ id, rootPath })."
        );

    }

    const { createProjectContext } = require("./ProjectContext");

    const source =
        path.join(record.rootPath, ".agent");

    const target =
        createProjectContext(record).dataRoot;

    const report = {
        project_id: record.id,
        source,
        target,
        source_present: fs.existsSync(source),
        copied: [],
        skipped: [],
        errors: []
    };

    /* The full central layout exists afterwards whether or not the
       legacy side had anything to give (گام ۱ scaffold). */
    try {

        dataRoot.ensureRoot(target);

    } catch (error) {

        report.errors.push({
            file: null,
            error: error.message
        });

        return report;
    }

    if (!report.source_present) {
        return report;
    }

    /* A file the legacy side never had is not a candidate (absence is
       not corruption — there is just nothing to move). */
    const candidates = [
        ...FILES.filter(
            name => fs.existsSync(path.join(source, name))
        ),
        ...DIRECTORIES.flatMap(
            dir => walkFiles(path.join(source, dir))
                .map(relative => path.join(dir, relative))
        )
    ];

    for (const relative of candidates) {

        const outcome = copyMissing(
            path.join(source, relative),
            path.join(target, relative)
        );

        if (outcome === "copied") {

            report.copied.push(relative);

        } else if (outcome === "skipped") {

            report.skipped.push(relative);

        } else {

            report.errors.push({
                file: relative,
                error: outcome
            });

        }
    }

    return report;
}


module.exports = {
    FILES,
    DIRECTORIES,
    migrateProject
};
