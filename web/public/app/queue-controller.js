/*
|--------------------------------------------------------------------------
| Multi-project queue
|--------------------------------------------------------------------------
|
| A task sent to several projects runs once per project, one after another.
*/

import { state } from "./store.js";
import { failureText, notifyError, pushMessage, setStatus } from "./console-core.js";
import { projectById } from "./project-routing.js";


export function labelChatForProject(projectId) {

    const project = projectById(projectId);
    const name = project ? project.name : projectId;

    pushMessage({
        role: "system",
        kind: "message",
        content: `Project · ${name}`,
        at: Date.now()
    });
}


/*
| The labelled runs of a multi-project task go one after another: the
| next starts when the current one settles. The queue tracks its own
| in-flight item rather than the run status on screen, because a snapshot
| of the project on screen says nothing about a run of another project.
|
| The event stream reports the settle when it can see that project (the
| global stream sees all of them, a project stream only its own). For a
| run outside the stream, the project's state is polled until it has no
| active run left. Before this, the queue waited for a status it could
| never receive and the remaining projects never ran.
*/
let queueCurrent = null;


let queueToken = 0;


function streamSees(projectId) {

    return !state.currentProjectId || state.currentProjectId === projectId;
}


function finishQueueItem(token) {

    if (!queueCurrent || queueCurrent.token !== token) {
        return;
    }

    queueCurrent = null;
    drainProjectTaskQueue();
}


export function stopProjectQueue() {

    state.multiQueue = [];
    queueCurrent = null;
    queueToken++;
}


/* a run:status that is not "running" arrived on the stream */
export function projectRunSettled(projectId) {

    if (!queueCurrent) {
        drainProjectTaskQueue();
        return;
    }

    if (streamSees(queueCurrent.projectId) && (!projectId || projectId === queueCurrent.projectId)) {
        finishQueueItem(queueCurrent.token);
    }
}


function watchProjectRun(item) {

    const poll = async () => {

        if (!queueCurrent || queueCurrent.token !== item.token) {
            return;
        }

        try {

            const response = await fetch(`/api/projects/${encodeURIComponent(item.projectId)}/state`);
            const snapshot = response.ok ? await response.json() : null;
            const active = Array.isArray(snapshot?.active_runs) ? snapshot.active_runs : null;

            if (active && !active.some(run => ["running", "queued"].includes(run.status))) {
                /* no stream will report this run's end; the composer is free
                   again unless the next queued run takes it */
                if (state.activeProjectId === item.projectId) setStatus("idle");
                finishQueueItem(item.token);
                return;
            }

        } catch {
            /* a transient failure: the next poll tries again */
        }

        setTimeout(poll, state.queuePollMs);
    };

    setTimeout(poll, state.queuePollMs);
}


export async function drainProjectTaskQueue() {

    if (queueCurrent || state.multiQueue.length === 0) {
        return;
    }

    const next = { ...state.multiQueue.shift(), token: ++queueToken };

    queueCurrent = next;
    setStatus("running");
    state.activeProjectId = next.projectId;
    labelChatForProject(next.projectId);

    let failure = null;

    try {

        const response =
            await fetch(
                `/api/projects/${encodeURIComponent(next.projectId)}/tasks`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        task: next.task,
                        ...(next.reasoningEffort ? { reasoning_effort: next.reasoningEffort } : {})
                    })
                }
            );

        if (!response.ok) {
            failure = await failureText(response, `Could not start ${next.projectId}`);
        }

    } catch (error) {
        failure = `Could not start ${next.projectId}: ${error.message || "network error"}`;
    }

    if (queueCurrent?.token !== next.token) {
        return;
    }

    if (failure) {
        setStatus("idle");
        notifyError(failure);
        finishQueueItem(next.token);
        return;
    }

    if (!streamSees(next.projectId)) {
        watchProjectRun(next);
    }
}
