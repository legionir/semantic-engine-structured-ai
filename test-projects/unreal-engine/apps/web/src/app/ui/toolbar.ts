import type { AppState } from '../state/store';

/** Buttons that depend on state, computed in one place so the rules are testable. */
export interface ToolbarButtonStates {
  readonly playDisabled: boolean;
  readonly pauseDisabled: boolean;
  readonly pushDisabled: boolean;
  readonly statusText: string;
}

export function computeButtonStates(state: AppState): ToolbarButtonStates {
  const running = state.status === 'running';
  const paused = state.status === 'paused';
  const busy = state.status === 'starting';
  return {
    playDisabled: busy || (running && !paused),
    /* A paused loop still owns the frame handle, so Pause stays live: pressing
       it again is how the shell stops a held loop. */
    pauseDisabled: busy || (!running && !paused),
    /* Push needs a reachable API and a scene that is worth uploading; saving is
       always possible because the local store falls back to memory. */
    pushDisabled: !state.apiAvailable,
    statusText: paused ? 'Pause' : running ? 'Running' : 'Play',
  };
}

export interface ToolbarElements {
  readonly play: HTMLButtonElement | null;
  readonly pause: HTMLButtonElement | null;
  readonly save: HTMLButtonElement | null;
  readonly push: HTMLButtonElement | null;
  readonly reset: HTMLButtonElement | null;
  readonly spin: HTMLInputElement | null;
  readonly lights: HTMLInputElement | null;
  readonly loading: HTMLElement | null;
  readonly toast: HTMLElement | null;
}

export interface ToolbarActions {
  play(): void;
  pause(): void;
  save(): void;
  push(): void;
  reset(): void;
  spin(enabled: boolean): void;
  lights(enabled: boolean): void;
}

export interface ToolbarTimers {
  setTimeout(handler: () => void, timeout: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ToolbarOptions {
  readonly timers?: ToolbarTimers;
  readonly toastMs?: number;
}

export interface Toolbar {
  sync(state: AppState): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  hideLoading(): void;
  dispose(): void;
}

/**
 * Wire the toolbar to app actions.
 *
 * The buttons are queried, not created: the markup in `index.html` is the
 * source of truth, so a host page can drop or rename a control and the app
 * still boots (each handler is attached only when its element exists).
 */
export function createToolbar(
  elements: ToolbarElements,
  actions: ToolbarActions,
  options: ToolbarOptions = {}
): Toolbar {
  const timers: ToolbarTimers = options.timers ?? {
    setTimeout: (handler, timeout) => setTimeout(handler, timeout),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const toastMs = options.toastMs ?? 4500;

  const onClick = (element: HTMLButtonElement | null, handler: () => void): (() => void) => {
    if (!element) return () => undefined;
    const listener = (event: Event): void => {
      event.preventDefault();
      handler();
    };
    element.addEventListener('click', listener);
    return () => element.removeEventListener('click', listener);
  };

  const onChange = (element: HTMLInputElement | null, handler: (checked: boolean) => void): (() => void) => {
    if (!element) return () => undefined;
    const listener = (): void => handler(element.checked);
    element.addEventListener('change', listener);
    return () => element.removeEventListener('change', listener);
  };

  const unbinds: Array<() => void> = [
    onClick(elements.play, actions.play),
    onClick(elements.pause, actions.pause),
    onClick(elements.save, actions.save),
    onClick(elements.push, actions.push),
    onClick(elements.reset, actions.reset),
    onChange(elements.spin, (checked) => actions.spin(checked)),
    onChange(elements.lights, (checked) => actions.lights(checked)),
  ];

  let toastHandle: unknown = null;

  return {
    sync(state): void {
      const next = computeButtonStates(state);
      if (elements.play) {
        elements.play.textContent = next.statusText;
        elements.play.disabled = next.playDisabled;
      }
      if (elements.pause) elements.pause.disabled = next.pauseDisabled;
      if (elements.push) elements.push.disabled = next.pushDisabled;
      if (elements.spin) elements.spin.disabled = !state.canSpin;
    },
    toast(message, kind = 'info'): void {
      const node = elements.toast;
      if (!node) return;
      node.textContent = message;
      node.dataset['kind'] = kind;
      node.hidden = false;
      if (toastHandle !== null) timers.clearTimeout(toastHandle);
      toastHandle = timers.setTimeout(() => {
        toastHandle = null;
        node.hidden = true;
      }, toastMs);
    },
    hideLoading(): void {
      if (!elements.loading) return;
      elements.loading.dataset['done'] = 'true';
    },
    dispose(): void {
      unbinds.forEach((unbind) => unbind());
      if (toastHandle !== null) timers.clearTimeout(toastHandle);
    },
  };
}

export interface ShortcutHandlers {
  /** Space toggles play/pause; returns nothing. */
  toggleRun(): void;
  /** Ctrl/Cmd+S saves. */
  save(): void;
}

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  const tag = element.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

/** True when the key press was handled (used by tests and by the caller). */
export function handleShortcutKey(
  event: { code?: string; key?: string; metaKey?: boolean; ctrlKey?: boolean; target?: EventTarget | null },
  handlers: ShortcutHandlers
): boolean {
  if (isEditable(event.target ?? null)) return false;

  if ((event.metaKey || event.ctrlKey) && (event.key ?? '').toLowerCase() === 's') {
    handlers.save();
    return true;
  }
  if (event.code === 'Space' || event.key === ' ') {
    handlers.toggleRun();
    return true;
  }
  return false;
}

export function bindShortcuts(target: { addEventListener(type: string, listener: (event: KeyboardEvent) => void): void; removeEventListener(type: string, listener: (event: KeyboardEvent) => void): void }, handlers: ShortcutHandlers): () => void {
  const listener = (event: KeyboardEvent): void => {
    if (handleShortcutKey(event, handlers)) event.preventDefault();
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
