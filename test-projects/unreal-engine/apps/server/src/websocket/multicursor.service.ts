export interface CursorPosition {
  userId: string;
  username: string;
  projectId: string;
  position: { x: number; y: number };
  color: string;
  selection?: { start: { x: number; y: number }; end: { x: number; y: number } };
  lastUpdated: number;
}

const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA',
];

let colorIndex = 0;

function getNextColor(): string {
  const color = CURSOR_COLORS[colorIndex % CURSOR_COLORS.length];
  colorIndex++;
  return color;
}

export class MulticursorService {
  private cursors: Map<string, CursorPosition> = new Map();

  private key(userId: string, projectId: string): string {
    return `${projectId}:${userId}`;
  }

  setCursor(userId: string, username: string, projectId: string, position: { x: number; y: number }): CursorPosition {
    const k = this.key(userId, projectId);
    let cursor = this.cursors.get(k);

    if (!cursor) {
      cursor = {
        userId,
        username,
        projectId,
        position,
        color: getNextColor(),
        lastUpdated: Date.now(),
      };
    } else {
      cursor.position = position;
      cursor.lastUpdated = Date.now();
    }

    this.cursors.set(k, cursor);
    return cursor;
  }

  setSelection(userId: string, projectId: string, selection: { start: { x: number; y: number }; end: { x: number; y: number } }): void {
    const k = this.key(userId, projectId);
    const cursor = this.cursors.get(k);
    if (cursor) {
      cursor.selection = selection;
      cursor.lastUpdated = Date.now();
    }
  }

  removeCursor(userId: string, projectId: string): void {
    this.cursors.delete(this.key(userId, projectId));
  }

  getProjectCursors(projectId: string): CursorPosition[] {
    const result: CursorPosition[] = [];
    this.cursors.forEach((c) => {
      if (c.projectId === projectId) result.push(c);
    });
    return result;
  }

  getCursor(userId: string, projectId: string): CursorPosition | undefined {
    return this.cursors.get(this.key(userId, projectId));
  }

  cleanupStale(timeoutMs: number = 10000): void {
    const now = Date.now();
    this.cursors.forEach((c, k) => {
      if (now - c.lastUpdated > timeoutMs) {
        this.cursors.delete(k);
      }
    });
  }

  getActiveCursorCount(projectId: string): number {
    let count = 0;
    this.cursors.forEach((c) => {
      if (c.projectId === projectId) count++;
    });
    return count;
  }
}