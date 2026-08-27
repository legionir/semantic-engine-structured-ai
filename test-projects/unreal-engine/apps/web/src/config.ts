/**
 * Runtime configuration for the web client.
 *
 * The client is configured by `<meta name="web-engine:*">` tags in
 * `apps/web/index.html` rather than by bundler constants, so one build can be
 * served by the Vite dev server, by `apps/server` from `dist/`, or from any
 * static host — only the tags change. A host page may also set
 * `window.__WEB_ENGINE__` to override individual keys at runtime.
 */

export type RendererPreference = 'auto' | 'webgpu' | 'webgl2';

export interface WebAppConfig {
  /** Base URL for `apps/server` REST routes. `''` means "same origin". */
  readonly apiBaseUrl: string;
  /** Fully resolved WebSocket endpoint for presence, or `null` to disable it. */
  readonly websocketUrl: string | null;
  /** Project the client loads and pushes by default. */
  readonly projectId: string;
  /** Which backend to try first. */
  readonly renderer: RendererPreference;
  /** Identity advertised on the presence channel. */
  readonly username: string;
  /** Start the frame loop as soon as the renderer is ready. */
  readonly autoStart: boolean;
}

export const DEFAULT_CONFIG: WebAppConfig = {
  apiBaseUrl: '/api',
  websocketUrl: null,
  projectId: 'default',
  renderer: 'auto',
  username: 'guest',
  autoStart: true,
};

/** Meta tag names understood by {@link resolveConfig}. */
export const CONFIG_META_NAMES = {
  apiBaseUrl: 'web-engine:api-base-url',
  websocketUrl: 'web-engine:websocket-url',
  projectId: 'web-engine:project-id',
  renderer: 'web-engine:renderer',
  username: 'web-engine:username',
  autoStart: 'web-engine:auto-start',
} as const;

/** Trailing slashes would double up against the route paths the client builds. */
export function normalizeApiBaseUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '';
  return trimmed.replace(/\/+$/, '');
}

export function parseBooleanFlag(
  raw: string | null | undefined,
  fallback: boolean
): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return fallback;
  if (value === 'false' || value === '0' || value === 'off' || value === 'no') return false;
  return true;
}

export function parseRendererPreference(
  raw: string | null | undefined,
  fallback: RendererPreference = 'auto'
): RendererPreference {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'webgpu' || value === 'webgl2' || value === 'auto') return value;
  return fallback;
}

/**
 * Turn the configured API base into a `ws(s)://…/ws` endpoint.
 *
 * `apps/server` mounts the WebSocket server on the `/ws` path of the same port
 * it serves REST from, so a relative API base is resolved against the page
 * origin. Returns `null` when there is no origin to resolve against (for
 * example under a test runner), which simply disables presence.
 */
export function deriveWebsocketUrl(apiBaseUrl: string, pageOrigin: string | null): string | null {
  const explicit = apiBaseUrl.trim();
  if (/^wss?:\/\//i.test(explicit)) {
    return /\/ws\/?$/i.test(explicit) ? explicit : `${explicit.replace(/\/+$/, '')}/ws`;
  }
  if (/^https?:\/\//i.test(explicit)) {
    const wsBase = explicit.replace(/^http/i, 'ws').replace(/\/+$/, '');
    return /\/ws\/?$/i.test(wsBase) ? wsBase : `${wsBase}/ws`;
  }
  if (!pageOrigin) return null;
  const base = pageOrigin.replace(/\/+$/, '');
  const path = explicit === '' ? '' : explicit;
  return `${base.replace(/^http/i, 'ws')}${path}/ws`;
}

export interface ResolveConfigInput {
  /** Looks up one configuration value, typically a `<meta>` tag's content. */
  readonly read: (name: string) => string | null;
  /** Highest precedence: `window.__WEB_ENGINE__` or an embedder's overrides. */
  readonly overrides?: Partial<WebAppConfig>;
  /** `window.location.origin` of the hosting page, used to derive the WS URL. */
  readonly pageOrigin?: string | null;
}

export function resolveConfig({
  read,
  overrides = {},
  pageOrigin = null,
}: ResolveConfigInput): WebAppConfig {
  const apiBaseUrl = normalizeApiBaseUrl(
    overrides.apiBaseUrl ?? read(CONFIG_META_NAMES.apiBaseUrl)
  );
  /* An absent tag inherits the API base; `off`/`none`/`disabled` — or an
     explicit `null` override from a host page — turns presence off entirely. */
  const overrideWs = overrides.websocketUrl;
  const configuredWs =
    overrideWs === undefined
      ? (read(CONFIG_META_NAMES.websocketUrl) ?? '').trim()
      : overrideWs === null
        ? 'off'
        : overrideWs.trim();
  const wsDisabled = configuredWs === 'off' || configuredWs === 'none' || configuredWs === 'disabled';
  let websocketUrl: string | null = null;
  if (!wsDisabled) {
    const candidate = configuredWs === '' ? apiBaseUrl : configuredWs;
    websocketUrl = candidate === '' && !pageOrigin ? null : deriveWebsocketUrl(candidate, pageOrigin);
  }

  return {
    apiBaseUrl,
    websocketUrl,
    projectId: overrides.projectId ?? read(CONFIG_META_NAMES.projectId)?.trim() ?? DEFAULT_CONFIG.projectId,
    renderer: parseRendererPreference(
      overrides.renderer ?? read(CONFIG_META_NAMES.renderer),
      DEFAULT_CONFIG.renderer
    ),
    username: overrides.username ?? (read(CONFIG_META_NAMES.username)?.trim() || DEFAULT_CONFIG.username),
    autoStart: parseBooleanFlag(
      overrides.autoStart !== undefined
        ? String(overrides.autoStart)
        : read(CONFIG_META_NAMES.autoStart),
      DEFAULT_CONFIG.autoStart
    ),
  };
}

/** Configuration sources available in a browser document. */
export function readConfigFromDocument(doc: Document, win: Window & { __WEB_ENGINE__?: Partial<WebAppConfig> } = window): WebAppConfig {
  const read = (name: string): string | null =>
    doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;

  return resolveConfig({
    read,
    overrides: win.__WEB_ENGINE__ ?? {},
    pageOrigin: typeof win.location?.origin === 'string' ? win.location.origin : null,
  });
}
