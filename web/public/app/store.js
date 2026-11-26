/*
|--------------------------------------------------------------------------
| Console store
|--------------------------------------------------------------------------
|
| One plain state object, owned here, and one signal per region of the
| screen. Code that changes state calls touch() with the regions it
| changed; every view mounted on one of those regions re-renders once at
| the end of the current batch. Nothing else triggers a render.
|
| The state is deliberately mutable plain data (Maps and arrays, no
| proxies): the reducers in runtime-state.js keep the exact semantics the
| imperative console had, and the regions make the dependency of each view
| explicit instead of inferred.
|
| Domains held here, for orientation: runtimeState (status, run timer),
| executionState (agents, graphs, calls, hooks, loops, archive),
| conversationState (messages, waiting), eventState (events, log rows and
| filter), approvalState (approval:request / approval:resolved), planState,
| settingsState, mcpState, historyState and projectState.
|--------------------------------------------------------------------------
*/

import { signal, batch } from "../vendor/signals-core.module.js";

export { batch };


export const REGIONS = Object.freeze([
    "run",
    "header",
    "tree",
    "plan",
    "chat",
    "log",
    "approvals",
    "attachments",
    "composer",
    "discussion",
    "projects",
    "settings",
    "mcp",
    "history",
    "dashboard",
    "logs",
    "terminal",
    "files",
    "tabs",
    "queue"
]);


/* the caps the console has always enforced */
export const LIMITS = Object.freeze({
    events: 5000,
    logRows: 400,
    archivedRuns: 50
});


export function createState() {

    return {
        /* executionState */
        agents: new Map(),
        order: [],
        graphs: new Map(),
        calls: new Map(),
        loops: [],
        hooks: new Map(),
        hookOrder: [],
        currentTask: null,
        archive: [],
        openArchiveIds: new Set(),

        /* approvalState */
        approvals: new Map(),

        /* planState */
        plan: null,

        /* conversationState */
        messages: [],
        waiting: null,
        openExecutionKeys: new Set(),

        /* eventState */
        events: [],
        logRows: [],
        logSeq: 0,
        logFilter: "",
        logFilterText: "",
        logType: "",

        /* runtimeState */
        /* how often a queued run on a project outside the visible stream
           is checked for its end (ms) */
        queuePollMs: 1500,
        status: "idle",
        startedAt: null,
        stopPending: false,
        activeProjectId: null,
        submitting: false,
        uploading: false,

        /* header */
        workspace: "",
        model: "",
        turnsText: "",
        approvalMode: null,
        autoContinue: false,
        reconnecting: false,

        /* historyState */
        session: null,
        sessions: [],
        history: null,

        /* settingsState */
        settings: [],
        settingsStatus: new Map(),
        modelCatalog: null,
        modelCatalogResult: null,

        /* mcpState: filled by mcp-view's createMcpState when the modal opens */
        mcp: null,
        /* operator tools: filled by their controllers when first opened */
        logs: null,
        terminal: null,
        files: null,
        /* how often the Logs badge checks for new errors (ms) */
        logBadgePollMs: 20000,
        /* keystrokes typed within this window go in one request (ms) */
        terminalInputFlushMs: 8,
        /* a dialog resize settles this long before the shell is told (ms) */
        terminalResizeDebounceMs: 120,

        /* discussion */
        discussion: null,
        discussionMode: false,
        discussionPersonas: [],
        /* the composer's persona picker: null until the personas first load */
        discussionSelection: null,
        discussionRounds: "5",
        /* an error on the composer line stays until the operator submits again */
        discussionError: null,

        /* projectState */
        projects: [],
        currentProjectId: null,
        taskScopeMode: "current",
        taskProjectIds: [],
        dashboard: { open: false, projectId: null, tab: "overview", request: 0, loading: false, data: null, saving: false, saveMessage: "" },
        multiQueue: [],

        /* conversationState per project (P1-03 / P1-04 / P1-05): one line
           per live conversation, the visible project's message queue, the
           conversations that finished or asked while the page was hidden,
           and whether the operator wants browser notifications */
        conversations: [],
        queue: null,
        conversationMode: null,
        attention: new Set(),
        notificationsEnabled: false,
        editingQueueItem: null,

        attachments: [],
        attachmentError: null,
        gatewayHealth: null
    };
}


export const state = createState();


const regions =
    new Map(REGIONS.map(name => [name, signal(0)]));


function regionOf(name) {

    const region = regions.get(name);

    if (!region) {
        throw new Error(`unknown store region: ${name}`);
    }

    return region;
}


/* Marks regions as changed. Inside batch() the renders run once, at the end. */
export function touch(...names) {

    batch(() => {

        for (const name of names) {
            regionOf(name).value++;
        }
    });
}


/* Reads a region inside an effect, which subscribes the effect to it. */
export function watch(name) {

    return regionOf(name).value;
}
