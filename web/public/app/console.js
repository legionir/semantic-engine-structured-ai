/*
|--------------------------------------------------------------------------
| Console controller
|--------------------------------------------------------------------------
|
| The console keeps no state of its own beyond what the runtime reports.
| Events from the stream go through the reducer in runtime-state.js into
| the store (store.js); the panels are views mounted on store regions and
| redraw themselves (execution-view, plan-view, chat, event-view,
| discussion-view, approval-state). This file owns what is left: the
| request/response flows (task submit, settings, MCP, history, projects),
| the stream connection, and the wiring of index.html's controls.
|
| Three things are deliberately modal rather than inline, because they
| interrupt: settings, an approval request, and the full detail of one
| executed call. They share the Modal service in modal.js.
*/

import { state, touch, batch, REGIONS } from "./store.js";
import { mount, bind, stickToBottom, stickInside, mountInModal, html } from "./dom.js";
import { reduce, applySnapshot as reduceSnapshot, setRunStatus } from "./runtime-state.js";
import { resetRun, currentRun, treeSummary } from "./execution-model.js";
import { normalizeConversationMessage, normalizeConversationMessages } from "./conversation-model.js";
import { Tree, Archive, ExecutionPanel, openCallDetail as showCallDetail } from "./execution-view.js";
import { Plan, planSummary } from "./plan-view.js";
import { Chat, waitingText } from "./chat.js";
import { LogRows, LogTypeOptions, EventsPanel, logViews, logCountText } from "./event-view.js";
import { Discussion } from "./discussion-view.js";
import { createApprovals } from "./approval-state.js";
import { Attachments } from "./composer-view.js";
import { DashboardTabs, DashboardBody, dashboardHeading, dashboardTab } from "./project-view.js";
import { Sessions, historySubtitle } from "./history-view.js";
import { McpBody, createMcpState, mcpSubtitle, connectBody } from "./mcp-view.js";
import { SettingsBody, APPROVAL_MODES, isLlmSetting, isModelSetting, modelCatalogConfigChanged } from "./settings-view.js";

const el = id => document.getElementById(id);


/*
| Handles of open modals and in-flight flags. They describe the page, not
| the runtime, so they live beside the store's data rather than in it.
*/
Object.assign(state, {
    historyModal: null,
    executionModal: null,
    eventsModal: null,
    settingsModal: null,
    llmSettingsModal: null,
    planModal: null,
    mcpModal: null,
    mcpTab: "servers",
    mcpConfigText: "",
    mcpConfigPath: "",
    mcpConfigError: null,
    mcpConfigNotice: "",
    discussionModal: null,
    historyOpening: false,
    mcpOpening: false,
    eventSource: null
});

const PROJECT_STORAGE_KEY = "structured-ai.currentProjectId";



function node(tag, className, text) {

    const element =
        document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined && text !== null) {
        element.textContent = text;
    }

    return element;
}


/* -------------------------------------------------------------- sessions */

async function openHistory() {

    if (state.historyModal && state.historyModal.isOpen()) {
        return state.historyModal;
    }

    /* Fetching the list is asynchronous. Ignore double clicks while it is
       in flight; otherwise two orphaned dialogs are pushed onto the modal
       stack and the visible one no longer matches state.historyModal. */
    if (state.historyOpening) {
        return null;
    }

    state.historyOpening = true;

    let payload = null;

    try {
        const response = await fetch("/api/sessions");
        payload = response.ok ? await response.json() : null;
    } catch {
        payload = null;
    }

    if (!payload || !Array.isArray(payload.sessions)) {
        state.historyOpening = false;
        notifyError("The saved conversations could not be loaded.");
        return null;
    }

    state.sessions = payload.sessions;
    state.history = { sessions: payload.sessions, current: payload.current, pending: null, error: null };

    let dispose = () => {};

    const handle = Modal.open({
        title: "Conversations",
        subtitle: historySubtitle(payload.sessions),
        size: "medium",
        footer: Modal.row(
            Modal.button("New conversation", "ghost", () => startNewConversation(handle)),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            dispose();
            state.historyModal = null;
        }
    });

    state.historyModal = handle;
    state.historyOpening = false;

    dispose = mountInModal(
        handle,
        () => Sessions({ history: state.history, onOpen: loadSession }),
        ["history"]
    );

    return handle;
}


function historyFailure(message) {

    if (state.historyModal && state.historyModal.isOpen()) {
        state.history.pending = null;
        state.history.error = message;
        touch("history");
    } else {
        notifyError(message);
    }
}


async function startNewConversation(handle) {

    if (state.history?.pending) return;

    state.history.pending = "new";
    state.history.error = null;
    touch("history");

    try {
        const response = await fetch("/api/sessions", { method: "POST" });
        if (!response.ok) {
            historyFailure(await failureText(response, "A new conversation was not started"));
            return;
        }
    } catch (error) {
        historyFailure(`A new conversation was not started: ${error.message || "network error"}`);
        return;
    }

    handle.close("new");
}


/*
| Another console switched conversation: load it. Several switches in a
| row resolve out of order, so only the newest request is applied.
*/
let sessionRequest = 0;

async function refreshSession(id) {

    const request = ++sessionRequest;

    try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
        if (!response.ok) return;
        const payload = await response.json();
        if (request === sessionRequest && payload?.session) applySession(payload.session);
    } catch {
        /* the next session:switched or snapshot redraws it */
    }
}


async function loadSession(id) {

    const request = ++sessionRequest;

    if (state.history) {
        state.history.pending = id;
        state.history.error = null;
        touch("history");
    }

    let payload = null;

    try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "POST" });
        if (!response.ok) {
            historyFailure(await failureText(response, "The conversation could not be opened"));
            return;
        }
        payload = await response.json();
    } catch (error) {
        historyFailure(`The conversation could not be opened: ${error.message || "network error"}`);
        return;
    }

    if (request !== sessionRequest || !payload?.session) {
        return;
    }

    applySession(payload.session);
    state.historyModal?.close("loaded");
}


/* ------------------------------------------------------------------ mcp */

/*
| Every MCP action reports its outcome: a refused toggle or removal is
| shown on its row, a failed connect in the form, a failed save under the
| editor. The list only changes when the server says it did.
*/

async function mcpRequest(url, options = {}) {

    let response;

    try {
        response = await fetch(url, options);
    } catch (error) {
        return { ok: false, error: error.message || "network error" };
    }

    const payload = await response.json().catch(() => ({}));

    return response.ok
        ? { ok: true, payload }
        : { ok: false, error: payload.error || `request failed (${response.status})` };
}


async function refreshMcp(force = false) {

    const result = await mcpRequest(`/api/mcp${force ? "?refresh=1" : ""}`);

    if (!result.ok || !result.payload || typeof result.payload !== "object") {
        return false;
    }

    state.mcp.payload = {
        ...result.payload,
        servers: Array.isArray(result.payload.servers) ? result.payload.servers : []
    };

    state.mcpModal?.setSubtitle(mcpSubtitle(state.mcp.payload));
    touch("mcp");

    return true;
}


async function loadMcpConfig() {

    const mcp = state.mcp;
    const result = await mcpRequest("/api/mcp/config");

    mcp.configNotice = "";

    if (result.ok) {
        mcp.configText = result.payload.text || '{\n  "mcpServers": {}\n}\n';
        mcp.configPath = result.payload.path || "";
        mcp.configError = null;
        mcp.configKey++;
    } else {
        mcp.configError = result.error;
    }

    touch("mcp");
}


async function mcpServerAction(server, url, options) {

    const mcp = state.mcp;

    mcp.pending.add(server.name);
    mcp.rowErrors.delete(server.name);
    touch("mcp");

    const result = await mcpRequest(url, options);

    mcp.pending.delete(server.name);

    if (!result.ok) {
        mcp.rowErrors.set(server.name, result.error);
    }

    touch("mcp");

    if (result.ok) {
        await refreshMcp(false);
    }
}


const mcpActions = {

    tab(tab) {
        state.mcp.tab = tab;
        touch("mcp");
    },

    transport(value) {
        state.mcp.transport = value;
        touch("mcp");
    },

    toggle(server) {
        return mcpServerAction(server, `/api/mcp/${encodeURIComponent(server.name)}/enabled`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: !server.enabled })
        });
    },

    remove(server) {
        return mcpServerAction(server, `/api/mcp/${encodeURIComponent(server.name)}`, { method: "DELETE" });
    },

    async connect(form) {

        const mcp = state.mcp;
        const body = connectBody(form);

        if (!body.name) {
            mcp.formMessage = "a server needs a name";
            touch("mcp");
            return;
        }

        mcp.connecting = true;
        mcp.formMessage = "connecting…";
        touch("mcp");

        const result = await mcpRequest("/api/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        });

        mcp.connecting = false;

        if (!result.ok) {
            mcp.formMessage = result.error;
            touch("mcp");
            return;
        }

        /* a new form: the fields are empty again, the transport stays */
        mcp.formMessage = "";
        mcp.formKey++;
        touch("mcp");

        await refreshMcp(false);
    },

    async save(text) {

        const mcp = state.mcp;
        let parsed;

        try {
            parsed = JSON.parse(text);
        } catch (error) {
            mcp.configError = `Invalid JSON: ${error.message}`;
            touch("mcp");
            return;
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            mcp.configError = "MCP config must be a JSON object.";
            touch("mcp");
            return;
        }

        mcp.saving = true;
        mcp.configError = null;
        mcp.configNotice = "Saving…";
        touch("mcp");

        const result = await mcpRequest("/api/mcp/config", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text })
        });

        mcp.saving = false;

        if (!result.ok) {
            mcp.configError = result.error;
            mcp.configNotice = "";
            touch("mcp");
            return;
        }

        /* the buffer already holds this text; it is not remounted */
        mcp.configText = text;
        mcp.configPath = result.payload.path || mcp.configPath;
        mcp.configNotice = "Saved. MCP servers are reloading.";
        touch("mcp");

        await refreshMcp(false);
    }
};


async function openMcp() {

    if (state.mcpModal && state.mcpModal.isOpen()) {
        return state.mcpModal;
    }

    if (state.mcpOpening) {
        return null;
    }

    state.mcpOpening = true;

    /* each opening starts from what the server says now */
    state.mcp = { ...createMcpState(), tab: state.mcp?.tab || "servers" };

    const loaded = await refreshMcp(false);

    if (!loaded) {
        state.mcpOpening = false;
        notifyError("The MCP servers could not be loaded.");
        return null;
    }

    await loadMcpConfig();

    let dispose = () => {};

    const handle = Modal.open({
        title: "MCP servers",
        subtitle: mcpSubtitle(state.mcp.payload),
        size: "medium",
        footer: Modal.row(
            Modal.button("Reconnect all", "ghost", () => refreshMcp(true)),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            dispose();
            state.mcpModal = null;
        }
    });

    state.mcpModal = handle;
    state.mcpOpening = false;

    dispose = mountInModal(handle, () => McpBody({ mcp: state.mcp, actions: mcpActions }), ["mcp"]);

    return handle;
}


/*
| Discussion
| ----------
| The form starts a discussion; while it runs, the same event stream
| the delegation tree uses paints the rounds into the modal as they
| happen. The final report is the only part the observer guarantees,
| so it gets its own section once discussion:finish lands.
*/

function discussionOptionsRow() {

    const container =
        el("discussionOptions");

    if (!container || container.dataset.built === "1") {
        return container;
    }

    container.dataset.built = "1";

    const grid = node("div", "discussion-personas");

    const setAll = checked => {

        for (const box of grid.querySelectorAll("input[type=checkbox]")) {
            box.checked = checked;
        }
    };

    /* the spec's example panel, so a first run already shows a
       disagreement instead of a monologue */
    const preselect =
        new Set(["security", "backend", "frontend", "architect", "performance"]);

    for (const persona of state.discussionPersonas) {

        const label = node("label", "discussion-persona");
        label.title = persona.description;

        const checkbox = node("input", "persona-box");
        checkbox.type = "checkbox";
        checkbox.value = persona.id;
        checkbox.checked = preselect.has(persona.id);

        label.append(checkbox, node("span", null, persona.id));

        grid.appendChild(label);
    }

    const head = node("div", "discussion-persona-head");
    head.appendChild(node("span", null, "personas"));

    head.append(
        Modal.button("all", "link", () => setAll(true)),
        Modal.button("none", "link", () => setAll(false))
    );

    const bottom = node("div", "discussion-meta");

    const rounds = node("input", "filter");
    rounds.id = "discussionRounds";
    rounds.type = "number";
    rounds.min = "1";
    rounds.max = "10";
    rounds.value = "5";
    rounds.title = "maximum rounds (1-10)";

    const status = node("span", "muted discussion-status-line");
    status.id = "discussionStatusLine";

    bottom.append(
        node("span", null, "max rounds"),
        rounds,
        status
    );

    container.append(head, grid, bottom);

    return container;
}


function selectedDiscussionPersonas() {

    const boxes =
        el("discussionOptions")?.querySelectorAll(
            ".persona-box"
        );

    return [
        ...(boxes || [])
    ].filter(box => box.checked).map(box => box.value);
}


/*
| The composer's discussion status line and the Discussion button. The run
| button is not touched here: its label and state are derived from the
| store in bindRunControls().
*/
function refreshDiscussionComposerStatus() {

    const button = el("discussionButton");
    const line = el("discussionStatusLine");
    const discussion = state.discussion;

    if (button) {
        button.classList.toggle("active", state.discussionMode);
    }

    if (!line || line.dataset.error === "1") {
        return;
    }

    line.className = "muted discussion-status-line";
    line.replaceChildren();

    if (!discussion) {
        return;
    }

    let text;

    if (discussion.status === "running") {
        const round =
            discussion.rounds?.length
                ? `${discussion.rounds.length} of ${discussion.max_rounds}`
                : "starting";
        text = `round ${round} ·`;
    } else if (discussion.status === "done") {
        text = `done in ${discussion.total_rounds} round(s) ·`;
    } else {
        text = `failed · ${discussion.error || "unknown error"}`;
    }

    line.appendChild(node("span", null, text));

    if (discussion.status !== "failed") {
        line.appendChild(Modal.button("view", "link", () => openDiscussion()));
    }
}


/* an error on the composer line stays until the operator acts again */
function showDiscussionError(message) {

    const line = el("discussionStatusLine");

    if (!line) {
        return;
    }

    line.dataset.error = "1";
    line.className = "bad";
    line.textContent = message;
}


function clearDiscussionError() {

    const line = el("discussionStatusLine");

    if (line) {
        delete line.dataset.error;
    }
}


async function toggleDiscussionMode() {

    /* while a discussion is going, the button opens the live view
       instead of flipping the form */

    if (state.discussion?.status === "running") {
        openDiscussion();
        return;
    }

    state.discussionMode = !state.discussionMode;

    if (state.discussionMode && state.discussionPersonas.length === 0) {

        try {
            const response = await fetch("/api/discussion/personas");
            const payload = await response.json();
            state.discussionPersonas = response.ok ? payload.personas || [] : [];
        } catch {
            state.discussionPersonas = [];
        }
    }

    const options = el("discussionOptions");

    if (options) {
        options.hidden = !state.discussionMode;
    }

    if (state.discussionMode) {
        discussionOptionsRow();
    }

    touch("composer");
}


function openDiscussion() {

    if (state.discussionModal && state.discussionModal.isOpen()) {
        return state.discussionModal;
    }

    let dispose = () => {};

    const handle =
        Modal.open({
            title: "Discussion",
            subtitle: "specialist personas deliberate in rounds; an observer decides when to finish",
            size: "large",
            footer: Modal.row(Modal.button("Close", "", () => handle.close("footer"))),
            onClose: () => {
                dispose();
                state.discussionModal = null;
            }
        });

    dispose = mountInModal(handle, Discussion, ["discussion"], { state }, "discussion");

    state.discussionModal = handle;

    return handle;
}

/*
| Execution and Events live in a hidden row and open as header modals.
| A modal draws its own copy of the view from the store (class names
| only, so every id stays unique on the page); nothing is moved between
| the page and the dialog, so closing one can never strand a node.
*/

function openExecutionModal() {

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


function openEventsModal() {

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


/* --------------------------------------------------------- shared actions */

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
| Opening a conversation replays the events it stored, so the Execution
| and Events cards are rebuilt by the same code that draws them live.
| Nothing is summarised for storage, which is why this works at all.
*/

/* ------------------------------------------------------------ store glue */

/*
| Side effects an event asks for. Run for live events only: a snapshot or
| a stored session is replayed to redraw the past, not to re-trigger it.
*/
function runEffects(effects) {

    for (const effect of effects) {

        if (effect.type === "runSettled") {
            projectRunSettled(effect.projectId);
        } else if (effect.type === "loadSettings") {
            loadSettings();
        } else if (effect.type === "refreshSession") {
            refreshSession(effect.id);
        }
    }
}


/* one live event: reduce it, redraw what changed once, then run its effects */
function apply(event) {

    let result = null;

    batch(() => {

        if (state.reconnecting) {
            state.reconnecting = false;
            touch("run");
        }

        result = reduce(state, event);

        if (result.regions.size > 0) {
            touch(...result.regions);
        }
    });

    runEffects(result.effects);
}


/* a snapshot is reduced in full and drawn once */
function applySnapshot(snapshot) {

    batch(() => {
        reduceSnapshot(state, snapshot || {});
        touch(...REGIONS);
    });

}


/*
| Opening a conversation replays the events it stored, so the Execution
| and Events cards are rebuilt by the same code that draws them live.
*/
function applySession(session) {

    batch(() => {

        resetRun(state, true);

        state.messages = normalizeConversationMessages(session.messages);
        state.session = { id: session.id, title: session.title, turns: session.turns };
        state.events = [];
        state.logRows = [];

        for (const event of session.events || []) {
            if (event.type !== "session:message") {
                reduce(state, event);
            }
        }

        for (const call of session.calls || []) {

            if (call.key && !state.calls.has(call.key)) {

                state.calls.set(call.key, {
                    ...call,
                    argumentsPreview: JSON.stringify(call.arguments ?? {}, null, 2),
                    duration: call.duration_ms
                });
            }
        }

        touch(...REGIONS);
    });
}


function setStatus(status) {

    batch(() => {
        setRunStatus(state, status);
        touch("run");
    });
}


function pushMessage(message) {

    state.messages.push(normalizeConversationMessage(message, state.messages));
    touch("chat");
}


/*
| A request the operator made failed. The conversation is where the
| console has always reported that ("Could not start …"), so failures of
| every action are reported the same way.
*/
function notifyError(text) {

    pushMessage({ role: "assistant", kind: "error", content: text, at: Date.now() });
}


async function failureText(response, fallback) {

    const payload = await response.json().catch(() => ({}));

    return `${fallback}: ${payload.error || `request failed (${response.status})`}`;
}


/* drops the previous project's live cards while the new snapshot is in flight */
function resetProjectView() {

    batch(() => {
        resetRun(state, true);
        state.messages = [];
        state.events = [];
        state.logRows = [];
        state.approvals.clear();
        touch("tree", "chat", "log", "approvals", "plan");
    });
}


function openCallDetail(call, graph, run = currentRun(state)) {

    return showCallDetail({ Modal, call, graph, run, touchTree: () => touch("tree") });
}


function openCallByKey(key) {

    const call = state.calls.get(key);

    if (call) {
        openCallDetail(call, state.graphs.get(call.graph_id));
    }
}


const approvals = createApprovals({ Modal, state, touch });


/* ------------------------------------------------------------ views */

function mountViews() {

    mount(el("tree"), () => Tree({ run: currentRun(state), onOpenCall: openCallDetail }), ["tree"]);

    mount(el("executionArchive"), () => Archive({
        archive: state.archive,
        openIds: state.openArchiveIds,
        onToggle: toggleArchivedRun,
        onOpenCall: openCallDetail
    }), ["tree"]);

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

    mount(el("log"), () => LogRows({ state, onOpenCallKey: openCallByKey }), ["log"], {}, stickToBottom);

    mount(el("logType"), () => LogTypeOptions({ state }), ["log"]);

    bind(["tree"], () => {
        const summary = el("execSummary");
        if (summary) summary.textContent = treeSummary(currentRun(state));
    });

    bind(["plan"], () => {
        const summary = el("planSummary");
        if (summary) summary.textContent = planSummary(state.plan);
    });

    bind(["log"], () => {
        /* the filter may have been typed in the Events modal */
        const filter = el("logFilter");
        if (filter && filter.value.trim().toLowerCase() !== state.logFilter) {
            filter.value = state.logFilterText ?? state.logFilter;
        }
        const type = el("logType");
        if (type && type.value !== state.logType) type.value = state.logType;

        const count = el("logCount");
        if (!count) return;
        const views = logViews(state.logRows);
        count.textContent = logCountText(views, state.logFilter, state.logType);
        count.hidden = views.length === 0;
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

/* -------------------------------------------------------------- settings */

/* one aggregate request per catalog; a failure is kept for 10 s so a
   redraw does not repeat the same upstream fan-out */
function loadModelCatalog() {

    if (state.modelCatalog && state.modelCatalog.expiresAt > Date.now()) {
        return state.modelCatalog.promise;
    }

    const entry = { expiresAt: Infinity, promise: null };

    entry.promise = fetch("/api/models")
        .then(async response => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Model endpoint returned HTTP ${response.status}.`);
            }
            if (!Array.isArray(payload.models) || !payload.byRole) {
                throw new Error(payload.error || "Model endpoint returned an invalid catalog.");
            }
            return payload;
        })
        .then(catalog => {
            if (state.modelCatalog === entry) {
                state.modelCatalogResult = { catalog };
                touch("settings");
            }
            return catalog;
        })
        .catch(error => {
            entry.expiresAt = Date.now() + 10_000;
            if (state.modelCatalog === entry) {
                state.modelCatalogResult = { error: error.message };
                touch("settings");
            }
            throw error;
        });

    entry.promise.catch(() => {});
    state.modelCatalog = entry;

    return entry.promise;
}


function forgetModelCatalog() {

    state.modelCatalog = null;
    state.modelCatalogResult = null;
}


function markSetting(key, kind, message = null) {

    if (kind) {
        state.settingsStatus.set(key, { kind, message });
    } else {
        state.settingsStatus.delete(key);
    }

    touch("settings");
}


async function saveSetting(setting, control) {

    const value = control.value;
    let failure = null;

    try {
        const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: setting.key, value })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            failure = payload.error || `request failed (${response.status})`;
        }
    } catch (error) {
        failure = `not saved: ${error.message || "network error"}`;
    }

    if (failure) {
        /* the field shows the value that is actually in effect again */
        control.value = setting.secret ? "" : String(setting.value ?? "");
        markSetting(setting.key, "rejected", failure);
        return;
    }

    if (setting.secret) control.value = "";
    if (modelCatalogConfigChanged(setting.key)) forgetModelCatalog();

    markSetting(setting.key, "saved");
    setTimeout(() => {
        if (state.settingsStatus.get(setting.key)?.kind === "saved") markSetting(setting.key, null);
    }, 800);

    loadSettings();
}


async function resetSetting(setting) {

    try {
        const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: setting.key, reset: true })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            markSetting(setting.key, "rejected", payload.error || `request failed (${response.status})`);
            return;
        }
    } catch (error) {
        markSetting(setting.key, "rejected", `not restored: ${error.message || "network error"}`);
        return;
    }

    if (modelCatalogConfigChanged(setting.key)) forgetModelCatalog();

    markSetting(setting.key, null);
    loadSettings();
}


async function loadSettings() {

    try {
        const response = await fetch("/api/settings");
        if (!response.ok) return;
        const payload = await response.json();
        if (!Array.isArray(payload.settings)) return;
        state.settings = payload.settings;
    } catch {
        /* the modal keeps the list it has; Reload tries again */
        return;
    }

    touch("settings");
}


/* the body of one settings modal, drawn from the store */
function mountSettings(handle, kind) {

    const ui = { filter: "" };
    const llm = kind === "llm";

    const dispose = mountInModal(
        handle,
        () => SettingsBody({
            list: state.settings.filter(setting => isLlmSetting(setting) === llm),
            ui,
            status: state.settingsStatus,
            catalog: state.modelCatalogResult,
            policy: llm ? null : {
                approvalMode: state.approvalMode,
                autoContinue: state.autoContinue,
                onApprovalMode: changeApprovalMode,
                onAutoContinue: changeAutoContinue
            },
            onFilter: value => { ui.filter = value; touch("settings"); },
            onSave: saveSetting,
            onReset: resetSetting
        }),
        ["settings", "header"],
        {},
        "settings"
    );

    if (state.settings.some(setting => isLlmSetting(setting) === llm && isModelSetting(setting))) {
        loadModelCatalog().catch(() => {});
    }

    return { dispose, ui };
}


function openSettings() {

    if (state.settingsModal && state.settingsModal.isOpen()) {
        return;
    }

    let view = null;

    const handle = Modal.open({
        title: "Settings",
        subtitle: "applied on next use, no restart",
        size: "large",
        footer: Modal.row(
            Modal.button("Reload", "ghost", () => loadSettings()),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => {
            view?.dispose();
            state.settingsModal = null;
        }
    });

    state.settingsModal = handle;
    view = mountSettings(handle, "general");

    loadSettings();
}


function openLlmSettings() {

    if (state.llmSettingsModal && state.llmSettingsModal.isOpen()) return;

    let view = null;

    const handle = Modal.open({
        title: "LLM settings",
        subtitle: "Providers, model layers, and proxy",
        size: "large",
        onClose: () => {
            view?.dispose();
            state.llmSettingsModal = null;
        }
    });

    state.llmSettingsModal = handle;
    view = mountSettings(handle, "llm");

    loadSettings();
}


function isMobilePlanViewport() {

    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia === "function") {
        return window.matchMedia("(max-width: 900px)").matches;
    }
    return Number(window.innerWidth || 0) <= 900;
}


function openPlanModal() {

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


/* ----------------------------------------------------------- projects UI */

function browserLocation() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.location) {
            return globalThis.location;
        }

    } catch {
        /* tests / workers */
    }

    return { pathname: "/", search: "" };
}


function browserHistory() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.history) {
            return globalThis.history;
        }

    } catch {
        /* tests */
    }

    return null;
}


function browserStorage() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.localStorage) {
            return globalThis.localStorage;
        }

    } catch {
        /* private mode */
    }

    return null;
}


function readStoredProjectId() {

    const storage = browserStorage();

    if (!storage) {
        return null;
    }

    try {
        return storage.getItem(PROJECT_STORAGE_KEY);
    } catch {
        return null;
    }
}


function writeStoredProjectId(projectId) {

    const storage = browserStorage();

    if (!storage) {
        return;
    }

    try {

        if (projectId) {
            storage.setItem(PROJECT_STORAGE_KEY, projectId);
        } else {
            storage.removeItem(PROJECT_STORAGE_KEY);
        }

    } catch {
        /* private mode */
    }
}


function parseProjectRoute() {

    const location = browserLocation();
    const pathname = location.pathname || "/";
    const search = location.search || "";
    const params = new URLSearchParams(search);
    const match = /^\/projects\/([^/]+)\/?$/.exec(pathname);
    const tab = params.get("tab") || "overview";

    return {
        projectId: match ? decodeURIComponent(match[1]) : params.get("project"),
        dashboard: Boolean(match),
        tab
    };
}


function navigateConsole(projectId, tab, replace) {

    const dashboard = Boolean(tab);
    const path =
        projectId && dashboard
            ? `/projects/${encodeURIComponent(projectId)}${
                tab && tab !== "overview"
                    ? `?tab=${encodeURIComponent(tab)}`
                    : ""
            }`
            : projectId
                ? `/?project=${encodeURIComponent(projectId)}`
                : "/";

    try {

        const history = browserHistory();
        const method = replace ? "replaceState" : "pushState";

        if (history && typeof history[method] === "function") {
            history[method]({ projectId, tab }, "", path);
        }


    } catch {
        /* tests */
    }
}


function projectById(id) {

    return state.projects.find(item => item.id === id) || null;
}


function renderProjectSwitcher() {

    const label = el("activeProjectName");
    if (!label) return;

    if (state.taskScopeMode === "multiple" && state.taskProjectIds.length > 1) {
        label.textContent = `Multiple projects · ${state.taskProjectIds.length}`;
        return;
    }

    const project = projectById(state.currentProjectId);
    label.textContent = project ? (project.name || project.id) : "Default Workspace";
}


function selectedTaskScope() {

    return state.taskScopeMode || "current";
}


function selectedTaskProjectIds() {

    if (selectedTaskScope() === "multiple") {
        return [...state.taskProjectIds];
    }

    return state.currentProjectId ? [state.currentProjectId] : [];
}


function renderAttachments() {

    touch("attachments");
}


function removeAttachment(index) {

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
        const response = await fetch(`/api/uploads${query}`, {
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


function taskWithAttachments(task, files) {

    if (!files || files.length === 0) return task;

    return `${task}\n\nAttached files (stored locally on the server):\n${files
        .map(file => `- ${JSON.stringify(file.name)}: ${JSON.stringify(file.path)}`)
        .join("\n")}\n\nTreat these as user-provided input files. Inspect or extract them as appropriate for the task; do not execute uploaded code unless the task explicitly requires it.`;
}


function setUploadingState(uploading) {

    state.uploading = Boolean(uploading);
    touch("composer");
}


function labelChatForProject(projectId) {

    const project = projectById(projectId);
    const name = project ? project.name : projectId;

    pushMessage({
        role: "system",
        kind: "message",
        content: `Project · ${name}`,
        at: Date.now()
    });
}


function startLabeledProjectQueue(task, projectIds, attachmentFilesByProject = new Map(), reasoningEffort = null) {

    state.multiQueue = projectIds.map(id => ({
        projectId: id,
        task: taskWithAttachments(
            `[${(projectById(id) || { name: id }).name}] ${task}`,
            attachmentFilesByProject.get(id) || []
        ),
        reasoningEffort
    }));

    drainProjectTaskQueue();
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


function stopProjectQueue() {

    state.multiQueue = [];
    queueCurrent = null;
    queueToken++;
}


/* a run:status that is not "running" arrived on the stream */
function projectRunSettled(projectId) {

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


async function drainProjectTaskQueue() {

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


async function loadProjects() {

    try {

        const response = await fetch("/api/projects");

        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        state.projects = payload.projects || [];
        renderProjectSwitcher();

    } catch {
        state.projects = [];
    }
}


function setCurrentProject(projectId, options = {}) {

    const next = projectId || null;

    if (state.currentProjectId === next && !options.force) {

        if (options.dashboard) {
            openProjectDashboard(next, options.tab || "overview");
        }

        return;
    }

    state.currentProjectId = next;
    writeStoredProjectId(next);
    renderProjectSwitcher();

    if (!options.skipNavigate) {
        navigateConsole(next, options.dashboard ? (options.tab || "overview") : null, options.replace);
    }

    /* Drop the previous project's live cards so B cannot linger in A
       while the new stream snapshot is in flight. */
    resetProjectView();

    connect();

    if (options.dashboard && next) {
        openProjectDashboard(next, options.tab || "overview");
    } else if (!options.keepDashboard) {
        closeProjectDashboard();
    }
}


function refreshGatewayHealthChip(health) {

    const chip = el("gatewayHealth");

    if (!chip) {
        return;
    }

    const status = health?.status || health?.gateway?.status || "unknown";
    chip.textContent = `health · ${status}`;
    chip.classList.remove("health-ok", "health-degraded", "health-down");

    if (status === "ok") {
        chip.classList.add("health-ok");
    } else if (status === "down") {
        chip.classList.add("health-down");
    } else {
        chip.classList.add("health-degraded");
    }

    chip.href = state.currentProjectId
        ? `/projects/${encodeURIComponent(state.currentProjectId)}?tab=overview`
        : "/api/health";
}


async function loadGatewayHealth() {

    try {

        const response = await fetch("/api/health");

        if (!response.ok) {
            return;
        }

        state.gatewayHealth = await response.json();
        refreshGatewayHealthChip(state.gatewayHealth);

    } catch {
        /* health is optional */
    }
}


function closeProjectDashboard() {

    state.dashboard.open = false;
    state.dashboard.request++;
    touch("dashboard");
}


/*
| Loads what the dashboard shows for one project and tab. Each load takes
| a token; a response for a tab or project the operator already left is
| dropped instead of overwriting the one on screen.
*/
async function loadDashboard() {

    const dashboard = state.dashboard;
    const request = ++dashboard.request;
    const projectId = dashboard.projectId;
    const base = `/api/projects/${encodeURIComponent(projectId)}`;

    dashboard.loading = true;
    touch("dashboard");

    const read = async url => {
        try {
            const response = await fetch(url);
            return response.ok ? await response.json() : null;
        } catch {
            return null;
        }
    };

    const [project, projectState, metrics, health, sessions] = await Promise.all([
        read(base),
        read(`${base}/state`),
        read(`${base}/metrics`),
        read(`${base}/health`),
        read(`${base}/sessions`)
    ]);

    if (request !== state.dashboard.request || projectId !== state.dashboard.projectId) {
        return;
    }

    dashboard.loading = false;
    dashboard.data = {
        record: project?.project || projectById(projectId),
        projectState,
        metrics,
        health,
        sessions: Array.isArray(sessions?.sessions) ? sessions.sessions : []
    };

    touch("dashboard");
}


async function saveDashboardSettings(changes) {

    const dashboard = state.dashboard;
    const projectId = dashboard.projectId;

    dashboard.saving = true;
    dashboard.saveMessage = "";
    touch("dashboard");

    let failure = null;

    try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: String(changes.name || "").trim(), enabled: Boolean(changes.enabled) })
        });
        if (!response.ok) {
            failure = await failureText(response, "Not saved");
        }
    } catch (error) {
        failure = `Not saved: ${error.message || "network error"}`;
    }

    if (projectId !== state.dashboard.projectId) {
        return;
    }

    dashboard.saving = false;
    dashboard.saveMessage = failure || "Saved.";
    touch("dashboard");

    if (!failure) {
        await loadProjects();
        await loadDashboard();
    }
}


function openProjectDashboard(projectId, tab) {

    if (!projectId) {
        return;
    }

    const sameProject = state.dashboard.projectId === projectId;

    state.taskScopeMode = "current";
    state.taskProjectIds = [];
    Object.assign(state.dashboard, {
        open: true,
        projectId,
        tab: dashboardTab(tab),
        data: sameProject ? state.dashboard.data : null,
        saveMessage: ""
    });

    setCurrentProject(projectId, { skipNavigate: true, keepDashboard: true });
    navigateConsole(projectId, state.dashboard.tab, false);

    loadDashboard();
}


function mountDashboard() {

    mount(el("dashboardTabs"), () => DashboardTabs({
        dashboard: state.dashboard,
        onTab: tab => openProjectDashboard(state.dashboard.projectId, tab)
    }), ["dashboard"]);

    mount(el("dashboardBody"), () => DashboardBody({
        dashboard: state.dashboard,
        plan: state.plan,
        currentProjectId: state.currentProjectId,
        onSave: saveDashboardSettings
    }), ["dashboard", "plan"]);

    bind(["dashboard"], () => {

        const dashboard = state.dashboard;
        const dash = el("projectDashboard");
        const main = el("consoleMain");

        if (dash) dash.hidden = !dashboard.open;
        if (main) main.hidden = dashboard.open;

        if (dashboard.open) {
            const heading = dashboardHeading(dashboard, projectById(dashboard.projectId));
            const title = el("dashboardTitle");
            const subtitle = el("dashboardSubtitle");
            if (title) title.textContent = heading.title;
            if (subtitle) subtitle.textContent = heading.subtitle;
        }
    });
}


function openNewProjectModal() {

    const name = node("input");
    name.placeholder = "Display name";
    const root = node("input");
    root.placeholder = "/absolute/path/to/workspace";
    const message = node("p", "mcp-message");

    const form = node("div", "mcp-add");
    const nameField = node("label", "mcp-field");
    nameField.append(node("span", "label", "name"), name);
    const rootField = node("label", "mcp-field");
    rootField.append(node("span", "label", "root path (created if missing)"), root);
    form.append(nameField, rootField, message);

    const handle = Modal.open({
        title: "New Project",
        subtitle: "Registers a workspace. Root comes from you, never from the model.",
        body: form,
        footer: Modal.row(
            Modal.button("Create", "", async () => {

                if (root.value.trim() === "") {
                    message.textContent = "a root path is required";
                    return;
                }

                let response;

                try {
                    response = await fetch("/api/projects", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            name: name.value.trim() || undefined,
                            rootPath: root.value.trim(),
                            createIfMissing: true
                        })
                    });
                } catch (error) {
                    message.textContent = `could not register: ${error.message || "network error"}`;
                    return;
                }

                const payload = await response.json().catch(() => ({}));

                if (!response.ok || !payload.project) {
                    message.textContent = payload.error || "could not register";
                    return;
                }

                await loadProjects();
                state.taskScopeMode = "current";
                state.taskProjectIds = [];
                setCurrentProject(payload.project.id);
                handle.close("created");
            }),
            Modal.button("Cancel", "ghost", () => handle.close("cancel"))
        )
    });
}


async function openProjectsManager() {

    await loadProjects();

    const body = node("div", "sessions");
    const workspaceRow = node("label", "project-choice-row");
    const workspaceChoice = node("input");
    workspaceChoice.type = "radio";
    workspaceChoice.name = "projectSelectionMode";
    workspaceChoice.value = "workspace";
    workspaceChoice.checked = state.taskScopeMode !== "multiple" && !state.currentProjectId;
    workspaceRow.append(
        workspaceChoice,
        node("span", "name", "Default Workspace"),
        node("span", "muted", "Use the default workspace")
    );
    body.appendChild(workspaceRow);

    const selectedIds = new Set(
        state.taskScopeMode === "multiple"
            ? state.taskProjectIds
            : state.currentProjectId ? [state.currentProjectId] : []
    );
    const projectBoxes = [];

    if (state.projects.length === 0) {
        body.appendChild(node("p", "empty", "No registered projects yet."));
    }

    for (const project of state.projects) {

        const row = node("div", "project-row");
        const checkbox = node("input", "project-picker-checkbox");
        checkbox.type = "checkbox";
        checkbox.value = project.id;
        checkbox.checked = selectedIds.has(project.id);
        checkbox.setAttribute("aria-label", `Select ${project.name || project.id}`);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) workspaceChoice.checked = false;
            updateConfirmState();
        });
        projectBoxes.push(checkbox);

        row.appendChild(checkbox);
        row.appendChild(node("span", "name", project.name || project.id));
        row.appendChild(node("span", "muted", project.rootPath || ""));
        row.appendChild(
            Modal.button("Open", "ghost", () => {
                handle.close("open");
                openProjectDashboard(project.id, "overview");
            })
        );
        row.appendChild(
            Modal.button("Delete", "ghost danger", async () => {
                try {
                    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
                        method: "DELETE"
                    });
                    if (!response.ok) {
                        notifyError(await failureText(response, `${project.name || project.id} was not deleted`));
                        return;
                    }
                } catch (error) {
                    notifyError(`${project.name || project.id} was not deleted: ${error.message || "network error"}`);
                    return;
                }
                await loadProjects();
                if (state.currentProjectId === project.id) setCurrentProject(null);
                handle.close("deleted");
                openProjectsManager();
            })
        );
        body.appendChild(row);
    }

    const confirmButton = Modal.button("Confirm", "", () => {
        const ids = projectBoxes.filter(box => box.checked).map(box => box.value);
        if (workspaceChoice.checked || ids.length === 0) {
            state.taskScopeMode = "current";
            state.taskProjectIds = [];
            setCurrentProject(null);
        } else if (ids.length === 1) {
            state.taskScopeMode = "current";
            state.taskProjectIds = [];
            setCurrentProject(ids[0]);
        } else {
            state.taskScopeMode = "multiple";
            state.taskProjectIds = ids;
            setCurrentProject(ids[0]);
        }
        renderProjectSwitcher();
        handle.close("confirmed");
    });

    function updateConfirmState() {
        confirmButton.disabled = !workspaceChoice.checked && !projectBoxes.some(box => box.checked);
    }

    workspaceChoice.addEventListener("change", () => {
        if (workspaceChoice.checked) projectBoxes.forEach(box => { box.checked = false; });
        updateConfirmState();
    });
    projectBoxes.forEach(box => {
        if (box.checked) workspaceChoice.checked = false;
    });
    updateConfirmState();

    const handle = Modal.open({
        title: "Projects",
        subtitle: `${state.projects.length} registered`,
        size: "medium",
        body,
        footer: Modal.row(
            Modal.button("New Project", "ghost", () => {
                handle.close("new");
                openNewProjectModal();
            }),
            confirmButton,
            Modal.button("Close", "ghost", () => handle.close("footer"))
        )
    });
}


function bindProjectControls() {

    el("newProjectButton")?.addEventListener("click", openNewProjectModal);
    el("projectsButton")?.addEventListener("click", openProjectsManager);

    const attachButton = el("attachFilesButton");
    const attachmentInput = el("attachmentInput");
    attachButton?.addEventListener("click", () => attachmentInput?.click());
    attachmentInput?.addEventListener("change", event => {
        const files = [...(event.target.files || [])];
        for (const file of files) {
            state.attachments.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, uploaded: new Map() });
        }
        state.attachmentError = null;
        renderAttachments();
        event.target.value = "";
    });
    el("dashboardBack")?.addEventListener("click", () => {

        closeProjectDashboard();
        navigateConsole(state.currentProjectId, null, false);
    });

    try {

        const win =
            typeof globalThis !== "undefined"
                ? globalThis.window
                : undefined;

        if (win && typeof win.addEventListener === "function") {

            win.addEventListener("popstate", () => {
                applyProjectRoute(true);
            });
        }

    } catch {
        /* tests */
    }
}


function applyProjectRoute(fromPop) {

    const route = parseProjectRoute();
    const stored = readStoredProjectId();
    const projectId = route.projectId || stored || null;

    if (projectId) {
        state.taskScopeMode = "current";
        state.taskProjectIds = [];
    }

    if (route.dashboard && projectId) {

        setCurrentProject(projectId, {
            force: true,
            dashboard: true,
            tab: route.tab,
            skipNavigate: true,
            replace: !fromPop
        });
        return;
    }

    if (projectId) {
        setCurrentProject(projectId, { force: true, skipNavigate: true, replace: true });
    }
}


async function initProjects() {

    if (!el("activeProjectName") && !el("projectDashboard")) {
        return;
    }

    bindProjectControls();
    await loadProjects();
    applyProjectRoute(false);
    loadGatewayHealth();
}


/* ------------------------------------------------------------------ wire */

function eventsUrl() {

    if (state.currentProjectId) {

        return `/api/events?projectId=${encodeURIComponent(state.currentProjectId)}`;
    }

    return "/api/events";
}


function connect() {

    if (state.eventSource && typeof state.eventSource.close === "function") {

        try {
            state.eventSource.close();
        } catch {
            /* already closed */
        }
    }

    const source =
        new EventSource(eventsUrl());

    state.eventSource = source;

    source.onmessage = message => {

        /* a stream from a previous project must not draw into this one */
        if (state.eventSource !== source) {
            return;
        }

        let payload;

        try {
            payload = JSON.parse(message.data);
        } catch {
            return;
        }

        if (!payload || typeof payload !== "object") {
            return;
        }

        if (payload.type === "snapshot") {
            applySnapshot(payload.snapshot);
            return;
        }

        apply(payload);
    };

    source.onerror = () => {

        if (state.eventSource !== source) {
            return;
        }

        state.reconnecting = true;
        touch("run");
    };
}


/* ---------------------------------------------------------- task submit */

function selectedReasoningEffort() {

    const selected = el("taskEffort")?.value || "inherit";

    return ["low", "medium", "high", "xhigh"].includes(selected) ? selected : null;
}


function clearComposer() {

    const task = el("task");

    if (task) task.value = "";

    state.attachments = [];
    state.attachmentError = null;
    touch("attachments");
}


/* uploads the attachments for each target; false (and a chip error) on failure */
async function uploadFor(projectIds, filesByProject) {

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


/*
| Discussion mode sends the same task box to the panel instead of the
| delegation tree: the personas and the round limit come from the options
| row, and the live view opens as it runs.
*/
async function submitDiscussion(task, reasoningEffort) {

    clearDiscussionError();

    const personas = selectedDiscussionPersonas();

    if (personas.length === 0) {
        showDiscussionError("select at least one persona");
        return;
    }

    const maxRounds =
        Math.max(1, Math.min(10, Number(el("discussionRounds")?.value) || 5));

    const files = new Map();

    if (!(await uploadFor([state.currentProjectId], files))) {
        return;
    }

    const discussionTask =
        state.attachments.length > 0
            ? taskWithAttachments(task, files.get(state.currentProjectId || "__default__"))
            : task;

    const url =
        state.currentProjectId
            ? `/api/projects/${encodeURIComponent(state.currentProjectId)}/discussions`
            : "/api/discussion";

    state.submitting = true;
    touch("composer");

    try {

        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                task: discussionTask,
                personas,
                max_rounds: maxRounds,
                ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
            })
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            showDiscussionError(payload.error || `request failed (${response.status})`);
            return;
        }

        const payload = await response.json().catch(() => ({}));

        clearComposer();

        /* the stream confirms with discussion:start; this keeps the
           composer honest in the meantime */
        state.discussion = {
            id: payload.id || null,
            status: "running",
            task: discussionTask,
            personas,
            max_rounds: maxRounds,
            rounds: [],
            observer_decisions: [],
            final_report: null
        };

        touch("discussion", "composer");
        openDiscussion();

    } catch (error) {
        showDiscussionError(`the discussion could not be started (${error.message || "network error"})`);
    } finally {
        state.submitting = false;
        touch("composer");
    }
}


async function submitTask(task, reasoningEffort) {

    const targets = selectedTaskProjectIds();
    const projectIds = targets.length > 0 ? targets : [null];
    const files = new Map();

    if (!(await uploadFor(projectIds, files))) {
        return;
    }

    if (targets.length > 1) {
        startLabeledProjectQueue(task, targets, files, reasoningEffort);
        clearComposer();
        return;
    }

    const projectId = targets[0] || null;

    if (state.attachments.length > 0) {
        task = taskWithAttachments(task, files.get(projectId || "__default__"));
    }

    state.activeProjectId = projectId;
    setStatus("running");

    const url =
        projectId
            ? `/api/projects/${encodeURIComponent(projectId)}/tasks`
            : "/api/tasks";

    let response;

    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                task,
                ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
            })
        });
    } catch (error) {
        setStatus("idle");
        notifyError(`The task could not be sent: ${error.message || "network error"}`);
        return;
    }

    if (!response.ok) {
        setStatus("idle");
        notifyError(await failureText(response, "The task was not started"));
        return;
    }

    clearComposer();

    if (projectId) {
        labelChatForProject(projectId);
    }

    try {
        const snapshot = await (await fetch("/api/state")).json();
        if (snapshot && snapshot.turns !== undefined) {
            state.turnsText = `${snapshot.turns} turns`;
            touch("header");
        }
    } catch {
        /* the next snapshot carries the count */
    }
}


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

    const projectId = state.activeProjectId;
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
        const response = await fetch("/api/clear", { method: "POST" });
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


/*
| The two runtime policy controls take effect on the server. The control
| shows the new value at once and goes back to the previous one, with a
| message, if the server does not accept it.
*/
async function saveRuntimePolicy({ url, body, apply, revert, label }) {

    apply();
    touch("header");

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            revert();
            touch("header");
            notifyError(await failureText(response, `${label} was not changed`));
        }
    } catch (error) {
        revert();
        touch("header");
        notifyError(`${label} was not changed: ${error.message || "network error"}`);
    }
}


function changeAutoContinue(value) {

    const previous = Boolean(state.autoContinue);
    const next = Boolean(value);

    if (next === previous) return;

    saveRuntimePolicy({
        url: "/api/settings",
        body: { key: "AUTO_CONTINUE", value: next },
        apply: () => { state.autoContinue = next; },
        revert: () => { state.autoContinue = previous; },
        label: "Auto-continue"
    });
}


function changeApprovalMode(value) {

    const previous = state.approvalMode;
    const next = String(value ?? "");

    if (next === previous || !APPROVAL_MODES.includes(next)) return;

    saveRuntimePolicy({
        url: "/api/approval-mode",
        body: { mode: next },
        apply: () => { state.approvalMode = next; },
        revert: () => { state.approvalMode = previous; },
        label: "Approval mode"
    });
}


el("autoContinue").addEventListener("change", event => changeAutoContinue(event.target.checked));
el("approvalMode").addEventListener("change", event => changeApprovalMode(event.target.value));
el("clearLog").addEventListener("click", clearLogRows);
el("logFilter").addEventListener("input", event => setLogFilter(event.target.value));
el("logType").addEventListener("change", event => setLogType(event.target.value));


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
el("historyButton").addEventListener("click", openHistory);
el("executionButton").addEventListener("click", openExecutionModal);
el("eventsButton").addEventListener("click", openEventsModal);
el("discussionButton").addEventListener("click", toggleDiscussionMode);
el("approvalsButton").addEventListener("click", () => approvals.open());


el("task").addEventListener("keydown", event => {

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        el("taskForm").requestSubmit();
    }
});


mountViews();

mountDashboard();

mount(el("attachmentList"), () => Attachments({ state, onRemove: removeAttachment }), ["attachments"]);

connect();

loadSettings();

initProjects();
