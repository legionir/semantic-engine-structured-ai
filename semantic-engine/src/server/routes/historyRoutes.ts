/** REST endpoints for project-scoped Git history mining. */

import { RouteDefinition, HttpRequestContext } from '../types';
import { ProjectService } from '../../services/ProjectService';
import { GitHistoryMiner } from '../../services/history/GitHistoryMiner';

export function createHistoryRoutes(
  projectService: ProjectService,
  historyMiner: GitHistoryMiner
): RouteDefinition[] {
  const hotspotsHandler = async (ctx: HttpRequestContext) => {
    const projectId = ctx.params.id;
    if (!projectService.getProject(projectId)) return { status: 404, json: { error: `Project '${projectId}' not found` } };
    return { status: 200, json: { projectId, hotspots: historyMiner.getHotspots(projectId, 10) } };
  };

  const coChurnHandler = async (ctx: HttpRequestContext) => {
    const projectId = ctx.params.id;
    if (!projectService.getProject(projectId)) return { status: 404, json: { error: `Project '${projectId}' not found` } };
    const filePath = ctx.params.filePath;
    return { status: 200, json: { projectId, filePath, coChurn: historyMiner.getCoChurn(projectId, filePath, 10) } };
  };

  const recordCommitHandler = async (ctx: HttpRequestContext) => {
    const projectId = ctx.params.id;
    if (!projectService.getProject(projectId)) return { status: 404, json: { error: `Project '${projectId}' not found` } };
    const body = (ctx.body || {}) as { filesChanged?: string[]; linesDiff?: Record<string, { added: number; deleted: number }> };
    if (!body.filesChanged || !Array.isArray(body.filesChanged)) {
      return { status: 400, json: { error: 'filesChanged array is required' } };
    }
    historyMiner.recordCommit(projectId, body.filesChanged, body.linesDiff);
    return { status: 200, json: { success: true, projectId, filesRecorded: body.filesChanged.length } };
  };

  return [
    { method: 'GET', pattern: '/api/v1/projects/:id/history/hotspots', requireAuth: true, handler: hotspotsHandler },
    { method: 'GET', pattern: '/api/v2/projects/:id/history/hotspots', requireAuth: true, handler: hotspotsHandler },
    { method: 'GET', pattern: '/api/v1/projects/:id/history/co-churn/:filePath', requireAuth: true, handler: coChurnHandler },
    { method: 'GET', pattern: '/api/v2/projects/:id/history/co-churn/:filePath', requireAuth: true, handler: coChurnHandler },
    { method: 'POST', pattern: '/api/v1/projects/:id/history/record-commit', requireAuth: true, handler: recordCommitHandler },
    { method: 'POST', pattern: '/api/v2/projects/:id/history/record-commit', requireAuth: true, handler: recordCommitHandler },
  ];
}
