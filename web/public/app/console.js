/*
|--------------------------------------------------------------------------
| Console controller
|--------------------------------------------------------------------------
|
| The entry the page loads (through main.js). The console keeps no state of
| its own beyond what the runtime reports: events from the stream go
| through the reducer in runtime-state.js into the store (store.js), and
| the panels are views mounted on store regions that redraw themselves.
| The request/response flows live in one controller per feature
| (*-controller.js, project-*.js); this file wires index.html's controls
| to them and starts the console.
|
| Three things are deliberately modal rather than inline, because they
| interrupt: settings, an approval request, and the full detail of one
| executed call. They share the Modal service in modal.js.
*/

import { openSystem, refreshSystemWarnings } from "./system-view.js";
import { initInterrupted } from "./interrupted-controller.js";
import { initQuality } from "./quality-controller.js";
import { state, touch } from "./store.js";
import { mount } from "./dom.js";
import { Attachments } from "./composer-view.js";
import { approvals, el, failureText, notifyError } from "./console-core.js";
import { openHistory } from "./history-controller.js";
import { openMcp } from "./mcp-controller.js";
import { submitDiscussion, toggleDiscussionMode } from "./discussion-controller.js";
import { mountViews, openEventsModal, openExecutionModal, openPlanModal } from "./panels-controller.js";
import { changeApprovalMode, changeAutoContinue, loadSettings, openLlmSettings, openSettings } from "./settings-controller.js";
import { connect } from "./stream-controller.js";
import { removeAttachment, selectedReasoningEffort, submitCorrection, submitTask } from "./composer-controller.js";
import { initConversations, toggleNotifications } from "./conversations-controller.js";
import { messageQueueActions, stopProjectQueue } from "./queue-controller.js";
import { QueuePanel } from "./queue-view.js";
import { mountDashboard } from "./projects-controller.js";
import { initProjects } from "./project-manager.js";
import { installPanelErrorReporting, openLogs, startLogBadge } from "./logs-controller.js";
import { openTerminal } from "./terminal-controller.js";
import { openFiles } from "./files-controller.js";
import { initMentions } from "./mention-controller.js";


el("taskForm").addEventListener("submit", async submitEvent => {

    submitEvent.preventDefault();

    let task = el("task").value.trim();

    if (task === "" && state.attachments.length === 0) {
        return;
    }

    if (task === "") {
        task = "Inspect the attached file(s) and determine the appropriate next step.";
    }

    const reasoningEffort = selectedReasoningEffort();

    if (state.discussionMode) {
        await submitDiscussion(task, reasoningEffort);
    } else {
        await submitTask(task, reasoningEffort);
    }
});


/* ------------------------------------------------------------- controls */

el("cancelButton").addEventListener("click", async () => {

    stopProjectQueue();
    state.stopPending = true;
    touch("run");

    /* the conversation on screen; the default view stops the run it shows */
    const projectId = state.currentProjectId || state.activeProjectId;
    const url = projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/cancel`
        : "/api/cancel";

    try {
        const response = await fetch(url, { method: "POST" });
        if (!response.ok) throw new Error(`Stop request failed (${response.status}).`);
    } catch (error) {
        state.stopPending = false;
        touch("run");
        notifyError(error.message || "Stop request failed.");
    }
});


el("clearButton").addEventListener("click", async () => {

    try {
        /* a project's tab starts its own conversation afresh */
        const projectId = state.currentProjectId;
        const response = await fetch(
            projectId ? `/api/projects/${encodeURIComponent(projectId)}/clear` : "/api/clear",
            { method: "POST" }
        );
        if (!response.ok) {
            notifyError(await failureText(response, "The conversation was not cleared"));
            return;
        }
        state.turnsText = "0 turns";
        touch("header");
    } catch (error) {
        notifyError(`The conversation was not cleared: ${error.message || "network error"}`);
    }
});


el("autoContinue").addEventListener("change", event => changeAutoContinue(event.target.checked));
el("approvalMode").addEventListener("change", event => changeApprovalMode(event.target.value));


el("settingsButton").addEventListener("click", openSettings);
el("llmSettingsButton").addEventListener("click", openLlmSettings);
el("planButton").addEventListener("click", openPlanModal);

el("mobileMenuToggle").addEventListener("click", () => {
    const header = el("consoleHeader");
    const open = header.classList.toggle("menu-open");
    el("mobileMenuToggle").setAttribute("aria-expanded", String(open));
});

el("consoleMenu").addEventListener("click", event => {
    if (event.target.closest("button")) {
        el("consoleHeader").classList.remove("menu-open");
        el("mobileMenuToggle").setAttribute("aria-expanded", "false");
    }
});

el("mcpButton").addEventListener("click", openMcp);
el("logsButton").addEventListener("click", openLogs);
el("systemButton").addEventListener("click", openSystem);
el("terminalButton").addEventListener("click", openTerminal);
el("filesButton").addEventListener("click", openFiles);
el("historyButton").addEventListener("click", openHistory);
el("executionButton").addEventListener("click", openExecutionModal);
el("eventsButton").addEventListener("click", openEventsModal);
el("discussionButton").addEventListener("click", toggleDiscussionMode);
el("approvalsButton").addEventListener("click", () => approvals.open());
el("notificationsButton").addEventListener("click", toggleNotifications);
el("correctButton").addEventListener("click", submitCorrection);


el("task").addEventListener("keydown", event => {

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        el("taskForm").requestSubmit();
    }
});


mountViews();

mountDashboard();

mount(el("attachmentList"), () => Attachments({ state, onRemove: removeAttachment }), ["attachments", "settings"]);

initMentions();

mount(el("messageQueue"), () => QueuePanel({ state, actions: messageQueueActions }), ["queue", "projects"]);

initConversations();

connect();

loadSettings();

initProjects();

startLogBadge();

initInterrupted();

initQuality();

refreshSystemWarnings();

installPanelErrorReporting();
