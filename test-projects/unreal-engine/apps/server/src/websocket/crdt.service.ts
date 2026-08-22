// CRDT/OT Conflict Resolution Service
// Uses a hybrid approach: OT for text operations, CRDT for structural changes

export interface TextOperation {
  type: 'insert' | 'delete' | 'retain';
  position: number;
  text?: string;
  length?: number;
}

export interface StructuralOperation {
  type: 'add' | 'remove' | 'move' | 'update';
  path: string[];
  nodeId?: string;
  properties?: Record<string, any>;
  parentId?: string;
  index?: number;
}

export interface Revision {
  id: string;
  projectId: string;
  userId: string;
  operations: (TextOperation | StructuralOperation)[];
  timestamp: number;
  parentId: string | null;
  hash: string;
}

export class CrdtService {
  private revisions: Map<string, Revision[]> = new Map();
  private currentStates: Map<string, any> = new Map();

  applyOperation(projectId: string, operation: TextOperation | StructuralOperation, userId: string): any {
    const revId = `${projectId}-${Date.now()}-${userId}`;
    const projectRevs = this.revisions.get(projectId) || [];
    const parentId = projectRevs.length > 0 ? projectRevs[projectRevs.length - 1].id : null;

    const revision: Revision = {
      id: revId,
      projectId,
      userId,
      operations: [operation],
      timestamp: Date.now(),
      parentId,
      hash: this.computeHash(operation),
    };

    projectRevs.push(revision);
    this.revisions.set(projectId, projectRevs);
    this.applyToState(projectId, operation);

    return revision;
  }

  applyOperations(projectId: string, operations: (TextOperation | StructuralOperation)[], userId: string): Revision {
    const revId = `${projectId}-${Date.now()}-${userId}`;
    const projectRevs = this.revisions.get(projectId) || [];
    const parentId = projectRevs.length > 0 ? projectRevs[projectRevs.length - 1].id : null;

    const revision: Revision = {
      id: revId,
      projectId,
      userId,
      operations,
      timestamp: Date.now(),
      parentId,
      hash: this.computeHash(operations[0]),
    };

    projectRevs.push(revision);
    this.revisions.set(projectId, projectRevs);

    for (const op of operations) {
      this.applyToState(projectId, op);
    }

    return revision;
  }

  private applyToState(projectId: string, operation: TextOperation | StructuralOperation): void {
    if (!this.currentStates.has(projectId)) {
      this.currentStates.set(projectId, {});
    }
    const state = this.currentStates.get(projectId);

    if ('path' in operation) {
      // Structural operation
      const op = operation as StructuralOperation;
      switch (op.type) {
        case 'add':
          if (op.path.length === 0) {
            state[op.nodeId!] = op.properties || {};
          } else {
            let current = state;
            for (let i = 0; i < op.path.length - 1; i++) {
              current = current[op.path[i]] = current[op.path[i]] || {};
            }
            current[op.path[op.path.length - 1]] = op.properties || {};
          }
          break;
        case 'remove':
          if (op.path.length === 0 && op.nodeId) {
            delete state[op.nodeId];
          } else {
            let current = state;
            for (let i = 0; i < op.path.length - 1; i++) {
              if (!current[op.path[i]]) return;
              current = current[op.path[i]];
            }
            delete current[op.path[op.path.length - 1]];
          }
          break;
        case 'update':
          if (op.properties) {
            let target = state;
            if (op.nodeId && state[op.nodeId]) {
              target = state[op.nodeId];
            }
            for (const key of op.path) {
              target = target[key] = target[key] || {};
            }
            Object.assign(target, op.properties);
          }
          break;
        case 'move':
          // Simple move not implemented - requires full CRDT
          break;
      }
    }
  }

  private computeHash(operation: TextOperation | StructuralOperation): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getRevisions(projectId: string, limit: number = 50): Revision[] {
    const revs = this.revisions.get(projectId) || [];
    return revs.slice(-limit);
  }

  getRevision(projectId: string, revisionId: string): Revision | undefined {
    return (this.revisions.get(projectId) || []).find(r => r.id === revisionId);
  }

  getState(projectId: string): any {
    return this.currentStates.get(projectId) || null;
  }

  resolveConflict(projectId: string, localOps: (TextOperation | StructuralOperation)[], remoteOps: (TextOperation | StructuralOperation)[]): (TextOperation | StructuralOperation)[] {
    // Last-writer-wins strategy for simplicity
    // In production, use vector clocks or Lamport timestamps
    const merged: (TextOperation | StructuralOperation)[] = [...remoteOps];

    for (const localOp of localOps) {
      const conflict = remoteOps.find(r => {
        if ('path' in r && 'path' in localOp) {
          return (r as StructuralOperation).path.join('.') === (localOp as StructuralOperation).path.join('.');
        }
        if ('position' in r && 'position' in localOp) {
          return (r as TextOperation).position === (localOp as TextOperation).position;
        }
        return false;
      });

      if (!conflict) {
        merged.push(localOp);
      }
    }

    return merged;
  }

  clearProject(projectId: string): void {
    this.revisions.delete(projectId);
    this.currentStates.delete(projectId);
  }
}