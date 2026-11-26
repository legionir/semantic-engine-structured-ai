"use strict";

/*
|--------------------------------------------------------------------------
| agent review [diff|staged|commit <ref>|branch <ref>|pr <n>] (roadmap P3-08)
|--------------------------------------------------------------------------
|
| Reviews one change set of the workspace (-w) or --project and prints the
| findings, most severe first; --json prints the whole result, including
| fix_task, the task a fixing run would get. The exit code makes it a CI
| gate: 1 when any finding is high or critical (or the model call failed),
| 2 when the review cannot start (no repository, bad ref), 0 otherwise.
*/

const ReviewRunner = require("../review/ReviewRunner");
const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");

const SETUP_ERRORS = /^(NOT_A_REPOSITORY|NO_GITHUB_|NO_BASE|INVALID_)/;


function rootOf(runtime, options) {

    if (!options.project) {
        return WORKSPACE_ROOT;
    }

    return runtime.resolveRunProjectContext({ projectId: options.project }).workspaceRoot;
}


async function runReview(runtime, options, { EXIT, write = text => process.stdout.write(text), writeError = text => process.stderr.write(text) }) {

    const target = options.reviewTarget || "diff";

    let result;

    try {

        result = await ReviewRunner.review({
            root: rootOf(runtime, options),
            callAI: request => runtime.callAI(request),
            target,
            ref: target === "pr" ? undefined : options.reviewRef,
            number: target === "pr" ? Number(options.reviewRef) : undefined,
            base: options.base,
            post: options.post === true,
            projectId: options.project || null
        });

    } catch (error) {

        if (options.json) {
            write(`${JSON.stringify({ error: error.message, code: error.code || null }, null, 2)}\n`);
        } else {
            writeError(`agent: review failed: ${error.message}\n`);
        }

        /* a setup problem (no repository, bad ref, no GitHub server) is told
           apart from a blocking finding, which is exit 1 */
        return SETUP_ERRORS.test(String(error.code || "")) ? EXIT.USAGE : EXIT.FAILED;
    }

    const blocking = result.findings.some(item => item.severity === "critical" || item.severity === "high");

    if (options.json) {

        write(`${JSON.stringify({ ...result, fix_task: ReviewRunner.fixTask(result.findings, result.label) }, null, 2)}\n`);

    } else {

        write(`Review of ${result.label}${result.truncated ? " (diff cut at REVIEW_MAX_DIFF_CHARS)" : ""}\n\n${result.summary}\n`);

        for (const item of result.findings) {
            write(`\n[${item.severity}] ${item.file}${item.line ? `:${item.line}` : ""}  ${item.title}\n`);
            if (item.detail) write(`    ${item.detail}\n`);
            if (item.suggestion) write(`    fix: ${item.suggestion}\n`);
        }

        write(result.findings.length === 0 ? "\nNo findings.\n" : `\n${result.findings.length} finding(s).\n`);

        if (result.posted) {
            write(result.posted.posted ? `Posted to the pull request through ${result.posted.server}.\n` : `Not posted: ${result.posted.reason}\n`);
        }
    }

    return blocking ? EXIT.FAILED : EXIT.SUCCESS;
}


module.exports = { runReview };
