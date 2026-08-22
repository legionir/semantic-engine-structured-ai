import { FastifyInstance, RequestHandler } from 'fastify';

// Import route registration functions
import { registerAuthRoutes } from './routes/auth.routes';
import { registerProjectRoutes } from './routes/project.routes';
import { registerAssetRoutes } from './routes/asset.routes';
import { registerBuildRoutes } from './builds/routes/build.routes';
import { registerPwaRoutes } from './pwa/pwa.routes';
import { registerWebSocketRoutes } from './websocket/websocket.routes';
import { WebSocketService } from './websocket/websocket.service';

// Define route handlers
const healthCheckHandler: RequestHandler = async (request, reply) => {
  return { status: 'OK', uptime: process.uptime() };
};

const errorHandler: RequestHandler = async (request, reply) => {
  reply.status(404).send({ error: 'Route Not Found' });
};

// Register routes function
export const registerRoutes = (server: FastifyInstance, wsService?: WebSocketService) => {
  // Basic routes
  server.get('/', async (req, res) => {
    return { message: 'Welcome to Web Engine Server' };
  });
  
  server.get('/health', healthCheckHandler);
  
  // Register specific route modules
  registerAuthRoutes(server);
  registerProjectRoutes(server);
  registerAssetRoutes(server);
  registerBuildRoutes(server);
  registerPwaRoutes(server);
  
  // Register WebSocket routes
  if (wsService) {
    registerWebSocketRoutes(server, wsService);
  }
  
  // Catch-all for undefined routes
  server.setNotFoundHandler(errorHandler);
};