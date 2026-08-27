import { describe, expect, it } from 'vitest';
import {
  buildSocketUrl,
  computeReconnectDelay,
  createPresenceClient,
  parseSocketMessage,
  DEFAULT_RECONNECT,
  type SocketLike,
} from '../src/app/net/presence';

class FakeSocket implements SocketLike {
  readonly sent: string[] = [];
  closed = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed += 1;
  }

  open(): void {
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  drop(): void {
    this.onclose?.();
  }
}

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; handler: () => void }>();
  return {
    setTimeout(handler: () => void, timeout: number): number {
      const id = nextId++;
      pending.set(id, { at: now + timeout, handler });
      return id;
    },
    clearTimeout(handle: unknown): void {
      pending.delete(handle as number);
    },
    tick(ms: number): void {
      now += ms;
      [...pending.entries()].forEach(([id, job]) => {
        if (job.at <= now) {
          pending.delete(id);
          job.handler();
        }
      });
    },
    pending(): number {
      return pending.size;
    },
  };
}

describe('parseSocketMessage', () => {
  it('reads the message types the server broadcasts', () => {
    expect(parseSocketMessage(JSON.stringify({ type: 'connected', clientId: 'c1', userId: 'u1', projectId: 'p1' }))).toEqual({
      type: 'connected',
      clientId: 'c1',
      userId: 'u1',
      projectId: 'p1',
    });
    expect(parseSocketMessage(JSON.stringify({ type: 'pong' }))).toEqual({ type: 'pong' });
    expect(parseSocketMessage(JSON.stringify({ type: 'cursor', userId: 'u2', username: 'ada', position: { x: 3, y: 4 } })))
      .toMatchObject({ type: 'cursor', username: 'ada', position: { x: 3, y: 4 } });
  });

  it('normalizes a presence list and tolerates junk entries', () => {
    const event = parseSocketMessage(
      JSON.stringify({ type: 'presence', users: [{ userId: 'u1', username: 'ada', projectId: 'p1', status: 'busy', lastSeen: 5 }, null, 7] })
    );
    expect(event).toEqual({
      type: 'presence',
      users: [{ userId: 'u1', username: 'ada', projectId: 'p1', status: 'busy', lastSeen: 5 }],
    });
  });

  it('defaults an unknown status to online and a missing username to the id', () => {
    const event = parseSocketMessage(JSON.stringify({ type: 'presence', users: [{ userId: 'u9', status: 'sleeping' }] }));
    expect(event).toEqual({
      type: 'presence',
      users: [{ userId: 'u9', username: 'u9', projectId: '', status: 'online', lastSeen: 0 }],
    });
  });

  it('returns null for malformed or unknown frames instead of throwing', () => {
    expect(parseSocketMessage('not json')).toBeNull();
    expect(parseSocketMessage(JSON.stringify({ nope: true }))).toBeNull();
    expect(parseSocketMessage(JSON.stringify('a string'))).toBeNull();
  });
});

describe('computeReconnectDelay', () => {
  it('backs off exponentially and stops at the ceiling', () => {
    expect(computeReconnectDelay(1)).toBe(500);
    expect(computeReconnectDelay(2)).toBe(1_000);
    expect(computeReconnectDelay(3)).toBe(2_000);
    expect(computeReconnectDelay(12)).toBe(DEFAULT_RECONNECT.maxDelayMs);
  });

  it('treats a first attempt of 0 like attempt 1', () => {
    expect(computeReconnectDelay(0)).toBe(500);
  });
});

describe('buildSocketUrl', () => {
  it('passes the identity the server reads from the query string', () => {
    expect(buildSocketUrl('ws://h/ws', { userId: 'u1', username: 'ada', projectId: 'p1' })).toBe(
      'ws://h/ws?userId=u1&username=ada&projectId=p1'
    );
  });

  it('keeps query parameters the host already set', () => {
    expect(buildSocketUrl('ws://h/ws?token=abc', { userId: 'u1', username: 'ada', projectId: 'p1' })).toContain('token=abc');
  });
});

describe('createPresenceClient', () => {
  it('publishes connection state and the peer list', () => {
    const socket = new FakeSocket();
    const timers = createFakeTimers();
    const client = createPresenceClient({
      url: 'ws://h/ws',
      projectId: 'p1',
      username: 'ada',
      socketFactory: () => socket,
      timers,
    });

    expect(client.state.connected).toBe(false);
    client.start();
    socket.open();
    expect(client.state.connected).toBe(true);
    expect(client.state.error).toBeNull();

    socket.receive({ type: 'presence', users: [{ userId: 'u2', username: 'grace', projectId: 'p1', status: 'online', lastSeen: 1 }] });
    expect(client.state.peers.map((peer) => peer.username)).toEqual(['grace']);

    client.stop();
    expect(client.state.connected).toBe(false);
    expect(client.state.peers).toHaveLength(0);
    expect(socket.closed).toBe(1);
    expect(timers.pending()).toBe(0);
  });

  it('sends the message shapes the server switches on', () => {
    const socket = new FakeSocket();
    const client = createPresenceClient({
      url: 'ws://h/ws',
      projectId: 'p1',
      username: 'ada',
      socketFactory: () => socket,
      timers: createFakeTimers(),
    });
    client.start();
    socket.open();

    client.sendCursor({ x: 1, y: 2 });
    client.setStatus('away');
    client.sendOperation({ type: 'update_component' });
    client.sendSelection('entity-1');

    expect(socket.sent.map((raw) => JSON.parse(raw) as unknown)).toEqual([
      { type: 'cursor', position: { x: 1, y: 2 } },
      { type: 'presence', status: 'away' },
      { type: 'operation', operation: { type: 'update_component' } },
      { type: 'cursor_update', position: { x: 0, y: 0 }, selection: 'entity-1' },
    ]);
  });

  it('drops silently when the socket was never opened', () => {
    const client = createPresenceClient({
      url: 'ws://h/ws',
      projectId: 'p1',
      username: 'ada',
      socketFactory: () => new FakeSocket(),
      timers: createFakeTimers(),
    });
    expect(() => client.sendCursor({ x: 1, y: 1 })).not.toThrow();
  });

  it('reconnects with backoff after a drop and stops after maxAttempts', () => {
    const timers = createFakeTimers();
    const created: FakeSocket[] = [];
    const events: string[] = [];
    const client = createPresenceClient({
      url: 'ws://h/ws',
      projectId: 'p1',
      username: 'ada',
      reconnect: { maxAttempts: 1, baseDelayMs: 100, maxDelayMs: 100 },
      socketFactory: () => {
        const socket = new FakeSocket();
        created.push(socket);
        return socket;
      },
      timers,
      onStateChange: (state) => {
        if (state.error) events.push(state.error);
      },
    });

    client.start();
    created[0]!.drop();
    expect(timers.pending()).toBe(1);

    timers.tick(100);
    expect(created).toHaveLength(2);
    created[1]!.drop();

    /* `maxAttempts: 1` allows a single retry; the second drop ends the saga. */
    timers.tick(100);
    expect(created).toHaveLength(2);
    expect(timers.pending()).toBe(0);
    expect(client.state.error).toMatch(/reconnect attempts exhausted/);

    client.stop();
  });

  it('never reconnects after an explicit stop', () => {
    const timers = createFakeTimers();
    const socket = new FakeSocket();
    const client = createPresenceClient({
      url: 'ws://h/ws',
      projectId: 'p1',
      username: 'ada',
      socketFactory: () => socket,
      timers,
    });

    client.start();
    client.stop();
    socket.drop();

    expect(timers.pending()).toBe(0);
  });

  it('survives a socket factory that throws and retries', () => {
    const timers = createFakeTimers();
    let attempts = 0;
    const client = createPresenceClient({
      url: 'ws://h/ws',
      projectId: 'p1',
      username: 'ada',
      timers,
      reconnect: { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10 },
      socketFactory: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('no WebSocket implementation in this environment');
        return new FakeSocket();
      },
    });

    client.start();
    expect(client.state.error).toMatch(/no WebSocket implementation/);
    timers.tick(10);
    expect(attempts).toBe(2);
    client.stop();
  });
});
