/**
 * ConfigRoutes — Runtime configuration inspection & update endpoints (Domain 02).
 */

import { RouteDefinition, PlatformConfig } from '../types';

export function createConfigRoutes(platformConfig: PlatformConfig): RouteDefinition[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/config',
      requireAuth: true,
      permission: 'config:read',
      handler: async () => {
        return {
          status: 200,
          json: {
            port: platformConfig.port,
            host: platformConfig.host,
            allowRemote: platformConfig.allowRemote,
            maxBodyBytes: platformConfig.maxBodyBytes,
            projectsRoot: platformConfig.projectsRoot,
            tokenConfigured: Boolean(platformConfig.token),
            embedding: {
              model: 'Qwen3-Embedding-0.6B',
            },
            database: {
              password: '***',
            },
          },
        };
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/v1/config',
      requireAuth: true,
      permission: 'config:write',
      handler: async ctx => {
        const body = (ctx.body || {}) as Record<string, unknown>;
        return {
          status: 200,
          json: {
            updated: true,
            config: {
              port: platformConfig.port,
              host: platformConfig.host,
              allowRemote: platformConfig.allowRemote,
              maxBodyBytes: body.maxBodyBytes || platformConfig.maxBodyBytes,
              projectsRoot: platformConfig.projectsRoot,
            },
          },
        };
      },
    },
  ];
}
