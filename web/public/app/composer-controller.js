/*
|--------------------------------------------------------------------------
| Composer
|--------------------------------------------------------------------------
|
| Task submission: the target projects, attachments and their upload, the
| reasoning effort, and sending the task (or queueing it per project).
*/

import { state, touch } from "./store.js";
import { el, failureText, notifyError, setStatus } from "./console-core.js";
import { projectById } from "./project-routing.js";
import { drainProjectTaskQueue, labelChatForProject, sendCorrection } from "./queue-controller.js";
import { apiFetch } from "./auth-transport.js";


const TASK_DRAFT_KEY = "structured-ai.taskDraft";


function draftStorage() {

    try {
        if (typeof globalThis !== "undefined" && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch {
        /* private mode */
    }

    return null;
}


export function readTaskDraft() {

    const storage = draftStorage();
    if (!storage) return "";

    try {
        return storage.getItem(TASK_DRAFT_KEY) || "";
    } catch {
        return "";
    }
}


export function writeTaskDraft(text) {

    const storage = draftStorage();
    if (!storage) return;

    const value = String(text ?? "");

    try {
        if (value === "") storage.removeItem(TASK_DRAFT_KEY);
        else storage.setItem(TASK_DRAFT_KEY, value);
    } catch {
        /* storage quota or private mode */
    }
}


export function initTaskDraft() {

    const field = el("task");
    if (!field) return;

    const saved = readTaskDraft();
    if (saved !== "" && field.value === "") {
        field.value = saved;
    }

    field.addEventListener("input", () => writeTaskDraft(field.value));
}


function selectedTaskScope() {

    return state.taskScopeMode || "current";
}


export function selectedTaskProjectIds() {

    if (selectedTaskScope() === "multiple") {
        return [...state.taskProjectIds];
    }

    return state.currentProjectId ? [state.currentProjectId] : [];
}


export function renderAttachments() {

    touch("attachments");
}


export function removeAttachment(index) {

    state.attachments.splice(index, 1);
    state.attachmentError = null;
    touch("attachments");
}


async function uploadAttachmentsForProject(projectId, attachments = state.attachments) {

    const key = projectId || "__default__";
    const pending = attachments.filter(attachment => !attachment.uploaded.has(key));

    if (pending.length > 0) {
        const form = new FormData();
        for (const attachment of pending) {
            form.append("files", attachment.file, attachment.file.name);
        }

        const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const response = await apiFetch(`/api/uploads${query}`, {
            method: "POST",
            body: form
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !Array.isArray(payload.files) || payload.files.length !== pending.length) {
            throw new Error(payload.error || `File upload failed (${response.status}).`);
        }

        pending.forEach((attachment, index) => {
            attachment.uploaded.set(key, payload.files[index]);
        });
    }

    return attachments.map(attachment => attachment.uploaded.get(key));
}


export function taskWithAttachments(task, files) {

    if (!files || files.length === 0) return task;

    return `${task}\n\nAttached files (stored locally on the server):\n${files
        .map(file => `- ${JSON.stringify(file.name)}: ${JSON.stringify(file.path)}`)
        .join("\n")}\n\nTreat these as user-provided input files. Inspect or extract them as appropriate for the task; do not execute uploaded code unless the task explicitly requires it.`;
}


function setUploadingState(uploading) {

    state.uploading = Boolean(uploading);
    touch("composer");
}


function setSubmittingState(submitting) {

    state.submitting = Boolean(submitting);
    const locked = Boolean(state.uploading || state.submitting);
    const run = el("runButton");
    const queue = el("queueButton");
    if (run && state.status !== "running") run.disabled = locked;
    if (queue) queue.disabled = locked;
    touch("composer");
}


function startLabeledProjectQueue(task, projectIds, attachmentFilesByProject = new Map(), reasoningEffort = null, runFlags = {}) {

    state.multiQueueTotal = projectIds.length;
    state.multiQueueActive = true;
    state.multiQueue = projectIds.map(id => ({
        projectId: id,
        task: taskWithAttachments(
            `[${(projectById(id) || { name: id }).name}] ${task}`,
            attachmentFilesByProject.get(id) || []
        ),
        reasoningEffort,
        runFlags
    }));

    drainProjectTaskQueue();
}


/*
| Plan first / dollar cap of the next task (roadmap P3-03, P3-05),
| as the request fields the server reads. Empty fields send nothing.
*/
export function selectedRunFlags() {

    const flags = {};
    const cap = (el("taskMaxCost")?.value || "").trim();

    if (state.composerPlanMode) flags.plan_mode = true;
    if (cap !== "" && Number.isFinite(Number(cap)) && Number(cap) >= 0) flags.max_cost_usd = Number(cap);

    return flags;
}


export function selectedReasoningEffort() {

    const selected = el("taskEffort")?.value || "inherit";

    return ["low", "medium", "high", "xhigh"].includes(selected) ? selected : null;
}


export function clearComposer() {

    const task = el("task");

    if (task) task.value = "";
    writeTaskDraft("");

    /* plan mode belongs to one task; the dollar cap stays */
    if (state.composerPlanMode) {
        state.composerPlanMode = false;
        touch("header");
    }

    state.attachments = [];
    state.attachmentError = null;
    touch("attachments");
}


/* uploads the attachments for each target; false (and a chip error) on failure */
export async function uploadFor(projectIds, filesByProject) {

    if (state.attachments.length === 0) {
        return true;
    }

    setUploadingState(true);

    try {
        for (const projectId of projectIds) {
            filesByProject.set(projectId || "__default__", await uploadAttachmentsForProject(projectId));
        }
        return true;
    } catch (error) {
        state.attachmentError = error.message;
        touch("attachments");
        return false;
    } finally {
        setUploadingState(false);
    }
}


/* "Correct now": the text reaches the running turn before its next step */
export async function submitCorrection() {

    const field = el("task");
    const text = field ? field.value.trim() : "";

    if (text === "" || !state.currentProjectId || state.submitting || state.uploading) {
        return false;
    }

    setSubmittingState(true);

    try {
        if (await sendCorrection(text)) {
            clearComposer();
            return true;
        }
        return false;
    } finally {
        setSubmittingState(false);
    }
}


export async function submitTask(task, reasoningEffort, runFlags = selectedRunFlags()) {

    if (state.submitting || state.uploading) {
        return false;
    }

    setSubmittingState(true);

    try {
        const goal = runFlags?.plan_mode && !runFlags.goal
            ? String(task || "").trim().slice(0, 2000)
            : "";
        const effectiveFlags = goal ? { ...runFlags, goal } : runFlags;

        const targets = selectedTaskProjectIds();
        const projectIds = targets.length > 0 ? targets : [null];
        const files = new Map();

        if (!(await uploadFor(projectIds, files))) {
            return false;
        }

        if (targets.length > 1) {
            startLabeledProjectQueue(task, targets, files, reasoningEffort, effectiveFlags);
            clearComposer();
            return true;
        }

        const projectId = targets[0] || null;

        if (state.attachments.length > 0) {
            task = taskWithAttachments(task, files.get(projectId || "__default__"));
        }

        /* a busy project queues the message for its next turn (P1-04) */
        const statusBefore = state.status;
        const busy = statusBefore === "running";

        const url =
            projectId
                ? `/api/projects/${encodeURIComponent(projectId)}/tasks`
                : "/api/tasks";

        let response;

        try {
            response = await apiFetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    task,
                    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
                    ...effectiveFlags
                })
            });
        } catch (error) {
            notifyError(`The task could not be sent: ${error.message || "network error"}`);
            return false;
        }

        if (!response.ok) {
            notifyError(await failureText(response, "The task was not started"));
            return false;
        }

        const accepted = typeof response.json === "function" ? await response.json().catch(() => ({})) : {};

        clearComposer();

        if (accepted && accepted.queued === true) {
            /* the queue panel shows it; the run on screen goes on */
            return true;
        }

        state.activeProjectId = projectId;
        if (!busy && state.status === statusBefore) {
            setStatus("running");
        }

        if (projectId) {
            labelChatForProject(projectId);
        }

        try {
            const snapshot = await (await apiFetch("/api/state")).json();
            if (snapshot && snapshot.turns !== undefined) {
                state.turnsText = `${snapshot.turns} turns`;
                touch("header");
            }
        } catch {
            /* the next snapshot carries the count */
        }

        return true;
    } finally {
        setSubmittingState(false);
    }
}
