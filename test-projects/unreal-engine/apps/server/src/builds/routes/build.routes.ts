import { FastifyInstance } from 'fastify';
import { BuildService } from '../services/build.service';

export const registerBuildRoutes = (server: FastifyInstance) => {
  // Build routes (Fastify-style without NestJS)
  const buildService = new BuildService(null, null);

  // Create a new build
  server.post('/builds', async (req, res) => {
    try {
      const { projectId, buildType, targetPlatform, config } = req.body as any;
      const userId = (req.headers['x-user-id'] as string) || 'anonymous';
      const build = await buildService.create(projectId, userId, { buildType, targetPlatform, config });
      res.code(201).send(build);
    } catch (error) {
      res.code(400).send({ error: error.message });
    }
  });

  // List builds for a project
  server.get('/builds/project/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params as any;
      const builds = await buildService.findAll(projectId);
      res.code(200).send(builds);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });

  // Get a single build
  server.get('/builds/:id', async (req, res) => {
    try {
      const { id } = req.params as any;
      const build = await buildService.findOne(id);
      if (!build) {
        res.code(404).send({ error: 'Build not found' });
        return;
      }
      res.code(200).send(build);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });

  // Start a build
  server.post('/builds/:id/start', async (req, res) => {
    try {
      const { id } = req.params as any;
      const build = await buildService.startBuild(id);
      res.code(200).send(build);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });

  // Update build status
  server.put('/builds/:id/status', async (req, res) => {
    try {
      const { id } = req.params as any;
      const { status, log } = req.body as any;
      const build = await buildService.updateStatus(id, status, log);
      res.code(200).send(build);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
};
