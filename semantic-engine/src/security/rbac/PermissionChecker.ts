/**
 * PermissionChecker — Evaluates permissions and resource scoping for Platform V2.
 */

import { AuthContext, PermissionScope } from './types';

export class PermissionChecker {
  static hasPermission(
    auth: AuthContext,
    requiredPermission: PermissionScope,
    targetProjectId?: string
  ): { allowed: boolean; reason?: string } {
    if (!auth.authenticated) {
      return { allowed: false, reason: 'Unauthenticated' };
    }

    if (!auth.permissions.includes(requiredPermission) && !auth.permissions.includes('system:admin')) {
      return {
        allowed: false,
        reason: `Missing required permission: ${requiredPermission}`,
      };
    }

    if (targetProjectId && auth.resourceScope !== '*') {
      const allowedScope = `project:${targetProjectId}`;
      if (auth.resourceScope !== allowedScope) {
        return {
          allowed: false,
          reason: `Resource scope mismatch: key is scoped to '${auth.resourceScope}', but request targets 'project:${targetProjectId}'`,
        };
      }
    }

    return { allowed: true };
  }
}
