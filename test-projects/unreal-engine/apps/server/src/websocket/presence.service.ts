export interface UserPresence {
  userId: string;
  username: string;
  projectId: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  lastSeen: number;
  cursorPosition?: { x: number; y: number };
  selectedNodeId?: string;
  editingComponent?: string;
}

export class PresenceService {
  private presences: Map<string, UserPresence> = new Map();

  private key(userId: string, projectId: string): string {
    return `${projectId}:${userId}`;
  }

  setPresence(userId: string, username: string, projectId: string, status: UserPresence['status']): void {
    const k = this.key(userId, projectId);
    const existing = this.presences.get(k);
    this.presences.set(k, {
      userId,
      username,
      projectId,
      status,
      lastSeen: Date.now(),
      cursorPosition: existing?.cursorPosition,
      selectedNodeId: existing?.selectedNodeId,
      editingComponent: existing?.editingComponent,
    });
  }

  updateCursor(userId: string, projectId: string, position: { x: number; y: number }): void {
    const k = this.key(userId, projectId);
    const p = this.presences.get(k);
    if (p) {
      p.cursorPosition = position;
      p.lastSeen = Date.now();
    }
  }

  updateSelection(userId: string, projectId: string, nodeId: string | undefined): void {
    const k = this.key(userId, projectId);
    const p = this.presences.get(k);
    if (p) {
      p.selectedNodeId = nodeId;
      p.lastSeen = Date.now();
    }
  }

  removePresence(userId: string, projectId: string): void {
    this.presences.delete(this.key(userId, projectId));
  }

  getProjectPresences(projectId: string): UserPresence[] {
    const result: UserPresence[] = [];
    this.presences.forEach((p) => {
      if (p.projectId === projectId) result.push(p);
    });
    return result;
  }

  isUserOnline(userId: string, projectId: string): boolean {
    const p = this.presences.get(this.key(userId, projectId));
    return p !== undefined && p.status !== 'offline';
  }

  getOnlineCount(projectId: string): number {
    return this.getProjectPresences(projectId).filter(p => p.status !== 'offline').length;
  }

  cleanupStale(timeoutMs: number = 30000): void {
    const now = Date.now();
    this.presences.forEach((p, k) => {
      if (now - p.lastSeen > timeoutMs) {
        p.status = 'away';
      }
    });
  }
}