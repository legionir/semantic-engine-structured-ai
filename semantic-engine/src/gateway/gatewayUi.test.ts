/**
 * Gateway console logic — فاز ۱۲.
 *
 * `public/gateway.js` keeps its pure half (form mapping, validation, rendering,
 * URLs) free of the DOM so Node can require it. The point of these tests is the
 * contract the plan asks for: **every form field maps to a key of the
 * WorkerConfig schema, and every schema key is reachable from the form.**
 */

import * as path from 'path';
import { WORKER_CONFIG_JSON_SCHEMA } from './WorkerConfigSchema';
import { ProjectWorkerConfig } from './types';

const ui = require(path.join(__dirname, '..', '..', 'public', 'gateway.js')) as {
  WORKER_FORM_FIELDS: { name: string; section: string; type: string; configPath: string }[];
  WORKER_ACTIONS: { id: string }[];
  formToConfig(values: Record<string, unknown>): Record<string, unknown>;
  configToForm(config: unknown): Record<string, unknown>;
  validateForm(values: Record<string, unknown>): { field: string; message: string }[];
  commandPreview(config: Record<string, unknown>): string;
  summarize(workers: Record<string, unknown>[]): Record<string, number>;
  stateClass(worker: Record<string, unknown>): string;
  renderWorkerRow(worker: Record<string, unknown>): string;
  renderSummaryCards(stats: Record<string, number>): string;
  renderFormFields(values: Record<string, unknown>): string;
  projectDashboardUrl(projectId: string): string;
  mcpEndpointUrl(projectId: string): string;
};

/** همهٔ کلیدهای schema، به‌شکل نقطه‌دار (`indexing.vectors`). */
function schemaKeys(): string[] {
  const properties = WORKER_CONFIG_JSON_SCHEMA.properties as Record<
    string,
    { type?: string; properties?: Record<string, unknown> }
  >;
  const keys: string[] = [];

  for (const [name, definition] of Object.entries(properties)) {
    if (definition.type === 'object' && definition.properties) {
      for (const child of Object.keys(definition.properties)) keys.push(`${name}.${child}`);
    } else {
      keys.push(name);
    }
  }

  return keys;
}

describe('gateway console — form ↔ WorkerConfig schema', () => {
  it('maps every form field to a real schema key', () => {
    const keys = new Set(schemaKeys());

    for (const field of ui.WORKER_FORM_FIELDS) {
      expect(`${field.name} → ${field.configPath}`).toBeTruthy();
      expect(keys.has(field.configPath)).toBe(true);
    }
  });

  it('leaves no schema key unreachable from the form', () => {
    const covered = new Set(ui.WORKER_FORM_FIELDS.map(field => field.configPath));

    for (const key of schemaKeys()) {
      expect(key).toBe(covered.has(key) ? key : `MISSING FORM FIELD: ${key}`);
    }
  });

  it('has no duplicate field names', () => {
    const names = ui.WORKER_FORM_FIELDS.map(field => field.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('round-trips a configuration through the form', () => {
    const config = {
      projectId: 'prj-app-12345678',
      name: 'App',
      rootPath: '/srv/app',
      autoStart: true,
      watch: true,
      indexing: { vectors: true, sqlite: false, blueprint: true, git: true, treeSitter: true, pretty: false },
      watchOptions: { debounceMs: 250, blueprintMode: 'threshold', skipInitialIndex: true },
      service: { transport: 'socket', host: '127.0.0.1', socketPath: '/run/app.sock', web: true },
      security: { gatewayManaged: true, allowRemote: false, tokenEnvVar: 'SE_TOKEN' },
      embedding: { enabled: true, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', normalize: true },
    } as unknown as ProjectWorkerConfig;

    const values = ui.configToForm(config);
    expect(values['projectId']).toBe('prj-app-12345678');
    expect(values['debounceMs']).toBe(250);
    expect(values['embeddingProvider']).toBe('ollama');
    expect(values['treeSitter']).toBe(true);
    expect(values['pretty']).toBe(false);

    const back = ui.formToConfig(values) as Record<string, unknown>;
    expect(back['projectId']).toBe('prj-app-12345678');
    expect((back['watchOptions'] as Record<string, unknown>)['debounceMs']).toBe(250);
    expect((back['indexing'] as Record<string, unknown>)['pretty']).toBe(false);
    expect((back['service'] as Record<string, unknown>)['socketPath']).toBe('/run/app.sock');
    expect((back['security'] as Record<string, unknown>)['tokenEnvVar']).toBe('SE_TOKEN');
  });
});

describe('gateway console — validation', () => {
  const valid = {
    projectId: 'prj-app-12345678',
    name: 'App',
    rootPath: '/srv/app',
    debounceMs: 500,
    transport: 'loopback',
    embeddingEnabled: false,
    embeddingProvider: 'local',
  };

  it('accepts a valid configuration', () => {
    expect(ui.validateForm(valid)).toEqual([]);
  });

  it.each([
    ['projectId', { projectId: 'Not Valid' }, /lowercase/],
    ['name', { name: '   ' }, /must not be empty/],
    ['rootPath', { rootPath: '' }, /must not be empty/],
    ['debounceMs', { debounceMs: 5 }, /between 25 and 60000/],
    ['port', { port: 70000 }, /between 0 and 65535/],
    ['socketPath', { transport: 'socket', socketPath: '' }, /required when the transport is socket/],
    ['allowRemote', { gatewayManaged: true, allowRemote: true, tokenEnvVar: 'T' }, /must not allow remote/],
    ['tokenEnvVar', { gatewayManaged: true, tokenEnvVar: '' }, /needs a token environment variable/],
    ['embeddingBaseUrl', { embeddingEnabled: true, embeddingProvider: 'ollama', embeddingBaseUrl: 'localhost' }, /http\(s\) URL/],
    ['embeddingModel', { embeddingEnabled: true, embeddingProvider: 'openai-compatible', embeddingBaseUrl: 'http://x', embeddingModel: '' }, /model is required/],
  ])('rejects %s', (_field, patch, pattern) => {
    const errors = ui.validateForm({ ...valid, ...patch });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map(error => error.message).join(' ')).toMatch(pattern);
  });

  it('refuses a secret in the form values', () => {
    const errors = ui.validateForm({ ...valid, apiKey: 'sk-live-123' });
    expect(errors.map(error => error.message).join(' ')).toMatch(/secrets are never/);
  });
});

describe('gateway console — preview and rendering', () => {
  const config = {
    projectId: 'prj-app-12345678',
    rootPath: '/srv/app',
    dataDir: '/srv/data',
    indexing: { vectors: true, sqlite: false, blueprint: true, git: true, treeSitter: true, pretty: true },
    watchOptions: { debounceMs: 250, blueprintMode: 'threshold' },
    service: { transport: 'loopback', host: '127.0.0.1' },
    security: { gatewayManaged: true, tokenEnvVar: 'SE_TOKEN' },
    embedding: { enabled: true, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', normalize: true },
  };

  it('previews the same flags the worker accepts', () => {
    const preview = ui.commandPreview(config);

    expect(preview.startsWith('semantic-engine worker ')).toBe(true);
    expect(preview).toContain('--project-id prj-app-12345678');
    expect(preview).toContain('--root /srv/app');
    expect(preview).toContain('--data-dir /srv/data');
    expect(preview).toContain('--vectors');
    expect(preview).toContain('--no-sqlite');
    expect(preview).toContain('--debounce 250');
    expect(preview).toContain('--blueprint-mode threshold');
    expect(preview).toContain('--gateway-managed');
    expect(preview).toContain('--embedding-provider ollama');
    expect(preview).toContain('--embedding-normalize');
  });

  it('never previews a secret value, only the variable name', () => {
    const preview = ui.commandPreview(config);
    expect(preview).not.toContain('SE_TOKEN');
    expect(preview).not.toMatch(/sk-/);
  });

  it('has no shell metacharacters in the flags it emits', () => {
    for (const part of ui.commandPreview(config).split(' ')) {
      if (part.startsWith('--')) expect(part).toMatch(/^--[a-z0-9-]+$/);
    }
  });

  it('renders one row per worker, with its state and actions', () => {
    const workers = Array.from({ length: 10 }, (_unused, index) => ({
      projectId: `prj-app-${String(index).padStart(8, '0')}`,
      name: `App ${index}`,
      rootPath: `/srv/app-${index}`,
      pid: 1000 + index,
      state: index % 2 === 0 ? 'ready' : 'starting',
      indexState: index % 2 === 0 ? 'fresh' : 'missing',
      restartCount: index,
      degraded: index === 3,
    }));

    const rows = workers.map(worker => ui.renderWorkerRow(worker)).join('');

    for (let index = 0; index < 10; index += 1) {
      expect(rows).toContain(`prj-app-${String(index).padStart(8, '0')}`);
    }
    expect(rows).toContain('state-ready');
    expect(rows).toContain('state-indexing');
    expect(rows).toContain('state-degraded');

    for (const action of ui.WORKER_ACTIONS) {
      expect(rows).toContain(`data-action="${action.id}"`);
    }
  });

  it('escapes what it renders', () => {
    const row = ui.renderWorkerRow({ projectId: '<script>alert(1)</script>', name: 'x', state: 'ready' });
    expect(row).not.toContain('<script>');
    expect(row).toContain('&lt;script&gt;');
  });

  it('aggregates the cards', () => {
    const stats = ui.summarize([
      { state: 'ready', restartCount: 1 },
      { state: 'starting', restartCount: 0 },
      { state: 'crashed', restartCount: 2, degraded: true },
    ]);

    expect(stats['projects']).toBe(3);
    expect(stats['ready']).toBe(1);
    expect(stats['indexing']).toBe(1);
    expect(stats['crashed']).toBe(1);
    expect(stats['degraded']).toBe(1);
    expect(stats['restarts']).toBe(3);

    const cards = ui.renderSummaryCards(stats);
    expect(cards).toContain('data-key="projects"');
    expect(cards).toContain('>3<');
  });

  it('renders every form field with its section', () => {
    const html = ui.renderFormFields(ui.configToForm(config as unknown as ProjectWorkerConfig));

    for (const field of ui.WORKER_FORM_FIELDS) {
      expect(html).toContain(`name="${field.name}"`);
      expect(html).toContain(`data-config="${field.configPath}"`);
    }
    for (const section of ['project', 'indexing', 'watch', 'service', 'security', 'embedding', 'advanced']) {
      expect(html).toContain(`data-section="${section}"`);
    }
  });

  it('builds the deep links', () => {
    expect(ui.projectDashboardUrl('prj-app-12345678')).toBe('/visualizer?project=prj-app-12345678');
    expect(ui.projectDashboardUrl('a/b')).toBe('/visualizer?project=a%2Fb');
    expect(ui.mcpEndpointUrl('prj-app-12345678')).toBe('/mcp/prj-app-12345678');
  });
});
