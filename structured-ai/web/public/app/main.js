/*
|--------------------------------------------------------------------------
| Console main (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| Entry point: the page's wiring, then the three calls that start the console.
|
| Every listener here is one line; handler bodies live with the feature they
| belong to, so reading the wiring does not mean reading the console.
|
| index.html loads modal.js as a classic script and this file as a module —
| module scripts are deferred, so the DOM is complete before the wiring runs.
|--------------------------------------------------------------------------
*/

import { el } from "./dom.js";
import { openEventsModal, openExecutionModal } from "./modal-manager.js";
import { openHistory } from "./history-view.js";
import { openMcp } from "./mcp-view.js";
import { toggleDiscussionMode } from "./discussion-view.js";
import { openApprovalModal } from "./approvals-view.js";
import { applyLogFilter } from "./event-view.js";
import { loadSettings } from "./api.js";
import { connect } from "./event-stream.js";
import { openSettings } from "./settings-view.js";
import { cancelCurrentRun, clearConversation, setAutoContinue, submitTaskForm } from "./task-runner.js";
import { initProjects } from "./project-switcher.js";
import { approvalState, eventState } from "./store.js";

el("taskForm").addEventListener("submit", submitTaskForm);

el("cancelButton").addEventListener("click", cancelCurrentRun);

el("clearButton").addEventListener("click", clearConversation);

el("autoContinue").addEventListener("change", setAutoContinue);

el("clearLog").addEventListener("click", () => {

    el("log").innerHTML = "";

    /*
    | The type list is built from the rows that exist, so emptying the
    | list has to rebuild it or it would keep offering types that are
    | no longer there.
    */

    applyLogFilter();
});

el("logFilter").addEventListener("input", event => {

    eventState.logFilter =
        event.target.value.trim().toLowerCase();

    applyLogFilter();
});

el("logType").addEventListener("change", event => {

    eventState.logType = event.target.value;

    applyLogFilter();
});

el("approvalMode").addEventListener("change", event => {

    fetch("/api/approval-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: event.target.value })
    });
});

el("settingsButton").addEventListener("click", openSettings);

el("mcpButton").addEventListener("click", openMcp);

el("historyButton").addEventListener("click", openHistory);

el("executionButton").addEventListener("click", openExecutionModal);

el("eventsButton").addEventListener("click", openEventsModal);

el("discussionButton").addEventListener("click", toggleDiscussionMode);

el("approvalsButton").addEventListener("click", () => {

    if (!approvalState.approvalModal) {
        openApprovalModal();
    }
});

el("task").addEventListener("keydown", event => {

    if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter"
    ) {

        el("taskForm").requestSubmit();
    }
});

connect();

loadSettings();

initProjects();
