/**
 * Authentication & Authorization Middleware
 * Provides JWT verification, role-based access control,
 * and permission checking for Fastify routes.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { AuthUser, ROLES, Role } from './types';

/**
 * JWT payload structure.
 */
interface JwtPayload {
  sub: string;
  email: string;
  username?: string;
  roles?: Role[];
  iat?: number;
  exp?: number;
}

/**
 * Extract JWT secret from environment or use default.
 */
function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'fallback_secret_key';
}

/**
 * Verify and decode a JWT token.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Extract token from request headers.
 */
function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;

  // Support Bearer token
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    return parts[1];
  }

  // Support raw token in header
  return authHeader;
}

/**
 * Authentication middleware — verifies JWT and attaches user to request.
 */
export function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): AuthUser | null {
  const token = extractToken(request);

  if (!token) {
    reply.status(401).send({ error: 'Authentication required' });
    return null;
  }

  const payload = verifyToken(token);
  if (!payload) {
    reply.status(401).send({ error: 'Invalid or expired token' });
    return null;
  }

  const user: AuthUser = {
    id: payload.sub,
    email: payload.email,
    username: payload.username,
    roles: payload.roles || ['user'],
    permissions: getPermissionsForRoles(payload.roles || ['user']),
  };

  // Attach user to request
  (request as any).user = user;

  return user;
}

/**
 * Get all permissions for a given set of roles.
 */
function getPermissionsForRoles(roles: Role[]): string[] {
  const permissions = new Set<string>();
  for (const role of roles) {
    const perms = ROLES[role];
    if (perms) {
      perms.forEach((p) => permissions.add(p));
    }
  }
  return Array.from(permissions);
}

/**
 * Authorization middleware — checks if the authenticated user has the required role.
 */
export function requireRole(...roles: Role[]) {
  return (request: FastifyRequest, reply: FastifyReply): boolean => {
    const user = (request as any).user as AuthUser | undefined;

    if (!user) {
      reply.status(401).send({ error: 'Authentication required' });
      return false;
    }

    const hasRole = user.roles.some((r) => roles.includes(r as Role));
    if (!hasRole) {
      reply.status(403).send({ error: 'Insufficient permissions' });
      return false;
    }

    return true;
  };
}

/**
 * Authorization middleware — checks if the authenticated user has the required permission.
 */
export function requirePermission(...permissions: string[]) {
  return (request: FastifyRequest, reply: FastifyReply): boolean => {
    const user = (request as any).user as AuthUser | undefined;

    if (!user) {
      reply.status(401).send({ error: 'Authentication required' });
      return false;
    }

    // Admin role has all permissions
    if (user.roles.includes('admin')) return true;

    const hasPermission = permissions.some((p) => {
      if (user.permissions.includes('*')) return true;
      return user.permissions.includes(p);
    });

    if (!hasPermission) {
      reply.status(403).send({ error: 'Insufficient permissions' });
      return false;
    }

    return true;
  };
}

/**
 * Create an auth middleware wrapper for Fastify route handlers.
 */
export function authGuard(
  handler: (request: FastifyRequest, reply: FastifyReply, user: AuthUser) => Promise<void>,
  options?: {
    requireRoles?: Role[];
    requirePermissions?: string[];
  }
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Step 1: Authenticate
    const user = authenticate(request, reply);
    if (!user) return;

    // Step 2: Role check
    if (options?.requireRoles?.length) {
      const passed = requireRole(...options.requireRoles)(request, reply);
      if (!passed) return;
    }

    // Step 3: Permission check
    if (options?.requirePermissions?.length) {
      const passed = requirePermission(...options.requirePermissions)(request, reply);
      if (!passed) return;
    }

    // Step 4: Execute handler
    await handler(request, reply, user);
  };
}

/**
 * Create a simple token (for API keys, service-to-service auth).
 */
export function createToken(payload: Partial<JwtPayload>, expiresIn: string = '24h'): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

/**
 * Decode a token without verification (for reading payload).
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
}
