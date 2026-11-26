/*
|--------------------------------------------------------------------------
| Project dashboard view
|--------------------------------------------------------------------------
|
| The dashboard replaces the conversation with one project's overview,
| runs, sessions, plan, events, approvals, MCP use and settings. Its data
| is loaded by the controller into state.dashboard; this module only
| draws it. A slow response for a tab the operator already left is
| dropped by the controller (request token), so a tab never shows the
| data of another tab or project.
|
| ProjectsManager and NewProjectForm are the two project modals' bodies.
| The manager draws the registered list from the store and the operator's
| unconfirmed choice from `picker`, so a list that changes while it is
| open redraws in place without losing that choice.
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";
import { Plan } from "./plan-view.js";
import { describeEvent } from "./event-view.js";


export const DASHBOARD_TABS = [
    ["overview", "Overview"],
    ["runs", "Agent Runs"],
    ["sessions", "Sessions"],
    ["memory", "Memory"],
    ["plan", "Plan"],
    ["events", "Events"],
    ["approvals", "Approvals"],
    ["mcp", "MCP"],
    ["logs", "Logs"],
    ["settings", "Settings"]
];


export function dashboardTab(value) {

    return DASHBOARD_TABS.some(([id]) => id === value) ? value : "overview";
}


export function DashboardTabs({ dashboard, onTab }) {

    return html`${DASHBOARD_TABS.map(([id, label]) => html`<button
        type="button"
        key=${id}
        class=${id === dashboard.tab ? "active" : ""}
        data-tab=${id}
        onClick=${() => onTab(id)}
    >${label}</button>`)}`;
}


function Card({ title, value }) {

    return html`<div class="dashboard-card">
        <h3>${title}</h3>
        <div>${String(value ?? "—")}</div>
    </div>`;
}


const empty = text => html`<p class="empty">${text}</p>`;


function SettingsForm({ dashboard, onSave }) {

    const record = dashboard.data?.record;

    /* keyed on the record: a saved change re-seeds the fields */
    return html`<form
        class="mcp-add"
        key=${`${record?.name}|${record?.enabled}`}
        onSubmit=${event => {
            event.preventDefault();
            const form = event.currentTarget;
            onSave({
                name: form.elements.namedItem("name").value,
                enabled: form.elements.namedItem("enabled").checked
            });
        }}
    >
        <label class="mcp-field">
            <span class="label">name</span>
            <input name="name" defaultValue=${record?.name || ""} />
        </label>
        <label class="mcp-field">
            <span class="label">enabled</span>
            <input name="enabled" type="checkbox" defaultChecked=${record?.enabled !== false} />
        </label>
        ${dashboard.saveMessage ? html`<p class="mcp-message">${dashboard.saveMessage}</p>` : null}
        <button type="submit" disabled=${dashboard.saving}>Save</button>
    </form>`;
}


function TabBody({ dashboard, plan, currentProjectId, onSave }) {

    const { record, projectState, metrics, health, sessions } = dashboard.data || {};
    const counters = metrics?.metrics || {};

    switch (dashboard.tab) {

        case "runs": {
            const runs = projectState?.active_runs || [];
            return runs.length === 0
                ? empty("No active runs for this project.")
                : runs.map(run => html`<div class="labeled-run" key=${run.run_id}>${`${run.status} · ${run.run_id} · ${run.task || ""}`}</div>`);
        }

        case "sessions":
            return (sessions || []).length === 0
                ? empty("No saved sessions for this project.")
                : sessions.map(session => html`<div class="labeled-run" key=${session.id}>${session.title || session.id}</div>`);

        case "memory":
            return html`
                ${empty("Memory is stored in this project's data root. Inspect it with memory_get during a scoped run.")}
                <${Card} title="last activity" value=${counters.project_last_activity || "none"} />
            `;

        case "plan":
            return plan && currentProjectId === dashboard.projectId
                ? html`<div class="plan-view" id="dashboardPlan"><${Plan} plan=${plan} /></div>`
                : empty("Plan appears here while this project is the active console run.");

        case "events":
        case "logs": {
            const events = (projectState?.events || [])
                .slice(-80)
                .filter(event => dashboard.tab === "events" || /error|failed|deadline/i.test(event.type || ""));
            return events.length === 0
                ? empty("No events recorded for this project.")
                : html`<ul class="log">${events.map((event, index) =>
                    html`<li key=${index}>${`${event.type} · ${describeEvent(event)}`}</li>`)}</ul>`;
        }

        case "approvals": {
            const pending = projectState?.pending_approvals || [];
            return pending.length === 0
                ? empty("No pending approvals for this project.")
                : pending.map(item => html`<div class="labeled-run" key=${item.id}>${`${item.tool} · ${item.agent}`}</div>`);
        }

        case "mcp":
            return html`<${Card} title="mcp calls" value=${counters.project_mcp_calls_total ?? 0} />`;

        case "settings":
            return html`<${SettingsForm} dashboard=${dashboard} onSave=${onSave} />`;

        default:
            return html`<div class="dashboard-grid">
                <${Card} title="status" value=${health?.status || projectState?.status} />
                <${Card} title="runs" value=${counters.project_runs_total ?? 0} />
                <${Card} title="active" value=${counters.project_active_runs ?? 0} />
                <${Card} title="root" value=${record?.rootPath} />
            </div>`;
    }
}


export function DashboardBody({ dashboard, plan, currentProjectId, onSave }) {

    if (dashboard.loading && !dashboard.data) {
        return empty("Loading…");
    }

    return html`<${TabBody}
        dashboard=${dashboard}
        plan=${plan}
        currentProjectId=${currentProjectId}
        onSave=${onSave}
    />`;
}


export function dashboardHeading(dashboard, fallback) {

    const record = dashboard.data?.record || fallback;

    return {
        title: record?.name || dashboard.projectId || "",
        subtitle: `${record?.rootPath || ""} · ${dashboard.data?.health?.status || "unknown"}`
    };
}


/*
| Text fields are uncontrolled and read on Create (as in the MCP form), so
| a redraw for the message line never touches what was typed.
*/
export function NewProjectForm({ form, refs }) {

    return html`
        <label class="mcp-field">
            <span class="label">name</span>
            <input name="name" placeholder="Display name" ref=${refs.name} />
        </label>
        <label class="mcp-field">
            <span class="label">root path (created if missing)</span>
            <input name="rootPath" placeholder="/absolute/path/to/workspace" ref=${refs.root} />
        </label>
        <p class="mcp-message">${form.message}</p>
    `;
}


export function ProjectsManager({ state, picker, actions }) {

    return html`
        <label class="project-choice-row">
            <input
                type="radio"
                name="projectSelectionMode"
                value="workspace"
                checked=${picker.workspace}
                onChange=${event => actions.chooseWorkspace(event.currentTarget.checked)}
            />
            <span class="name">Default Workspace</span>
            <span class="muted">Use the default workspace</span>
        </label>
        ${state.projects.length === 0 ? html`<p class="empty">No registered projects yet.</p>` : null}
        ${state.projects.map(project => {
            const name = project.name || project.id;
            return html`<div class="project-row" key=${project.id}>
                <input
                    type="checkbox"
                    class="project-picker-checkbox"
                    value=${project.id}
                    aria-label=${`Select ${name}`}
                    checked=${picker.ids.has(project.id)}
                    onChange=${event => actions.toggle(project.id, event.currentTarget.checked)}
                />
                <span class="name">${name}</span>
                <span class="muted">${project.rootPath || ""}</span>
                <button type="button" class="ghost" onClick=${() => actions.open(project.id)}>Open</button>
                <button type="button" class="ghost danger" onClick=${() => actions.remove(project)}>Delete</button>
            </div>`;
        })}
    `;
}
