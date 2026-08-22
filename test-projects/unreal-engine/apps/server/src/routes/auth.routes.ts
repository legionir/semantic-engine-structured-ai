import { FastifyInstance, RequestHandler } from 'fastify';
import { AuthService } from '../auth/services/auth.service';

export const registerAuthRoutes = (server: FastifyInstance) => {
  // Initialize services
  const authService = new AuthService();
  
  // Authentication routes
  server.post('/auth/register', async (req, res) => {
    try {
      const result = await authService.register(req.body);
      res.code(201).send(result);
    } catch (error) {
      res.code(400).send({ error: error.message });
    }
  });
  
  server.post('/auth/login', async (req, res) => {
    try {
      const result = await authService.login(req.body);
      res.code(200).send(result);
    } catch (error) {
      res.code(401).send({ error: error.message });
    }
  });
  
  server.post('/auth/logout', async (req, res) => {
    try {
      const result = await authService.logout(req.headers.authorization);
      res.code(200).send(result);
    } catch (error) {
      res.code(401).send({ error: error.message });
    }
  });
};
