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


function phaseResult(phase, results, skipped = false, stopped = false) {

    return {
        phase,
        skipped,
        stopped,
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
        .filter(item => !item.skipped)
        .map(
            item =>
                `- ${item.id}: ${item.ok ? "ok" : "failed"} — ${item.summary}`
        )
        .join("\n");
}


module.exports = {
    hookResultSummary,
    skippedResult,
    completedResult,
    failedResult,
    phaseResult,
    phaseEventResult,
    hookReportText
};
