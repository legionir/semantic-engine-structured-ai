/* Project switcher/dashboard boundary — EXECUTION_PLAN Phase 24. */

import { byId, create, clear } from "./dom.js";
import { projectById, writeCurrentProject } from "./project-state.js";

export function renderProjects(projects, currentId, container = byId("projectSwitcher")) {
  if (!container) return;
  clear(container);
  (projects || []).forEach(project => {
    const option = create("option");
    option.value = project.id;
    option.textContent = project.name || project.id;
    option.selected = project.id === currentId;
    container.appendChild(option);
  });
  container.value = currentId || "";
}

export function selectProject(projects, id) {
  const selected = projectById(projects, id);
  writeCurrentProject(selected?.id || null);
  return selected;
}
