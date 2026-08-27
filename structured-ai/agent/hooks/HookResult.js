/*
|--------------------------------------------------------------------------\
| Hook results
|--------------------------------------------------------------------------\
|
| A hook run produces one record per hook, in three shapes: done, skipped,
| failed. The record itself is built by the runner — it is the only place that
| knows the timing and the error — while this module owns the two things that
| were duplicated across those three paths:
|
|   • `hookResultSummary`: how a result becomes the one line a model and the
|     console both read, capped so a tool that dumps a megabyte cannot blow
|     the prompt;
|   • `endEvent`: the `hook:end` payload. It used to be spelled out three
|     times, and a field added to two of the three copies is precisely the bug
|     no test would have caught.
|--------------------------------------------------------------------------*/

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

    if (typeof value?.stdout === "string" && value.stdout.trim() !== "") {
        return value.stdout.trim().slice(0, 600);
    }

    const text = JSON.stringify(value);

    return text.length > 600
        ? `${text.slice(0, 600)}…`
        : text;
}


/*
| The one projection of a record onto the event bus. Field names are what
| the web console and the SSE stream already consume; `error` stays `undefined`
| (not null) on success, which is how JSON.stringify drops it.
*/

function endEvent(record) {

    return {
        id: record.id,
        phase: record.phase,
        hook_type: record.type,
        ok: record.ok,
        skipped: record.skipped,
        status: record.status,
        summary: record.summary,
        error: record.error,
        on_failure: record.on_failure,
        duration_ms: record.duration_ms
    };
}


module.exports = {
    hookResultSummary,
    endEvent
};
