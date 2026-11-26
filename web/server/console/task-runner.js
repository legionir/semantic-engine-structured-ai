"use strict";

/*
|--------------------------------------------------------------------------
| Task runner
|--------------------------------------------------------------------------
|
| Starting a task in the default workspace or in a project slot, and the
| background runs that keep one project's run off the shared state.
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
|
*/


module.exports = function createTaskRunner(shared) {

    const {
        addMessage,
        approvalStore,
        recordGitReport,
        resolveApproval,
        runtime,
        saveSession,
        state
    } = shared;

    /*
    | runOptions (EXECUTION_PLAN Phase 7 گام ۲): when the caller names a
    | projectId the run is resolved against the project registry and the
    | whole run is scoped to that project (the project context is resolved before accepting). Legacy callers pass nothing
    | and the historical single-run behaviour is untouched.
    */
    /*
    | The plan lives in the run's PROJECT data root. Outside the run (before it
    | starts and in the finally block that decides on auto-continue) there is no
    | run context, so plan lookups must be made inside that project's frame;
    | otherwise a project run is judged by the default project's plan and never
    | continues (or continues on the wrong plan).
    */
    function inRunProject(runOptions, fn) {

        if (
            !runOptions.projectId ||
            typeof runtime.runWithProject !== "function" ||
            typeof runtime.resolveRunProjectContext !== "function"
        ) {
            return fn();
        }

        const context =
            runtime.resolveRunProjectContext({ projectId: runOptions.projectId });

        return runtime.runWithProject(context, fn);
    }


    /*
    | Per-project run slots (plan phase 7 / step 3). The console has ONE
    | foreground conversation (`state`), but that must not serialise the
    | whole process: a run for project B may start while project A's run is in
    | progress. Rules:
    |   - a project with a run in progress refuses another (409) - the
    |     "same project" policy, on top of the scheduler's MAX_RUNS_PER_PROJECT;
    |   - a run for another project starts at once and, when the foreground is
    |     busy, runs in the BACKGROUND (own slot, no clobbering of `state`);
    |   - a run with no project keeps the historical single-run gate.
    */
    const projectSlots = new Map();

    function projectSlotBusy(projectId) {

        const slot = projectSlots.get(projectId);

        return Boolean(slot && slot.status === "running");
    }

    function slotView(projectId) {

        const slot = projectSlots.get(projectId);

        if (!slot) {
            return { project_id: projectId, status: "idle" };
        }

        return {
            project_id: projectId,
            status: slot.status,
            task: slot.task,
            answer: slot.answer,
            error: slot.error,
            started_at: slot.startedAt,
            finished_at: slot.finishedAt,
            background: slot.background
        };
    }


    async function startBackgroundRun(task, runOptions) {

        const projectId = runOptions.projectId;

        const slot = {
            projectId,
            status: "running",
            task,
            answer: null,
            error: null,
            startedAt: Date.now(),
            finishedAt: null,
            background: true,
            history: []
        };

        projectSlots.set(projectId, slot);

        try {

            const action =
                await runtime.runAgent({
                    task,
                    history: slot.history,
                    projectId,
                    ...(runOptions.reasoningEffort ? { reasoning_effort: runOptions.reasoningEffort } : {})
                });

            slot.answer = action.response ? action.response.content : null;
            slot.error = action.error || null;
            slot.status = action.error ? "failed" : "done";

        } catch (error) {

            const cancelled =
                error.code === "RUN_CANCELLED" || /cancel/i.test(error.message);

            slot.error = {
                code: cancelled ? "CANCELLED" : error.name || "RUNTIME_ERROR",
                message: error.message,
                retryable: false
            };

            slot.status = cancelled ? "cancelled" : "failed";

            if (!error.runTerminalEmitted) {

                runtime.events.emit("run:error", {
                    project_id: projectId,
                    message: error.message,
                    cancelled
                });
            }

        } finally {

            slot.finishedAt = Date.now();
        }
    }


    async function startTask(task, runOptions = {}) {

        if (runOptions.projectId) {

            if (projectSlotBusy(runOptions.projectId)) {

                throw Object.assign(
                    new Error(`project ${runOptions.projectId} already has a run in progress`),
                    { status: 409 }
                );
            }

            /* the foreground is taken (by another project or the default
               project): run in the background instead of refusing */
            if (state.status === "running") {

                return startBackgroundRun(task, runOptions);
            }

        } else if (state.status === "running") {

            throw Object.assign(
                new Error("a task is already running"),
                { status: 409 }
            );
        }

        state.status = "running";
        state.stopRequested = false;
        state.projectId = runOptions.projectId || null;

        if (runOptions.projectId) {

            projectSlots.set(runOptions.projectId, {
                projectId: runOptions.projectId,
                status: "running",
                task,
                answer: null,
                error: null,
                startedAt: Date.now(),
                finishedAt: null,
                background: false
            });
        }

        if (state.lastPlanSignature === null) {

            const before =
                inRunProject(runOptions, () => runtime.currentPlanSummary());

            state.lastPlanSignature =
                before.exists
                    ? `${before.steps}:${before.done}:${before.blocked}`
                    : "none";
        }
        state.task = task;
        state.answer = null;
        state.error = null;
        state.startedAt = Date.now();
        state.finishedAt = null;

        const turn_id =
            `turn-${Date.now()}-${(state.turnCounter = (state.turnCounter || 0) + 1)}`;

        state.currentTurnId = turn_id;

        addMessage({
            role: "user",
            kind: "message",
            content: task,
            turn_id
        });

        try {

            const action =
                await runtime.runAgent({
                    task,

                    turn_id,

                    history:
                        state.history,

                    ...(runOptions.projectId
                        ? { projectId: runOptions.projectId }
                        : {}),
                    ...(runOptions.reasoningEffort
                        ? { reasoning_effort: runOptions.reasoningEffort }
                        : {})
                });

            state.answer =
                action.response
                    ? action.response.content
                    : null;

            state.error =
                action.error || null;

            state.status =
                action.error
                    ? "failed"
                    : "done";

            if (state.answer) {

                addMessage({
                    role: "assistant",
                    kind: "response",
                    turn_id,
                    content: state.answer
                });
            }

            if (state.error) {

                addMessage({
                    role: "assistant",
                    kind: "error",
                    turn_id,
                    content:
                        `${state.error.code}: ${state.error.message}`
                });
            }

        } catch (error) {

            state.error = {
                code:
                    runtime.isRunCancelled()
                        ? "CANCELLED"
                        : error.name || "RUNTIME_ERROR",

                message:
                    error.message,

                retryable: false
            };

            state.status =
                runtime.isRunCancelled()
                    ? "cancelled"
                    : "failed";

            /* the runtime already ended a started run with run:error; only a
               failure before the run started still needs its terminal event */
            if (!error.runTerminalEmitted) {

                runtime.events.emit("run:error", {
                    message: error.message,
                    cancelled: runtime.isRunCancelled()
                });
            }

            addMessage({
                role: "assistant",
                kind: "error",
                turn_id,
                content: error.message
            });

        } finally {

            state.finishedAt = Date.now();

            const foregroundSlot =
                runOptions.projectId
                    ? projectSlots.get(runOptions.projectId)
                    : null;

            if (foregroundSlot && !foregroundSlot.background) {

                foregroundSlot.status = state.status;
                foregroundSlot.answer = state.answer;
                foregroundSlot.error = state.error;
                foregroundSlot.finishedAt = state.finishedAt;
            }

            /* Record what this run changed in git — shown in the
               conversation and streamed as a git:report event. */
            await recordGitReport();
            if (runtime.eventstore && typeof runtime.eventstore.flush === "function") {
                await runtime.eventstore.flush();
            }

            /*
            | The console equivalent of --until-done: while the plan has
            | open steps and the operator has not stopped, the next
            | cycle starts on its own.
            */

            const plan =
                inRunProject(runOptions, () => runtime.currentPlanSummary());

            /*
            | Progress is any movement of the plan: a step finished, a
            | step added, or the plan appearing for the first time.
            */

            const signature =
                plan.exists
                    ? `${plan.steps}:${plan.done}:${plan.blocked}`
                    : "none";

            const madeProgress =
                state.lastPlanSignature === null ||
                signature !== state.lastPlanSignature;

            state.lastPlanSignature = signature;

            const shouldContinue =
                runtime.settings.get("AUTO_CONTINUE") === true &&
                state.status === "done" &&
                plan.exists &&
                !plan.complete &&
                !state.stopRequested &&
                state.cycles < runtime.settings.get("MAX_AUTO_CYCLES");

            if (shouldContinue && !madeProgress) {

                /*
                | A cycle that finished no step would repeat for ever,
                | so the loop stops and says why.
                */

                runtime.events.emit("run:loop", {
                    agent: "main_agent",
                    scope: "main_agent",
                    outcome: "stalled",
                    signature,
                    repeats: state.cycles,
                    reason: "a cycle finished without completing a step"
                });

                runtime.events.emit("run:auto_stopped", {
                    reason: "no step was completed in the last cycle",
                    done: plan.done,
                    steps: plan.steps
                });

            } else if (shouldContinue) {

                state.cycles++;

                /*
                | Each cycle is a fresh conversation. The plan on disk
                | carries the state, so the transcript never has to,
                | which is what keeps a long build inside the context
                | budget.
                */

                state.history = [];

                runtime.events.emit("run:auto_continue", {
                    cycle: state.cycles,
                    open_steps:
                        plan.pending + plan.in_progress,
                    next_step: plan.next_step
                });

                /*
                | The continuation is the SAME run for the same project: it
                | inherits the options (projectId, ...) of the run that just
                | ended. Without them the next cycle silently fell back to the
                | default project (audit F-002 / AUTO_CONTINUE drops project scope).
                */
                setTimeout(
                    () =>
                        startTask(
                            "Continue the plan: read it, take the next open step, verify it, and record the result.",
                            { ...runOptions }
                        ).catch(() => {}),
                    50
                );
            }

            /*
            | Nothing may stay pending once THIS run is over — but only the
            | approvals this run created. A finishing run used to resolve every
            | pending approval, including one a newer run had already surfaced
            | during the git-report/eventstore drain, silently auto-denying it.
            */

            for (const id of approvalStore.pendingKeys()) {
                const owned = approvalStore.getPending(id);
                if (owned && owned.ownerTurnId === turn_id) {
                    resolveApproval(id, false);
                }
            }

            runtime.events.emit("run:status", {
                status: state.status,
                answer: state.answer,
                error: state.error,
                turn_id
            });

            state.session.turns =
                state.session.messages.filter(
                    message => message.role === "user"
                ).length;

            saveSession();
        }
    }

    return {
        projectSlotBusy,
        slotView,
        startTask
    };
};
