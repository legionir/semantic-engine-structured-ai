/**
 * Rate Limiting Middleware
 * Provides configurable rate limiting with multiple backends
 * and per-route/per-user granularity.
 */

import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * In-memory rate limiter store.
 * For production, use Redis or another distributed store.
 */
class InMemoryStore {
  private store: Map<string, { count: number; resetAt: number }> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    // Allow cleanup to not block process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; remaining: number; resetAt: number }> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { count: 1, remaining: 0, resetAt };
    }

    entry.count++;
    return {
      count: entry.count,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  async getRemaining(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    return entry.count;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// Global store instance
let globalStore: InMemoryStore;
function getStore(): InMemoryStore {
  if (!globalStore) {
    globalStore = new InMemoryStore();
  }
  return globalStore;
}

/**
 * Rate limit configuration.
 */
export interface RateLimitOptions {
  max: number;
  timeWindow: string | number;
  keyGenerator?: (request: FastifyRequest) => string;
  errorMessage?: string;
  skip?: (request: FastifyRequest) => boolean;
}

/**
 * Parse a time window string (e.g., "1 minute", "1h", "1000") to milliseconds.
 */
function parseTimeWindow(timeWindow: string | number): number {
  if (typeof timeWindow === 'number') return timeWindow;

  const match = timeWindow.match(/^(\d+)\s*(ms|s|sec|m|min|h|hour|d|day)?$/i);
  if (!match) {
    return 60_000; // default 1 minute
  }

  const value = parseInt(match[1], 10);
  const unit = (match[2] || 'ms').toLowerCase();

  switch (unit) {
    case 'ms': return value;
    case 's':
    case 'sec': return value * 1000;
    case 'm':
    case 'min': return value * 60 * 1000;
    case 'h':
    case 'hour': return value * 60 * 60 * 1000;
    case 'd':
    case 'day': return value * 24 * 60 * 60 * 1000;
    default: return value;
  }
}

/**
 * Default key generator: uses IP address.
 */
function defaultKeyGenerator(request: FastifyRequest): string {
  return request.ip || request.socket?.remoteAddress || 'unknown';
}

/**
 * Create a rate limit middleware.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const {
    max,
    timeWindow,
    keyGenerator = defaultKeyGenerator,
    errorMessage = 'Too many requests, please try again later',
    skip,
  } = options;

  const windowMs = parseTimeWindow(timeWindow);
  const store = getStore();

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (skip?.(request)) return;

    const key = keyGenerator(request);
    const result = await store.increment(key, windowMs);

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', Math.max(0, max - result.count));
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (result.count > max) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      reply.header('Retry-After', retryAfter);
      reply.status(429).send({
        error: errorMessage,
        retryAfter,
      });
      return;
    }
  };
}

/**
 * Register rate limiting on a Fastify instance with default config.
 */
export function registerRateLimiting(
  server: any,
  options?: Partial<RateLimitOptions>
) {
  const config: RateLimitOptions = {
    max: options?.max ?? 100,
    timeWindow: options?.timeWindow ?? '1 minute',
    keyGenerator: options?.keyGenerator,
    errorMessage: options?.errorMessage,
    skip: options?.skip,
  };

  const middleware = createRateLimiter(config);
  server.addHook('onRequest', middleware);
}

/**
 * Create a rate limiter for a specific route (stricter limits).
 */
export function createRouteRateLimiter(
  routeMax: number,
  routeWindow: string | number = '1 minute'
) {
  return createRateLimiter({
    max: routeMax,
    timeWindow: routeWindow,
    errorMessage: 'Too many requests for this endpoint',
  });
}

// Auth-specific rate limiters
export const authRateLimiter = createRateLimiter({
  max: 10,
  timeWindow: '1 minute',
  errorMessage: 'Too many authentication attempts, please try again later',
});

export const apiRateLimiter = createRateLimiter({
  max: 100,
  timeWindow: '1 minute',
  errorMessage: 'API rate limit exceeded',
});

export const buildRateLimiter = createRateLimiter({
  max: 5,
  timeWindow: '1 minute',
  errorMessage: 'Too many build requests, please wait',
});
