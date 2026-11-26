/*
|--------------------------------------------------------------------------
| Projects manager
|--------------------------------------------------------------------------
|
| The Projects modal (pick one or several projects, open, delete) and the
| New Project form, plus the project bar's controls.
*/

import { state, touch } from "./store.js";
import { bind, html, mountInModal } from "./dom.js";
import { NewProjectForm, ProjectsManager } from "./project-view.js";
import { CloneForm, loadCloneContext, startClone, suggestedFolder } from "./project-clone.js";
import { el, failureText, notifyError } from "./console-core.js";
import { navigateConsole, projectById } from "./project-routing.js";
import { renderAttachments } from "./composer-controller.js";
import { applyProjectRoute, bindProjectHeader, closeProjectDashboard, loadGatewayHealth, loadProjects, openProjectDashboard, setCurrentProject } from "./projects-controller.js";


/* the task scope the composer sends to: one project (or the default) or several */
function applyScope(ids) {

    state.taskScopeMode = ids.length > 1 ? "multiple" : "current";
    state.taskProjectIds = ids.length > 1 ? ids : [];
    touch("projects");
    setCurrentProject(ids[0] || null);
}


/*
| A deleted project leaves the task scope too: a multi-project scope keeps
| the rest (or falls back to one project), and a deleted visible project
| hands over to the next selected one or to the default workspace.
*/
function forgetProject(projectId) {

    const remaining =
        state.taskScopeMode === "multiple"
            ? state.taskProjectIds.filter(id => id !== projectId)
            : [];

    if (state.taskScopeMode === "multiple") {
        state.taskScopeMode = remaining.length > 1 ? "multiple" : "current";
        state.taskProjectIds = remaining.length > 1 ? remaining : [];
        touch("projects");
    }

    if (state.currentProjectId === projectId) {
        setCurrentProject(remaining[0] || null);
    }
}


/* "Folder" registers an existing or new folder; "From git URL" clones (P1-02) */
function NewProjectBody({ form, refs, actions }) {

    return html`
        <div class="mcp-tabs" role="tablist">
            ${[["folder", "Folder"], ["git", "From git URL"]].map(([id, label]) => html`
                <button
                    type="button"
                    key=${id}
                    class=${`mcp-tab${form.mode === id ? " active" : ""}`}
                    aria-selected=${form.mode === id ? "true" : "false"}
                    disabled=${form.busy}
                    onClick=${() => actions.mode(id)}
                >${label}</button>
            `)}
        </div>
        ${form.mode === "git"
            ? html`<${CloneForm} form=${form} refs=${refs} actions=${actions} />`
            : html`<${NewProjectForm} form=${form} refs=${refs} />`}
    `;
}


function openNewProjectModal(initialMode = "folder") {

    const form = { message: "", busy: false, mode: initialMode, job: null, root: null, secrets: [], suggested: "", closed: false };
    const refs = {
        name: { current: null },
        root: { current: null },
        url: { current: null },
        branch: { current: null },
        folder: { current: null },
        cloneName: { current: null },
        secret: { current: null },
        shallow: { current: null }
    };
    let dispose = () => {};

    const actions = {

        mode(mode) {
            form.mode = mode;
            form.message = "";
            createButton.textContent = mode === "git" ? "Clone" : "Create";
            touch("projects");
            if (mode === "git" && form.root === null) {
                void loadCloneContext(form);
            }
        },

        urlChanged(url) {
            form.suggested = suggestedFolder(url);
            touch("projects");
        }
    };

    const say = message => {
        form.message = message;
        touch("projects");
    };

    const create = async () => {

        if (form.busy) {
            return;
        }

        if (form.mode === "git") {

            await startClone(form, refs, async project => {
                await loadProjects();
                applyScope([project.id]);
                handle.close("cloned");
            });
            return;
        }

        const rootPath = (refs.root.current?.value || "").trim();
        const name = (refs.name.current?.value || "").trim();

        if (rootPath === "") {
            say("a root path is required");
            return;
        }

        form.busy = true;

        try {

            let response;

            try {
                response = await fetch("/api/projects", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ name: name || undefined, rootPath, createIfMissing: true })
                });
            } catch (error) {
                say(`could not register: ${error.message || "network error"}`);
                return;
            }

            const payload = await response.json().catch(() => ({}));

            if (!response.ok || !payload.project) {
                say(payload.error || "could not register");
                return;
            }

            await loadProjects();
            applyScope([payload.project.id]);
            handle.close("created");

        } finally {
            form.busy = false;
        }
    };

    const createButton = Modal.button(initialMode === "git" ? "Clone" : "Create", "", create);

    const handle = Modal.open({
        title: "New Project",
        subtitle: "Registers a workspace or clones a repository. The location comes from you, never from the model.",
        footer: Modal.row(
            createButton,
            Modal.button("Cancel", "ghost", () => handle.close("cancel"))
        ),
        onClose: () => {
            /* a clone keeps running on the server; only the polling stops */
            form.closed = true;
            dispose();
        }
    });

    dispose = mountInModal(handle, NewProjectBody, ["projects"], { form, refs, actions }, "mcp-add");

    if (initialMode === "git") {
        void loadCloneContext(form);
    }
}


async function openProjectsManager() {

    await loadProjects();

    /* the operator's choice until Confirm; it starts from the current scope */
    const scoped =
        state.taskScopeMode === "multiple"
            ? state.taskProjectIds
            : state.currentProjectId ? [state.currentProjectId] : [];
    const picker = { ids: new Set(scoped.filter(id => projectById(id))) };
    picker.workspace = picker.ids.size === 0 && state.taskScopeMode !== "multiple" && !state.currentProjectId;

    const changed = () => touch("projects");

    const actions = {

        chooseWorkspace(checked) {
            picker.workspace = checked;
            if (checked) picker.ids.clear();
            changed();
        },

        toggle(id, checked) {
            if (checked) {
                picker.ids.add(id);
                picker.workspace = false;
            } else {
                picker.ids.delete(id);
            }
            changed();
        },

        open(id) {
            handle.close("open");
            openProjectDashboard(id, "overview");
        },

        async remove(project) {

            const name = project.name || project.id;

            try {
                const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
                if (!response.ok) {
                    notifyError(await failureText(response, `${name} was not deleted`));
                    return;
                }
            } catch (error) {
                notifyError(`${name} was not deleted: ${error.message || "network error"}`);
                return;
            }

            picker.ids.delete(project.id);
            if (picker.ids.size === 0) picker.workspace = true;
            await loadProjects();
            forgetProject(project.id);
            changed();
        }
    };

    const confirmButton = Modal.button("Confirm", "", () => {
        const ids = picker.workspace ? [] : state.projects.map(project => project.id).filter(id => picker.ids.has(id));
        applyScope(ids);
        handle.close("confirmed");
    });

    let stopFooter = () => {};
    let dispose = () => {};

    const handle = Modal.open({
        title: "Projects",
        subtitle: `${state.projects.length} registered`,
        size: "medium",
        footer: Modal.row(
            Modal.button("New Project", "ghost", () => {
                handle.close("new");
                openNewProjectModal();
            }),
            confirmButton,
            Modal.button("Close", "ghost", () => handle.close("footer"))
        ),
        onClose: () => {
            stopFooter();
            dispose();
        }
    });

    dispose = mountInModal(handle, ProjectsManager, ["projects"], { state, picker, actions }, "sessions");

    stopFooter = bind(["projects"], () => {
        handle.setSubtitle(`${state.projects.length} registered`);
        confirmButton.disabled = !picker.workspace && picker.ids.size === 0;
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

    bindProjectHeader();
    bindProjectControls();
    await loadProjects();
    applyProjectRoute(false);
    loadGatewayHealth();
}
