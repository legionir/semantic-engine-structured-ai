"use strict";

const events = require("../lib/events");
const settings = require("../lib/storage");


/*
|--------------------------------------------------------------------------
| Observability (EXECUTION_PLAN Phase 10 گام ۲)
|--------------------------------------------------------------------------
|
| Process-wide counters split into per-project series and a gateway
| rollup. One project's crash/degraded flag never flips the gateway to
| "down"; the gateway is "degraded" at most.
|--------------------------------------------------------------------------
*/

function emptyProject() {

    return {
        project_runs_total: 0,
        project_active_runs: 0,
        project_failed_runs: 0,
        project_tool_calls_total: 0,
        project_index_state: "unknown",
        project_last_activity: null,
        project_memory_bytes: 0,
        project_process_count: 0,
        project_mcp_calls_total: 0,
        project_mcp_errors_total: 0,
        last_error: null,
        crashed: false
    };
}


class Observability {

    constructor() {

        this.projects = new Map();
        this.gateway = {
            gateway_projects_total: 0,
            gateway_active_runs: 0,
            gateway_failed_runs: 0,
            gateway_memory_bytes: 0,
            gateway_tool_calls_total: 0,
            gateway_mcp_errors_total: 0,
            gateway_mcp_calls_total: 0
        };
        this.indexInflight = 0;
        this.attached = false;
        this.startedAt = Date.now();
        this.cpuSample = process.cpuUsage();
        this.cpuSampleAt = Date.now();
    }


    bucket(projectId) {

        if (!projectId) {
            return null;
        }

        if (!this.projects.has(projectId)) {
            this.projects.set(projectId, emptyProject());
        }

        return this.projects.get(projectId);
    }


    attach() {

        if (this.attached) {
            return this;
        }

        this.attached = true;
        events.bus.on("event", event => this.observe(event));
        return this;
    }


    observe(event) {

        const projectId = event.project_id || null;
        const bucket = this.bucket(projectId);

        if (bucket) {
            bucket.project_last_activity = event.at || Date.now();
        }

        if (event.type === "run:start") {

            this.gateway.gateway_active_runs++;

            if (bucket) {
                bucket.project_runs_total++;
                bucket.project_active_runs++;
            }
        }

        if (event.type === "run:end" || event.type === "run:error") {

            this.gateway.gateway_active_runs =
                Math.max(0, this.gateway.gateway_active_runs - 1);

            const failed =
                event.type === "run:error" ||
                event.ok === false ||
                event.success === false;

            if (failed) {
                this.gateway.gateway_failed_runs++;
            }

            if (bucket) {
                bucket.project_active_runs =
                    Math.max(0, bucket.project_active_runs - 1);

                if (failed) {
                    bucket.project_failed_runs++;
                    bucket.last_error =
                        event.message ||
                        (event.error && event.error.message) ||
                        event.type;
                }
            }
        }

        if (event.type === "tool:end") {

            this.gateway.gateway_tool_calls_total++;

            if (bucket) {
                bucket.project_tool_calls_total++;
            }

            if (event.name && String(event.name).startsWith("code_index_")) {

                if (bucket) {
                    bucket.project_index_state =
                        event.success === false ? "failed" : "ready";
                }
            }
        }

        if (event.type === "mcp:result" || event.type === "mcp:call") {

            if (event.type === "mcp:result") {
                this.gateway.gateway_mcp_calls_total++;

                if (bucket) {
                    bucket.project_mcp_calls_total++;
                }

                if (event.ok === false) {
                    this.gateway.gateway_mcp_errors_total++;

                    if (bucket) {
                        bucket.project_mcp_errors_total++;
                        bucket.last_error = event.error || "mcp error";
                    }
                }
            }
        }

        if (event.type === "mcp:unavailable") {

            this.gateway.gateway_mcp_errors_total++;

            if (bucket) {
                bucket.project_mcp_errors_total++;
                bucket.last_error = event.error || "mcp unavailable";
            }
        }
    }


    recordCrash(projectId, message) {

        const bucket = this.bucket(projectId);

        if (!bucket) {
            return;
        }

        bucket.crashed = true;
        bucket.last_error = message || "simulated crash";
        bucket.project_index_state = "down";
    }


    recordMemory(projectId, bytes) {

        const bucket = this.bucket(projectId);

        if (bucket) {
            bucket.project_memory_bytes = bytes;
        }
    }


    beginIndex() {

        const limit = settings.get("MAX_CONCURRENT_INDEX_RUNS");

        if (this.indexInflight >= limit) {
            return false;
        }

        this.indexInflight++;
        return true;
    }


    endIndex() {

        this.indexInflight = Math.max(0, this.indexInflight - 1);
    }


    processCount(projectId) {

        try {

            const processTools = require("../tools/process");
            const sessions = processTools._sessions;

            if (!sessions) {
                return 0;
            }

            let count = 0;

            for (const session of sessions.values()) {

                if (session.status !== "running") {
                    continue;
                }

                if (!projectId || session.project_id === projectId) {
                    count++;
                }
            }

            return count;

        } catch {

            return 0;
        }
    }


    cpuPercent() {

        const now = Date.now();
        const elapsedMs = now - this.cpuSampleAt;

        if (elapsedMs <= 0) {
            return 0;
        }

        const usage = process.cpuUsage(this.cpuSample);
        this.cpuSample = process.cpuUsage();
        this.cpuSampleAt = now;

        const cpuMs = (usage.user + usage.system) / 1000;

        return Math.min(100, Math.round((cpuMs / elapsedMs) * 100));
    }


    projectSnapshot(projectId) {

        const bucket = this.bucket(projectId) || emptyProject();

        return {
            ...bucket,
            project_process_count: this.processCount(projectId)
        };
    }


    snapshot() {

        this.gateway.gateway_memory_bytes = process.memoryUsage().heapUsed;
        this.gateway.gateway_projects_total = this.projects.size;

        const projects = {};

        for (const id of this.projects.keys()) {
            projects[id] = this.projectSnapshot(id);
        }

        return {
            uptime_ms: Date.now() - this.startedAt,
            gateway: { ...this.gateway },
            projects,
            index_inflight: this.indexInflight,
            cpu_percent: this.cpuPercent()
        };
    }


    healthOf(projectId) {

        const bucket = this.projects.get(projectId);

        if (!bucket) {

            return {
                status: "ok",
                project_id: projectId,
                last_error: null
            };
        }

        const status =
            bucket.crashed
                ? "down"
                : bucket.last_error
                    ? "degraded"
                    : "ok";

        return {
            status,
            project_id: projectId,
            last_error: bucket.last_error,
            active_runs: bucket.project_active_runs,
            index_state: bucket.project_index_state
        };
    }


    health() {

        const projects = {};
        let down = 0;
        let degraded = 0;
        let ok = 0;

        for (const id of this.projects.keys()) {

            const item = this.healthOf(id);
            projects[id] = item;

            if (item.status === "down") {
                down++;
            } else if (item.status === "degraded") {
                degraded++;
            } else {
                ok++;
            }
        }

        /* A single crashed project never takes the gateway down. */
        const status =
            down + degraded === 0
                ? "ok"
                : "degraded";

        return {
            status,
            gateway: {
                status,
                memory_bytes: process.memoryUsage().heapUsed,
                active_runs: this.gateway.gateway_active_runs
            },
            counts: { ok, degraded, down },
            projects
        };
    }


    reset() {

        this.projects.clear();
        this.gateway.gateway_projects_total = 0;
        this.gateway.gateway_active_runs = 0;
        this.gateway.gateway_failed_runs = 0;
        this.gateway.gateway_tool_calls_total = 0;
        this.gateway.gateway_mcp_errors_total = 0;
        this.gateway.gateway_mcp_calls_total = 0;
        this.indexInflight = 0;
    }
}


const observability = new Observability();


module.exports = {
    Observability,
    observability
};
