/**
 * Presence + multiplayer cursor client for the `/ws` socket in
 * `apps/server/src/websocket/websocket.service.ts`.
 *
 * The wire protocol is flat JSON objects (`{ type, … }`), not the
 * `{ type, data: { … } }` shape `docs/api.md` shows; the handlers below follow
 * the server implementation, and `parseSocketMessage` is tolerant so an unknown
 * `type` is ignored instead of breaking the session.
 */

export type PresenceStatus = 'online' | 'away' | 'busy';

export interface PresenceUser {
  readonly userId: string;
  readonly username: string;
  readonly projectId: string;
  readonly status: PresenceStatus;
  readonly lastSeen: number;
  readonly cursorPosition?: { x: number; y: number };
}

export type PresenceEvent =
  | { readonly type: 'connected'; readonly clientId: string; readonly userId: string; readonly projectId: string }
  | { readonly type: 'presence'; readonly users: PresenceUser[] }
  | { readonly type: 'cursor'; readonly userId: string; readonly username: string; position: { x: number; y: number } }
  | { readonly type: 'cursor_update'; readonly cursors: readonly unknown[] }
  | { readonly type: 'operation'; readonly userId: string; readonly operation: unknown }
  | { readonly type: 'crdt_operation'; readonly userId: string; readonly operation: unknown; readonly revision?: unknown }
  | { readonly type: 'pong' };

/** Parse one frame into a known event, or `null` for anything unrecognized. */
export function parseSocketMessage(raw: string): PresenceEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const message = parsed as Record<string, unknown>;
  switch (message['type']) {
    case 'connected':
      return {
        type: 'connected',
        clientId: String(message['clientId'] ?? ''),
        userId: String(message['userId'] ?? ''),
        projectId: String(message['projectId'] ?? ''),
      };
    case 'presence':
      return { type: 'presence', users: normalizeUsers(message['users']) };
    case 'cursor':
      return {
        type: 'cursor',
        userId: String(message['userId'] ?? ''),
        username: String(message['username'] ?? ''),
        position: normalizePosition(message['position']),
      };
    case 'cursor_update':
      return { type: 'cursor_update', cursors: Array.isArray(message['cursors']) ? message['cursors'] : [] };
    case 'operation':
      return { type: 'operation', userId: String(message['userId'] ?? ''), operation: message['operation'] };
    case 'crdt_operation':
      return {
        type: 'crdt_operation',
        userId: String(message['userId'] ?? ''),
        operation: message['operation'],
        ...(message['revision'] === undefined ? {} : { revision: message['revision'] }),
      };
    case 'pong':
      return { type: 'pong' };
    default:
      return null;
  }
}

function normalizePosition(value: unknown): { x: number; y: number } {
  const record = (value ?? {}) as Record<string, unknown>;
  return { x: Number(record['x'] ?? 0), y: Number(record['y'] ?? 0) };
}

function normalizeUsers(value: unknown): PresenceUser[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      userId: String(entry['userId'] ?? ''),
      username: String(entry['username'] ?? entry['userId'] ?? 'anonymous'),
      projectId: String(entry['projectId'] ?? ''),
      status: toStatus(entry['status']),
      lastSeen: Number(entry['lastSeen'] ?? 0),
      ...(entry['cursorPosition'] ? { cursorPosition: normalizePosition(entry['cursorPosition']) } : {}),
    }));
}

function toStatus(value: unknown): PresenceStatus {
  return value === 'away' || value === 'busy' ? value : 'online';
}

export interface ReconnectPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RECONNECT: ReconnectPolicy = {
  maxAttempts: 6,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
};

/** Exponential backoff with a ceiling; `attempt` is 1-based. */
export function computeReconnectDelay(attempt: number, policy: ReconnectPolicy = DEFAULT_RECONNECT): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = policy.baseDelayMs * 2 ** exponent;
  return Math.min(policy.maxDelayMs, Math.round(raw));
}

/** Query string the server reads identity from (`userId`, `username`, `projectId`). */
export function buildSocketUrl(url: string, identity: { userId: string; username: string; projectId: string }): string {
  const [base, existingQuery] = url.split('?');
  const params = new URLSearchParams(existingQuery ?? '');
  params.set('userId', identity.userId);
  params.set('username', identity.username);
  params.set('projectId', identity.projectId);
  return `${base}?${params.toString()}`;
}

/** The subset of `WebSocket` this client needs, so tests can fake it. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface Timers {
  setTimeout(handler: () => void, timeout: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PresenceClientOptions {
  readonly url: string;
  readonly projectId: string;
  readonly username: string;
  readonly userId?: string;
  readonly socketFactory?: (url: string) => SocketLike;
  readonly timers?: Timers;
  readonly reconnect?: Partial<ReconnectPolicy>;
  /** Send `{type:'ping'}` this often; 0 disables the heartbeat. */
  readonly heartbeatMs?: number;
  readonly onEvent?: (event: PresenceEvent) => void;
  readonly onStateChange?: (state: PresenceClientState) => void;
}

/** Live view of the socket. The object is reused, so read it, do not keep it. */
export interface PresenceClientState {
  connected: boolean;
  attempts: number;
  error: string | null;
  peers: readonly PresenceUser[];
}

export interface PresenceClient {
  readonly state: PresenceClientState;
  start(): void;
  stop(): void;
  sendCursor(position: { x: number; y: number }): void;
  sendSelection(selection: unknown): void;
  setStatus(status: PresenceStatus): void;
  sendOperation(operation: unknown): void;
}

/**
 * Connect to the presence channel, keep a peer list, and reconnect with
 * backoff. Deliberately dependency-free: no auto-reconnect storms on a dead
 * server (`maxAttempts`), and no DOM/WebSocket type imports (a `socketFactory`
 * is injected instead).
 */
export function createPresenceClient(options: PresenceClientOptions): PresenceClient {
  const timers = options.timers ?? {
    setTimeout: (handler, timeout) => setTimeout(handler, timeout),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const reconnect: ReconnectPolicy = { ...DEFAULT_RECONNECT, ...(options.reconnect ?? {}) };
  const socketFactory = options.socketFactory ?? defaultSocketFactory;
  const identity = {
    userId: options.userId ?? options.username,
    username: options.username,
    projectId: options.projectId,
  };

  let socket: SocketLike | null = null;
  let connected = false;
  let attempts = 0;
  let stopped = false;
  let reconnectHandle: unknown = null;
  let heartbeatHandle: unknown = null;
  let peers: PresenceUser[] = [];
  let error: string | null = null;

  const state: PresenceClientState = { connected: false, attempts: 0, error: null, peers: [] };

  const publish = (): void => {
    state.connected = connected;
    state.attempts = attempts;
    state.error = error;
    state.peers = peers;
    options.onStateChange?.(state);
  };

  const emit = (event: PresenceEvent): void => {
    if (event.type === 'presence') peers = event.users;
    options.onEvent?.(event);
  };

  function connect(): void {
    if (stopped) return;
    let created: SocketLike;
    try {
      created = socketFactory(buildSocketUrl(options.url, identity));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      publish();
      scheduleReconnect();
      return;
    }
    socket = created;

    socket.onopen = () => {
      connected = true;
      error = null;
      attempts = 0;
      publish();
      if (options.heartbeatMs && options.heartbeatMs > 0) {
        heartbeatHandle = timers.setTimeout(() => {
          send({ type: 'ping' });
          heartbeatHandle = null;
        }, options.heartbeatMs);
      }
    };

    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      const parsed = parseSocketMessage(raw);
      if (!parsed) return;
      emit(parsed);
      publish();
    };

    socket.onerror = () => {
      connected = false;
      error = 'WebSocket error';
      publish();
    };

    socket.onclose = () => {
      connected = false;
      socket = null;
      if (heartbeatHandle !== null) {
        timers.clearTimeout(heartbeatHandle);
        heartbeatHandle = null;
      }
      publish();
      if (!stopped) scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectHandle !== null) return;
    if (attempts >= reconnect.maxAttempts) {
      error = error ?? 'presence unavailable: reconnect attempts exhausted';
      publish();
      return;
    }
    attempts += 1;
    const delay = computeReconnectDelay(attempts, reconnect);
    reconnectHandle = timers.setTimeout(() => {
      reconnectHandle = null;
      connect();
    }, delay);
    publish();
  }

  function send(payload: Record<string, unknown>): void {
    if (!socket) return;
    socket.send(JSON.stringify(payload));
  }

  return {
    state,
    start(): void {
      stopped = false;
      connect();
    },
    stop(): void {
      stopped = true;
      if (reconnectHandle !== null) {
        timers.clearTimeout(reconnectHandle);
        reconnectHandle = null;
      }
      if (heartbeatHandle !== null) {
        timers.clearTimeout(heartbeatHandle);
        heartbeatHandle = null;
      }
      const current = socket;
      connected = false;
      socket = null;
      current?.close(1000, 'client stop');
      peers = [];
      publish();
    },
    sendCursor(position): void {
      send({ type: 'cursor', position });
    },
    sendSelection(selection): void {
      send({ type: 'cursor_update', position: { x: 0, y: 0 }, selection });
    },
    setStatus(status): void {
      send({ type: 'presence', status });
    },
    sendOperation(operation): void {
      send({ type: 'operation', operation });
    },
  };
}

function defaultSocketFactory(url: string): SocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
  if (!Ctor) throw new Error('No WebSocket implementation in this environment');
  return new Ctor(url);
}
