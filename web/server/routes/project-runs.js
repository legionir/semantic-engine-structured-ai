"use strict";

/*
|--------------------------------------------------------------------------
| Project run routes
|--------------------------------------------------------------------------
|
| Starting, cancelling and inspecting runs of one project: tasks and chat,
| cancel, the active run, metrics and health.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const { sendJson } = require("../Response");
const { readBody } = require("../RequestBody");


module.exports = async function ProjectRunsRoutes(shared, request, project) {

    const {
        conversations,
        projectQueue,
        projectSlotBusy,
        requestReasoningEffort,
        runtime,
        slotView,
        startTask,
        state
    } = shared;

    const {
        req,
        res
    } = request;

    const {
        projectId,
        requireAccess,
        requireRecord,
        suffix
    } = project;

    if (suffix === "/cancel" && req.method === "POST") {

        requireAccess(projectId, "project:write");
        requireRecord(projectId);

        const options = await readBody(req).catch(() => ({}));

        const cancelled = [];

        /* the turn that ends now must not start its next plan cycle */
        const conv = conversations.get(projectId);

        if (conv && conv.status === "running") {
            conv.stopRequested = true;
        }

        if (
            typeof runtime.runManager.activeRuns === "function"
        ) {

            for (const run of runtime.runManager.activeRuns()) {

                if (run.projectId === projectId) {

                    runtime.cancelRunById(run.runId, "web console");
                    cancelled.push(run.runId);
                }
            }
        }

        if (state.projectId === projectId) {

            state.stopRequested = true;
            runtime.cancelRun("web console");
        }

        const dropped =
            runtime.runScheduler &&
            typeof runtime.runScheduler.cancelQueued === "function"
                ? runtime.runScheduler.cancelQueued(projectId, "web console")
                : 0;

        /* the message queue survives a cancel unless asked (P1-04) */
        const clearedQueue =
            options && options.clear_queue === true
                ? projectQueue.clear(projectId)
                : 0;

        sendJson(res, 200, {
            cancelled: true,
            project_id: projectId,
            run_ids: cancelled,
            queued_dropped: dropped,
            queue_cleared: clearedQueue
        });
        return true;
    }

    if (
        (suffix === "/tasks" || suffix === "/chat") &&
        req.method === "POST"
    ) {

        requireAccess(projectId, "project:write");

        const body = await readBody(req);

        const task =
            typeof body.task === "string"
                ? body.task.trim()
                : typeof body.message === "string"
                    ? body.message.trim()
                    : "";
        let reasoningEffort;
        try {
            reasoningEffort = requestReasoningEffort(body);
        } catch (error) {
            sendJson(res, error.status || 400, { error: error.message });
            return true;
        }

        if (task === "") {

            sendJson(res, 400, {
                error: "task is required"
            });
            return true;
        }

        /*
        | Per-project gate: only THIS project's own run blocks it. The
        | message then waits in the project's queue for the next turn
        | (P1-04); `queue: false` (or PROJECT_QUEUE_MAX=0) keeps the
        | historical 409.
        */
        if (projectSlotBusy(projectId)) {

            requireRecord(projectId);

            if (body.queue === false || !projectQueue.enabled()) {

                sendJson(res, 409, {
                    error: `project ${projectId} already has a run in progress`,
                    project_id: projectId
                });
                return true;
            }

            try {

                const item =
                    projectQueue.add(projectId, task, { reasoningEffort });

                sendJson(res, 202, {
                    accepted: true,
                    project_id: projectId,
                    queued: true,
                    queued_message: item,
                    queue_length: projectQueue.view(projectId).items.length
                });

            } catch (error) {

                sendJson(res, error.status || 400, {
                    error: error.message,
                    project_id: projectId,
                    ...(error.status === 429 ? { code: "PROJECT_QUEUE_FULL" } : {})
                });
            }

            return true;
        }

        const record = requireRecord(projectId);

        const admission =
            runtime.runScheduler &&
            typeof runtime.runScheduler.admit === "function"
                ? runtime.runScheduler.admit(record.id)
                : "start";

        if (admission === "reject") {

            sendJson(res, 429, {
                error: "run queue is full",
                code: "RUN_QUEUE_FULL",
                project_id: record.id
            });
            return true;
        }

        startTask(task, { projectId: record.id, reasoningEffort }).catch(() => {});

        sendJson(res, 202, {
            accepted: true,
            project_id: record.id,
            queued: admission === "queue"
        });
        return true;
    }

    if (suffix === "/run" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        requireRecord(projectId);

        sendJson(res, 200, slotView(projectId));
        return true;
    }

    if (suffix === "/metrics" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        requireRecord(projectId);

        sendJson(res, 200, {
            project_id: projectId,
            metrics:
                runtime.observability.projectSnapshot(projectId),
            scheduler:
                runtime.runScheduler.snapshot()
        });
        return true;
    }

    if (suffix === "/health" && req.method === "GET") {

        requireAccess(projectId, "project:read");
        requireRecord(projectId);

        sendJson(res, 200, runtime.observability.healthOf(projectId));
        return true;
    }

    return false;
};
