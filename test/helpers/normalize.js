"use strict";

/*
|--------------------------------------------------------------------------
| Baseline Normalizer
|--------------------------------------------------------------------------
|
| Contract and regression tests compare runtime output against captured
| fixtures (EXECUTION_PLAN, Phase 1). Some fields are volatile by nature —
| timestamps, run ids, ports, pids, durations, temp paths — so equality is
| defined over a NORMALIZED form: volatile values become stable tokens,
| object keys are sorted, and array order is preserved by default (the
| order of messages, tool calls and events is contractual).
|
| Token vocabulary:
|   <TSTAMP>   ISO-8601 timestamps and anything shaped like one
|   <RUN_ID>   runtime identifiers (run-<timestamp>...)
|   <EPOCH>    epoch-millisecond numbers (>= 1e12)
|   <VOL>      other key-driven volatile numbers (seq, pid, port, ms, seq)
|   <TMP>      OS temp directories
|   <WORK>     the active workspace root (passed in via options.workspace)
|   <PID>      process ids embedded in text
|
| Helpers intentionally avoid replacing values whose order or content is
| contractual; when in doubt they do nothing.
|
*/

const VOLATILE_KEYS = new Set([

    "at",
    "seq",
    "pid",
    "port",
    "ms",
    "duration_ms",
    "durationMs",
    "elapsed_ms",
    "total_ms",
    "started_at",
    "ended_at",
    "created_at",
    "updated_at",
    "last_activity",
    "last_run_at",
    "timestamp",
    "time",
    "date",
    "took_ms"

]);

const TIMESTAMP_RE =
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

const RUN_ID_RE =
    /run-\d{4}-\d{2}-\d{2}[0-9A-Za-z:.\-_]*/g;

const TMP_RE =
    /\/(?:tmp|var\/folders)\/[^\s"'()[\]{}]*[^\s"'()[\]{}.,/]/g;

const PID_TEXT_RE =
    /\b(?:pid|PID)[:= ]+\d+/g;

const EPOCH_MIN = 1_000_000_000_000;


function normalizeString(text, options) {

    let out = text;

    if (options.workspace) {

        out = out.split(options.workspace).join("<WORK>");

    }

    out = out
        .replace(RUN_ID_RE, "<RUN_ID>")
        .replace(TIMESTAMP_RE, "<TSTAMP>")
        .replace(TMP_RE, "<TMP>")
        .replace(PID_TEXT_RE, "pid=<PID>");

    return out;

}


function normalizeNumber(key, value) {

    if (typeof value !== "number") {

        return value;

    }

    if (Number.isInteger(value) && value >= EPOCH_MIN) {

        return "<EPOCH>";

    }

    if (key !== null && VOLATILE_KEYS.has(key)) {

        return "<VOL>";

    }

    return value;

}


function normalize(value, options = {}) {

    return walk(value, null, options);

}


function walk(value, key, options) {

    if (value === null || value === undefined) {

        return value;

    }

    if (typeof value === "string") {

        return normalizeString(value, options);

    }

    if (typeof value === "number") {

        return normalizeNumber(key, value);

    }

    if (typeof value === "boolean") {

        return value;

    }

    if (Array.isArray(value)) {

        return value.map(item => walk(item, null, options));

    }

    if (typeof value === "object") {

        const out = {};

        for (const childKey of Object.keys(value).sort()) {

            out[childKey] = walk(value[childKey], childKey, options);

        }

        return out;

    }

    return value;

}


function normalizeJson(text, options) {

    return normalize(JSON.parse(text), options);

}


module.exports = {
    normalize,
    normalizeJson,
    VOLATILE_KEYS
};
