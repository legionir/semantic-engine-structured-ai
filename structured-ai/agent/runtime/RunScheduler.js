"use strict";

const settings = require("../lib/storage");


/*
|--------------------------------------------------------------------------
| Run Scheduler (EXECUTION_PLAN Phase 10 گام ۱)
|--------------------------------------------------------------------------
|
| Fair admission of project-scoped modular runs:
|
|   - distinct projects run in parallel up to MAX_CONCURRENT_PROJECT_RUNS
|   - one project is capped at MAX_RUNS_PER_PROJECT (default 1 = serialize)
|   - total inflight runs cap at MAX_WORKERS_PER_USER
|   - overflow goes on a per-project queue (round-robin dispatch)
|   - a full queue rejects immediately (RUN_QUEUE_FULL) instead of hanging
|
| Disabled unless both RUN_CONTEXT_MODE and PROJECT_CONTEXT_MODE are
| modular, and bypassed when a run has no projectId — so Phase 3's
| unscoped concurrent-run tests keep their historical interleaving.
|--------------------------------------------------------------------------
*/

function schedulerEnabled() {

    return (
        settings.get("RUN_CONTEXT_MODE") === "modular" &&
        settings.get("PROJECT_CONTEXT_MODE") === "modular"
    );
}


class RunScheduler {

    constructor() {

        this.inflight = new Map();
        this.queues = new Map();
        this.rrCursor = 0;
        this.dispatching = false;
    }


    keyOf(projectId) {

        return projectId || null;
    }


    inflightCount(key) {

        return this.inflight.get(key) || 0;
    }


    queueOf(key) {

        if (!this.queues.has(key)) {
            this.queues.set(key, []);
        }

        return this.queues.get(key);
    }


    distinctActiveProjects() {

        let count = 0;

        for (const [key, n] of this.inflight) {

            if (key && n > 0) {
                count++;
            }
        }

        return count;
    }


    totalInflight() {

        let total = 0;

        for (const n of this.inflight.values()) {
            total += n;
        }

        return total;
    }


    memoryExceeded(key) {

        const memoryLimit = settings.get("PROJECT_MEMORY_LIMIT");

        return (
            memoryLimit > 0 &&
            typeof this.memoryFor === "function" &&
            this.memoryFor(key) >= memoryLimit
        );
    }


    canStart(key) {

        const perProject = settings.get("MAX_RUNS_PER_PROJECT");
        const concurrentProjects = settings.get("MAX_CONCURRENT_PROJECT_RUNS");
        const workers = settings.get("MAX_WORKERS_PER_USER");

        if (this.totalInflight() >= workers) {
            return false;
        }

        const mine = this.inflightCount(key);

        if (mine >= perProject) {
            return false;
        }

        if (mine === 0 && this.distinctActiveProjects() >= concurrentProjects) {
            return false;
        }

        if (this.memoryExceeded(key)) {
            return false;
        }

        return true;
    }


    admit(projectId) {

        if (!schedulerEnabled() || !projectId) {
            return "start";
        }

        const key = this.keyOf(projectId);

        if (this.memoryExceeded(key)) {
            return "reject";
        }

        if (this.canStart(key)) {
            return "start";
        }

        if (this.queueOf(key).length >= settings.get("RUN_QUEUE_LIMIT")) {
            return "reject";
        }

        return "queue";
    }


    async schedule(projectId, fn) {

        if (!schedulerEnabled() || !projectId) {
            return fn();
        }

        const key = this.keyOf(projectId);

        if (this.memoryExceeded(key)) {

            const limit = settings.get("PROJECT_MEMORY_LIMIT");
            const error = new Error(
                `Project ${projectId} is over PROJECT_MEMORY_LIMIT (${limit})`
            );

            error.code = "PROJECT_MEMORY_LIMIT";
            error.status = 429;
            error.project_id = projectId;
            throw error;
        }

        return new Promise((resolve, reject) => {

            const job = { fn, resolve, reject, projectId, enqueuedAt: Date.now() };

            if (this.canStart(key)) {

                this.start(key, job);
                return;
            }

            const queue = this.queueOf(key);
            const limit = settings.get("RUN_QUEUE_LIMIT");

            if (queue.length >= limit) {

                const error = new Error(
                    `Run queue for project ${projectId} is full ` +
                    `(RUN_QUEUE_LIMIT=${limit})`
                );

                error.code = "RUN_QUEUE_FULL";
                error.status = 429;
                error.project_id = projectId;
                reject(error);
                return;
            }

            queue.push(job);
        });
    }


    start(key, job) {

        this.inflight.set(key, this.inflightCount(key) + 1);

        Promise.resolve()
            .then(() => job.fn())
            .then(job.resolve, job.reject)
            .finally(() => {

                const next = this.inflightCount(key) - 1;

                if (next <= 0) {
                    this.inflight.delete(key);
                } else {
                    this.inflight.set(key, next);
                }

                this.dispatch();
            });
    }


    dispatch() {

        if (this.dispatching) {
            return;
        }

        this.dispatching = true;

        try {

            for (;;) {

                const keys = [...this.queues.keys()].filter(
                    key => this.queueOf(key).length > 0
                );

                if (keys.length === 0) {
                    return;
                }

                let started = 0;

                for (let offset = 0; offset < keys.length; offset++) {

                    const index = (this.rrCursor + offset) % keys.length;
                    const key = keys[index];

                    if (!this.canStart(key)) {
                        continue;
                    }

                    const job = this.queueOf(key).shift();

                    if (!job) {
                        continue;
                    }

                    this.start(key, job);
                    this.rrCursor = (index + 1) % keys.length;
                    started++;
                    break;
                }

                if (started === 0) {
                    return;
                }
            }

        } finally {

            this.dispatching = false;
        }
    }


    cancelQueued(projectId, reason) {

        const key = this.keyOf(projectId);

        if (!key || !this.queues.has(key)) {
            return 0;
        }

        const pending = this.queueOf(key).splice(0);

        for (const job of pending) {

            const error = new Error(
                reason || `queued run for project ${projectId} was cancelled`
            );

            error.code = "RUN_CANCELLED";
            error.status = 409;
            error.project_id = projectId;
            job.reject(error);
        }

        return pending.length;
    }


    snapshot() {

        const queues = {};

        for (const [key, list] of this.queues) {

            if (list.length > 0) {
                queues[key] = list.length;
            }
        }

        const inflight = {};

        for (const [key, n] of this.inflight) {

            if (n > 0) {
                inflight[key] = n;
            }
        }

        return {
            enabled: schedulerEnabled(),
            inflight,
            queues,
            total_inflight: this.totalInflight(),
            active_projects: this.distinctActiveProjects()
        };
    }


    reset() {

        for (const list of this.queues.values()) {

            for (const job of list) {

                const error = new Error("scheduler reset");
                error.code = "RUN_CANCELLED";
                job.reject(error);
            }
        }

        this.inflight.clear();
        this.queues.clear();
        this.rrCursor = 0;
        this.dispatching = false;
    }
}


const runScheduler = new RunScheduler();


module.exports = {
    RunScheduler,
    runScheduler,
    schedulerEnabled
};
