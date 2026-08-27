/*
|--------------------------------------------------------------------------
| Console task-runner (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| Submitting work: the scope selector, a task for one project, the labelled
| sequential queue for several — and the four header handlers whose logic belongs
| to this feature rather than to the page.
|
| Those handlers (`submitTaskForm`, `cancelCurrentRun`, `clearConversation`,
| `setAutoContinue`) are the wiring bodies of app.js, moved verbatim; main.js now
| only attaches them.
|--------------------------------------------------------------------------
*/

import { el } from "./dom.js";
import { openDiscussion, refreshDiscussionComposerStatus, selectedDiscussionPersonas } from "./discussion-view.js";
import { projectById } from "./project-state.js";
import { discussionState, projectState, pushMessage, runtimeState, setStatus } from "./store.js";

export function selectedTaskScope() {

    const radios =
        typeof document !== "undefined" &&
        typeof document.getElementsByName === "function"
            ? document.getElementsByName("taskScope")
            : [];

    for (const radio of radios) {

        if (radio.checked) {
            return radio.value;
        }
    }

    return "current";
}

export function selectedTaskProjectIds() {

    const scope = selectedTaskScope();

    if (scope === "specific") {

        const value = el("taskScopeProject")?.value;
        return value ? [value] : [];
    }

    if (scope === "multiple") {

        const boxes = el("taskScopeList")?.querySelectorAll(".scope-box") || [];
        return [...boxes].filter(box => box.checked).map(box => box.value);
    }

    return projectState.currentProjectId ? [projectState.currentProjectId] : [];
}

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

export function startLabeledProjectQueue(task, projectIds) {

    runtimeState.multiQueue = projectIds.map(id => ({
        projectId: id,
        task: `[${(projectById(id) || { name: id }).name}] ${task}`
    }));

    drainProjectTaskQueue();
}

export async function drainProjectTaskQueue() {

    if (runtimeState.status === "running" || runtimeState.multiQueue.length === 0) {
        return;
    }

    const next = runtimeState.multiQueue.shift();

    setStatus("running");
    labelChatForProject(next.projectId);

    const response =
        await fetch(
            `/api/projects/${encodeURIComponent(next.projectId)}/tasks`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ task: next.task })
            }
        );

    if (!response.ok) {
        setStatus("idle");
        pushMessage({
            role: "assistant",
            kind: "error",
            content: `Could not start ${next.projectId}`
        });
        drainProjectTaskQueue();
    }
}

export async function submitTaskForm(submitEvent) {

submitEvent.preventDefault();

    const task =
        el("task").value.trim();

    if (task === "") {
        return;
    }

    /*
    | Discussion mode sends the same task box to the panel instead of
    | the delegation tree: the personas and the round limit come from
    | the options row, and the live view opens as it runs.
    */

    if (discussionState.discussionMode) {

        const personas =
            selectedDiscussionPersonas();

        const line =
            el("discussionStatusLine");

        if (personas.length === 0) {

            if (line) {
                line.className = "bad";
                line.textContent =
                    "select at least one persona";
            }

            return;
        }

        const maxRounds =
            Math.max(
                1,
                Math.min(10, Number(el("discussionRounds")?.value) || 5)
            );

        el("runButton").disabled = true;

        const response =
            await fetch("/api/discussion", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ task, personas, max_rounds: maxRounds })
            });

        if (response.ok) {

            el("task").value = "";

            /* the stream confirms with discussion:start; this keeps
               the composer honest in the meantime */
            discussionState.discussion = {
                id:
                    (await response.json().catch(() => ({}))).id ||
                    null,
                status: "running",
                task,
                personas,
                max_rounds: maxRounds,
                rounds: [],
                observer_decisions: [],
                final_report: null
            };

            refreshDiscussionComposerStatus();

            openDiscussion();

        } else {

            const payload =
                await response.json().catch(() => ({}));

            el("runButton").disabled = false;

            if (line) {
                line.className = "bad";
                line.textContent =
                    payload.error ||
                    `request failed (${response.status})`;
            }
        }

        return;
    }

    const targets = selectedTaskProjectIds();

    if (targets.length > 1) {

        startLabeledProjectQueue(task, targets);
        el("task").value = "";
        return;
    }

    setStatus("running");

    const projectId = targets[0] || null;
    const url =
        projectId
            ? `/api/projects/${encodeURIComponent(projectId)}/tasks`
            : "/api/tasks";

    const response =
        await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task })
        });

    if (response.ok) {

        el("task").value = "";

        if (projectId) {
            labelChatForProject(projectId);
        }

        const snapshot =
            await (await fetch("/api/state")).json();

        el("turns").textContent = `${snapshot.turns} turns`;

    } else {

        setStatus("idle");
    }
}

export async function cancelCurrentRun() {

runtimeState.multiQueue = [];

    if (projectState.currentProjectId) {

        fetch(
            `/api/projects/${encodeURIComponent(projectState.currentProjectId)}/cancel`,
            { method: "POST" }
        );
    }

    fetch("/api/cancel", { method: "POST" });
}

export async function clearConversation() {

await fetch("/api/clear", { method: "POST" });

    el("turns").textContent = "0 turns";
}

export async function setAutoContinue(event) {

fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            key: "AUTO_CONTINUE",
            value: event.target.checked
        })
    });
}
