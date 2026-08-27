import type { AppState } from '../state/store';

export interface HudRow {
  readonly label: string;
  readonly value: string;
}

export interface HudModel {
  readonly rows: readonly HudRow[];
  readonly summary: string;
  readonly peers: readonly string[];
  readonly error: string | null;
}

/** Milliseconds since the epoch → "just now" / "12s ago" / "3m ago". */
export function formatRelativeTime(now: number, then: number | null): string {
  if (then === null) return 'never';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function statusLabel(status: AppState['status']): string {
  switch (status) {
    case 'starting':
      return 'starting…';
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'stopped':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Turn app state into the text the HUD shows.
 *
 * Kept free of DOM access so the HUD's wording is covered by the unit tests
 * instead of only by a manual look at the page.
 */
export function formatHud(state: AppState, now: number = Date.now()): HudModel {
  const rows: HudRow[] = [
    { label: 'scene', value: state.sceneName },
    { label: 'status', value: statusLabel(state.status) },
    { label: 'renderer', value: state.rendererLabel },
    { label: 'fps', value: state.fps === null ? '—' : state.fps.toFixed(1) },
    { label: 'entities', value: String(state.entities) },
    { label: 'meshes', value: String(state.meshes) },
    { label: 'peers', value: String(state.peers) },
    { label: 'source', value: state.sceneOrigin },
    { label: 'server', value: state.apiAvailable ? 'connected' : 'offline' },
    { label: 'saved', value: formatRelativeTime(now, state.lastSavedAt) },
    { label: 'pushed', value: formatRelativeTime(now, state.lastPushedAt) },
  ];

  const error = state.error ?? state.presenceError;
  const summary = state.hint ?? `${state.sceneName} · ${state.entities} entities · ${state.meshes} meshes`;

  return {
    rows,
    summary,
    peers: state.peerNames,
    error,
  };
}

export interface HudElements {
  readonly root: HTMLElement;
}

export interface Hud {
  update(state: AppState, now?: number): void;
  dispose(): void;
}

/** Renders {@link formatHud} into `#hud`, reusing the row nodes between frames. */
export function createHud({ root }: HudElements): Hud {
  const cache = new Map<string, HTMLElement>();

  const rowFor = (label: string): HTMLElement => {
    let row = cache.get(label);
    if (!row) {
      row = document.createElement('div');
      row.className = 'hud-row';
      const key = document.createElement('span');
      key.className = 'label';
      key.textContent = label;
      const value = document.createElement('span');
      value.className = 'value';
      row.append(key, value);
      cache.set(label, row);
    }
    return row;
  };

  const summary = document.createElement('div');
  summary.className = 'hud-summary';
  const peers = document.createElement('div');
  peers.className = 'peers';

  root.append(summary, peers);

  return {
    update(state, now = Date.now()): void {
      const model = formatHud(state, now);
      const keep = new Set<string>();

      model.rows.forEach(({ label, value }) => {
        keep.add(label);
        const row = rowFor(label);
        const valueNode = row.querySelector('.value');
        if (valueNode) valueNode.textContent = value;
        if (row.parentNode !== root) root.insertBefore(row, summary);
      });

      cache.forEach((row, label) => {
        if (!keep.has(label) && row.parentNode === root) row.remove();
      });

      summary.textContent = model.error ? `⚠ ${model.error}` : model.summary;
      peers.textContent = model.peers.length > 0 ? `online: ${model.peers.join(', ')}` : '';
    },
    dispose(): void {
      cache.forEach((row) => row.remove());
      cache.clear();
      summary.remove();
      peers.remove();
    },
  };
}
