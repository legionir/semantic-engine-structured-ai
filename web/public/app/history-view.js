/*
| Conversations modal: the saved sessions grouped by project and, when needed,
| by workspace. Opening or deleting reports failures in the modal instead of
| silently doing nothing.
*/

import { html } from "./dom.js";
import { describeSession } from "./formatters.js";
import { SkeletonRows } from "./skeleton-view.js";


function workspaceBaseName(workspace) {

    const text = String(workspace || "").replace(/[\\/]+$/, "");
    if (!text) return "Default Workspace";
    const parts = text.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || text;
}


export function groupSessions(sessions, {
    projects = [],
    defaultWorkspace = "",
    currentProjectId = null,
    currentSessionId = null
} = {}) {

    const projectMap = new Map(
        (projects || []).filter(Boolean).map(project => [project.id, project])
    );

    const projectWorkspaces = new Map();
    for (const session of sessions || []) {
        if (!session?.project_id) continue;
        const proj = projectMap.get(session.project_id);
        const ws = String(session.workspace || proj?.rootPath || "").trim();
        if (!ws) continue;
        if (!projectWorkspaces.has(session.project_id)) {
            projectWorkspaces.set(session.project_id, new Set());
        }
        projectWorkspaces.get(session.project_id).add(ws);
    }

    const groups = new Map();

    for (const session of sessions || []) {
        if (!session) continue;

        const hasProject = Boolean(session.project_id);
        const project = hasProject ? projectMap.get(session.project_id) : null;
        const workspace = hasProject
            ? String(session.workspace || project?.rootPath || "").trim()
            : String(session.workspace || defaultWorkspace || "").trim();

        let key;
        let kind;
        let title;

        if (hasProject) {
            const splitWs = (projectWorkspaces.get(session.project_id)?.size || 0) > 1;
            key = splitWs
                ? `project:${session.project_id}::${workspace}`
                : `project:${session.project_id}`;
            kind = "project";
            title = project?.name || session.project_name || session.project_id;
        } else {
            key = `workspace:${workspace || "__default__"}`;
            kind = "workspace";
            title = !workspace || (defaultWorkspace && workspace === defaultWorkspace)
                ? "Default Workspace"
                : workspaceBaseName(workspace);
        }

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                kind,
                projectId: hasProject ? session.project_id : null,
                title,
                workspace,
                sessions: [],
                latestAt: "",
                hasCurrentSession: false
            });
        }

        const group = groups.get(key);
        group.sessions.push(session);

        if (session.id === currentSessionId) {
            group.hasCurrentSession = true;
        }

        const updated = String(session.updated_at || session.created_at || "");
        if (updated.localeCompare(group.latestAt) > 0) {
            group.latestAt = updated;
        }
    }

    const isActiveGroup = group => {
        if (currentProjectId) {
            return group.kind === "project" && group.projectId === currentProjectId;
        }
        return group.kind === "workspace" && (!group.workspace || group.workspace === defaultWorkspace);
    };

    return [...groups.values()].sort((left, right) => {
        const leftActive = isActiveGroup(left) ? 1 : 0;
        const rightActive = isActiveGroup(right) ? 1 : 0;
        if (leftActive !== rightActive) return rightActive - leftActive;

        const leftCurrent = left.hasCurrentSession ? 1 : 0;
        const rightCurrent = right.hasCurrentSession ? 1 : 0;
        if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;

        const byTime = right.latestAt.localeCompare(left.latestAt);
        if (byTime !== 0) return byTime;

        return left.title.localeCompare(right.title);
    });
}


export function historySubtitle(sessions, groups = null) {

    const count = Array.isArray(sessions) ? sessions.length : 0;
    if (Array.isArray(groups) && groups.length > 1) {
        return `${count} saved across ${groups.length} groups`;
    }
    return `${count} saved in this workspace`;
}


/* props: history {sessions, current, pending, error, loading, search, scope}, projects, defaultWorkspace, currentProjectId, onOpen(session), onDelete(session), onRetry(), onSearch(q), onScopeChange(scope) */
export function Sessions({
    history,
    projects = [],
    defaultWorkspace = "",
    currentProjectId = null,
    onOpen,
    onDelete,
    onRetry,
    onSearch,
    onScopeChange
}) {

    const sessions = history.sessions || [];
    const allGroups = groupSessions(sessions, {
        projects,
        defaultWorkspace,
        currentProjectId,
        currentSessionId: history.current
    });

    const activeScope = allGroups.some(group => group.key === history.scope)
        ? history.scope
        : "all";
    const query = String(history.search || "").trim().toLowerCase();

    const visibleGroups = allGroups
        .filter(group => activeScope === "all" || group.key === activeScope)
        .map(group => {
            if (!query) return group;
            const groupMatch =
                group.title.toLowerCase().includes(query) ||
                group.workspace.toLowerCase().includes(query);
            const matched = groupMatch
                ? group.sessions
                : group.sessions.filter(session =>
                    String(session.title || session.id).toLowerCase().includes(query)
                );
            return { ...group, sessions: matched };
        })
        .filter(group => group.sessions.length > 0);

    return html`<div class="sessions">
        ${history.error ? html`<div class="modal-error-row">
            <p class="mcp-error">${history.error}</p>
            ${onRetry ? html`<button type="button" class="ghost" onClick=${onRetry}>Retry</button>` : null}
        </div>` : null}
        ${history.loading && sessions.length === 0
            ? html`<${SkeletonRows} count=${5} label="Loading conversations…" />`
            : sessions.length === 0 && !history.error
                ? html`<p class="empty">No conversations have been saved yet.</p>`
                : null}
        ${sessions.length > 0 ? html`<div class="history-toolbar">
            <input
                type="search"
                class="history-search"
                placeholder="Filter conversations, project or workspace…"
                aria-label="Filter conversations"
                value=${history.search || ""}
                onInput=${event => onSearch?.(event.target.value)}
            />
            ${allGroups.length > 1 ? html`<select
                class="history-scope-filter"
                aria-label="Filter by project or workspace"
                value=${activeScope}
                onChange=${event => onScopeChange?.(event.target.value)}
            >
                <option value="all">${`All (${sessions.length})`}</option>
                ${allGroups.map(group => html`<option key=${group.key} value=${group.key}>
                    ${`${group.title} (${group.sessions.length})`}
                </option>`)}
            </select>` : null}
        </div>` : null}
        ${sessions.length > 0 && visibleGroups.length === 0
            ? html`<p class="empty">No matching conversations found.</p>`
            : html`<div class="history-groups">
                ${visibleGroups.map(group => html`<section
                    key=${group.key}
                    class="history-group"
                    data-group-kind=${group.kind}
                    data-project-id=${group.projectId || ""}
                    data-workspace=${group.workspace || ""}
                >
                    <header class="history-group-head">
                        <div class="history-group-heading">
                            <strong class="history-group-title">${group.title}</strong>
                            <span class="chip history-group-kind">${group.kind === "project" ? "Project" : "Workspace"}</span>
                            <span class="history-group-count muted">${group.sessions.length}</span>
                        </div>
                        ${group.workspace
                            ? html`<span class="history-group-workspace" title=${group.workspace}>${group.workspace}</span>`
                            : null}
                    </header>
                    <div class="history-group-list">
                        ${group.sessions.map(session => {
                            const isCurrent = session.id === history.current;
                            const title = session.title || session.id;
                            return html`<div class="session-row" key=${session.id}>
                                <button
                                    type="button"
                                    class=${`session${isCurrent ? " current" : ""}`}
                                    disabled=${Boolean(history.pending)}
                                    onClick=${() => onOpen(session)}
                                >
                                    <span class="name">${title}</span>
                                    <span class="facts">${describeSession(session)}</span>
                                </button>
                                <button
                                    type="button"
                                    class="ghost danger session-delete"
                                    title=${isCurrent ? "Cannot delete the open conversation" : "Delete conversation"}
                                    aria-label=${`Delete ${title}`}
                                    disabled=${Boolean(history.pending) || isCurrent}
                                    onClick=${() => onDelete?.(session)}
                                >Delete</button>
                            </div>`;
                        })}
                    </div>
                </section>`)}
            </div>`}
    </div>`;
}
