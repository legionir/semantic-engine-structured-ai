/** Shapes returned by `apps/server`. Only the fields the web client reads. */

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly status?: string;
  readonly ownerId?: string;
  readonly config?: Record<string, unknown>;
  readonly scenes?: readonly unknown[];
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface AssetRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly url: string;
  readonly status?: string;
  readonly projectId?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Any JSON object; in practice the engine's `SceneSnapshot`. */
export type SceneDocument = object;

export interface BuildRecord {
  readonly id: string;
  readonly projectId: string;
  readonly buildNumber?: number;
  readonly buildType?: string;
  readonly targetPlatform?: string;
  readonly status: string;
  readonly outputUrl?: string | null;
  readonly error?: string | null;
  readonly logs?: string | null;
}

export interface AuthSession {
  readonly token: string;
  readonly user?: { readonly id?: string; readonly email?: string; readonly username?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, fallbackMessage: string) {
    super(extractMessage(body) ?? fallbackMessage);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

function extractMessage(body: unknown): string | null {
  if (typeof body === 'string' && body.trim() !== '') return body;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['error', 'message', 'statusCode']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
  }
  return null;
}

/** Join a base URL and a route path without ever doubling or dropping a slash. */
export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.trim().replace(/\/+$/, '');
  const trimmedPath = path.trim().replace(/^\/+/, '');
  if (trimmedPath === '') return trimmedBase === '' ? '/' : trimmedBase;
  return trimmedBase === '' ? `/${trimmedPath}` : `${trimmedBase}/${trimmedPath}`;
}

/**
 * Read the bearer token out of an auth response.
 *
 * `apps/server`'s `AuthService.login()` returns `{ access_token: … }` while the
 * register path returns the persisted user; the client tolerates the common
 * spellings so a server-side rename does not brick the login screen.
 */
export function extractToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['access_token', 'accessToken', 'token']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/**
 * Pick the first scene document out of a project record, if it has one.
 *
 * `scenes` is a jsonb column, so a document can come back as an object or — when
 * the row was written as text — as a JSON string. `normalizeSnapshot` on the
 * app side accepts both; this only has to stop the string from being dropped.
 */
export function readProjectScene(project: ProjectRecord | null | undefined): Record<string, unknown> | string | null {
  const scenes = project?.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) return null;
  const first = scenes[0];
  if (typeof first === 'string') return first.trim() === '' ? null : first;
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly tokenProvider?: () => string | null;
  readonly userIdProvider?: () => string | null;
}

export interface ApiRequestInit {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly auth?: boolean;
}

export interface ApiClient {
  request<T>(path: string, init?: ApiRequestInit): Promise<T>;
  health(): Promise<{ status: string; uptime?: number }>;
  login(credentials: { email: string; password: string }): Promise<AuthSession>;
  logout(): Promise<void>;
  listProjects(): Promise<ProjectRecord[]>;
  getProject(id: string): Promise<ProjectRecord>;
  createProject(input: { name: string; description?: string }): Promise<ProjectRecord>;
  updateProject(id: string, patch: Partial<ProjectRecord>): Promise<ProjectRecord>;
  deleteProject(id: string): Promise<void>;
  /** Store the serialized scene document in `project.scenes[0]` (jsonb). */
  saveProjectScene(id: string, scene: SceneDocument): Promise<ProjectRecord>;
  listAssets(): Promise<AssetRecord[]>;
  getAsset(id: string): Promise<AssetRecord>;
  createBuild(input: {
    projectId: string;
    buildType?: string;
    targetPlatform?: string;
    config?: Record<string, unknown>;
  }): Promise<BuildRecord>;
  startBuild(id: string): Promise<BuildRecord>;
  getBuild(id: string): Promise<BuildRecord>;
  listBuilds(projectId: string): Promise<BuildRecord[]>;
}

/**
 * Thin typed client for the Fastify routes in `apps/server`.
 *
 * Route inventory (from `apps/server/src/routes.ts` and the modules it calls):
 * `/health`, `/auth/{register,login,logout}`, `/projects[/:id]`,
 * `/assets[/:id]`, `/builds`, `/builds/:id/start`, `/builds/project/:id`.
 *
 * `fetch` and the token are injected so the whole layer is testable without a
 * browser or a live server.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available; pass `fetchImpl` to createApiClient.');
  }

  async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const token = options.tokenProvider?.() ?? null;
    if (init.auth !== false && token) headers.Authorization = `Bearer ${token}`;

    /* The project/asset handlers read the caller from `x-user-id` rather than
       from the JWT, so the client sends both until the server agrees on one. */
    const userId = options.userIdProvider?.() ?? null;
    if (userId) headers['x-user-id'] = userId;

    const response = await fetchImpl(joinUrl(options.baseUrl, path), {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await response.text();
    const body: unknown = text === '' ? null : safeJson(text);

    if (!response.ok) {
      throw new ApiError(response.status, body, `${method} ${path} failed (${response.status})`);
    }

    return body as T;
  }

  return {
    request,
    health: () => request('/health'),
    async login(credentials) {
      const body = await request<unknown>('/auth/login', { method: 'POST', body: credentials, auth: false });
      const token = extractToken(body);
      if (!token) {
        throw new ApiError(200, body, 'Login succeeded but returned no token');
      }
      const user = (body as Record<string, unknown>)['user'];
      return { token, ...(user && typeof user === 'object' ? { user: user as AuthSession['user'] } : {}) };
    },
    logout: async () => {
      await request<void>('/auth/logout', { method: 'POST' });
    },
    listProjects: () => request<ProjectRecord[]>('/projects'),
    getProject: (id) => request<ProjectRecord>(`/projects/${encodeURIComponent(id)}`),
    createProject: (input) => request<ProjectRecord>('/projects', { method: 'POST', body: input }),
    updateProject: (id, patch) =>
      request<ProjectRecord>(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
    deleteProject: async (id) => {
      await request<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    saveProjectScene: (id, scene) =>
      request<ProjectRecord>(`/projects/${encodeURIComponent(id)}`, {
        method: 'PUT',
        /* `scenes` is a jsonb array on the Project entity; index 0 is the active
           scene the web client loads on boot. */
        body: { scenes: [scene] },
      }),
    listAssets: () => request<AssetRecord[]>('/assets'),
    getAsset: (id) => request<AssetRecord>(`/assets/${encodeURIComponent(id)}`),
    createBuild: (input) =>
      request<BuildRecord>('/builds', {
        method: 'POST',
        body: { targetPlatform: 'web', ...input },
      }),
    startBuild: (id) => request<BuildRecord>(`/builds/${encodeURIComponent(id)}/start`, { method: 'POST' }),
    getBuild: (id) => request<BuildRecord>(`/builds/${encodeURIComponent(id)}`),
    listBuilds: (projectId) => request<BuildRecord[]>(`/builds/project/${encodeURIComponent(projectId)}`),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
