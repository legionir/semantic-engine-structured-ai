export type Listener<T> = (state: T, previous: T) => void;

export interface Store<T extends object> {
  get(): T;
  /** Shallow patch, or a function returning one. `null` values are ignored. */
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: Listener<T>): () => void;
}

/**
 * A minimal observable state holder.
 *
 * The web client has exactly one mutable screen, so it does not need a state
 * library; what it does need is a single place where the render loop, the
 * network layer and the HUD agree on what is happening — and a store small
 * enough to unit test without a DOM.
 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get(): T {
      return state;
    },
    set(patch): void {
      const next = typeof patch === 'function' ? patch(state) : patch;
      const previous = state;
      let changed = false;
      for (const key of Object.keys(next) as (keyof T)[]) {
        if (previous[key] !== next[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;

      state = { ...previous, ...next };
      listeners.forEach((listener) => listener(state, previous));
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'error';

export interface AppState {
  readonly status: RuntimeStatus;
  readonly sceneName: string;
  readonly rendererKind: 'webgpu' | 'webgl2' | null;
  readonly rendererLabel: string;
  readonly entities: number;
  readonly meshes: number;
  readonly fps: number | null;
  readonly peers: number;
  readonly peerNames: readonly string[];
  readonly presenceError: string | null;
  readonly lastSavedAt: number | null;
  readonly lastPushedAt: number | null;
  readonly error: string | null;
  readonly hint: string | null;
  /** Where the current scene came from: `apps/server`, IndexedDB, or the demo. */
  readonly sceneOrigin: 'server' | 'local' | 'demo';
  /** Whether `apps/server` answered; drives the Push button and the HUD. */
  readonly apiAvailable: boolean;
  /** True when the loaded scene has a turntable the Spin toggle can drive. */
  readonly canSpin: boolean;
}

export const INITIAL_APP_STATE: AppState = {
  status: 'idle',
  sceneName: '—',
  rendererKind: null,
  rendererLabel: '—',
  entities: 0,
  meshes: 0,
  fps: null,
  peers: 0,
  peerNames: [],
  presenceError: null,
  lastSavedAt: null,
  lastPushedAt: null,
  error: null,
  hint: null,
  sceneOrigin: 'demo',
  apiAvailable: false,
  canSpin: false,
};
