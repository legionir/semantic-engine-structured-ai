/**
 * providerRoutes — کشف provider و مدل‌های embedding (SE-UI-03).
 *
 * از UI برای «اتصال provider»، «دریافت خودکار مدل‌ها» و انتخاب مدل
 * embedding استفاده می‌شود.
 */

import { RouteDefinition } from '../types';
import {
  EmbeddingProviderService,
  ProviderKind,
} from '../../services/providers/EmbeddingProviderService';

export function createProviderRoutes(service: EmbeddingProviderService): RouteDefinition[] {
  return [
    {
      // فهرست provider های پشتیبانی‌شده + مدل‌های لوکال پیش‌فرض.
      method: 'GET',
      pattern: '/api/v1/providers',
      permission: 'config:read',
      handler: async () => ({
        status: 200,
        json: {
          providers: service.listProviders(),
          localModels: service.listLocalModels(),
        },
      }),
    },
    {
      // اتصال به provider و دریافت خودکار مدل‌ها.
      method: 'POST',
      pattern: '/api/v1/providers/models',
      permission: 'config:read',
      schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['local', 'ollama', 'openai-compatible'] },
          baseUrl: { type: 'string' },
          apiKey: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
        required: ['provider'],
      },
      handler: async ctx => {
        const body = (ctx.body || {}) as {
          provider: ProviderKind;
          baseUrl?: string;
          apiKey?: string;
          timeoutMs?: number;
        };
        const result = await service.fetchModels(body);
        return {
          status: result.connected ? 200 : 502,
          json: result,
        };
      },
    },
  ];
}
