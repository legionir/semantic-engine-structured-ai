/** Project and dashboard routes backed only by ProjectService data. */

import { RouteDefinition } from '../types';
import { ProjectService } from '../../services/ProjectService';

const unavailable = (reason: string) => ({ state: 'unavailable' as const, reason });

export function createProjectRoutes(projectService: ProjectService): RouteDefinition[] {
  const find = (id: string) => projectService.getProject(id);

  return [
    {
      method: 'GET',
      pattern: '/api/v1/projects',
      handler: async () => {
        const projects = projectService.listProjects();
        return {
          status: 200,
          json: {
            total: projects.length,
            projects: projects.map(p => ({ id: p.id, name: p.name, rootPath: p.rootPath, status: p.status, stats: p.stats })),
          },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/projects',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' } },
        required: ['path'],
      },
      handler: async ctx => {
        const body = (ctx.body || {}) as { path: string; name?: string; id?: string };
        const project = projectService.registerProject(body.path, body.id, body.name);
        return {
          status: 201,
          json: { id: project.id, name: project.name, rootPath: project.rootPath, status: project.status, stats: project.stats },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id',
      handler: async ctx => {
        const project = find(ctx.params.id);
        if (!project) return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        const files = project.reader?.getAllFiles() ?? [];
        return {
          status: 200,
          json: {
            id: project.id,
            name: project.name,
            status: project.status,
            indexStatus: project.status,
            languages: Array.from(new Set(files.map(f => f.language).filter((language): language is string => Boolean(language)))),
            files: project.stats.filesCount,
            symbols: project.stats.symbolsCount,
            dependencies: project.stats.dependenciesCount,
            chunks: Array.isArray(project.index?.vectorChunks) ? project.index.vectorChunks.length : unavailable('vector chunk index is not available'),
            rootPath: project.rootPath,
            indexPath: project.indexPath,
            stats: project.stats,
          },
        };
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/v1/projects/:id',
      requireAuth: true,
      handler: async ctx => {
        if (!find(ctx.params.id)) return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        // ProjectService has no update API; claiming success would leave stale registry/runtime state.
        return { status: 501, json: { error: 'Project update is unavailable', ...unavailable('ProjectService exposes no project update method') } };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/projects/:id',
      requireAuth: true,
      handler: async ctx => {
        if (!find(ctx.params.id)) return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        return { status: 501, json: { error: 'Project deletion is unavailable', ...unavailable('ProjectService exposes no project deletion method') } };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/dashboard/overview',
      handler: async ctx => {
        const project = find(ctx.params.id);
        if (!project) return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        const files = project.reader?.getAllFiles() ?? [];
        const languages = Array.from(new Set(files.map(f => f.language).filter((language): language is string => Boolean(language))));
        const dependencyGraph = project.index?.graphs?.dependencyGraph ?? [];
        const chunks = Array.isArray(project.index?.vectorChunks)
          ? project.index.vectorChunks.length
          : unavailable('vector chunk index is not available');

        return {
          status: 200,
          json: {
            project: { id: project.id, name: project.name, rootPath: project.rootPath },
            // Index state is real; no health service is attached to this route.
            health: { ...unavailable('ProjectService does not expose runtime health metrics'), indexState: project.status },
            statistics: {
              files: project.stats.filesCount,
              symbols: project.stats.symbolsCount,
              dependencies: project.stats.dependenciesCount,
              chunks,
            },
            languages,
            topFiles: files.slice(0, 5).map(f => ({ path: f.path, size: f.size })),
            hotspots: unavailable('history service is not attached to dashboard routes'),
            recentChanges: unavailable('recent-change service is not attached to dashboard routes'),
            indexStatus: { state: project.status, lastIndexedAt: project.stats.lastIndexedAt },
            graphStats: { nodesCount: project.stats.symbolsCount + project.stats.filesCount, edgesCount: dependencyGraph.length },
          },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/dashboard/dependencies',
      handler: async ctx => {
        const project = find(ctx.params.id);
        if (!project) return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        return { status: 200, json: { projectId: project.id, dependencies: project.index?.graphs?.dependencyGraph ?? [] } };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/dashboard/metrics',
      handler: async ctx => {
        const project = find(ctx.params.id);
        if (!project) return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        return { status: 200, json: { projectId: project.id, stats: project.stats } };
      },
    },
  ];
}
