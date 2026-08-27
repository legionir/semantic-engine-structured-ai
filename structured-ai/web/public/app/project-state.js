/*
|--------------------------------------------------------------------------
| Console project-state (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The browser-facing half of multi-project state: which project the console is
| on, where that choice is remembered (URL, history entry, localStorage), and the
| routing that keeps a deep link reloadable.
|
| Each accessor is defensive because the console also runs inside a test shim and
| where storage is denied: a throw here would take the page down, so the answer is
| `null` and the UI falls back to the global view.
|
| `eventVisibleForCurrentProject` lives here because it is the same question —
| which project does this belong to — asked of an event.
|--------------------------------------------------------------------------
*/

import { el } from "./dom.js";
import { renderTree } from "./execution-view.js";
import { renderChat } from "./chat.js";
import { renderApprovals } from "./approvals-view.js";
import { log } from "./event-view.js";
import { connect } from "./event-stream.js";
import { renderProjectSwitcher } from "./project-switcher.js";
import { closeProjectDashboard, openProjectDashboard } from "./project-dashboard.js";
import { PROJECT_STORAGE_KEY, approvalState, conversationState, eventState, projectState, resetRun } from "./store.js";

export function eventVisibleForCurrentProject(event) {

    if (!projectState.currentProjectId) {
        return true;
    }

    if (!event || !event.project_id) {
        return true;
    }

    return event.project_id === projectState.currentProjectId;
}

export function browserLocation() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.location) {
            return globalThis.location;
        }

    } catch {
        /* tests / workers */
    }

    return { pathname: "/", search: "" };
}

export function browserHistory() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.history) {
            return globalThis.history;
        }

    } catch {
        /* tests */
    }

    return null;
}

export function browserStorage() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.localStorage) {
            return globalThis.localStorage;
        }

    } catch {
        /* private mode */
    }

    return null;
}

export function readStoredProjectId() {

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

export function writeStoredProjectId(projectId) {

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

export function parseProjectRoute() {

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

export function navigateConsole(projectId, tab, replace) {

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

        const location = browserLocation();
        const url = new URL(path, "http://localhost");
        location.pathname = url.pathname;
        location.search = url.search;

    } catch {
        /* tests */
    }
}

export function projectById(id) {

    return projectState.projects.find(item => item.id === id) || null;
}

export function setCurrentProject(projectId, options = {}) {

    const next = projectId || null;

    if (projectState.currentProjectId === next && !options.force) {

        if (options.dashboard) {
            openProjectDashboard(next, options.tab || "overview");
        }

        return;
    }

    projectState.currentProjectId = next;
    writeStoredProjectId(next);
    renderProjectSwitcher();

    const switcher = el("projectSwitcher");

    if (switcher) {
        switcher.value = next || "";
    }

    if (!options.skipNavigate) {
        navigateConsole(next, options.dashboard ? (options.tab || "overview") : null, options.replace);
    }

    /* Drop the previous project's live cards so B cannot linger in A
       while the new stream snapshot is in flight. */
    resetRun(true);
    conversationState.messages = [];
    eventState.events = [];
    approvalState.approvals.clear();

    const log = el("log");

    if (log) {
        log.innerHTML = "";
    }

    renderChat();
    renderTree();
    renderApprovals();

    connect();

    if (options.dashboard && next) {
        openProjectDashboard(next, options.tab || "overview");
    } else if (!options.keepDashboard) {
        closeProjectDashboard();
    }
}
