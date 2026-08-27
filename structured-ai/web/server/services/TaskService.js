"use strict";

/*
|--------------------------------------------------------------------------
| Web console task loop (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| One task at a time, with the console's own version of --until-done
| wrapped around it.
|
| Everything the run is allowed to touch is *not* here: this only owns
| the console's view of a run — the turn id, the conversation entries,
| the status transitions, the auto-continue decision and the drain of
| pending approvals in the finally block, because nothing may stay
| pending once a run is over.
|
| Progress is any movement of the plan: a step finished, a step added,
| or the plan appearing at all. A cycle that finished no step would
| repeat forever, so the loop says why it stopped instead of stopping.
|
| The two status/answer/error writes and the `run:status` event at the
| end of the finally block are what /api/state and the SSE stream read,
| which is why this moved as one piece with the auto-continue logic
| rather than being split further.
|--------------------------------------------------------------------------
*/

function createTaskService(ctx) {

    const { runtime, state } = ctx;

    /*
    | runOptions (EXECUTION_PLAN Phase 7 گام ۲): when the caller names a
    | projectId the run is resolved against the project registry and the
    | whole run is scoped to that project (modular modes required — the
    | route enforces that before accepting). Legacy callers pass nothing
    | and the historical single-run behaviour is untouched.
    */
    async function startTask(task, runOptions = {}) {

        if (state.status === "running") {

            throw Object.assign(
                new Error("a task is already running"),
                { status: 409 }
            );
        }

        state.status = "running";
        state.stopRequested = false;
        state.projectId = runOptions.projectId || null;

        if (state.lastPlanSignature === null) {

            const before =
                runtime.currentPlanSummary();

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

        ctx.addMessage({
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

                ctx.addMessage({
                    role: "assistant",
                    kind: "response",
                    turn_id,
                    content: state.answer
                });
            }

            if (state.error) {

                ctx.addMessage({
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

            runtime.events.emit("run:error", {
                message: error.message,
                cancelled: runtime.isRunCancelled()
            });

            ctx.addMessage({
                role: "assistant",
                kind: "error",
                turn_id,
                content: error.message
            });

        } finally {

            state.finishedAt = Date.now();

            /* Record what this run changed in git — shown in the
               conversation and streamed as a git:report event. */
            await ctx.recordGitReport();
            if (runtime.eventstore && typeof runtime.eventstore.flush === "function") {
                await runtime.eventstore.flush();
            }

            /*
            | The console equivalent of --until-done: while the plan has
            | open steps and the operator has not stopped, the next
            | cycle starts on its own.
            */

            const plan =
                runtime.currentPlanSummary();

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
                ctx.settings.autoContinue() &&
                state.status === "done" &&
                plan.exists &&
                !plan.complete &&
                !state.stopRequested &&
                state.cycles < ctx.settings.maxAutoCycles();

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

                setTimeout(
                    () =>
                        startTask(
                            "Continue the plan: read it, take the next open step, verify it, and record the result."
                        ).catch(() => {}),
                    50
                );
            }

            /* nothing may stay pending once the run is over */

            for (const id of state.approvals.pendingIds()) {
                ctx.resolveApproval(id, false);
            }

            runtime.events.emit("run:status", {
                status: state.status,
                answer: state.answer,
                error: state.error
            });

            state.session.turns =
                state.session.messages.filter(
                    message => message.role === "user"
                ).length;

            ctx.saveSession();
        }
    }

    return {
        startTask
    };
}

module.exports = {
    createTaskService
};
