"use strict";

/*
|--------------------------------------------------------------------------
| Hook result model — EXECUTION_PLAN Phase 22
|--------------------------------------------------------------------------
|
| Hook execution records are deliberately plain objects: they are embedded
| in runtime notices and event payloads. The constructors centralize their
| shape while preserving the fields used by the existing UI and tests.
|--------------------------------------------------------------------------
*/

function hookResultSummary(value) {

    if (value === null || value === undefined) {
        return "completed";
    }

    if (typeof value === "string") {
        return value.slice(0, 600);
    }

    if (typeof value?.response?.content === "string") {
        return value.response.content.slice(0, 600);
    }

    if (
        typeof value?.stdout === "string" &&
        value.stdout.trim() !== ""
    ) {
        return value.stdout.trim().slice(0, 600);
    }

    const text = JSON.stringify(value);

    return text.length > 600
        ? `${text.slice(0, 600)}…`
        : text;
}


function skippedResult(hook, durationMs) {

    return {
        id: hook.id,
        type: hook.type,
        phase: hook.phase,
        ok: false,
        skipped: true,
        status: "skipped",
        summary: `condition was false: ${hook.when}`,
        on_failure: hook.on_failure,
        duration_ms: durationMs
    };
}


/* Not executed because an earlier hook failed with on_failure: stop. */
function stoppedResult(hook, reason) {

    return {
        id: hook.id,
        type: hook.type,
        phase: hook.phase,
        ok: false,
        skipped: true,
        status: "skipped",
        skipped_by: "on_failure_stop",
        reason,
        summary: reason,
        on_failure: hook.on_failure,
        duration_ms: 0
    };
}


function completedResult(hook, result, durationMs) {

    return {
        id: hook.id,
        type: hook.type,
        phase: hook.phase,
        ok: true,
        skipped: false,
        status: "done",
        summary: hookResultSummary(result),
        result,
        on_failure: hook.on_failure,
        duration_ms: durationMs
    };
}


function failedResult(hook, error, durationMs) {

    return {
        id: hook.id,
        type: hook.type,
        phase: hook.phase,
        ok: false,
        skipped: false,
        status: "failed",
        summary: error.message,
        error: error.message,
        on_failure: hook.on_failure,
        duration_ms: durationMs
    };
}


/*
| A stopped phase carries its cause on the report itself. Consumers used to
| re-derive it by searching the phase results for a failed stop hook, which
| broke on a short-circuited phase: every envelope there is 'skipped', so the
| search returned undefined and the dereference crashed. 'stopped_by' is the
| hook id, 'stop_reason' the human sentence; either may be null.
*/
function phaseResult(
    phase,
    results,
    skipped = false,
    stopped = false,
    stoppedBy = null,
    stopReason = null
) {

    return {
        phase,
        skipped,
        stopped,
        stopped_by: stoppedBy,
        stop_reason: stopReason,
        results
    };
}


function phaseEventResult(results) {

    return results.map(item => ({
        id: item.id,
        status: item.status,
        ok: item.ok,
        summary: item.summary
    }));
}


function hookReportText(report) {

    if (!report || report.results.length === 0) {
        return "";
    }

    return report.results
        /* A condition-skipped hook said nothing; a stop-skipped hook is the
           evidence the operator asked for, so it is kept and rendered. */
        .filter(
            item =>
                !item.skipped ||
                item.skipped_by === "on_failure_stop"
        )
        .map(
            item =>
                item.skipped_by === "on_failure_stop"
                    ? `- ${item.id}: skipped — ${item.reason || item.summary}`
                    : `- ${item.id}: ${item.ok ? "ok" : "failed"} — ${item.summary}`
        )
        .join("\n");
}


module.exports = {
    stoppedResult,
    hookResultSummary,
    skippedResult,
    completedResult,
    failedResult,
    phaseResult,
    phaseEventResult,
    hookReportText
};
