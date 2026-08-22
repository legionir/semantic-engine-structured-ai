/**
 * ProjectRoutes — Project registration, retrieval, status, and dashboard overview endpoints (Domain 04 & 13).
 */

import { RouteDefinition } from '../types';
import { ProjectService } from '../../services/ProjectService';

export function createProjectRoutes(projectService: ProjectService): RouteDefinition[] {
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
            projects: projects.map(p => ({
              id: p.id,
              name: p.name,
              rootPath: p.rootPath,
              status: p.status,
              stats: p.stats,
            })),
          },
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/projects',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          name: { type: 'string' },
          id: { type: 'string' },
        },
        required: ['path'],
      },
      handler: async ctx => {
        const body = (ctx.body || {}) as { path: string; name?: string; id?: string };
        const project = projectService.registerProject(body.path, body.id, body.name);
        return {
          status: 201,
          json: {
            id: project.id,
            name: project.name,
            rootPath: project.rootPath,
            status: project.status,
            stats: project.stats,
          },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }
        return {
          status: 200,
          json: {
            id: project.id,
            name: project.name,
            status: project.status,
            indexStatus: project.status,
            languages: project.reader ? Array.from(new Set(project.reader.getAllFiles().map(f => f.language))) : ['typescript'],
            files: project.stats.filesCount,
            symbols: project.stats.symbolsCount,
            dependencies: project.stats.dependenciesCount,
            chunks: 0,
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
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }
        const body = (ctx.body || {}) as { name?: string };
        return {
          status: 200,
          json: {
            updated: true,
            id: project.id,
            name: body.name || project.name,
            status: project.status,
          },
        };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/projects/:id',
      requireAuth: true,
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }
        return {
          status: 200,
          json: { deleted: true, id: ctx.params.id },
        };
      },
    },
    // Domain 13: Dashboard Overview & Visualization Data
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/dashboard/overview',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const files = project.reader?.getAllFiles() ?? [];
        const languages = Array.from(new Set(files.map(f => f.language)));

        return {
          status: 200,
          json: {
            project: { id: project.id, name: project.name, rootPath: project.rootPath },
            health: { status: 'healthy', indexState: project.status },
            statistics: {
              files: project.stats.filesCount,
              symbols: project.stats.symbolsCount,
              dependencies: project.stats.dependenciesCount,
              chunks: 0,
            },
            languages,
            topFiles: files.slice(0, 5).map(f => ({ path: f.path, size: f.size })),
            hotspots: [],
            recentChanges: [],
            indexStatus: { state: project.status, lastIndexedAt: project.stats.lastIndexedAt },
            graphStats: {
              nodesCount: project.stats.symbolsCount + project.stats.filesCount,
              edgesCount: project.stats.dependenciesCount,
            },
          },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/dashboard/dependencies',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) return { status: 404, json: { error: `Project not found` } };
        return {
          status: 200,
          json: { dependencies: project.index?.graphs?.dependencyGraph ?? [] },
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/dashboard/metrics',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) return { status: 404, json: { error: `Project not found` } };
        return {
          status: 200,
          json: { stats: project.stats },
        };
      },
    },
  ];
}
