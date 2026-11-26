"use strict";

/*
|--------------------------------------------------------------------------
| Background turns (roadmap P1-03)
|--------------------------------------------------------------------------
|
| A project's turn that runs while the console's foreground is taken. It is
| a complete turn of that project's own conversation: the user message,
| the model's messages (routed here by live-events), the answer or error,
| a git report of the project's workspace, the end-of-turn approval sweep,
| a `run:status` the project's stream sees, then the next queued message
| or the next plan cycle. The foreground `state` is never touched.
*/


const startCheckpoint = require("./turn-checkpoint");


module.exports = function createBackgroundTurns(shared, support, scheduleNext) {

    const {
        conversations,
        projectQueue,
        recordGitReport,
        runtime,
        state
    } = shared;

    const {
        attribution,
        continuationTask,
        projectWorkspace,
        rememberPlan,
        shouldAutoContinue,
        sweepApprovals
    } = support;


    async function run(task, runOptions) {

        const projectId = runOptions.projectId;

        const conv = conversations.ensure(projectId);

        Object.assign(conv, {
            status: "running",
            task,
            answer: null,
            error: null,
            startedAt: Date.now(),
            finishedAt: null,
            background: true,
            stopRequested: false
        });

        rememberPlan(conv, runOptions);

        /* one counter for every turn the console starts keeps ids unique */
        const turn_id =
            `turn-${Date.now()}-${(state.turnCounter = (state.turnCounter || 0) + 1)}`;

        conv.currentTurnId = turn_id;

        const addMessage = entry => conversations.addMessage(conv, entry);

        addMessage({ role: "user", kind: runOptions.kind || "message", content: task, turn_id });

        /* P1-06: saved now and while it runs, so a restart can continue it */
        const stopCheckpoint =
            startCheckpoint(
                runtime,
                () => conversations.saveConversation(conv),
                () => `${conv.history.length}:${conv.messages.length}:${conv.events.length}`
            );

        /* how the turn ended; the conversation shows it once it has unwound */
        let settled = "failed";

        try {

            const action =
                await runtime.runAgent({
                    task,
                    turn_id,
                    history: conv.history,
                    projectId,
                    ...(runOptions.reasoningEffort ? { reasoning_effort: runOptions.reasoningEffort } : {})
                });

            conv.answer = action.response ? action.response.content : null;
            conv.error = action.error || null;
            settled = action.error ? "failed" : "done";

            if (conv.answer) {
                addMessage({ role: "assistant", kind: "response", turn_id, content: conv.answer });
            }

            if (conv.error) {
                addMessage({
                    role: "assistant",
                    kind: "error",
                    turn_id,
                    content: `${conv.error.code}: ${conv.error.message}`
                });
            }

        } catch (error) {

            const cancelled =
                conv.stopRequested ||
                error.code === "RUN_CANCELLED" ||
                /cancel/i.test(error.message);

            conv.error = {
                code: cancelled ? "CANCELLED" : error.name || "RUNTIME_ERROR",
                message: error.message,
                retryable: false
            };

            settled = cancelled ? "cancelled" : "failed";

            if (!error.runTerminalEmitted) {

                runtime.events.emit("run:error", {
                    message: error.message,
                    cancelled,
                    turn_id,
                    ...attribution(projectId)
                });
            }

            addMessage({ role: "assistant", kind: "error", turn_id, content: error.message });

        } finally {

            stopCheckpoint();

            conv.finishedAt = Date.now();

            try {

                await recordGitReport({
                    workspace: projectWorkspace(projectId),
                    projectId,
                    turnId: turn_id,
                    addMessage
                });

                if (runtime.eventstore && typeof runtime.eventstore.flush === "function") {
                    await runtime.eventstore.flush();
                }

            } catch {

                /* a report that cannot be made must not keep the turn open */
            }

            /* the project is free only now that its turn has unwound: a
               message sent meanwhile waited in the queue instead of
               starting a turn this one's ending would then trample */
            conv.status = settled;

            /* a waiting message is the operator's next turn; it goes first */
            const next = projectQueue.takeNext(conv);

            const again =
                !next && shouldAutoContinue(conv, runOptions);

            sweepApprovals(turn_id);

            runtime.events.emit("run:status", {
                status: conv.status,
                answer: conv.answer,
                error: conv.error,
                turn_id,
                background: true,
                ...attribution(projectId)
            });

            conversations.saveConversation(conv);

            if (next) {

                scheduleNext(next.text, {
                    projectId,
                    reasoningEffort: next.reasoningEffort,
                    kind: next.kind
                });

            } else if (again) {

                scheduleNext(continuationTask(), { ...runOptions, kind: "message" });
            }
        }
    }


    return {
        run
    };
};
