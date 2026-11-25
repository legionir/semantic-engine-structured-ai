/*
|--------------------------------------------------------------------------
| Projects
|--------------------------------------------------------------------------
|
| The visible project: switching it (which reconnects the stream), the
| project switcher label, the gateway health chip, the route on load and on
| back/forward, and the project dashboard.
*/

import { state, touch } from "./store.js";
import { bind, mount } from "./dom.js";
import { DashboardBody, dashboardHeading, dashboardTab, DashboardTabs } from "./project-view.js";
import { el, failureText, resetProjectView } from "./console-core.js";
import { connect } from "./stream-controller.js";
import { navigateConsole, parseProjectRoute, projectById, readStoredProjectId, writeStoredProjectId } from "./project-routing.js";


export function renderProjectSwitcher() {

    const label = el("activeProjectName");
    if (!label) return;

    if (state.taskScopeMode === "multiple" && state.taskProjectIds.length > 1) {
        label.textContent = `Multiple projects · ${state.taskProjectIds.length}`;
        return;
    }

    const project = projectById(state.currentProjectId);
    label.textContent = project ? (project.name || project.id) : "Default Workspace";
}


export async function loadProjects() {

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


export function setCurrentProject(projectId, options = {}) {

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


export async function loadGatewayHealth() {

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


export function closeProjectDashboard() {

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


export function openProjectDashboard(projectId, tab) {

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


export function mountDashboard() {

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


export function applyProjectRoute(fromPop) {

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
