import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { CrdtService } from './crdt.service';
import { RevisionService } from './revision.service';
import { MulticursorService } from './multicursor.service';

export interface Client {
  id: string;
  userId: string;
  username: string;
  ws: WebSocket;
  projectId: string;
  joinedAt: number;
}

export interface Presence {
  userId: string;
  username: string;
  projectId: string;
  status: 'online' | 'away' | 'busy';
  lastSeen: number;
  cursorPosition?: { x: number; y: number };
}

export interface Operation {
  type: string;
  userId: string;
  projectId: string;
  data: any;
  timestamp: number;
}

export class WebSocketService {
  private wss: WebSocketServer;
  private clients: Map<string, Client> = new Map();
  private presenceMap: Map<string, Presence> = new Map();
  private projectClients: Map<string, Set<string>> = new Map();
  private crdtService: CrdtService;
  private revisionService: RevisionService;
  private multicursorService: MulticursorService;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.crdtService = new CrdtService();
    this.revisionService = new RevisionService();
    this.multicursorService = new MulticursorService();
    this.setup();
  }

  private setup(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '', 'http://localhost');
      const userId = url.searchParams.get('userId') || 'unknown';
      const username = url.searchParams.get('username') || 'Anonymous';
      const projectId = url.searchParams.get('projectId') || 'default';

      const clientId = `${userId}-${Date.now()}`;
      const client: Client = { id: clientId, userId, username, ws, projectId, joinedAt: Date.now() };

      this.clients.set(clientId, client);
      this.addToProject(client);
      this.updatePresence(userId, username, projectId, 'online');
      this.broadcastToProject(projectId, { type: 'presence', users: this.getProjectPresence(projectId) }, clientId);

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(client, msg);
        } catch { /* ignore */ }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        this.removeFromProject(client);
        this.updatePresence(userId, username, projectId, 'away');
        this.broadcastToProject(projectId, { type: 'presence', users: this.getProjectPresence(projectId) });
      });

      ws.on('error', () => {
        this.clients.delete(clientId);
        this.removeFromProject(client);
      });

      ws.send(JSON.stringify({ type: 'connected', clientId, userId, projectId }));
    });
  }

  private addToProject(client: Client): void {
    if (!this.projectClients.has(client.projectId)) {
      this.projectClients.set(client.projectId, new Set());
    }
    this.projectClients.get(client.projectId)!.add(client.id);
  }

  private removeFromProject(client: Client): void {
    const project = this.projectClients.get(client.projectId);
    if (project) {
      project.delete(client.id);
      if (project.size === 0) this.projectClients.delete(client.projectId);
    }
  }

  private updatePresence(userId: string, username: string, projectId: string, status: 'online' | 'away' | 'busy'): void {
    const key = `${projectId}:${userId}`;
    if (status === 'away' && !this.presenceMap.has(key)) return;
    this.presenceMap.set(key, { userId, username, projectId, status, lastSeen: Date.now() });
  }

  private getProjectPresence(projectId: string): Presence[] {
    const result: Presence[] = [];
    this.presenceMap.forEach((p) => {
      if (p.projectId === projectId) result.push(p);
    });
    return result;
  }

  private handleMessage(client: Client, msg: any): void {
    switch (msg.type) {
      case 'cursor':
        this.updateCursor(client.userId, client.projectId, msg.position);
        this.broadcastToProject(client.projectId, { type: 'cursor', userId: client.userId, username: client.username, position: msg.position }, client.id);
        break;
      case 'operation':
        this.broadcastToProject(client.projectId, { type: 'operation', userId: client.userId, operation: msg.operation, timestamp: Date.now() }, client.id);
        break;
      case 'presence':
        this.updatePresence(client.userId, client.username, client.projectId, msg.status || 'online');
        this.broadcastToProject(client.projectId, { type: 'presence', users: this.getProjectPresence(client.projectId) });
        break;
      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'crdt_operation':
        {
          const revision = this.crdtService.applyOperation(client.projectId, msg.operation, client.userId);
          this.revisionService.addRevision(client.projectId, revision, client.username, msg.description || '');
          this.broadcastToProject(client.projectId, { type: 'crdt_operation', userId: client.userId, operation: msg.operation, revision, timestamp: Date.now() }, client.id);
        }
        break;
      case 'cursor_update':
        {
          this.multicursorService.setCursor(client.userId, client.username, client.projectId, msg.position);
          if (msg.selection) {
            this.multicursorService.setSelection(client.userId, client.projectId, msg.selection);
          }
          const allCursors = this.multicursorService.getProjectCursors(client.projectId);
          this.broadcastToProject(client.projectId, { type: 'cursor_update', cursors: allCursors }, client.id);
        }
        break;
    }
  }

  private updateCursor(userId: string, projectId: string, position: { x: number; y: number }): void {
    const key = `${projectId}:${userId}`;
    const presence = this.presenceMap.get(key);
    if (presence) {
      presence.cursorPosition = position;
      presence.lastSeen = Date.now();
    }
  }

  private broadcastToProject(projectId: string, message: any, excludeClientId?: string): void {
    const project = this.projectClients.get(projectId);
    if (!project) return;
    const data = JSON.stringify(message);
    project.forEach((clientId) => {
      if (clientId === excludeClientId) return;
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    });
  }

  broadcastToAll(message: any): void {
    const data = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    });
  }

  getOnlineClients(projectId: string): number {
    return this.projectClients.get(projectId)?.size || 0;
  }

  getClientCount(): number {
    return this.clients.size;
  }
}