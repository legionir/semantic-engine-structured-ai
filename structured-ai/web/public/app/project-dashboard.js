/*
|--------------------------------------------------------------------------
| Console project-dashboard (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The per-project dashboard: its tabs, its cards, the health chip, and the
| register/edit modal for projects themselves.
|
| The dashboard is the same SPA as the console (decision 30): this module draws
| the body, project-state.js decides which tab is open, and the rows come from the
| project-scoped endpoints rather than the global snapshot — so a second project
| can never show the first one's events.
|--------------------------------------------------------------------------
*/

import { Modal, el, node } from "./dom.js";
import { describeEvent } from "./event-view.js";
import { loadProjects } from "./api.js";
import { navigateConsole, projectById, setCurrentProject } from "./project-state.js";
import { DASHBOARD_TABS, planState, projectState } from "./store.js";

export function refreshGatewayHealthChip(health) {

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

    chip.href = projectState.currentProjectId
        ? `/projects/${encodeURIComponent(projectState.currentProjectId)}?tab=overview`
        : "/api/health";
}

export function closeProjectDashboard() {

    projectState.dashboard.open = false;

    const dash = el("projectDashboard");
    const main = el("consoleMain");

    if (dash) {
        dash.hidden = true;
    }

    if (main) {
        main.hidden = false;
    }
}

export function renderDashboardTabs(active) {

    const nav = el("dashboardTabs");

    if (!nav) {
        return;
    }

    nav.innerHTML = "";

    for (const [id, label] of DASHBOARD_TABS) {

        const button = node("button", id === active ? "active" : "", label);
        button.type = "button";
        button.dataset.tab = id;
        button.addEventListener("click", () => openProjectDashboard(projectState.dashboard.projectId, id));
        nav.appendChild(button);
    }
}

export function dashboardCard(title, value) {

    const card = node("div", "dashboard-card");
    card.append(node("h3", null, title), node("div", null, String(value ?? "—")));
    return card;
}

export async function renderDashboardBody(projectId, tab) {

    const body = el("dashboardBody");

    if (!body) {
        return;
    }

    body.innerHTML = "";
    body.appendChild(node("p", "empty", "Loading…"));

    let record = projectById(projectId);
    let projectState = null;
    let metrics = null;
    let health = null;
    let sessions = [];

    try {

        const [projectRes, stateRes, metricsRes, healthRes, sessionsRes] =
            await Promise.all([
                fetch(`/api/projects/${encodeURIComponent(projectId)}`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/state`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/metrics`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/health`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`)
            ]);

        if (projectRes.ok) {
            record = (await projectRes.json()).project || record;
        }

        if (stateRes.ok) {
            projectState = await stateRes.json();
        }

        if (metricsRes.ok) {
            metrics = await metricsRes.json();
        }

        if (healthRes.ok) {
            health = await healthRes.json();
        }

        if (sessionsRes.ok) {
            sessions = (await sessionsRes.json()).sessions || [];
        }

    } catch {
        /* render what we have */
    }

    body.innerHTML = "";

    const title = el("dashboardTitle");
    const subtitle = el("dashboardSubtitle");

    if (title) {
        title.textContent = record?.name || projectId;
    }

    if (subtitle) {
        subtitle.textContent = `${record?.rootPath || ""} · ${health?.status || "unknown"}`;
    }

    if (tab === "overview") {

        const grid = node("div", "dashboard-grid");
        grid.append(
            dashboardCard("status", health?.status || projectState?.status),
            dashboardCard("runs", metrics?.metrics?.project_runs_total ?? 0),
            dashboardCard("active", metrics?.metrics?.project_active_runs ?? 0),
            dashboardCard("index", metrics?.metrics?.project_index_state || "unknown"),
            dashboardCard("root", record?.rootPath)
        );
        body.appendChild(grid);
        return;
    }

    if (tab === "runs") {

        const runs = projectState?.active_runs || [];

        if (runs.length === 0) {
            body.appendChild(node("p", "empty", "No active runs for this project."));
            return;
        }

        for (const run of runs) {
            body.appendChild(
                node("div", "labeled-run", `${run.status} · ${run.run_id} · ${run.task || ""}`)
            );
        }

        return;
    }

    if (tab === "sessions") {

        if (sessions.length === 0) {
            body.appendChild(node("p", "empty", "No saved sessions for this project."));
            return;
        }

        for (const session of sessions) {
            body.appendChild(
                node("div", "labeled-run", session.title || session.id)
            );
        }

        return;
    }

    if (tab === "memory") {

        body.appendChild(
            node(
                "p",
                "empty",
                "Memory is stored in this project's data root. Inspect it with memory_get during a scoped run."
            )
        );
        body.appendChild(
            dashboardCard("last activity", metrics?.metrics?.project_last_activity || "none")
        );
        return;
    }

    if (tab === "plan") {

        if (planState.plan && projectState.currentProjectId === projectId) {
            const holder = node("div", "plan-view");
            holder.id = "dashboardPlan";
            body.appendChild(holder);
            const previous = el("plan");
            /* reuse live plan card text when this is the active project */
            if (previous) {
                holder.appendChild(node("div", null, previous.textContent));
            }
            return;
        }

        body.appendChild(
            node("p", "empty", "Plan appears here while this project is the active console run.")
        );
        return;
    }

    if (tab === "events" || tab === "logs") {

        const events = (projectState?.events || []).slice(-80);

        if (events.length === 0) {
            body.appendChild(node("p", "empty", "No events recorded for this project."));
            return;
        }

        const list = node("ul", "log");

        for (const event of events) {

            if (tab === "logs" && !/error|failed|deadline/i.test(event.type || "")) {
                continue;
            }

            list.appendChild(
                node("li", null, `${event.type} · ${describeEvent(event)}`)
            );
        }

        body.appendChild(list);
        return;
    }

    if (tab === "approvals") {

        const pending = projectState?.pending_approvals || [];

        if (pending.length === 0) {
            body.appendChild(node("p", "empty", "No pending approvals for this project."));
            return;
        }

        for (const item of pending) {
            body.appendChild(
                node("div", "labeled-run", `${item.tool} · ${item.agent}`)
            );
        }

        return;
    }

    if (tab === "semantic") {

        body.append(
            dashboardCard("index", metrics?.metrics?.project_index_state || "unknown"),
            dashboardCard("health", health?.index_state || health?.status)
        );
        return;
    }

    if (tab === "mcp") {

        body.appendChild(
            dashboardCard("mcp calls", metrics?.metrics?.project_mcp_calls_total ?? 0)
        );
        return;
    }

    if (tab === "settings") {

        const form = node("div", "mcp-add");
        const name = node("input");
        name.value = record?.name || "";
        const enabled = node("input");
        enabled.type = "checkbox";
        enabled.checked = record?.enabled !== false;

        form.append(
            node("label", "mcp-field"),
        );

        const nameField = node("label", "mcp-field");
        nameField.append(node("span", "label", "name"), name);
        const enabledField = node("label", "mcp-field");
        enabledField.append(node("span", "label", "enabled"), enabled);
        form.append(nameField, enabledField);

        form.appendChild(
            Modal.button("Save", "", async () => {

                await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        name: name.value,
                        enabled: enabled.checked
                    })
                });

                await loadProjects();
                renderDashboardBody(projectId, "settings");
            })
        );

        body.appendChild(form);
    }
}

export function openProjectDashboard(projectId, tab) {

    if (!projectId) {
        return;
    }

    projectState.dashboard = { open: true, projectId, tab: tab || "overview" };
    setCurrentProject(projectId, { skipNavigate: true, keepDashboard: true });
    navigateConsole(projectId, projectState.dashboard.tab, false);

    const dash = el("projectDashboard");
    const main = el("consoleMain");

    if (dash) {
        dash.hidden = false;
    }

    if (main) {
        main.hidden = true;
    }

    renderDashboardTabs(projectState.dashboard.tab);
    renderDashboardBody(projectId, projectState.dashboard.tab);
}

export function openNewProjectModal() {

    const name = node("input");
    name.placeholder = "Display name";
    const root = node("input");
    root.placeholder = "/absolute/path/to/workspace";
    const message = node("p", "mcp-message");

    const form = node("div", "mcp-add");
    const nameField = node("label", "mcp-field");
    nameField.append(node("span", "label", "name"), name);
    const rootField = node("label", "mcp-field");
    rootField.append(node("span", "label", "rootPath"), root);
    form.append(nameField, rootField, message);

    const handle = Modal.open({
        title: "New Project",
        subtitle: "Registers a workspace. Root comes from you, never from the model.",
        body: form,
        footer: Modal.row(
            Modal.button("Create", "", async () => {

                const response = await fetch("/api/projects", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        name: name.value.trim() || undefined,
                        rootPath: root.value.trim()
                    })
                });

                const payload = await response.json().catch(() => ({}));

                if (!response.ok) {
                    message.textContent = payload.error || "could not register";
                    return;
                }

                await loadProjects();
                setCurrentProject(payload.project.id);
                handle.close("created");
            }),
            Modal.button("Cancel", "ghost", () => handle.close("cancel"))
        )
    });
}

export async function openProjectsManager() {

    await loadProjects();

    const body = node("div", "sessions");

    if (projectState.projects.length === 0) {
        body.appendChild(node("p", "empty", "No registered projects yet."));
    }

    for (const project of projectState.projects) {

        const row = node("div", "project-row");
        row.appendChild(node("span", "name", project.name || project.id));
        row.appendChild(node("span", "muted", project.rootPath || ""));

        row.appendChild(
            Modal.button("Open", "ghost", () => {

                handle.close("open");
                openProjectDashboard(project.id, "overview");
            })
        );

        row.appendChild(
            Modal.button("Use", "ghost", () => {

                handle.close("use");
                setCurrentProject(project.id);
            })
        );

        row.appendChild(
            Modal.button("Delete", "ghost danger", async () => {

                await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
                    method: "DELETE"
                });

                await loadProjects();

                if (projectState.currentProjectId === project.id) {
                    setCurrentProject(null);
                }

                handle.close("deleted");
                openProjectsManager();
            })
        );

        body.appendChild(row);
    }

    const handle = Modal.open({
        title: "Projects",
        subtitle: `${projectState.projects.length} registered`,
        size: "medium",
        body,
        footer: Modal.row(
            Modal.button("New Project", "ghost", () => {

                handle.close("new");
                openNewProjectModal();
            }),
            Modal.button("Close", "", () => handle.close("footer"))
        )
    });
}
