import { describe, expect, it, vi } from 'vitest';
import { computeButtonStates, handleShortcutKey } from '../src/app/ui/toolbar';
import { INITIAL_APP_STATE, type AppState } from '../src/app/state/store';
import { resolveSceneSource } from '../src/app/scene-source';
import type { ApiClient } from '../src/app/net/api-client';
import type { SceneStorage } from '../src/app/storage/scene-storage';

const stateOf = (patch: Partial<AppState> = {}): AppState => ({ ...INITIAL_APP_STATE, ...patch });
const snapshot = { version: 1, id: 's1', name: 'Restored', entities: [] };

describe('computeButtonStates', () => {
  it('disables Pause until the loop is actually running', () => {
    expect(computeButtonStates(stateOf({ status: 'idle' }))).toMatchObject({
      playDisabled: false,
      pauseDisabled: true,
    });
    expect(computeButtonStates(stateOf({ status: 'running' }))).toMatchObject({
      playDisabled: true,
      pauseDisabled: false,
    });
  });

  it('lets Play resume a paused loop and freezes both while starting', () => {
    expect(computeButtonStates(stateOf({ status: 'paused' }))).toMatchObject({
      playDisabled: false,
      pauseDisabled: false,
      statusText: 'Pause',
    });
    expect(computeButtonStates(stateOf({ status: 'starting' }))).toMatchObject({
      playDisabled: true,
      pauseDisabled: true,
    });
  });

  it('gates Push on the server and keeps Save always available', () => {
    expect(computeButtonStates(stateOf({ apiAvailable: false })).pushDisabled).toBe(true);
    expect(computeButtonStates(stateOf({ apiAvailable: true })).pushDisabled).toBe(false);
  });
});

describe('handleShortcutKey', () => {
  it('maps Space to the run toggle and Ctrl/Cmd+S to save', () => {
    const handlers = { toggleRun: vi.fn(), save: vi.fn() };

    expect(handleShortcutKey({ code: 'Space' }, handlers)).toBe(true);
    expect(handlers.toggleRun).toHaveBeenCalledTimes(1);

    expect(handleShortcutKey({ key: 's', ctrlKey: true }, handlers)).toBe(true);
    expect(handleShortcutKey({ key: 'S', metaKey: true }, handlers)).toBe(true);
    expect(handlers.save).toHaveBeenCalledTimes(2);
  });

  it('ignores a bare "s" and keys typed into a field', () => {
    const handlers = { toggleRun: vi.fn(), save: vi.fn() };
    expect(handleShortcutKey({ key: 's' }, handlers)).toBe(false);

    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(handleShortcutKey({ code: 'Space', target: input }, handlers)).toBe(false);
    expect(handlers.toggleRun).not.toHaveBeenCalled();
  });

  it('leaves contenteditable hosts alone too', () => {
    const handlers = { toggleRun: vi.fn(), save: vi.fn() };
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(handleShortcutKey({ code: 'Space', target: editable }, handlers)).toBe(false);
  });
});

describe('resolveSceneSource', () => {
  const storageWith = (record: unknown): SceneStorage =>
    ({
      load: vi.fn(async () => record),
      save: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      remove: vi.fn(async () => undefined),
    }) as unknown as SceneStorage;

  const apiWith = (impl: Partial<Record<'getProject', () => Promise<unknown>>>): ApiClient =>
    ({
      getProject: impl.getProject ?? (async () => ({ id: 'p1', name: 'P1' })),
    }) as unknown as ApiClient;

  it('prefers the scene stored on the server project', async () => {
    const api = apiWith({
      getProject: async () => ({ id: 'p1', name: 'P1', scenes: [snapshot] }),
    });
    const resolved = await resolveSceneSource({ projectId: 'p1', api, storage: storageWith(null) });

    expect(resolved.origin).toBe('server');
    expect(resolved.snapshot).toEqual(snapshot);
    expect(resolved.hint).toBeNull();
  });

  it('says so when the project exists but holds no scene', async () => {
    const resolved = await resolveSceneSource({
      projectId: 'p1',
      api: apiWith({ getProject: async () => ({ id: 'p1', name: 'My Project' }) }),
    });
    expect(resolved.origin).toBe('demo');
    expect(resolved.snapshot).toBeNull();
    expect(resolved.hint).toContain('My Project');
  });

  it('falls back to the local copy when the server cannot be reached', async () => {
    const api = apiWith({
      getProject: async () => {
        throw new Error('fetch failed');
      },
    });
    const storage = storageWith({ projectId: 'p1', savedAt: 5, snapshot });

    const resolved = await resolveSceneSource({ projectId: 'p1', api, storage });

    expect(resolved.origin).toBe('local');
    expect(resolved.snapshot).toEqual(snapshot);
    expect(resolved.hint).toContain('server unavailable (fetch failed)');
  });

  it('falls back to the demo scene when neither source has one', async () => {
    const api = apiWith({
      getProject: async () => {
        throw new Error('offline');
      },
    });
    const resolved = await resolveSceneSource({ projectId: 'p1', api, storage: storageWith(null) });

    expect(resolved).toEqual({ snapshot: null, origin: 'demo', hint: 'server unavailable (offline)' });
  });

  it('works with no server and no storage configured', async () => {
    const resolved = await resolveSceneSource({ projectId: 'p1' });
    expect(resolved.origin).toBe('demo');
    expect(resolved.snapshot).toBeNull();
  });

  it('does not let a broken local record escape as an exception', async () => {
    const storage = {
      load: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
    } as unknown as SceneStorage;

    const resolved = await resolveSceneSource({ projectId: 'p1', storage });
    expect(resolved.origin).toBe('demo');
  });

  it('parses a scene document that arrives as a JSON string', async () => {
    const api = apiWith({
      getProject: async () => ({ id: 'p1', name: 'P1', scenes: [JSON.stringify(snapshot)] }),
    });
    const resolved = await resolveSceneSource({ projectId: 'p1', api });
    expect(resolved.snapshot).toEqual(snapshot);
  });
});
