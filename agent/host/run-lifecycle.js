"use strict";

/*
|--------------------------------------------------------------------------
| Run lifecycle
|--------------------------------------------------------------------------
|
| The legacy global run, the per-run context lookup, starting a run with
| a clean slate, deadlines and cancelling one or all runs.
|
| Part of the runtime's composition root (agent/agent.js): the factory reads
| what it needs from `host`, which agent.js and the earlier factories have
| filled in, and returns what the rest of the runtime uses.
*/

const toolRuntime = require("../tools");
const events = require("../events");
const settings = require("../config");


module.exports = function createRunLifecycle(host) {

    const {
        AGENT_BUDGET,
        AgentRunContext,
        runElapsedMs,
        runManager,
        runScheduler
    } = host;

    /*
    |--------------------------------------------------------------------------
    | Run Deadline and Cancellation
    |--------------------------------------------------------------------------
    |
    | A run is bounded by wall-clock time, not only by iteration counts: a
    | delegation tree of slow agents could otherwise spin for hours. Every
    | model request, tool call, and sub-agent observes the same deadline, and
    | an interrupt cancels all of them at once.
    |--------------------------------------------------------------------------
    */

    const RUN = {
        id: null,
        started_at: 0,
        controller: null,
        cancelled_reason: null,
        inHook: false,
        hook_phase: null,
        hook_started_at: 0,
        hook_deadline_at: null,
        hook_results: {},
        /*
        | The run-scoped verdict of a hook that failed with on_failure: stop.
        | Later phases short-circuit on it, so it belongs to the run, not to
        | the process: startRun() clears it exactly like hook_results, and the
        | hooks lifecycle suite locks that contract.
        */
        hooks_stopped: null,
        hooks_stopped_by: null,
        after_hooks_ran: false,
        main_agent_definition: null,
        task: "",
        turnCounter: 0,
        /*
        | The ProjectContext this run is scoped to (Phase 2). Null in legacy
        | mode: nothing downstream may branch on it yet — consumers arrive
        | with the project-aware tool runtime in Phase 4.
        */
        project: null
    };


    /*
    | The compat accessors of EXECUTION_PLAN Phase 3: every read/write the
    | engine used to aim at the global RUN and AGENT_BUDGET goes through
    | these. In legacy mode (and anywhere outside a run's async scope) they
    | resolve to the same globals as before, so behavior is unchanged; in
    | modular mode each run's async chain resolves to its own
    | AgentRunContext, which is what lets two runs share a process without
    | sharing messages, budgets or cancellation.
    */

    function currentRun() {

        return runManager.current() || RUN;

    }


    function currentAgentBudget() {

        const context = runManager.current();

        return context ? context.agentBudget : AGENT_BUDGET;

    }


    function startRun() {

        currentRun().started_at = Date.now();

        /*
        | Archived records outlive the process, so they carry the run they
        | came from; without it a later search cannot tell yesterday's
        | failure from this morning's.
        */

        /*
        | A modular run keeps the id the RunManager issued when its context
        | was created, so the run is addressable before startRun; the legacy
        | global RUN always regenerates its id from the fresh start
        | timestamp, exactly as it historically does.
        */

        if (
            !(currentRun() instanceof AgentRunContext) ||
            !currentRun().id
        ) {

            currentRun().id =
                `run-${new Date(currentRun().started_at).toISOString()
                    .replace(/[:.]/g, "-")}`;

        }

        /* Every event emitted from now on carries this run_id in its
           correlation envelope, so the journal, session and archive can
           attribute events to the same run. */
        events.setContext({ run_id: currentRun().id });

        /* P0-7: a cancel that arrived before this point is kept, with its
           reason; attaching the controller aborts it immediately. */
        const cancelledEarly =
            Boolean(
                currentRun().cancellation &&
                currentRun().cancellation.requested
            );

        const earlyReason =
            cancelledEarly
                ? currentRun().cancelled_reason
                : null;

        currentRun().controller = new AbortController();
        currentRun().cancelled_reason = earlyReason;
        currentRun().inHook = false;
        currentRun().hook_phase = null;
        currentRun().hook_started_at = 0;
        currentRun().hook_deadline_at = null;
        currentRun().hook_results = {};
        currentRun().hooks_stopped = null;
        currentRun().hooks_stopped_by = null;
        currentRun().after_hooks_ran = false;
        currentRun().main_agent_definition = null;
        currentRun().task = "";
        currentRun().turnCounter = 0;
        currentRun().project = null;

        /*
        | Whatever belongs to a single run is cleared here, so every entry
        | point gets the same clean slate, not only runAgent.
        */

        /* A modular run resets only its own tool scope (search sessions,
           telemetry buckets); the legacy start resets process-wide state
           exactly as it always has. */
        currentRun().carried =
            toolRuntime.startRunScope(
                currentRun() instanceof AgentRunContext
                    ? currentRun().id
                    : undefined
            );

        return currentRun().carried;
    }


    /*
    | The deadline is derived, never stored, so raising or lowering the
    | budget from the console moves it for a run that is already going.
    */

    function runDeadlineAt() {

        if (currentRun().inHook && currentRun().hook_deadline_at) {
            return currentRun().hook_deadline_at;
        }

        if (!currentRun().started_at) {
            return null;
        }

        return (
            currentRun().started_at +
            settings.get("MAX_RUN_MS")
        );
    }


    function cancelRun(reason) {

        if (
            !currentRun().controller ||
            currentRun().controller.signal.aborted
        ) {
            return;
        }

        currentRun().cancelled_reason = reason;

        if (reason === "deadline") {

            events.emit("run:deadline", {
                agent: "main_agent",
                max_run_ms: settings.get("MAX_RUN_MS"),
                elapsed_ms: runElapsedMs()
            });
        }

        currentRun().controller.abort();
    }


    /*
    | Cancellation is addressable by run id. A
    | caller that holds no async scope of the run — a web cancel endpoint,
    | a test — names the run instead of whichever run happens to be current
    | process-wide. Awaiting the run's promise still reports the failure to
    | its own caller; every other run keeps going. Returns false when no
    | tracked run has that id.
    */
    function cancelRunById(runId, reason) {

        const context = runManager.get(runId);

        if (!context) {
            return false;
        }

        /* A run that is still waiting for admission has no controller yet: it
           is cancelled by removing it from the scheduler queue, and the caller
           of runAgent() gets RUN_CANCELLED. */
        if (context.status === "queued") {

            context.cancelled_reason = reason;

            context.cancellation.abort();

            return runScheduler.cancelQueuedRun(runId, reason) || true;
        }

        /*
        | P0-7: a run that is running but whose startRun has not attached its
        | controller yet keeps the cancel (RunCancellation remembers it and
        | aborts the controller attached next). Only an already-aborted run
        | is left alone.
        */
        if (
            context.controller &&
            context.controller.signal.aborted
        ) {
            return true;
        }

        context.cancelled_reason = reason;

        if (reason === "deadline") {

            events.emit("run:deadline", {
                run_id: context.runId,
                project_id: context.projectId,
                agent: "main_agent",
                max_run_ms: settings.get("MAX_RUN_MS"),
                elapsed_ms:
                    context.started_at
                        ? Date.now() - context.started_at
                        : 0
            });
        }

        context.cancellation.abort();

        return true;
    }


    /*
    | Signals must reach EVERY run: the legacy/global current run and each
    | modular run, active or still queued. `cancelRun` alone only touched
    | whichever run was current in the signal handler's (empty) scope.
    */
    function cancelAllRuns(reason) {

        cancelRun(reason);

        for (const context of [...runManager.activeRuns(), ...runManager.queuedRuns()]) {

            cancelRunById(context.runId, reason);
        }
    }


    return {
        cancelAllRuns,
        cancelRun,
        cancelRunById,
        currentAgentBudget,
        currentRun,
        runDeadlineAt,
        startRun
    };
};
