/*
|--------------------------------------------------------------------------
| Console project-switcher (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The header controls: the project list, the selection, the keyboard bindings,
| and applying a route to the console.
|--------------------------------------------------------------------------
*/

import { el, node } from "./dom.js";
import { loadGatewayHealth, loadProjects } from "./api.js";
import { selectedTaskScope } from "./task-runner.js";
import { navigateConsole, parseProjectRoute, readStoredProjectId, setCurrentProject } from "./project-state.js";
import { closeProjectDashboard, openNewProjectModal, openProjectsManager } from "./project-dashboard.js";
import { projectState } from "./store.js";

export function fillProjectSelect(select, selectedId) {

    if (!select) {
        return;
    }

    select.innerHTML = "";

    const empty = node("option", null, "workspace default");
    empty.value = "";
    select.appendChild(empty);

    for (const project of projectState.projects) {

        const option = node("option", null, project.name || project.id);
        option.value = project.id;
        select.appendChild(option);
    }

    select.value = selectedId || "";
}

export function renderProjectSwitcher() {

    fillProjectSelect(el("projectSwitcher"), projectState.currentProjectId);
    fillProjectSelect(el("taskScopeProject"), el("taskScopeProject")?.value);

    const list = el("taskScopeList");

    if (list) {

        list.innerHTML = "";

        for (const project of projectState.projects) {

            const label = node("label");
            const box = node("input", "scope-box");
            box.type = "checkbox";
            box.value = project.id;
            label.append(box, node("span", null, project.name || project.id));
            list.appendChild(label);
        }
    }

    const link = el("visualizerLink");

    if (link) {

        link.href =
            projectState.currentProjectId
                ? `/visualizer.html?projectId=${encodeURIComponent(projectState.currentProjectId)}`
                : "/visualizer.html";
    }
}

export function bindProjectControls() {

    const switcher = el("projectSwitcher");

    if (switcher) {

        switcher.addEventListener("change", event => {
            setCurrentProject(event.target.value || null);
        });
    }

    el("newProjectButton")?.addEventListener("click", openNewProjectModal);
    el("projectsButton")?.addEventListener("click", openProjectsManager);
    el("dashboardBack")?.addEventListener("click", () => {

        closeProjectDashboard();
        navigateConsole(projectState.currentProjectId, null, false);
    });

    const scope = el("taskScope");

    if (scope) {

        scope.addEventListener("change", () => {

            const mode = selectedTaskScope();
            const specific = el("taskScopeProject");
            const list = el("taskScopeList");

            if (specific) {
                specific.hidden = mode !== "specific";
            }

            if (list) {
                list.hidden = mode !== "multiple";
            }
        });
    }

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

export function applyProjectRoute(fromPop) {

    const route = parseProjectRoute();
    const stored = readStoredProjectId();
    const projectId = route.projectId || stored || null;

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

export async function initProjects() {

    if (!el("projectSwitcher") && !el("projectDashboard")) {
        return;
    }

    bindProjectControls();
    await loadProjects();
    applyProjectRoute(false);
    loadGatewayHealth();
}
