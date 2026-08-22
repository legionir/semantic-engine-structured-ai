/**
 * Security Layer — Shared Types
 */

export interface SecurityOptions {
  csrf?: CSRFConfig;
  csp?: CSPConfig;
  rateLimit?: RateLimitConfig;
  cors?: CORSConfig;
}

export interface CSRFConfig {
  enabled: boolean;
  secret?: string;
  cookieName?: string;
  headerName?: string;
  methods?: string[];
}

export interface CSPConfig {
  enabled: boolean;
  directives?: Partial<CSPDirectives>;
  reportOnly?: boolean;
  reportUri?: string;
}

export interface CSPDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'font-src': string[];
  'connect-src': string[];
  'media-src': string[];
  'object-src': string[];
  'frame-src': string[];
  'worker-src': string[];
  'manifest-src': string[];
  'base-uri': string[];
  'form-action': string[];
  'frame-ancestors': string[];
  'upgrade-insecure-requests': boolean;
  'block-all-mixed-content': boolean;
}

export interface RateLimitConfig {
  enabled: boolean;
  max: number;
  timeWindow: string | number;
  keyGenerator?: (req: any) => string;
  errorMessage?: string;
  skip?: (req: any) => boolean;
}

export interface CORSConfig {
  enabled: boolean;
  origin: string | string[] | RegExp;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  username?: string;
  roles: string[];
  permissions: string[];
}

export interface AuthenticatedRequest {
  user: AuthUser;
}

export type Role = 'admin' | 'editor' | 'viewer' | 'user';

export const ROLES: Record<Role, string[]> = {
  admin: ['*'],
  editor: ['project:read', 'project:write', 'asset:read', 'asset:write', 'build:read', 'build:write'],
  viewer: ['project:read', 'asset:read', 'build:read'],
  user: ['project:read', 'project:write', 'asset:read', 'asset:write', 'build:read'],
};

export const DEFAULT_CSP_DIRECTIVES: CSPDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", 'ws:', 'wss:'],
  'media-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'upgrade-insecure-requests': true,
  'block-all-mixed-content': true,
};
