"use strict";

/*
|--------------------------------------------------------------------------
| Web console git report (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| After each turn a short git report is captured and recorded both in the
| event stream and in the conversation, so a run's effect is visible at a
| glance instead of only in `git status` afterwards.
|
| A repository the console cannot read is not an error: `gitReport` resolves
| with ok:false and the text "not a git repository", because a workspace
| without git is a normal way to run the console and a run must still end
| cleanly. The 8s timeout and 4 MiB buffer moved with the call.
|
| The report goes out on the bus — event store, live console and any other
| listener all receive it — and then appears in the conversation, in that
| order.
|--------------------------------------------------------------------------
*/

const { execFile } = require("child_process");

function createGitReportService(ctx) {

    const { runtime, state } = ctx;

    /*
    | After each turn (user message → run) a short git report is captured and
    | recorded both in the event stream and in the conversation, so the user
    | can see what the run changed at a glance. The report counts modified,
    | new and deleted files from `git status --short`; a clean tree yields
    | "0 file changed, 0 new file, 0 file removed".
    */

    function gitReport(workspace) {

        return new Promise(resolve => {

            execFile(
                "git",
                ["status", "--short", "--branch"],
                {
                    cwd: workspace,
                    timeout: 8000,
                    maxBuffer: 4 * 1024 * 1024,
                    windowsHide: true
                },
                (error, stdout) => {

                    if (error) {

                        resolve({
                            ok: false,
                            branch: null,
                            changed: 0,
                            new_files: 0,
                            deleted: 0,
                            text: "not a git repository",
                            raw: null
                        });

                        return;
                    }

                    const lines =
                        stdout
                            .split("\n")
                            .map(line => line.trim())
                            .filter(Boolean);

                    const branchLine =
                        lines.find(line => line.startsWith("## ")) || "";

                    const branch =
                        branchLine
                            .replace(/^##\s+/, "")
                            .split("...")[0]
                            .trim() || null;

                    let changed = 0;
                    let new_files = 0;
                    let deleted = 0;

                    for (const line of lines) {

                        if (line.startsWith("##")) {
                            continue;
                        }

                        const code =
                            line.charAt(0) + (line.charAt(1) || " ");

                        if (/^\?\?/.test(code)) {
                            new_files++;
                        } else if (/^D/.test(code)) {
                            deleted++;
                        } else {
                            changed++;
                        }
                    }

                    const text =
                        `${changed} file${changed === 1 ? "" : "s"} changed, ` +
                        `${new_files} new file${new_files === 1 ? "" : "s"}, ` +
                        `${deleted} file${deleted === 1 ? "" : "s"} removed`;

                    resolve({
                        ok: true,
                        branch,
                        changed,
                        new_files,
                        deleted,
                        text,
                        raw: lines.filter(l => !l.startsWith("##"))
                    });
                }
            );
        });
    }

    async function recordGitReport() {

        const workspace =
            runtime.createRuntimeContext()
                .workspace_root;

        const report = await gitReport(workspace);

        /* Emit on the bus so the event store, the live console and any
           listener all receive it, then surface it in the conversation. */
        runtime.events.emit("git:report", {
            branch: report.branch,
            changed: report.changed,
            new_files: report.new_files,
            deleted: report.deleted,
            text: report.text,
            ok: report.ok,
            turn_id: state.currentTurnId || null
        });

        ctx.addMessage({
            role: "system",
            kind: "git-report",
            content: report.text,
            branch: report.branch
        });

        return report;
    }

    return {
        gitReport,
        recordGitReport
    };
}

module.exports = {
    createGitReportService
};
