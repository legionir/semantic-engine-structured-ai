/*
|--------------------------------------------------------------------------
| Panels
|--------------------------------------------------------------------------
|
| Mounts the page views on their store regions, derives the run controls
| from the store, and opens the Execution, Events and (on small screens)
| Plan modals. Execution and Events live in a hidden row and open as header
| modals. A modal draws its own copy of the view from the store (class
| names only, so every id stays unique on the page); nothing is moved
| between the page and the dialog, so closing one can never strand a node.
| Both copies share the actions below, so the filter, the type and the
| open archived runs stay the same in each.
*/

import { state, touch } from "./store.js";
import { bind, html, mount, mountInModal, stickInside, stickToBottom } from "./dom.js";
import { currentRun, treeSummary } from "./execution-model.js";
import { ExecutionPanel } from "./execution-view.js";
import { Plan, planSummary } from "./plan-view.js";
import { Chat, waitingText } from "./chat.js";
import { EventsPanel } from "./event-view.js";
import { approvals, el, openCallByKey, openCallDetail } from "./console-core.js";
import { refreshDiscussionComposerStatus } from "./discussion-controller.js";


export function openExecutionModal() {

    if (state.executionModal && state.executionModal.isOpen()) {
        return state.executionModal;
    }

    /* A modal can be removed by browser/navigation cleanup without the
       component callback running. Do not let that stale handle block every
       future Execution click. */
    state.executionModal = null;

    let disposers = [];

    const handle = Modal.open({
        title: "Execution",
        subtitle: treeSummary(currentRun(state)) || null,
        size: "large",
        className: "execution-modal",
        onClose: () => {
            for (const dispose of disposers) dispose();
            state.executionModal = null;
        }
    });

    disposers = [
        mountInModal(
            handle,
            () => ExecutionPanel({
                run: currentRun(state),
                archive: state.archive,
                openIds: state.openArchiveIds,
                onToggle: toggleArchivedRun,
                onOpenCall: openCallDetail
            }),
            ["tree"]
        ),
        bind(["tree"], () => handle.setSubtitle(treeSummary(currentRun(state)) || ""))
    ];

    state.executionModal = handle;

    return handle;
}


export function openEventsModal() {

    if (state.eventsModal && state.eventsModal.isOpen()) {
        return state.eventsModal;
    }

    state.eventsModal = null;

    let dispose = () => {};

    const handle = Modal.open({
        title: "Events",
        size: "large",
        className: "events-modal",
        onClose: () => {
            dispose();
            state.eventsModal = null;
        }
    });

    dispose = mountInModal(
        handle,
        () => EventsPanel({
            state,
            onOpenCallKey: openCallByKey,
            onFilter: setLogFilter,
            onType: setLogType,
            onClear: clearLogRows
        }),
        ["log"],
        {},
        "",
        stickInside(".log")
    );

    state.eventsModal = handle;

    return handle;
}


function toggleArchivedRun(id, open) {

    if (open) state.openArchiveIds.add(id);
    else state.openArchiveIds.delete(id);
}


function setLogFilter(text) {

    state.logFilterText = String(text ?? "");
    state.logFilter = state.logFilterText.trim().toLowerCase();
    touch("log");
}


function setLogType(type) {

    state.logType = String(type ?? "");
    touch("log");
}


/* clearing the panel clears its rows; the type list follows what is left */
function clearLogRows() {

    state.logRows = [];
    touch("log");
}


/*
| The page draws the conversation and the plan. Execution and Events have
| no page copy: they are drawn only while their modal is open.
*/
export function mountViews() {

    mount(el("plan"), () => Plan({ plan: state.plan }), ["plan"]);

    mount(
        el("chat"),
        () => Chat({
            state,
            onToggleExecution: (key, open) => {
                if (open) state.openExecutionKeys.add(key);
                else state.openExecutionKeys.delete(key);
            }
        }),
        ["chat"],
        {},
        stickToBottom
    );

    bind(["plan"], () => {
        const summary = el("planSummary");
        if (summary) summary.textContent = planSummary(state.plan);
    });

    bind(["header"], () => {

        const set = (id, text) => {
            const target = el(id);
            if (target) target.textContent = text;
        };

        set("workspace", state.workspace ?? "");
        set("model", state.model ?? "");
        set("turns", state.turnsText);
        set("sessionTitle", state.session ? state.session.title || "new conversation" : "");
        set("autoSwitchStatus", `auto-switch · ${state.autoContinue ? "on" : "off"}`);

        /* the header pair of policy controls (Settings draws its own pair
           from the same state) */
        const approvalMode = el("approvalMode");
        if (approvalMode && state.approvalMode !== null && state.approvalMode !== undefined) {
            approvalMode.value = state.approvalMode;
        }

        const autoContinue = el("autoContinue");
        if (autoContinue) autoContinue.checked = Boolean(state.autoContinue);
    });

    bindRunControls();

    bind(["approvals"], () => approvals.sync());

    bind(["discussion", "composer"], () => refreshDiscussionComposerStatus());
}


let runTimer = null;


let waitingTimer = null;


/* status dot, run/stop buttons and the run timer are derived from the store */
function bindRunControls() {

    bind(["run", "composer", "discussion"], () => {

        const dot = el("statusDot");
        const text = el("statusText");
        const run = el("runButton");
        const cancel = el("cancelButton");
        const discussionRunning = state.discussion?.status === "running";

        if (dot) dot.className = `dot ${state.status}`;
        if (text) text.textContent = state.reconnecting ? "reconnecting" : state.status;

        if (run) {
            run.disabled =
                state.status === "running" || state.uploading || state.submitting || discussionRunning;
            run.textContent =
                state.uploading && state.status !== "running"
                    ? "Uploading files…"
                    : discussionRunning
                        ? "Discussion running…"
                        : state.discussionMode ? "Start discussion" : "Run task";
        }

        if (cancel) {
            cancel.disabled = state.status !== "running" || state.stopPending;
            cancel.textContent = state.stopPending ? "Stopping…" : "Stop";
        }

        if (state.status === "running" && !runTimer) {
            runTimer = setInterval(() => {
                const timer = el("runTimer");
                if (timer && state.startedAt) {
                    timer.textContent = `${((Date.now() - state.startedAt) / 1000).toFixed(1)} s`;
                }
            }, 100);
        } else if (state.status !== "running" && runTimer) {
            clearInterval(runTimer);
            runTimer = null;
        }
    });

    /*
    | Only the elapsed text of the waiting bubble changes while the
    | endpoint works; the conversation itself is not redrawn for it.
    */
    bind(["chat"], () => {

        if (state.waiting && !waitingTimer) {
            waitingTimer = setInterval(() => {
                const text = el("chat")?.querySelector(".bubble.pending .text");
                if (text && state.waiting) text.textContent = waitingText(state.waiting);
            }, 200);
        } else if (!state.waiting && waitingTimer) {
            clearInterval(waitingTimer);
            waitingTimer = null;
        }
    });
}


function isMobilePlanViewport() {

    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia === "function") {
        return window.matchMedia("(max-width: 900px)").matches;
    }
    return Number(window.innerWidth || 0) <= 900;
}


export function openPlanModal() {

    if (!isMobilePlanViewport() || (state.planModal && state.planModal.isOpen())) return;

    let dispose = () => {};

    const handle = Modal.open({
        title: "Plan",
        subtitle: planSummary(state.plan) || null,
        size: "large",
        onClose: () => {
            dispose();
            state.planModal = null;
        }
    });

    dispose = mountInModal(
        handle,
        () => html`<div class="plan-view"><${Plan} plan=${state.plan} /></div>`,
        ["plan"],
        {},
        "plan-modal-content"
    );

    state.planModal = handle;
}
