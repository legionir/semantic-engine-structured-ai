import { serializeScene, type SceneSnapshot } from '@web-engine/engine-core';
import { readServiceWorkerSrc, registerServiceWorker } from './pwa';
import { resolveSceneSource } from './scene-source';
import { createApiClient } from './net/api-client';
import { createPresenceClient, type PresenceClient } from './net/presence';
import { createHud, type Hud } from './hud/hud';
import { bindShortcuts, createToolbar, type Toolbar, type ToolbarElements } from './ui/toolbar';
import { createSceneStorage, openKvStore, type KvStore, type SceneStorage } from './storage/scene-storage';
import { createRuntimeSession, type RuntimeSession } from './engine/runtime-session';
import { hasWebGpu } from './engine/renderer-choice';
import { INITIAL_APP_STATE, createStore, type Store, type AppState } from './state/store';
import type { WebAppConfig } from '../config';

/** Key under which an anonymous per-browser user id is kept (see `deviceId`). */
export const DEVICE_USER_KEY = 'web-engine:device-user';

export interface WebAppElements extends ToolbarElements {
  readonly canvas: HTMLCanvasElement;
  readonly hud: HTMLElement | null;
}

export interface MountWebAppOptions {
  readonly config: WebAppConfig;
  readonly elements: WebAppElements;
  readonly document?: Document;
  readonly window?: Window;
}

export interface WebAppHandle {
  readonly store: Store<AppState>;
  readonly state: AppState;
  readonly session: RuntimeSession | null;
  currentSnapshot(): SceneSnapshot | null;
  save(): Promise<void>;
  push(): Promise<void>;
  /** Rebuild from the serialized document currently in memory. */
  reload(): Promise<void>;
  dispose(): void;
}

/**
 * Stable anonymous identity for the request headers `apps/server` reads.
 *
 * The project routes resolve ownership from `x-user-id`, so an unauthenticated
 * visitor still needs a consistent id to push a scene to. It is a random uuid
 * in `localStorage` — not a credential, and nothing sensitive.
 */
export function deviceId(win: Window | undefined): string {
  const fallback = `web-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const storage = win?.localStorage;
    if (!storage) return fallback;
    const existing = storage.getItem(DEVICE_USER_KEY);
    if (existing) return existing;
    storage.setItem(DEVICE_USER_KEY, fallback);
    return fallback;
  } catch {
    /* Storage disabled (private mode, sandboxed iframe): stay anonymous. */
    return fallback;
  }
}

/** Look up every element the shell drives; any of them may be absent. */
export function collectElements(doc: Document, canvas: HTMLCanvasElement): WebAppElements {
  const query = <T extends Element>(selector: string): T | null => doc.querySelector<T>(selector);
  return {
    canvas,
    hud: query('#hud'),
    play: query<HTMLButtonElement>('#btn-play'),
    pause: query<HTMLButtonElement>('#btn-pause'),
    save: query<HTMLButtonElement>('#btn-save'),
    push: query<HTMLButtonElement>('#btn-push'),
    reset: query<HTMLButtonElement>('#btn-reset'),
    spin: query<HTMLInputElement>('#chk-spin'),
    lights: query<HTMLInputElement>('#chk-lights'),
    loading: query('#loading-screen'),
    toast: query('#toast'),
  };
}

/**
 * Build the whole web client around one canvas.
 *
 * Everything the browser owns — renderer, frame loop, HUD, toolbar, presence
 * socket, local store — is created and torn down here, so `main.ts` stays a
 * mount point and every piece below stays independently testable.
 */
export async function mountWebApp(options: MountWebAppOptions): Promise<WebAppHandle> {
  const { config, elements } = options;
  const doc = options.document ?? document;
  const win = options.window ?? window;

  const store = createStore<AppState>(INITIAL_APP_STATE);
  const hud: Hud | null = elements.hud ? createHud({ root: elements.hud }) : null;
  const user = deviceId(win);

  let session: RuntimeSession | null = null;
  let presence: PresenceClient | null = null;
  let toolbar: Toolbar | null = null;
  let unsubscribeMeter: (() => void) | null = null;
  let unbindKeys: (() => void) | null = null;
  let unbindCursor: (() => void) | null = null;
  let cursorThrottle: ReturnType<typeof setTimeout> | null = null;
  let snapshot: SceneSnapshot | null = null;
  let disposed = false;

  const api = createApiClient({
    baseUrl: config.apiBaseUrl,
    /* No token is persisted: a page that anyone can open must not leave a
       signed-in session behind. `login()` on the client exists for embedders. */
    tokenProvider: () => null,
    userIdProvider: () => user,
  });
  const storage: SceneStorage = createSceneStorage(await openStorage(win));

  const toast = (message: string, kind: 'info' | 'error' = 'info'): void => toolbar?.toast(message, kind);

  store.set({ status: 'starting' });

  const resolved = await resolveSceneSource({ projectId: config.projectId, api, storage });
  snapshot = resolved.snapshot;

  try {
    session = await createRuntimeSession({
      canvas: elements.canvas,
      preference: config.renderer,
      webgpuAvailable: hasWebGpu(win.navigator),
      snapshot: resolved.snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.set({ status: 'error', error: message, sceneOrigin: resolved.origin });
    toolbar = createToolbar(elements, inertToolbarActions());
    toolbar.toast(`renderer unavailable: ${message}`, 'error');
    toolbar.hideLoading();
    return {
      store,
      get state(): AppState {
        return store.get();
      },
      session: null,
      currentSnapshot: () => snapshot,
      save: async () => undefined,
      push: async () => undefined,
      reload: async () => undefined,
      dispose: () => {
        toolbar?.dispose();
        toolbar = null;
        hud?.dispose();
      },
    };
  }

  const scene = session;
  const counts = scene.summary();
  store.set({
    status: 'idle',
    sceneName: scene.model.scene.name,
    rendererKind: scene.rendererKind,
    rendererLabel: scene.rendererLabel,
    entities: counts.entities,
    meshes: counts.meshes,
    sceneOrigin: resolved.origin,
    canSpin: scene.canSpin,
    apiAvailable: resolved.origin === 'server',
    hint: resolved.hint ?? scene.fallbackReason,
  });
  if (scene.fallbackReason) toast(`WebGPU failed, using WebGL2`, 'info');

  unsubscribeMeter = scene.meter.subscribe(() => {
    if (!session) return;
    const latest = session.summary();
    store.set({ fps: session.meter.latest.fps, entities: latest.entities, meshes: latest.meshes });
  });

  if (config.websocketUrl) {
    presence = createPresenceClient({
      url: config.websocketUrl,
      projectId: config.projectId,
      username: config.username,
      userId: user,
      onStateChange: (state) => {
        store.set({
          peers: state.peers.length,
          peerNames: state.peers.map((peer) => peer.username),
          presenceError: state.connected ? state.error : state.error ?? 'presence offline',
        });
      },
    });
    presence.start();
  }

  const syncRunState = (): void => {
    if (!session) return;
    const running = session.runtime.isRunning;
    store.set({
      status: !running ? 'stopped' : session.runtime.isPaused ? 'paused' : 'running',
    });
  };

  const toggleRun = (): void => {
    if (!session) return;
    if (!session.runtime.isRunning) session.start();
    else if (session.runtime.isPaused) session.resume();
    else session.pause();
    syncRunState();
  };

  const save = async (): Promise<void> => {
    if (!session) return;
    const record = await storage.save(config.projectId, session.scene);
    snapshot = record.snapshot;
    store.set({ lastSavedAt: record.savedAt });
    toast('saved locally');
  };

  const push = async (): Promise<void> => {
    if (!session) return;
    try {
      const project = await api.saveProjectScene(config.projectId, serializeScene(session.scene));
      store.set({ lastPushedAt: Date.now(), apiAvailable: true, sceneName: project.name ?? store.get().sceneName });
      toast('pushed to server');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.set({ apiAvailable: false });
      toast(`push failed: ${message}`, 'error');
    }
  };

  const reload = async (): Promise<void> => {
    if (!session) return;
    session.dispose();
    session = null;
    store.set({ status: 'starting' });
    const next = await createRuntimeSession({
      canvas: elements.canvas,
      preference: config.renderer,
      webgpuAvailable: hasWebGpu(win.navigator),
      snapshot,
    });
    session = next;
    next.spin.setEnabled(elements.spin?.checked ?? true);
    next.start();
    store.set({ status: 'running', sceneName: next.model.scene.name });
  };

  toolbar = createToolbar(elements, {
    play: toggleRun,
    pause: () => {
      session?.pause();
      syncRunState();
    },
    save: () => void save().catch((error: unknown) => toast(String(error), 'error')),
    push: () => void push().catch((error: unknown) => toast(String(error), 'error')),
    reset: () => {
      session?.spin.reset();
      toast('turntable reset');
    },
    spin: (enabled) => session?.spin.setEnabled(enabled),
    lights: (enabled) => {
      if (!session) return;
      /* `SceneRuntime.setLights` is the only lighting API the runtime exposes at
         run time, so switching the lights off genuinely clears them. */
      session.runtime.setLights(enabled ? session.model.lights : []);
    },
  });
  toolbar.sync(store.get());
  toolbar.hideLoading();

  unbindKeys = bindShortcuts(doc, {
    toggleRun,
    save: () => void save().catch(() => undefined),
  });

  /* Outgoing cursors are throttled: presence is a courtesy, not a stream. */
  const onPointerMove = (event: PointerEvent): void => {
    if (!presence || cursorThrottle !== null) return;
    cursorThrottle = setTimeout(() => {
      cursorThrottle = null;
    }, 60);
    presence.sendCursor({ x: event.offsetX, y: event.offsetY });
  };
  elements.canvas.addEventListener('pointermove', onPointerMove);
  unbindCursor = () => elements.canvas.removeEventListener('pointermove', onPointerMove);

  if (config.autoStart) {
    session.start();
    syncRunState();
  } else {
    store.set({ status: 'stopped' });
  }

  void registerServiceWorker(
    readServiceWorkerSrc((name) => doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null),
    win.navigator?.serviceWorker
  );

  return {
    store,
    get state(): AppState {
      return store.get();
    },
    get session(): RuntimeSession | null {
      return session;
    },
    currentSnapshot: () => snapshot,
    save,
    push,
    reload,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      presence?.stop();
      presence = null;
      unsubscribeMeter?.();
      unsubscribeMeter = null;
      unbindKeys?.();
      unbindKeys = null;
      unbindCursor?.();
      unbindCursor = null;
      if (cursorThrottle !== null) clearTimeout(cursorThrottle);
      cursorThrottle = null;
      toolbar?.dispose();
      toolbar = null;
      hud?.dispose();
      session?.dispose();
      session = null;
    },
  };
}

/**
 * The local scene store, or an in-memory one.
 *
 * `openKvStore` never rejects — a browser that refuses IndexedDB (private mode,
 * a sandboxed iframe) still gets a working Save button for the session.
 */
async function openStorage(win: Window): Promise<KvStore> {
  return openKvStore(win);
}

/** Actions used when the renderer never came up: the shell must stay clickable. */
function inertToolbarActions(): Parameters<typeof createToolbar>[1] {
  return {
    play: () => undefined,
    pause: () => undefined,
    save: () => undefined,
    push: () => undefined,
    reset: () => undefined,
    spin: () => undefined,
    lights: () => undefined,
  };
}
