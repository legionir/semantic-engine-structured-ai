/*
|--------------------------------------------------------------------------
| Project routing
|--------------------------------------------------------------------------
|
| The URL (/projects/:id?tab=… for the dashboard, /?project=… otherwise)
| and the remembered project in localStorage. History is written with
| pushState/replaceState; the page never reloads.
*/

import { state } from "./store.js";


const PROJECT_STORAGE_KEY = "structured-ai.currentProjectId";


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


    } catch {
        /* tests */
    }
}


export function projectById(id) {

    return state.projects.find(item => item.id === id) || null;
}
