const { execFileSync } = require("child_process");
const nodePath = require("path");

const settings = require("../lib/storage");
const { WORKSPACE_ROOT } = require("../lib/workspace");

/*
|--------------------------------------------------------------------------
| Telemetry
|--------------------------------------------------------------------------
|
| Besides call counts, telemetry owns the run's file provenance. Files named
| by filesystem mutation tools are exact evidence. A Git status snapshot adds
| paths that became dirty through other mechanisms. Commands make tracking
| conservative because they can rewrite an already-dirty path without changing
| its status; an automatic commit refuses when that ambiguity matters.
|--------------------------------------------------------------------------
*/

const STATE = {
    started_at: Date.now(),
    total_calls: 0,
    total_failures: 0,
    per_tool: new Map(),
    recent: [],
    changed_files: new Set(),
    baseline_git: new Map(),
    change_tracking_complete: true
};


function normalisePath(value) {

    if (typeof value !== "string") {
        return null;
    }

    const absolute =
        nodePath.isAbsolute(value)
            ? nodePath.relative(WORKSPACE_ROOT, value)
            : value;

    const path = absolute
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .trim();

    if (
        path === "" ||
        path === "." ||
        path === ".." ||
        path.startsWith("../")
    ) {
        return null;
    }

    return path;
}


function gitStatusMap() {

    try {

        const output =
            execFileSync(
                "git",
                ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                {
                    cwd: WORKSPACE_ROOT,
                    encoding: "utf8",
                    timeout: settings.get("GIT_TIMEOUT_MS"),
                    windowsHide: true,
                    stdio: ["ignore", "pipe", "ignore"]
                }
            );

        const records = output.split("\0").filter(Boolean);
        const status = new Map();

        for (let index = 0; index < records.length; index++) {

            const record = records[index];
            const code = record.slice(0, 2);
            const first = normalisePath(record.slice(3));

            if (first) {
                status.set(first, code);
            }

            if (/^[RC]/.test(code) && records[index + 1]) {

                const second = normalisePath(records[++index]);

                if (second) {
                    status.set(second, code);
                }
            }
        }

        return status;

    } catch {
        return new Map();
    }
}


function rememberChangedPath(value) {

    const path = normalisePath(value);

    if (path) {
        STATE.changed_files.add(path);
    }
}


function recordMutation(name, args) {

    if (name === "fs_move") {
        rememberChangedPath(args?.source);
        rememberChangedPath(args?.destination);
        return;
    }

    if (["fs_write", "fs_edit", "fs_mkdir", "fs_delete"].includes(name)) {
        rememberChangedPath(args?.path);
        return;
    }

    if (["terminal_exec", "process_start", "process_write"].includes(name)) {
        STATE.change_tracking_complete = false;
    }
}


/*
| Per-run buckets (EXECUTION_PLAN Phase 4): in modular mode every run's
| calls are tallied under its run id in ADDITION to the process-wide
| counters. A concurrent run therefore neither reads nor wipes another
| run's tally, while the legacy surfaces below keep their exact shapes
| and semantics for single-run callers.
*/

const RUN_BUCKETS = new Map();


function bucketFor(runId) {

    let bucket = RUN_BUCKETS.get(runId);

    if (!bucket) {

        bucket = {
            total_calls: 0,
            total_failures: 0,
            per_tool: new Map(),
            recent: []
        };

        RUN_BUCKETS.set(runId, bucket);

        /* Stats buckets are small, but a long-lived process should not
           hold a retired run's tally forever; bound the history the same
           way the RunManager does. */
        while (
            RUN_BUCKETS.size >
            settings.get("RUN_HISTORY_LIMIT")
        ) {

            RUN_BUCKETS.delete(
                RUN_BUCKETS.keys().next().value
            );
        }
    }

    return bucket;

}


function record({
    name,
    success,
    durationMs,
    agent,
    error,
    run_id,
    project_id,
    arguments: args
}) {

    STATE.total_calls++;

    if (!success) {
        STATE.total_failures++;
    }

    const stats =
        STATE.per_tool.get(name) || {
            calls: 0,
            failures: 0,
            total_ms: 0,
            max_ms: 0
        };

    stats.calls++;
    stats.total_ms += durationMs;
    stats.max_ms = Math.max(stats.max_ms, durationMs);

    if (!success) {
        stats.failures++;
    } else {
        recordMutation(name, args || {});
    }

    STATE.per_tool.set(name, stats);

    STATE.recent.push({
        tool: name,
        agent: agent || "main_agent",
        success,
        duration_ms: durationMs,
        at: new Date().toISOString(),
        error: error || null
    });

    while (STATE.recent.length > settings.get("MAX_RECENT_TOOL_CALLS")) {
        STATE.recent.shift();
    }

    if (run_id) {

        const bucket = bucketFor(run_id);

        bucket.total_calls++;

        if (!success) {
            bucket.total_failures++;
        }

        const scopedStats =
            bucket.per_tool.get(name) || {
                calls: 0,
                failures: 0,
                total_ms: 0,
                max_ms: 0
            };

        scopedStats.calls++;
        scopedStats.total_ms += durationMs;
        scopedStats.max_ms = Math.max(scopedStats.max_ms, durationMs);

        if (!success) {
            scopedStats.failures++;
        }

        bucket.per_tool.set(name, scopedStats);

        /* Additive run/project attribution on scoped entries; the
           process-wide recent list above keeps its historical shape. */
        bucket.recent.push({
            tool: name,
            agent: agent || "main_agent",
            success,
            duration_ms: durationMs,
            at: new Date().toISOString(),
            error: error || null,
            run_id,
            ...(project_id ? { project_id } : {})
        });

        while (
            bucket.recent.length >
            settings.get("MAX_RECENT_TOOL_CALLS")
        ) {
            bucket.recent.shift();
        }
    }
}


function changedFiles() {

    const changed = new Set(STATE.changed_files);
    const current = gitStatusMap();

    for (const [file, code] of current) {

        /* Runtime-owned plan, archive, memory and session files are not
           project deliverables and never belong in an automatic commit. */
        if (file === ".agent" || file.startsWith(".agent/")) {
            continue;
        }

        if (
            !STATE.baseline_git.has(file) ||
            STATE.baseline_git.get(file) !== code
        ) {
            changed.add(file);
        }
    }

    return [...changed].sort();
}


function dirtyFiles() {

    return [...gitStatusMap().keys()]
        .filter(file => file !== ".agent" && !file.startsWith(".agent/"))
        .sort();
}


function changeTrackingComplete() {
    return STATE.change_tracking_complete;
}


async function runtimeStats(args) {

    const perTool =
        [...STATE.per_tool.entries()]
            .map(
                ([name, stats]) => ({
                    tool: name,
                    calls: stats.calls,
                    failures: stats.failures,
                    average_ms: Math.round(stats.total_ms / stats.calls),
                    max_ms: stats.max_ms
                })
            )
            .sort((a, b) => b.calls - a.calls);

    const result = {
        uptime_ms: Date.now() - STATE.started_at,
        total_calls: STATE.total_calls,
        total_failures: STATE.total_failures,
        files_changed: changedFiles(),
        file_tracking_complete: changeTrackingComplete(),
        tools: perTool
    };

    if (args && args.include_recent !== false) {

        const limit =
            Number.isInteger(args.recent_limit)
                ? args.recent_limit
                : 10;

        result.recent_calls = STATE.recent.slice(-limit);
    }

    return result;
}


/* reset() with no argument is the historical process-wide reset; with a
   run id only that run's bucket is dropped, so concurrent modular runs
   never clear each other's tallies. */
function reset(runId) {

    if (runId) {

        RUN_BUCKETS.delete(runId);

        return;
    }

    STATE.started_at = Date.now();
    STATE.total_calls = 0;
    STATE.total_failures = 0;
    STATE.per_tool.clear();
    STATE.recent.length = 0;
    STATE.changed_files.clear();
    STATE.change_tracking_complete = true;
    STATE.baseline_git = gitStatusMap();
}


function runSummary() {

    return {
        calls: STATE.total_calls,
        failures: STATE.total_failures,
        files_changed: changedFiles(),
        file_tracking_complete: changeTrackingComplete()
    };
}


/* With a run id, the tools that specific run executed; without one, the
   historical process-wide view. */
function executedToolNames(runId) {

    if (runId) {

        const bucket = RUN_BUCKETS.get(runId);

        return bucket ? [...bucket.per_tool.keys()] : [];
    }

    return [...STATE.per_tool.keys()];
}


module.exports = {
    runtime_stats: runtimeStats,
    runSummary,
    executedToolNames,
    changedFiles,
    dirtyFiles,
    changeTrackingComplete,
    record,
    reset,

    _gitStatusMap: gitStatusMap,
    _normalisePath: normalisePath,
    _buckets: RUN_BUCKETS
};
