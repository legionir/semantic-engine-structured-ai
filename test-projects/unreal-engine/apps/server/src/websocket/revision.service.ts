import { Revision } from './crdt.service';

export interface RevisionHistoryEntry {
  id: string;
  projectId: string;
  userId: string;
  username: string;
  timestamp: number;
  description: string;
  operations: any[];
  parentId: string | null;
  hash: string;
}

export class RevisionService {
  private history: Map<string, RevisionHistoryEntry[]> = new Map();
  private currentBranch: Map<string, string> = new Map(); // projectId -> head revision id

  addRevision(projectId: string, revision: Revision, username: string, description: string = ''): RevisionHistoryEntry {
    const entry: RevisionHistoryEntry = {
      id: revision.id,
      projectId,
      userId: revision.userId,
      username,
      timestamp: revision.timestamp,
      description,
      operations: revision.operations,
      parentId: revision.parentId,
      hash: revision.hash,
    };

    const projectHistory = this.history.get(projectId) || [];
    projectHistory.push(entry);
    this.history.set(projectId, projectHistory);
    this.currentBranch.set(projectId, revision.id);

    return entry;
  }

  getHistory(projectId: string, limit: number = 100): RevisionHistoryEntry[] {
    const projectHistory = this.history.get(projectId) || [];
    return projectHistory.slice(-limit).reverse();
  }

  getHeadRevision(projectId: string): RevisionHistoryEntry | undefined {
    const headId = this.currentBranch.get(projectId);
    if (!headId) return undefined;
    return this.getRevision(projectId, headId);
  }

  getRevision(projectId: string, revisionId: string): RevisionHistoryEntry | undefined {
    return (this.history.get(projectId) || []).find(r => r.id === revisionId);
  }

  getHistorySince(projectId: string, sinceTimestamp: number): RevisionHistoryEntry[] {
    return (this.history.get(projectId) || []).filter(r => r.timestamp > sinceTimestamp);
  }

  getHistoryByUser(projectId: string, userId: string): RevisionHistoryEntry[] {
    return (this.history.get(projectId) || []).filter(r => r.userId === userId);
  }

  getRevisionCount(projectId: string): number {
    return (this.history.get(projectId) || []).length;
  }

  clearProject(projectId: string): void {
    this.history.delete(projectId);
    this.currentBranch.delete(projectId);
  }
}