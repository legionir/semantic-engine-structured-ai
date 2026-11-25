/*
|--------------------------------------------------------------------------
| Projects manager
|--------------------------------------------------------------------------
|
| The Projects modal (pick one or several projects, open, delete) and the
| New Project form, plus the project bar's controls.
*/

import { state } from "./store.js";
import { el, failureText, node, notifyError } from "./console-core.js";
import { navigateConsole } from "./project-routing.js";
import { renderAttachments } from "./composer-controller.js";
import { applyProjectRoute, closeProjectDashboard, loadGatewayHealth, loadProjects, openProjectDashboard, renderProjectSwitcher, setCurrentProject } from "./projects-controller.js";


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


export async function initProjects() {

    if (!el("activeProjectName") && !el("projectDashboard")) {
        return;
    }

    bindProjectControls();
    await loadProjects();
    applyProjectRoute(false);
    loadGatewayHealth();
}
