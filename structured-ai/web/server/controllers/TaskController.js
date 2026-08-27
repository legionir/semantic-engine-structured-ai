"use strict";

/*
|--------------------------------------------------------------------------
| Web console run routes (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Start a task, cancel the run, clear the conversation.
|
| POST /api/tasks answers 202 and the run continues in the background: the
| browser watches /api/events instead of holding a request open, so a run
| that outlives a page reload is not lost. The 409 for a busy console covers
| a running task *and* a running discussion, because both own the one
| conversation.
|
| Cancel is not one call: it sets the stop flag, asks the runtime to cancel
| the run, and drains the pending approvals by resolving them false. A run
| cancelled while it waits on an approval would otherwise wait for a click
| that can never arrive.
|
| Clearing keeps the previous conversation on disk and starts the next one,
| and is refused while a task runs. Both halves are the original's contract.
|--------------------------------------------------------------------------
*/

function createTaskController(ctx) {

    const { runtime, state, calls, sessions } = ctx;

    /* ---------------------------------------------- tasks */

    async function submit(req, res, url, pathname, claims) {

        const body =
            await ctx.readBody(req);

        const task =
            typeof body.task === "string"
                ? body.task.trim()
                : "";

        if (task === "") {

            ctx.sendJson(res, 400, {
                error: "task is required"
            });

            return;
        }

        if (
            state.status === "running" ||
            (
                state.discussion &&
                state.discussion.status === "running"
            )
        ) {

            ctx.sendJson(res, 409, {
                error:
                    state.status === "running"
                        ? "a task is already running"
                        : "a discussion is already running"
            });

            return;
        }

        /* the run continues in the background */

        ctx.startTask(task).catch(() => {});

        ctx.sendJson(res, 202, { accepted: true });

    }

    /* --------------------------------------------- control */

    async function cancel(req, res, url, pathname, claims) {

        state.stopRequested = true;

        runtime.cancelRun("web console");

        for (const id of state.approvals.pendingIds()) {
            ctx.resolveApproval(id, false);
        }

        ctx.sendJson(res, 200, { cancelled: true });

    }

    async function clear(req, res, url, pathname, claims) {

        if (state.status === "running") {

            ctx.sendJson(res, 409, {
                error: "cannot clear while a task is running"
            });

            return;
        }

        state.cycles = 0;
        state.lastPlanSignature = null;
        state.history = [];
        state.events = [];

        /*
        | The previous conversation is kept on disk; this
        | starts the next one rather than erasing it.
        */

        ctx.saveSession();

        state.session = sessions.emptySession();

        calls.clear();
        state.answer = null;
        state.error = null;
        state.status = "idle";

        runtime.events.emit("session:cleared", {});

        ctx.sendJson(res, 200, { cleared: true });

    }

    return {
        submit,
        cancel,
        clear
    };
}

module.exports = { createTaskController };
