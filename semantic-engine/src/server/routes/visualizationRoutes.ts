/**
 * VisualizationRoutes — Progressive Semantic Level of Detail (LoD) Graph Endpoints.
 */

import { RouteDefinition } from '../types';
import { ProjectService } from '../../services/ProjectService';
import { LodService } from '../../services/visualization/LodService';

export function createVisualizationRoutes(
  projectService: ProjectService,
  lodService: LodService
): RouteDefinition[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/visualization/architecture',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const view = lodService.getArchitectureView(project);
        return {
          status: 200,
          json: view,
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/visualization/dependencies',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }
        const view = lodService.getDependenciesView(project);
        return { status: 200, json: view };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/visualization/module/:moduleId',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const view = lodService.getModuleView(project, ctx.params.moduleId);
        return {
          status: 200,
          json: view,
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/visualization/file/:fileId',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const view = lodService.getFileView(project, ctx.params.fileId);
        return {
          status: 200,
          json: view,
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/visualization/workflow/:workflowId',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const view = lodService.getWorkflowView(project, ctx.params.workflowId);
        return {
          status: 200,
          json: view,
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/visualization/business-mapping',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const view = lodService.getBusinessMappingView(project);
        return {
          status: 200,
          json: view,
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/projects/:id/visualization/test-map',
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const view = lodService.getTestIntelligenceView(project);
        return {
          status: 200,
          json: view,
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/projects/:id/visualization/neighborhood',
      schema: {
        type: 'object',
        properties: {
          seedId: { type: 'string' },
          depth: { type: 'integer' },
          minConfidence: { type: 'number' },
        },
        required: ['seedId'],
      },
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const body = (ctx.body || {}) as { seedId: string; depth?: number; minConfidence?: number };
        const view = lodService.getNeighborhoodView(project, body.seedId, body.depth || 1, body.minConfidence || 70);
        return {
          status: 200,
          json: view,
        };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/projects/:id/visualization/path',
      schema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      handler: async ctx => {
        const project = projectService.getProject(ctx.params.id);
        if (!project) {
          return { status: 404, json: { error: `Project not found: ${ctx.params.id}` } };
        }

        const body = (ctx.body || {}) as { from: string; to: string };
        const view = lodService.getPathView(project, body.from, body.to);
        return {
          status: 200,
          json: view,
        };
      },
    },
  ];
}
