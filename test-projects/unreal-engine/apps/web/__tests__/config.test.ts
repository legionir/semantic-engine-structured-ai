import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  deriveWebsocketUrl,
  normalizeApiBaseUrl,
  parseBooleanFlag,
  parseRendererPreference,
  resolveConfig,
} from '../src/config';

const emptyReader = () => null;
const readerFrom = (values: Record<string, string>) => (name: string): string | null => values[name] ?? null;

describe('normalizeApiBaseUrl', () => {
  it('treats an empty or root base as same-origin', () => {
    expect(normalizeApiBaseUrl('')).toBe('');
    expect(normalizeApiBaseUrl('/')).toBe('');
    expect(normalizeApiBaseUrl(null)).toBe('');
  });

  it('strips trailing slashes but keeps the rest', () => {
    expect(normalizeApiBaseUrl('http://127.0.0.1:3000///')).toBe('http://127.0.0.1:3000');
    expect(normalizeApiBaseUrl('/api/')).toBe('/api');
  });
});

describe('parseBooleanFlag', () => {
  it('accepts the usual falsy spellings and defaults on empty', () => {
    expect(parseBooleanFlag('false', true)).toBe(false);
    expect(parseBooleanFlag('off', true)).toBe(false);
    expect(parseBooleanFlag('0', true)).toBe(false);
    expect(parseBooleanFlag('yes', false)).toBe(true);
    expect(parseBooleanFlag('', true)).toBe(true);
    expect(parseBooleanFlag(undefined, false)).toBe(false);
  });
});

describe('parseRendererPreference', () => {
  it('only accepts known backends', () => {
    expect(parseRendererPreference('webgpu')).toBe('webgpu');
    expect(parseRendererPreference('WEBGL2')).toBe('webgl2');
    expect(parseRendererPreference('directx', 'auto')).toBe('auto');
    expect(parseRendererPreference(null, 'webgl2')).toBe('webgl2');
  });
});

describe('deriveWebsocketUrl', () => {
  it('upgrades an http origin to ws', () => {
    expect(deriveWebsocketUrl('http://127.0.0.1:3000', null)).toBe('ws://127.0.0.1:3000/ws');
    expect(deriveWebsocketUrl('https://engine.example.com/', null)).toBe('wss://engine.example.com/ws');
  });

  it('leaves an already-pointed ws url alone', () => {
    expect(deriveWebsocketUrl('wss://engine.example.com/ws', null)).toBe('wss://engine.example.com/ws');
  });

  it('resolves a same-origin base against the page origin', () => {
    expect(deriveWebsocketUrl('/api', 'http://localhost:5173')).toBe('ws://localhost:5173/api/ws');
    expect(deriveWebsocketUrl('', 'http://localhost:5173')).toBe('ws://localhost:5173/ws');
  });

  it('gives up when there is no origin to resolve against', () => {
    expect(deriveWebsocketUrl('', null)).toBeNull();
  });
});

describe('resolveConfig', () => {
  it('falls back to defaults with no meta tags', () => {
    const config = resolveConfig({ read: emptyReader });
    /* No tag means same-origin, not DEFAULT_CONFIG's `/api`: the default only
       applies when the shell itself is missing entirely. */
    expect(config.apiBaseUrl).toBe('');
    expect(config.projectId).toBe(DEFAULT_CONFIG.projectId);
    expect(config.renderer).toBe('auto');
    expect(config.username).toBe(DEFAULT_CONFIG.username);
    expect(config.autoStart).toBe(true);
    expect(config.websocketUrl).toBeNull();
  });

  it('defaults match the shell that apps/web ships', () => {
    expect(DEFAULT_CONFIG.apiBaseUrl).toBe('/api');
    expect(DEFAULT_CONFIG.renderer).toBe('auto');
  });

  it('reads the meta tags the shell ships', () => {
    const config = resolveConfig({
      read: readerFrom({
        'web-engine:api-base-url': 'http://127.0.0.1:3000',
        'web-engine:project-id': 'proj-7',
        'web-engine:renderer': 'webgl2',
        'web-engine:username': 'ada',
        'web-engine:auto-start': 'false',
      }),
      pageOrigin: 'http://localhost:5173',
    });

    expect(config.apiBaseUrl).toBe('http://127.0.0.1:3000');
    expect(config.projectId).toBe('proj-7');
    expect(config.renderer).toBe('webgl2');
    expect(config.username).toBe('ada');
    expect(config.autoStart).toBe(false);
    expect(config.websocketUrl).toBe('ws://127.0.0.1:3000/ws');
  });

  it('lets a host page opt out of presence', () => {
    const config = resolveConfig({
      read: readerFrom({ 'web-engine:websocket-url': 'off' }),
      pageOrigin: 'http://localhost:5173',
    });
    expect(config.websocketUrl).toBeNull();
  });

  it('gives explicit overrides precedence', () => {
    const config = resolveConfig({
      read: readerFrom({ 'web-engine:project-id': 'from-meta' }),
      overrides: { projectId: 'from-host' },
    });
    expect(config.projectId).toBe('from-host');
  });
});
