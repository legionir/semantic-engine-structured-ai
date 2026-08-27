import type { SceneSnapshot } from '@web-engine/engine-core';
import { normalizeSnapshot } from './engine/default-scene';
import { readProjectScene, type ApiClient } from './net/api-client';
import type { SceneStorage } from './storage/scene-storage';

export type SceneOrigin = 'server' | 'local' | 'demo';

export interface ResolvedScene {
  readonly snapshot: SceneSnapshot | null;
  readonly origin: SceneOrigin;
  /** Shown in the HUD when the scene did not come from where it was asked for. */
  readonly hint: string | null;
}

export interface SceneSourceDeps {
  readonly projectId: string;
  readonly api?: ApiClient | null;
  readonly storage?: SceneStorage | null;
}

/**
 * Decide which scene the canvas shows.
 *
 * Order: the project on `apps/server`, then the local-first copy in IndexedDB,
 * then the built-in demo. A missing or failing server is an expected state for
 * this client (it runs from `vite` without a backend), so every step degrades
 * with a one-line hint instead of an error dialog.
 */
export async function resolveSceneSource({ projectId, api, storage }: SceneSourceDeps): Promise<ResolvedScene> {
  if (api) {
    try {
      const project = await api.getProject(projectId);
      const scene = readProjectScene(project);
      if (scene) return { snapshot: normalizeSnapshot(scene), origin: 'server', hint: null };
      return {
        snapshot: null,
        origin: 'demo',
        hint: `project “${project.name ?? projectId}” has no scene yet`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const local = await loadLocal(storage, projectId);
      if (local) return { snapshot: local, origin: 'local', hint: `server unavailable (${message})` };
      return { snapshot: null, origin: 'demo', hint: `server unavailable (${message})` };
    }
  }

  const local = await loadLocal(storage, projectId);
  if (local) return { snapshot: local, origin: 'local', hint: null };
  return { snapshot: null, origin: 'demo', hint: null };
}

async function loadLocal(storage: SceneStorage | null | undefined, projectId: string): Promise<SceneSnapshot | null> {
  if (!storage) return null;
  try {
    const record = await storage.load(projectId);
    return record ? normalizeSnapshot(record.snapshot) : null;
  } catch {
    return null;
  }
}
