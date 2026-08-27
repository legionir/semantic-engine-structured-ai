import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  extractToken,
  joinUrl,
  readProjectScene,
} from '../src/app/net/api-client';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('joinUrl', () => {
  it('joins a proxied base without doubling slashes', () => {
    expect(joinUrl('/api/', '/projects')).toBe('/api/projects');
    expect(joinUrl('', 'health')).toBe('/health');
    expect(joinUrl('http://127.0.0.1:3000', '/health')).toBe('http://127.0.0.1:3000/health');
    expect(joinUrl('http://127.0.0.1:3000', '')).toBe('http://127.0.0.1:3000');
  });
});

describe('extractToken', () => {
  it('accepts the shapes apps/server and its neighbours return', () => {
    expect(extractToken({ access_token: 'a' })).toBe('a');
    expect(extractToken({ accessToken: 'b' })).toBe('b');
    expect(extractToken({ token: 'c' })).toBe('c');
    expect(extractToken({ user: { id: '1' } })).toBeNull();
    expect(extractToken(null)).toBeNull();
  });
});

describe('readProjectScene', () => {
  it('reads the first scene document of a project record', () => {
    expect(readProjectScene({ id: 'p', name: 'n', scenes: [{ version: 1 }] })).toEqual({ version: 1 });
    expect(readProjectScene({ id: 'p', name: 'n' })).toBeNull();
    expect(readProjectScene(null)).toBeNull();
  });
});

describe('createApiClient', () => {
  it('sends method, body and headers, and parses JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ id: 'p1', name: 'Demo' }]));
    const api = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(api.listProjects()).resolves.toEqual([{ id: 'p1', name: 'Demo' }]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'GET' }));
  });

  it('adds the bearer token and the user header the project routes read', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tokenProvider: () => 'jwt-1',
      userIdProvider: () => 'user-1',
    });

    await api.updateProject('p 1', { name: 'Renamed' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/projects/p%201');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ name: 'Renamed' }));
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-1');
    expect(headers['x-user-id']).toBe('user-1');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does not send credentials for anonymous calls', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'jwt' }));
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tokenProvider: () => 'stale',
    });

    const session = await api.login({ email: 'a@b.c', password: 'x' });
    expect(session.token).toBe('jwt');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('turns a failed response into an ApiError carrying the server message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Project not found' }, 404));
    const api = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = await api.getProject('missing').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe('Project not found');
    expect((error as ApiError).isUnauthorized).toBe(false);
  });

  it('flags an auth failure so callers can clear the session', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'expired' }, 401));
    const api = createApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = await api.listProjects().catch((caught: unknown) => caught);
    expect((error as ApiError).isUnauthorized).toBe(true);
  });

  it('treats an empty body as null instead of failing to parse', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.deleteProject('p1')).resolves.toBeUndefined();
  });

  it('rejects a login that returns no token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { id: '1' } }));
    const api = createApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.login({ email: 'a@b.c', password: 'x' })).rejects.toThrow(/no token/i);
  });

  it('defaults the build target to web and lets the caller override it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'b1', projectId: 'p1', status: 'queued' }));
    const api = createApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });

    await api.createBuild({ projectId: 'p1' });
    const [, first] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(first.body))).toEqual({ targetPlatform: 'web', projectId: 'p1' });

    await api.createBuild({ projectId: 'p1', targetPlatform: 'desktop', buildType: 'production' });
    const [, second] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(second.body))).toEqual({
      targetPlatform: 'desktop',
      projectId: 'p1',
      buildType: 'production',
    });
  });

  it('sends the scene document where the Project entity keeps it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'p1', name: 'Demo' }));
    const api = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });

    await api.saveProjectScene('p1', { version: 1, id: 's', name: 'Demo', entities: [] });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projects/p1');
    expect(JSON.parse(String(init.body))).toEqual({
      scenes: [{ version: 1, id: 's', name: 'Demo', entities: [] }],
    });
  });

  it('throws a clear error when there is no fetch to use', () => {
    const original = globalThis.fetch;
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;
    try {
      expect(() => createApiClient({ baseUrl: '' })).toThrow(/fetch implementation/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});
