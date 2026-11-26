const { execFileSync } = require("child_process");
const nodePath = require("path");

const settings = require("../config");
const childEnvironment = require("../tools/process/ChildEnvironment");
const { WORKSPACE_ROOT } = require("../context/WorkspaceBoundary");

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


/*
| The workspace a piece of provenance belongs to. Every run bucket remembers
| the root of ITS project; anything without one falls back to the active
| project's root and, outside any project, to the process workspace (the
| default project). Using the process WORKSPACE_ROOT for every project made
| absolute paths of a project rooted elsewhere disappear and compared every
| project's changes with the wrong Git repository (audit F-017).
*/
function activeProjectRoot() {

    try {

        const { effectiveProject } = require("./ProjectOverride");

        const project = effectiveProject();

        return (project && (project.workspaceRoot || project.rootPath)) || WORKSPACE_ROOT;

    } catch {

        return WORKSPACE_ROOT;
    }
}


function normalisePath(value, root = WORKSPACE_ROOT) {

    if (typeof value !== "string") {
        return null;
    }

    const absolute =
        nodePath.isAbsolute(value)
            ? nodePath.relative(root, value)
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


function gitStatusMap(root = WORKSPACE_ROOT) {

    try {

        const output =
            execFileSync(
                "git",
                ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                {
                    cwd: root,
                    env: childEnvironment.build({ GIT_TERMINAL_PROMPT: "0" }),
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
            const first = normalisePath(record.slice(3), root);

            if (first) {
                status.set(first, code);
            }

            if (/^[RC]/.test(code) && records[index + 1]) {

                const second = normalisePath(records[++index], root);

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


function rememberChangedPath(value, target = STATE) {

    const path = normalisePath(value, target.root || WORKSPACE_ROOT);

    if (path) {
        target.changed_files.add(path);
    }
}


function recordMutation(name, args, target = STATE) {

    if (name === "fs_move") {
        rememberChangedPath(args?.source, target);
        rememberChangedPath(args?.destination, target);
        return;
    }

    if (["fs_write", "fs_edit", "fs_mkdir", "fs_delete"].includes(name)) {
        rememberChangedPath(args?.path, target);
        return;
    }

    if (["terminal_exec", "process_start", "process_write"].includes(name)) {
        target.change_tracking_complete = false;
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
            /* set from the first call / reset of the run: its project's workspace */
            root: null,
            total_calls: 0,
            total_failures: 0,
            per_tool: new Map(),
            recent: [],
            changed_files: new Set(),
            baseline_git: new Map(),
            change_tracking_complete: true
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
    project_root,
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
        recordMutation(name, args || {}, STATE);
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

        /* the tool context is authoritative for where this run works */
        if (project_root) {
            bucket.root = project_root;
        }

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

        if (success) {
            recordMutation(name, args || {}, bucket);
        }

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


function changedFiles(runId) {

    const bucket = runId ? RUN_BUCKETS.get(runId) : null;
    const changed = new Set(bucket ? bucket.changed_files : STATE.changed_files);
    const baseline = bucket ? bucket.baseline_git : STATE.baseline_git;
    const current = gitStatusMap((bucket && bucket.root) || activeProjectRoot());

    for (const [file, code] of current) {

        /* Runtime-owned plan, archive, memory and session files are not
           project deliverables and never belong in an automatic commit. */
        if (file === ".agent" || file.startsWith(".agent/")) {
            continue;
        }

        if (
            !baseline.has(file) ||
            baseline.get(file) !== code
        ) {
            changed.add(file);
        }
    }

    return [...changed].sort();
}


function dirtyFiles(runId) {

    /* runId is accepted so hook callers can use one provenance API; dirty
       files are the live repository view and do not depend on the bucket. */
    const bucket = runId ? RUN_BUCKETS.get(runId) : null;
    return [...gitStatusMap((bucket && bucket.root) || activeProjectRoot()).keys()]
        .filter(file => file !== ".agent" && !file.startsWith(".agent/"))
        .sort();
}


function changeTrackingComplete(runId) {
    const bucket = runId ? RUN_BUCKETS.get(runId) : null;
    return bucket ? bucket.change_tracking_complete : STATE.change_tracking_complete;
}


/*
| What the server is carrying while these tools run (roadmap P1-07): CPU,
| memory, the console's own footprint and the runs in flight or waiting.
| No process command lines: they can carry anything the agent typed.
*/
function systemFigures() {

    try {

        const sample = require("./SystemResources").snapshot();
        const mb = bytes => Math.round(bytes / (1024 * 1024));

        return {
            cpu_cores: sample.cpu.cores,
            cpu_percent: sample.cpu.percent,
            load: sample.cpu.load,
            memory_total_mb: mb(sample.memory.total_bytes),
            memory_available_mb: mb(sample.memory.available_bytes),
            console_rss_mb: mb(sample.memory.process_rss_bytes),
            console_heap_mb: mb(sample.memory.process_heap_bytes),
            runs: sample.runs,
            background_processes: sample.processes.length,
            warnings: sample.warnings.map(item => item.message)
        };

    } catch {
        return null;
    }
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
        tools: perTool,
        system: systemFigures()
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
function reset(runId, root) {

    if (runId) {

        RUN_BUCKETS.delete(runId);
        const bucket = bucketFor(runId);
        bucket.root = root || activeProjectRoot();
        bucket.baseline_git = gitStatusMap(bucket.root);
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
