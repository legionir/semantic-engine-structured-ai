"use strict";

/*
|--------------------------------------------------------------------------
| System resources (roadmap P1-07)
|--------------------------------------------------------------------------
|
| What a small VPS operator needs to see before a sixth project tips the
| server over: CPU (cores, load, the busy share since the last sample),
| memory (total, available, this process), the free space where the data
| home and the workspace live, how many runs are active or waiting for a
| slot, and the processes the agent started.
|
| The monitor samples on RESOURCE_MONITOR_INTERVAL_MS and emits
| system:resources only when a warning appears or clears, so the global
| log says "memory is low" once, not every thirty seconds.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const os = require("os");
const path = require("path");

const settings = require("../config");


function megabytes(bytes) {
    return Math.round(bytes / (1024 * 1024));
}


/*
| The busy share of every core since the previous call. The first call
| compares against the boot counters, which is the long-run average.
*/
let previousCpu = null;

function cpuTimes() {

    let idle = 0;
    let total = 0;

    for (const cpu of os.cpus()) {

        for (const [kind, value] of Object.entries(cpu.times)) {

            total += value;

            if (kind === "idle") {
                idle += value;
            }
        }
    }

    return { idle, total };
}


function cpuPercent() {

    const now = cpuTimes();
    const before = previousCpu || { idle: 0, total: 0 };

    previousCpu = now;

    const total = now.total - before.total;
    const idle = now.idle - before.idle;

    if (total <= 0) {
        return null;
    }

    return Math.max(0, Math.min(100, Math.round(((total - idle) / total) * 1000) / 10));
}


/* Linux counts page cache as used; MemAvailable is what can really be had */
function availableMemory() {

    if (process.platform === "linux") {

        try {

            const text = fs.readFileSync("/proc/meminfo", "utf8");
            const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(text);

            if (match) {
                return Number(match[1]) * 1024;
            }

        } catch {
            /* fall back to os.freemem */
        }
    }

    return os.freemem();
}


function diskOf(target, label) {

    let probe = path.resolve(target);

    /* statfs needs an existing path: walk up to the nearest one */
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) {
        probe = path.dirname(probe);
    }

    try {

        const stats = fs.statfsSync(probe);
        const total = stats.blocks * stats.bsize;
        const free = stats.bavail * stats.bsize;

        return {
            label,
            path: path.resolve(target),
            total_bytes: total,
            free_bytes: free,
            used_percent: total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : null
        };

    } catch (error) {

        return { label, path: path.resolve(target), error: error.code || error.message };
    }
}


function dataHome() {

    try {
        return require("../projects/ProjectStore").resolveDataHome();
    } catch {
        return null;
    }
}


function workspaceRoot() {

    try {
        return require("../context/WorkspaceBoundary").WORKSPACE_ROOT;
    } catch {
        return process.cwd();
    }
}


function disks(extra = []) {

    const seen = new Map();

    for (const [label, target] of [["data home", dataHome()], ["workspace", workspaceRoot()], ...extra]) {

        if (!target) {
            continue;
        }

        const disk = diskOf(target, label);

        /* two folders on one filesystem are one disk */
        const key = disk.error ? `${label}:${disk.path}` : `${disk.total_bytes}:${disk.free_bytes}`;

        if (seen.has(key)) {
            seen.get(key).label += `, ${label}`;
            continue;
        }

        seen.set(key, disk);
    }

    return [...seen.values()];
}


function processes() {

    try {

        const { SESSIONS } = require("../tools/process/ProcessManager");
        const { runManager } = require("./RunManager");

        const active = new Set(runManager.activeRuns().map(run => run.runId || run.id));

        return [...SESSIONS.values()]
            .filter(session => session.status === "running")
            .map(session => ({
                id: session.id,
                pid: session.pid,
                command: String(session.command || "").slice(0, 200),
                project_id: session.project_id || null,
                run_id: session.run_id || null,
                run_active: Boolean(session.run_id && active.has(session.run_id)),
                started_at: session.started_at
            }));

    } catch {
        return [];
    }
}


function runs() {

    try {

        const { runScheduler } = require("./RunScheduler");
        const scheduler = runScheduler.snapshot();
        const queued = Object.values(scheduler.queues).reduce((sum, count) => sum + count, 0);

        return {
            active: scheduler.total_inflight,
            active_projects: scheduler.active_projects,
            queued,
            max_concurrent_projects: settings.get("MAX_CONCURRENT_PROJECT_RUNS"),
            max_runs_per_project: settings.get("MAX_RUNS_PER_PROJECT"),
            max_total: settings.get("MAX_WORKERS_PER_USER")
        };

    } catch {
        return null;
    }
}


function warningsFor(sample) {

    const warnings = [];
    const minMemory = settings.get("RESOURCE_MIN_FREE_MEMORY_MB");
    const minDisk = settings.get("RESOURCE_MIN_FREE_DISK_MB");

    if (minMemory > 0 && megabytes(sample.memory.available_bytes) < minMemory) {

        warnings.push({
            kind: "memory",
            message:
                `Memory is low: ${megabytes(sample.memory.available_bytes)} MB available ` +
                `(RESOURCE_MIN_FREE_MEMORY_MB=${minMemory}).`
        });
    }

    for (const disk of sample.disks) {

        if (minDisk > 0 && Number.isFinite(disk.free_bytes) && megabytes(disk.free_bytes) < minDisk) {

            warnings.push({
                kind: "disk",
                path: disk.path,
                message:
                    `Disk space is low for the ${disk.label}: ${megabytes(disk.free_bytes)} MB free ` +
                    `(RESOURCE_MIN_FREE_DISK_MB=${minDisk}).`
            });
        }
    }

    return warnings;
}


function snapshot(options = {}) {

    const memoryUsage = process.memoryUsage();
    const total = os.totalmem();
    const available = availableMemory();

    const result = {
        at: new Date().toISOString(),
        platform: `${process.platform} ${os.release()}`,
        node: process.version,
        uptime_ms: Math.round(process.uptime() * 1000),
        cpu: {
            cores: os.cpus().length,
            load: os.loadavg().map(value => Math.round(value * 100) / 100),
            percent: cpuPercent()
        },
        memory: {
            total_bytes: total,
            available_bytes: available,
            used_percent: total > 0 ? Math.round(((total - available) / total) * 1000) / 10 : null,
            process_rss_bytes: memoryUsage.rss,
            process_heap_bytes: memoryUsage.heapUsed
        },
        disks: disks(options.extraDisks || []),
        runs: runs(),
        processes: processes()
    };

    result.warnings = warningsFor(result);

    return result;
}


/*
| The monitor: one timer, unref'd so it never keeps the process alive.
| `emit` receives (type, payload) on every change of the warning set.
*/
function startMonitor(emit) {

    let active = new Map();
    let timer = null;

    const tick = () => {

        let current;

        try {
            current = snapshot();
        } catch {
            return;
        }

        const now = new Map(current.warnings.map(item => [`${item.kind}:${item.path || ""}`, item]));

        for (const [key, warning] of now) {

            if (!active.has(key)) {

                emit("system:resources", {
                    level: "warning",
                    kind: warning.kind,
                    path: warning.path || null,
                    message: warning.message,
                    memory_available_mb: megabytes(current.memory.available_bytes),
                    cpu_percent: current.cpu.percent
                });
            }
        }

        for (const [key, warning] of active) {

            if (!now.has(key)) {

                emit("system:resources", {
                    level: "ok",
                    kind: warning.kind,
                    path: warning.path || null,
                    message: `${warning.kind === "memory" ? "Memory" : "Disk space"} is back above the limit.`,
                    memory_available_mb: megabytes(current.memory.available_bytes),
                    cpu_percent: current.cpu.percent
                });
            }
        }

        active = now;
    };

    const schedule = () => {

        const interval = settings.get("RESOURCE_MONITOR_INTERVAL_MS");

        if (!(interval > 0)) {
            timer = null;
            return;
        }

        timer = setTimeout(() => {
            tick();
            schedule();
        }, interval);

        if (typeof timer.unref === "function") {
            timer.unref();
        }
    };

    tick();
    schedule();

    return {
        tick,
        stop() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        }
    };
}


module.exports = {
    snapshot,
    warningsFor,
    startMonitor,
    diskOf
};
