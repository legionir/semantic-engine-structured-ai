/* Project state helpers — EXECUTION_PLAN Phase 24. */

export const PROJECT_STORAGE_KEY = "structured-ai.currentProjectId";

export function readCurrentProject(storage = globalThis.localStorage) {
  return storage?.getItem?.(PROJECT_STORAGE_KEY) || null;
}

export function writeCurrentProject(id, storage = globalThis.localStorage) {
  if (!storage) return;
  if (id) storage.setItem(PROJECT_STORAGE_KEY, id);
  else storage.removeItem(PROJECT_STORAGE_KEY);
}

export function projectById(projects, id) {
  return (projects || []).find(project => project.id === id) || null;
}
