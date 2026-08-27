import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_APP_STATE,
  createStore,
  type AppState,
} from '../src/app/state/store';
import { formatHud, formatRelativeTime, statusLabel } from '../src/app/hud/hud';

const NOW = 1_700_000_000_000;

const stateOf = (patch: Partial<AppState> = {}): AppState => ({ ...INITIAL_APP_STATE, ...patch });

describe('createStore', () => {
  it('notifies subscribers with the next and the previous state', () => {
    const store = createStore(stateOf({ entities: 1 }));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set({ entities: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]?.entities).toBe(2);
    expect(listener.mock.calls[0]?.[1]?.entities).toBe(1);

    unsubscribe();
    store.set({ entities: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get().entities).toBe(3);
  });

  it('skips the notification when nothing actually changed', () => {
    const store = createStore(stateOf({ status: 'running' }));
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ status: 'running' });
    expect(listener).not.toHaveBeenCalled();

    store.set({ status: 'paused' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('accepts a function patch computed from the current state', () => {
    const store = createStore(stateOf({ meshes: 4 }));
    store.set((current) => ({ meshes: current.meshes + 1 }));
    expect(store.get().meshes).toBe(5);
  });

  it('keeps untouched keys when patching', () => {
    const store = createStore(stateOf({ sceneName: 'Demo', entities: 7 }));
    store.set({ status: 'running' });
    expect(store.get().sceneName).toBe('Demo');
    expect(store.get().entities).toBe(7);
  });

  it('starts from the documented idle state', () => {
    expect(INITIAL_APP_STATE.status).toBe('idle');
    expect(INITIAL_APP_STATE.sceneOrigin).toBe('demo');
    expect(INITIAL_APP_STATE.apiAvailable).toBe(false);
  });
});

describe('formatRelativeTime', () => {
  it('deserves a "never" for a scene that was not saved', () => {
    expect(formatRelativeTime(NOW, null)).toBe('never');
  });

  it('rounds through seconds, minutes and hours', () => {
    expect(formatRelativeTime(NOW, NOW - 1_000)).toBe('just now');
    expect(formatRelativeTime(NOW, NOW - 12_000)).toBe('12s ago');
    expect(formatRelativeTime(NOW, NOW - 90_000)).toBe('1m ago');
    expect(formatRelativeTime(NOW, NOW - 3_600_000 * 2)).toBe('2h ago');
  });

  it('never reports a negative time for a clock in the future', () => {
    expect(formatRelativeTime(NOW, NOW + 5_000)).toBe('just now');
  });
});

describe('statusLabel', () => {
  it('labels every state the runtime can be in', () => {
    expect(statusLabel('idle')).toBe('idle');
    expect(statusLabel('starting')).toBe('starting…');
    expect(statusLabel('running')).toBe('running');
    expect(statusLabel('paused')).toBe('paused');
    expect(statusLabel('stopped')).toBe('stopped');
    expect(statusLabel('error')).toBe('error');
  });
});

describe('formatHud', () => {
  it('shows the rows the shell promises', () => {
    const model = formatHud(stateOf({ sceneName: 'Demo', entities: 5, meshes: 3 }), NOW);
    expect(model.rows.map((row) => row.label)).toEqual([
      'scene',
      'status',
      'renderer',
      'fps',
      'entities',
      'meshes',
      'peers',
      'source',
      'server',
      'saved',
      'pushed',
    ]);
  });

  it('uses an em dash where a measurement is missing', () => {
    const model = formatHud(stateOf(), NOW);
    const value = (label: string): string => model.rows.find((row) => row.label === label)!.value;
    expect(value('fps')).toBe('—');
    expect(value('saved')).toBe('never');
    expect(value('server')).toBe('offline');
    expect(value('source')).toBe('demo');
  });

  it('prints fps with one decimal so the line does not jitter', () => {
    const model = formatHud(stateOf({ fps: 59.94 }), NOW);
    expect(model.rows.find((row) => row.label === 'fps')?.value).toBe('59.9');
  });

  it('prefers a hint over the default summary and an error over both', () => {
    const withHint = formatHud(stateOf({ hint: 'server unavailable' }), NOW);
    expect(withHint.summary).toBe('server unavailable');

    const withError = formatHud(stateOf({ hint: 'server unavailable', error: 'WebGL2 is not supported' }), NOW);
    expect(withError.error).toBe('WebGL2 is not supported');

    const presenceOnly = formatHud(stateOf({ presenceError: 'presence offline' }), NOW);
    expect(presenceOnly.error).toBe('presence offline');
  });

  it('lists the online peers for the footer line', () => {
    const model = formatHud(stateOf({ peerNames: ['ada', 'grace'], peers: 2 }), NOW);
    expect(model.peers).toEqual(['ada', 'grace']);
  });
});
