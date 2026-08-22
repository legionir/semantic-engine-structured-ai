import { PermissionChecker } from './PermissionChecker';
import { AuthContext } from './types';

describe('PermissionChecker (V2 Scoped RBAC)', () => {
  it('allows Admin with global wildcard scope to access any project and resource', () => {
    const auth: AuthContext = {
      authenticated: true,
      role: 'Admin',
      permissions: ['project:read', 'project:write', 'system:admin'],
      resourceScope: '*',
    };

    const res = PermissionChecker.hasPermission(auth, 'project:write', 'project-any');
    expect(res.allowed).toBe(true);
  });

  it('rejects Agent scoped to project-A when attempting to access project-B', () => {
    const auth: AuthContext = {
      authenticated: true,
      role: 'Agent',
      permissions: ['semantic:query', 'semantic:context', 'project:read'],
      resourceScope: 'project:project-A',
    };

    const allowedOnA = PermissionChecker.hasPermission(auth, 'semantic:query', 'project-A');
    expect(allowedOnA.allowed).toBe(true);

    const allowedOnB = PermissionChecker.hasPermission(auth, 'semantic:query', 'project-B');
    expect(allowedOnB.allowed).toBe(false);
    expect(allowedOnB.reason).toContain('Resource scope mismatch');
  });

  it('rejects action when required permission is missing', () => {
    const auth: AuthContext = {
      authenticated: true,
      role: 'ReadOnly',
      permissions: ['project:read', 'semantic:query'],
      resourceScope: '*',
    };

    const res = PermissionChecker.hasPermission(auth, 'config:write');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('Missing required permission');
  });
});
