import 'reflect-metadata';
import fastify, { FastifyInstance } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import routes
import { registerRoutes } from './routes';
import { WebSocketService } from './websocket/websocket.service';

// Define custom types
interface CustomServerOptions {
  logger: boolean;
}

// Create Fastify instance
const server: FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse
> = fastify({
  logger: process.env.NODE_ENV === 'development'
});

async function startServer() {
  try {
    // Register security plugins
    await server.register(helmet);
    
    // Register CORS
    await server.register(cors, {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    });
    
    // Register rate limiting
    await server.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute'
    });
    
    // Serve static files
    await server.register(staticPlugin, {
      root: path.join(__dirname, 'public'),
      prefix: '/public/',
    });
    
    // Create WebSocket service
    const wsService = new WebSocketService(server.server);
    
    // Register routes
    registerRoutes(server, wsService);
    
    // Error handler
    server.setErrorHandler((error, request, reply) => {
      server.log.error(error);
      reply.status(500).send({ error: 'Internal Server Error' });
    });
    
    // Start server
    const port = parseInt(process.env.PORT || '3000');
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

startServer();

export { server };
