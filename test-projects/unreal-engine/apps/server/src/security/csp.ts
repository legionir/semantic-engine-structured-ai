/**
 * Content Security Policy (CSP) Middleware
 * Sets secure HTTP headers to prevent XSS, data injection,
 * and other code-injection attacks at the browser level.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { CSPDirectives, DEFAULT_CSP_DIRECTIVES } from './types';

/**
 * Build a CSP header string from directives.
 */
export function buildCspString(directives: Partial<CSPDirectives>): string {
  const merged: CSPDirectives = { ...DEFAULT_CSP_DIRECTIVES, ...directives };
  const parts: string[] = [];

  for (const [key, value] of Object.entries(merged)) {
    if (key === 'upgrade-insecure-requests' && value) {
      parts.push('upgrade-insecure-requests');
      continue;
    }
    if (key === 'block-all-mixed-content' && value) {
      parts.push('block-all-mixed-content');
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      parts.push(`${key} ${value.join(' ')}`);
    }
  }

  return parts.join('; ');
}

/**
 * Create a CSP middleware handler.
 */
export function createCspMiddleware(
  options?: {
    directives?: Partial<CSPDirectives>;
    reportOnly?: boolean;
    reportUri?: string;
  }
) {
  const directives = options?.directives ?? {};
  const reportOnly = options?.reportOnly ?? false;
  const reportUri = options?.reportUri;

  // Add report-uri if provided
  if (reportUri) {
    (directives as any)['report-uri'] = [reportUri];
    (directives as any)['report-to'] = ['csp-endpoint'];
  }

  const headerName = reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  const headerValue = buildCspString(directives);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header(headerName, headerValue);
  };
}

/**
 * Register CSP headers on a Fastify instance.
 */
export function registerCspHeaders(
  server: any,
  options?: {
    directives?: Partial<CSPDirectives>;
    reportOnly?: boolean;
    reportUri?: string;
  }
) {
  const middleware = createCspMiddleware(options);
  server.addHook('onRequest', middleware);
}

/**
 * Set other security headers (HSTS, X-Content-Type-Options, etc.).
 */
export function registerSecurityHeaders(server: any) {
  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // HTTP Strict Transport Security (HSTS)
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    
    // Prevent MIME type sniffing
    reply.header('X-Content-Type-Options', 'nosniff');
    
    // Prevent clickjacking
    reply.header('X-Frame-Options', 'DENY');
    
    // Enable XSS filter in older browsers
    reply.header('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions policy (restrict browser features)
    reply.header('Permissions-Policy', 
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    );
    
    // Disable automatic embedding
    reply.header('Cross-Origin-Embedder-Policy', 'require-corp');
    
    // Restrict cross-origin opener
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    
    // Restrict resource sharing
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  });
}
