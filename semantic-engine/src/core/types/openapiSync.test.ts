/**
 * Platform Core V1 — OpenAPI Contract Sync Test.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONTRACT_PATH = path.join(__dirname, '..', '..', '..', 'contracts', 'platform-v1.openapi.json');

describe('Platform Core V1 — OpenAPI Specification Sync', () => {
  it('contracts/platform-v1.openapi.json exists and is valid JSON', () => {
    expect(fs.existsSync(CONTRACT_PATH)).toBe(true);
    const content = fs.readFileSync(CONTRACT_PATH, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info.title).toContain('Semantic Engine');
  });

  it('contains all core REST and LoD endpoints', () => {
    const content = fs.readFileSync(CONTRACT_PATH, 'utf8');
    const parsed = JSON.parse(content);
    const paths = Object.keys(parsed.paths);

    const requiredPaths = [
      '/api/v1/system',
      '/health',
      '/ready',
      '/metrics',
      '/api/v1/config',
      '/api/v1/projects',
      '/api/v1/projects/{id}',
      '/api/v1/projects/{id}/index',
      '/api/v1/projects/{id}/jobs/{jobId}',
      '/api/v1/projects/{id}/events',
      '/api/v1/projects/{id}/search',
      '/api/v1/projects/{id}/symbols/{symbolId}',
      '/api/v1/projects/{id}/context',
      '/api/v1/projects/{id}/visualization/architecture',
      '/api/v1/projects/{id}/visualization/module/{moduleId}',
      '/api/v1/projects/{id}/visualization/file/{fileId}',
      '/api/v1/projects/{id}/visualization/neighborhood',
    ];

    for (const p of requiredPaths) {
      expect(paths).toContain(p);
    }
  });
});
