"use strict";

/*
|--------------------------------------------------------------------------
| Task runner
|--------------------------------------------------------------------------
|
| Starting a task in the default workspace or in a project's conversation:
| the foreground turn (the console's `state`, the /api/state contract) and,
| when the foreground is taken, the project's background turn
| (background-turns.js). Each project keeps its own conversation
| (conversations.js) and message queue (project-queue.js).
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
|
*/

const createTurnSupport = require("./turn-support");
const createBackgroundTurns = require("./background-turns");


module.exports = function createTaskRunner(shared) {

    const {
        addMessage,
        conversations,
        projectQueue,
        recordGitReport,
        runtime,
        saveSession,
        state
    } = shared;

    const support = createTurnSupport(shared);

    const {
        attribution,
        continuationTask,
        inRunProject,
        projectWorkspace,
        rememberPlan,
        shouldAutoContinue,
        sweepApprovals
    } = support;

    /*
    | Per-project conversations (plan phase 7 / step 3, roadmap P1-03). The
    | console has ONE foreground conversation (`state`), but that must not
    | serialise the whole process: a run for project B may start while
    | project A's run is in progress. Rules:
    |   - a project with a run in progress takes no second run: the route
    |     queues the message for its next turn (P1-04) or answers 409;
    |   - a run for another project starts at once and, when the foreground
    |     is busy, runs in the BACKGROUND as a full turn of its own
    |     conversation (no clobbering of `state`); a conversation that
    |     lives in the background stays there until it is reset;
    |   - a run with no project keeps the historical single-run gate.
    */
    function projectSlotBusy(projectId) {

        return conversations.busy(projectId);
    }

    function slotView(projectId) {

        return conversations.view(projectId);
    }


    /* the next turn of a conversation starts once this one has unwound */
    function scheduleNext(task, runOptions) {

        setTimeout(
            () => startTask(task, runOptions).catch(() => {}),
            50
        );
    }


    const background =
        createBackgroundTurns(shared, support, scheduleNext);


    async function startTask(task, runOptions = {}) {

        const projectId = runOptions.projectId || null;

        if (projectId) {

            if (projectSlotBusy(projectId)) {

                throw Object.assign(
                    new Error(`project ${projectId} already has a run in progress`),
                    { status: 409 }
                );
            }

            const existing = conversations.get(projectId);

            /* the foreground is taken (by another project or the default
               project), or this conversation already lives in the
               background: run there instead of refusing */
            if (state.status === "running" || (existing && existing.background)) {

                return background.run(task, runOptions);
            }

        } else if (state.status === "running") {

            throw Object.assign(
                new Error("a task is already running"),
                { status: 409 }
            );
        }

        state.status = "running";
        state.stopRequested = false;
        state.projectId = projectId;

        const conv =
            projectId ? conversations.ensure(projectId) : null;

        if (conv) {

            Object.assign(conv, {
                status: "running",
                task,
                answer: null,
                error: null,
                startedAt: Date.now(),
                finishedAt: null,
                background: false,
                stopRequested: false
            });
        }

        rememberPlan(state, runOptions);

        state.task = task;
        state.answer = null;
        state.error = null;
        state.startedAt = Date.now();
        state.finishedAt = null;

        const turn_id =
            `turn-${Date.now()}-${(state.turnCounter = (state.turnCounter || 0) + 1)}`;

        state.currentTurnId = turn_id;

        if (conv) {
            conv.currentTurnId = turn_id;
        }

        addMessage({
            role: "user",
            kind: runOptions.kind || "message",
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

                    ...(projectId
                        ? { projectId }
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
                runtime.isRunCancelled() || (conv && conv.stopRequested)
                    ? "cancelled"
                    : "failed";

            /* the runtime already ended a started run with run:error; only a
               failure before the run started still needs its terminal event */
            if (!error.runTerminalEmitted) {

                runtime.events.emit("run:error", {
                    message: error.message,
                    cancelled: runtime.isRunCancelled(),
                    ...attribution(projectId)
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

            /* how this turn ended, kept apart from the shared state a turn
               started while this one unwinds would overwrite */
            const settled = {
                status: state.status,
                answer: state.answer,
                error: state.error
            };

            if (conv) {

                Object.assign(conv, {
                    answer: state.answer,
                    error: state.error,
                    finishedAt: state.finishedAt,
                    /* a later background turn of this project continues here */
                    history: state.history.slice()
                });
            }

            /* Record what this run changed in git — shown in the
               conversation and streamed as a git:report event. */
            await recordGitReport(
                projectId ? { workspace: projectWorkspace(projectId), turnId: turn_id } : {}
            );
            if (runtime.eventstore && typeof runtime.eventstore.flush === "function") {
                await runtime.eventstore.flush();
            }

            /* the project is free only now that its turn has unwound: a
               message sent meanwhile waited in the queue instead of
               starting a turn this one's ending would then trample */
            if (conv) {
                conv.status = settled.status;
            }

            /* a message queued for this project is the operator's next
               turn; it goes before the next plan cycle */
            const next =
                conv ? projectQueue.takeNext(conv) : null;

            if (conv && state.stopRequested) {
                conv.stopRequested = true;
            }

            /*
            | The continuation is the SAME run for the same project: it
            | inherits the options (projectId, ...) of the run that just
            | ended. Without them the next cycle silently fell back to the
            | default project (audit F-002 / AUTO_CONTINUE drops project scope).
            */
            if (!next && shouldAutoContinue(state, runOptions)) {

                scheduleNext(continuationTask(), { ...runOptions, kind: "message" });
            }

            sweepApprovals(turn_id);

            runtime.events.emit("run:status", {
                status: state.status,
                answer: state.answer,
                error: state.error,
                turn_id,
                ...attribution(projectId)
            });

            state.session.turns =
                state.session.messages.filter(
                    message => message.role === "user"
                ).length;

            saveSession();

            if (next) {

                scheduleNext(next.text, {
                    projectId,
                    reasoningEffort: next.reasoningEffort,
                    kind: next.kind
                });
            }
        }
    }

    return {
        inRunProject,
        projectSlotBusy,
        slotView,
        startTask
    };
};
