/**
 * One factory for every embedding provider — فاز ۵.
 *
 * Until now the "which generator do I build" decision lived inside
 * `server/routes/jobRoutes.ts`, so the platform server could use Ollama or an
 * OpenAI-compatible endpoint while the CLI could only ever build
 * `HashingEmbeddingGenerator`. Two code paths that must agree are how a user
 * ends up with a UI-configured model and a silently different index.
 *
 * This module is that single decision point; `jobRoutes` and the CLI both call
 * it.
 *
 * Secrets: the caller resolves the API key from the environment and passes the
 * value in. Nothing here reads a config file or logs the key.
 */

import { IEmbeddingGenerator } from './EmbeddingGenerator';
import { HashingEmbeddingGenerator } from './HashingEmbeddingGenerator';
import { RemoteEmbeddingGenerator, RemoteEmbeddingProvider } from './RemoteEmbeddingGenerator';

export type EmbeddingProviderName = 'local' | RemoteEmbeddingProvider;

export const EMBEDDING_PROVIDER_NAMES: readonly EmbeddingProviderName[] = [
  'local',
  'ollama',
  'openai-compatible',
];

export function isEmbeddingProviderName(value: unknown): value is EmbeddingProviderName {
  return (
    typeof value === 'string' && (EMBEDDING_PROVIDER_NAMES as readonly string[]).includes(value)
  );
}

export interface EmbeddingGeneratorSpec {
  readonly enabled: boolean;
  readonly provider?: EmbeddingProviderName;
  readonly model?: string;
  readonly baseUrl?: string;
  /** مقدار کلید (از محیط خوانده شده)، نه نام متغیر. */
  readonly apiKey?: string;
  readonly useDefaultModel?: boolean;
  readonly normalize?: boolean;
}

/**
 * ساخت generator مطابق spec.
 *
 * `enabled: false` → `null` (بدون vector). `local` → hashing قطعی و بدون
 * وابستگی native؛ بقیه → `RemoteEmbeddingGenerator` که به `baseUrl` و `model`
 * نیاز دارد و در نبودشان **بلند** خطا می‌دهد، چون یک index بی‌embedding که
 * بی‌صدا ساخته شود بعداً قابل تشخیص نیست.
 */
export function createEmbeddingGenerator(spec: EmbeddingGeneratorSpec): IEmbeddingGenerator | null {
  if (!spec.enabled) return null;

  const provider: EmbeddingProviderName = spec.provider ?? 'local';

  if (provider === 'local') {
    /*
    | The production-safe local provider is deterministic hashing. The
    | transformer/native stack is intentionally not bundled because its
    | transitive audit contained critical/high vulnerabilities and its model
    | download is not suitable for an unisolated worker.
    */
    return new HashingEmbeddingGenerator();
  }

  if (!spec.baseUrl) {
    throw new Error(`embedding provider "${provider}" needs a baseUrl`);
  }
  if (!spec.model && !spec.useDefaultModel) {
    throw new Error(`embedding provider "${provider}" needs a model`);
  }

  return new RemoteEmbeddingGenerator({
    provider,
    baseUrl: spec.baseUrl,
    model: spec.model || '',
    ...(spec.apiKey ? { apiKey: spec.apiKey } : {}),
    normalize: spec.normalize ?? true,
  });
}
