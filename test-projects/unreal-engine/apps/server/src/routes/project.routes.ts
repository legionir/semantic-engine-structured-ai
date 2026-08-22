import { FastifyInstance, RequestHandler } from 'fastify';
import { ProjectService } from '../projects/services/project.service';

export const registerProjectRoutes = (server: FastifyInstance) => {
  // Initialize service
  const projectService = new ProjectService(null); // Repository will be injected in actual implementation
  
  // Project routes
  server.get('/projects', async (req, res) => {
    try {
      // Extract user ID from authentication context
      const userId = req.headers['x-user-id'] as string; // This would come from auth middleware
      const projects = await projectService.findAll(userId);
      res.code(200).send(projects);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.get('/projects/:id', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const projectId = req.params['id'] as string;
      const project = await projectService.findOne(projectId, userId);
      if (!project) {
        res.code(404).send({ error: 'Project not found' });
        return;
      }
      res.code(200).send(project);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.post('/projects', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const projectData = req.body;
      const newProject = await projectService.create(userId, projectData);
      res.code(201).send(newProject);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.put('/projects/:id', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const projectId = req.params['id'] as string;
      const updateData = req.body;
      const updatedProject = await projectService.update(projectId, userId, updateData);
      res.code(200).send(updatedProject);
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
  
  server.delete('/projects/:id', async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const projectId = req.params['id'] as string;
      await projectService.remove(projectId, userId);
      res.code(204).send(); // No content
    } catch (error) {
      res.code(500).send({ error: error.message });
    }
  });
};
