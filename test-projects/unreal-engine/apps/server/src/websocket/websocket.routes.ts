import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WebSocketService } from './websocket.service';

export function registerWebSocketRoutes(app: FastifyInstance, wsService: WebSocketService): void {
  app.get('/ws/status', async (_req: FastifyRequest, _reply: FastifyReply) => {
    return { status: 'ok', clients: wsService.getClientCount(), timestamp: Date.now() };
  });

  app.get<{ Params: { projectId: string } }>(
    '/ws/projects/:projectId/online',
    async (req: FastifyRequest<{ Params: { projectId: string } }>, _reply: FastifyReply) => {
      return { projectId: req.params.projectId, online: wsService.getOnlineClients(req.params.projectId) };
    }
  );

  app.post('/ws/broadcast', async (req: FastifyRequest, _reply: FastifyReply) => {
    wsService.broadcastToAll(req.body);
    return { success: true };
  });
}