/**
 * CSRF Protection Middleware
 * Implements double-submit cookie pattern and token validation
 * to protect against Cross-Site Request Forgery attacks.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';

/**
 * Default configuration for CSRF protection.
 */
export const DEFAULT_CSRF_CONFIG = {
  enabled: true,
  cookieName: 'csrf-token',
  headerName: 'x-csrf-token',
  secretLength: 32,
  methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  safeMethods: ['GET', 'HEAD', 'OPTIONS'],
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 86400, // 24 hours
  },
};

/**
 * Generate a CSRF token.
 */
export function generateCsrfToken(secret?: string): string {
  const randomBytes = crypto.randomBytes(32);
  const timestamp = Date.now().toString(36);
  const raw = `${timestamp}.${randomBytes.toString('hex')}`;
  if (secret) {
    const hmac = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return `${raw}.${hmac}`;
  }
  return raw;
}

/**
 * Validate a CSRF token.
 */
export function validateCsrfToken(token: string, secret?: string): boolean {
  if (!token) return false;
  if (secret) {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const data = `${parts[0]}.${parts[1]}`;
    const expectedHmac = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expectedHmac));
  }
  return token.length > 0;
}

/**
 * CSRF protection middleware factory.
 */
export function createCsrfMiddleware(options?: Partial<typeof DEFAULT_CSRF_CONFIG>) {
  const config = { ...DEFAULT_CSRF_CONFIG, ...options };
  const secret = config.secret || crypto.randomBytes(16).toString('hex');

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.enabled) return;

    // Skip safe methods
    if (config.safeMethods.includes(request.method)) {
      // Set CSRF cookie on GET requests if not present
      const existingCookie = request.cookies?.[config.cookieName];
      if (!existingCookie) {
        const token = generateCsrfToken(secret);
        reply.setCookie(config.cookieName, token, config.cookieOptions);
      }
      return;
    }

    // Only protect configured methods
    if (!config.methods.includes(request.method)) return;

    // Get token from header or body
    const headerToken = request.headers[config.headerName] as string;
    const bodyToken = (request.body as any)?.[config.headerName?.replace(/-/g, '_')] || 
                     (request.body as any)?.[config.cookieName];
    const token = headerToken || bodyToken;

    if (!token) {
      reply.status(403).send({ error: 'Missing CSRF token' });
      return;
    }

    // Validate the token
    if (!validateCsrfToken(token, secret)) {
      reply.status(403).send({ error: 'Invalid CSRF token' });
      return;
    }

    // Double-submit cookie pattern: validate token matches cookie
    const cookieToken = request.cookies?.[config.cookieName];
    if (cookieToken && token !== cookieToken) {
      reply.status(403).send({ error: 'CSRF token mismatch' });
      return;
    }
  };
}

/**
 * Register CSRF protection on a Fastify instance.
 */
export function registerCsrfProtection(
  server: any,
  options?: Partial<typeof DEFAULT_CSRF_CONFIG>
) {
  const middleware = createCsrfMiddleware(options);
  server.addHook('onRequest', middleware);
}
