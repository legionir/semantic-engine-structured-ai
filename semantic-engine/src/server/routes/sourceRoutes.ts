/**
 * sourceRoutes — REST Endpoints for Multi-Environment Source Synchronization (Domain 05).
 */

import { RouteDefinition, HttpRequestContext } from '../types';
import { ProjectService } from '../../services/ProjectService';
import { SourceSyncService } from '../../services/source/SourceSyncService';

export function createSourceRoutes(
  projectService: ProjectService,
  sourceSyncService: SourceSyncService
): RouteDefinition[] {
  const syncGitHandler = async (ctx: HttpRequestContext) => {
    const projectId = ctx.params.id;
    const project = projectService.getProject(projectId);
    if (!project) return { status: 404, json: { error: `Project '${projectId}' not found` } };

    const body = (ctx.body || {}) as { repoUrl?: string; branch?: string; commitHash?: string };
    if (!body.repoUrl) return { status: 400, json: { error: 'repoUrl is required for Git sync' } };

    const result = await sourceSyncService.syncFromGit(projectId, project.rootPath, {
      repoUrl: body.repoUrl,
      branch: body.branch,
      commitHash: body.commitHash,
    });
    return { status: 200, json: result };
  };

  const uploadHandler = async (ctx: HttpRequestContext) => {
    const projectId = ctx.params.id;
    const project = projectService.getProject(projectId);
    if (!project) return { status: 404, json: { error: `Project '${projectId}' not found` } };

    const body = (ctx.body || {}) as { files?: Record<string, string> };
    if (!body.files || Object.keys(body.files).length === 0) {
      return { status: 400, json: { error: 'files payload is required' } };
    }

    const result = await sourceSyncService.importBundle(projectId, project.rootPath, body.files);
    return { status: 200, json: result };
  };

  return [
    { method: 'POST', pattern: '/api/v1/projects/:id/source/sync', requireAuth: true, permission: 'project:write', handler: syncGitHandler },
    { method: 'POST', pattern: '/api/v2/projects/:id/source/sync-git', requireAuth: true, permission: 'project:write', handler: syncGitHandler },
    { method: 'POST', pattern: '/api/v1/projects/:id/source/upload', requireAuth: true, permission: 'project:write', handler: uploadHandler },
    { method: 'POST', pattern: '/api/v2/projects/:id/source/upload', requireAuth: true, permission: 'project:write', handler: uploadHandler },
    {
      method: 'PUT',
      pattern: '/api/v1/projects/:id/files/:filePath',
      requireAuth: true,
      permission: 'project:write',
      handler: async ctx => {
        const projectId = ctx.params.id;
        const project = projectService.getProject(projectId);
        if (!project) return { status: 404, json: { error: `Project '${projectId}' not found` } };

        const filePath = ctx.params.filePath;
        const body = (ctx.body || {}) as { content?: string };
        const content = body.content || '';

        const result = await sourceSyncService.importBundle(projectId, project.rootPath, { [filePath]: content });
        return { status: 200, json: { updated: true, file: filePath, result } };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/projects/import-bundle',
      requireAuth: true,
      permission: 'project:admin',
      handler: async ctx => {
        const body = (ctx.body || {}) as { projectId?: string; name?: string; files?: Record<string, string> };
        if (!body.projectId || !body.files) {
          return { status: 400, json: { error: 'projectId and files are required' } };
        }
        const project = await projectService.registerProject(body.projectId, body.name || body.projectId);
        const result = await sourceSyncService.importBundle(body.projectId, project.rootPath, body.files);
        return { status: 201, json: { project, syncResult: result } };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v2/projects/import-bundle',
      requireAuth: true,
      permission: 'project:admin',
      handler: async ctx => {
        const body = (ctx.body || {}) as { projectId?: string; name?: string; files?: Record<string, string> };
        if (!body.projectId || !body.files) {
          return { status: 400, json: { error: 'projectId and files are required' } };
        }
        const project = await projectService.registerProject(body.projectId, body.name || body.projectId);
        const result = await sourceSyncService.importBundle(body.projectId, project.rootPath, body.files);
        return { status: 201, json: { project, syncResult: result } };
      },
    },
  ];
}
