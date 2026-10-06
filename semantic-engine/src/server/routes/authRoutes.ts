/**
 * authRoutes — REST Endpoints for IAM, API Key management, and Scoped RBAC (Domain 03).
 */

import { RouteDefinition, HttpRequestContext } from '../types';
import { ApiKeyStore } from '../../security/rbac/ApiKeyStore';
import { ROLE_DEFAULT_PERMISSIONS, PlatformRole } from '../../security/rbac/types';

export function createAuthRoutes(apiKeyStore: ApiKeyStore): RouteDefinition[] {
  const getRolesHandler = async () => ({
    status: 200,
    json: {
      roles: Object.keys(ROLE_DEFAULT_PERMISSIONS),
      permissionsByRole: ROLE_DEFAULT_PERMISSIONS,
    },
  });

  const createKeyHandler = async (ctx: HttpRequestContext) => {
    const body = (ctx.body || {}) as {
      name?: string;
      role?: PlatformRole;
      resourceScope?: string;
      expiresInMs?: number;
    };

    if (!body.name) {
      return { status: 400, json: { error: 'Key name is required' } };
    }

    const role = body.role || 'Developer';
    if (!Object.prototype.hasOwnProperty.call(ROLE_DEFAULT_PERMISSIONS, role)) {
      return { status: 400, json: { error: `Unknown role '${String(role)}'` } };
    }

    if (body.expiresInMs !== undefined &&
        (!Number.isFinite(body.expiresInMs) || body.expiresInMs <= 0)) {
      return { status: 400, json: { error: 'expiresInMs must be a positive finite number' } };
    }

    const created = apiKeyStore.createKey({
      name: body.name,
      role,
      resourceScope: body.resourceScope,
      expiresInMs: body.expiresInMs,
    });

    return {
      status: 201,
      json: {
        rawToken: created.rawToken,
        key: created.key,
      },
    };
  };

  const verifyHandler = async (ctx: HttpRequestContext) => {
    const body = (ctx.body || {}) as { token?: string };
    const token = body.token || ctx.token || '';
    const record = apiKeyStore.verifyToken(token);
    if (!record) {
      return { status: 401, json: { valid: false, error: 'Invalid or expired token' } };
    }
    return {
      status: 200,
      json: {
        valid: true,
        keyId: record.id,
        name: record.name,
        role: record.role,
        permissions: record.permissions,
        resourceScope: record.resourceScope,
      },
    };
  };

  return [
    { method: 'GET', pattern: '/api/v1/roles', requireAuth: false, handler: getRolesHandler },
    { method: 'GET', pattern: '/api/v2/auth/roles', requireAuth: false, handler: getRolesHandler },
    { method: 'GET', pattern: '/api/v1/auth/api-keys', requireAuth: true, permission: 'auth:manage', handler: async () => ({ status: 200, json: { keys: apiKeyStore.listKeys() } }) },
    { method: 'GET', pattern: '/api/v2/auth/keys', requireAuth: true, permission: 'auth:manage', handler: async () => ({ status: 200, json: { keys: apiKeyStore.listKeys() } }) },
    { method: 'POST', pattern: '/api/v1/auth/api-keys', requireAuth: true, permission: 'auth:manage', handler: createKeyHandler },
    { method: 'POST', pattern: '/api/v2/auth/keys', requireAuth: true, permission: 'auth:manage', handler: createKeyHandler },
    {
      method: 'POST',
      pattern: '/api/v1/users',
      requireAuth: true,
      permission: 'auth:manage',
      handler: async ctx => {
        const body = (ctx.body || {}) as { username?: string; role?: PlatformRole };
        return {
          status: 201,
          json: {
            id: `user_${Date.now()}`,
            username: body.username || 'user',
            role: body.role || 'Developer',
            createdAt: Date.now(),
          },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/roles',
      requireAuth: true,
      permission: 'auth:manage',
      handler: async ctx => {
        const body = (ctx.body || {}) as { roleName?: string; permissions?: string[] };
        return {
          status: 201,
          json: { roleName: body.roleName, permissions: body.permissions || [] },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/permissions',
      requireAuth: true,
      permission: 'auth:manage',
      handler: async ctx => {
        const body = (ctx.body || {}) as { permission?: string };
        return {
          status: 201,
          json: { permission: body.permission, active: true },
        };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/auth/api-keys/:keyId',
      requireAuth: true,
      permission: 'auth:manage',
      handler: async ctx => {
        const keyId = ctx.params.keyId;
        const success = apiKeyStore.revokeKey(keyId);
        if (!success) return { status: 404, json: { error: `Key '${keyId}' not found` } };
        return { status: 200, json: { revoked: true, keyId } };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v2/auth/keys/:keyId',
      requireAuth: true,
      permission: 'auth:manage',
      handler: async ctx => {
        const keyId = ctx.params.keyId;
        const success = apiKeyStore.revokeKey(keyId);
        if (!success) return { status: 404, json: { error: `Key '${keyId}' not found` } };
        return { status: 200, json: { revoked: true, keyId } };
      },
    },
    { method: 'POST', pattern: '/api/v1/auth/verify', requireAuth: false, handler: verifyHandler },
    { method: 'POST', pattern: '/api/v2/auth/verify', requireAuth: false, handler: verifyHandler },
  ];
}
