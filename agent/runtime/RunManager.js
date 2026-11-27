/*
|--------------------------------------------------------------------------
| Run Manager
|--------------------------------------------------------------------------
|
| Owns the lifecycle of runs: it creates their AgentRunContext, tracks
| which are active, runs each one inside its own async scope, and lets a
| caller finish or cancel a specific run by id.
|
| Isolation comes from two async-local scopes entered together per run:
|
| - this module's store carries { run: ctx }, so the engine's
|   currentRun() resolves to the calling run's context wherever the
|   flow awaits (model requests, tool calls, deadline timers);
|
| - the events module's scope carries the correlation envelope
|   (run_id, project_id, ...), so concurrent runs can never swap each
|   other's event attribution through the process-global context.
|
| In legacy mode this machinery is never entered: runAgent keeps its
| historical body and currentRun() falls back to the global RUN.
|--------------------------------------------------------------------------
*/

const { AsyncLocalStorage } = require("async_hooks");

const AgentRunContext = require("./AgentRunContext");
const events = require("../events");
const settings = require("../config");


const runScope = new AsyncLocalStorage();


class RunManager {

    constructor() {

        this.active = new Map();

        /* created and waiting for scheduler admission */
        this.queued = new Map();

        this.finished = new Map();

        /* Ids handed out by createRun, including runs that have not
           entered execute yet. Two Promise.all callers create both
           contexts in the same millisecond; without this set they
           would share a run id and mix their events. */
        this.issued = new Set();

    }


    /* The run context of the current async chain, or null outside any
       run scope (legacy mode, request handlers, startup). */
    current() {

        const store = runScope.getStore();

        return store ? store.run : null;

    }


    get(runId) {

        return (
            this.active.get(runId) ||
            this.queued.get(runId) ||
            this.finished.get(runId) ||
            null
        );

    }


    queuedRuns() {

        return [...this.queued.values()];

    }


    /* A run that exists (has an id) but is waiting for scheduler admission.
       Tracking it separately from `active` is what makes it addressable by
       id and cancellable before it ever starts. */
    enqueue(context) {

        context.status = "queued";

        this.queued.set(context.runId, context);
    }


    /* The run will never execute (queue full, cancelled while queued,
       rejected by the scheduler): settle its bookkeeping exactly once so no
       id, context or queue entry stays behind. */
    abandon(context, error) {

        if (!this.queued.delete(context.runId)) {
            return;
        }

        context.status =
            context.cancellation.isCancelled ||
            (error && error.code === "RUN_CANCELLED")
                ? "cancelled"
                : "failed";

        context.finishedAt = Date.now();

        this.finished.set(context.runId, context);

        this.trimFinished();
    }


    trimFinished() {

        while (
            this.finished.size >
            settings.get("RUN_HISTORY_LIMIT")
        ) {

            const oldest = this.finished.keys().next().value;

            this.finished.delete(oldest);
            this.issued.delete(oldest);
        }
    }


    activeRuns() {

        return [...this.active.values()];

    }


    /* The legacy run id format; a suffix keeps ids unique when two runs
       begin within the same millisecond. */
    issueRunId() {

        const base =
            `run-${new Date(Date.now()).toISOString()
                .replace(/[:.]/g, "-")}`;

        let candidate = base;

        let collision = 0;

        while (
            this.issued.has(candidate) ||
            this.active.has(candidate) ||
            this.finished.has(candidate)
        ) {

            collision++;

            candidate = `${base}-r${collision}`;

        }

        this.issued.add(candidate);

        return candidate;

    }


    createRun({
        task = "",
        parentRunId = null,
        project = null,
        turnId = null,
        messages = [],
        reasoningEffort = null,
        planMode = false,
        goal = null,
        maxCostUsd = null
    } = {}) {

        const context =

            new AgentRunContext({
                runId: this.issueRunId(),
                project,
                task,
                parentRunId,
                turnId,
                messages,
                reasoningEffort,
                planMode,
                goal,
                maxCostUsd
            });

        return context;

    }


    /* Runs fn inside both async scopes, tracks the run for its whole
       lifetime, and settles its bookkeeping exactly once. */
    async execute(context, fn) {

        this.queued.delete(context.runId);

        this.active.set(context.runId, context);

        context.status = "running";

        try {

            return await runScope.run(

                { run: context },

                () => events.runWithScope(
                    {
                        run_id: context.runId,
                        project_id: context.projectId
                    },
                    () => fn(context)
                )

            );

        } catch (error) {

            context.status =
                context.cancellation.isCancelled
                    ? "cancelled"
                    : "failed";

            throw error;

        } finally {

            context.finishedAt = Date.now();

            if (context.status === "running") {

                context.status =
                    context.cancellation.isCancelled
                        ? "cancelled"
                        : "completed";

            }

            this.active.delete(context.runId);

            this.finished.set(context.runId, context);

            /* Kept finished runs let a caller ask "what became of run
               X?" shortly after it settled, without growing memory for
               the process lifetime. */
            this.trimFinished();

        }

    }

}


/* One manager per process: the engine module and anything it hands the
   runtime to must agree on which runs exist. */
const runManager = new RunManager();


module.exports = {
    RunManager,
    runManager
};
