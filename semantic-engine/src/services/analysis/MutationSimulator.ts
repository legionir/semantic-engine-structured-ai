/**
 * MutationSimulator — In-memory virtual refactoring and graph diffing simulator.
 */

import { AnalysisGraph } from './AnalysisGraph';

export interface MutationAction {
  readonly type: 'rename_symbol' | 'delete_symbol' | 'move_symbol';
  readonly targetSymbolId: string;
  readonly newName?: string;
  readonly newPath?: string;
}

export interface BrokenReference {
  readonly callerId: string;
  readonly callerFile: string;
  readonly targetId: string;
  readonly relation: string;
}

export interface MutationDiffResult {
  readonly action: MutationAction;
  readonly affectedSymbolsCount: number;
  readonly brokenReferences: readonly BrokenReference[];
  readonly addedEdgesCount: number;
  readonly removedEdgesCount: number;
  readonly isSafe: boolean;
}

export class MutationSimulator {
  simulate(graph: AnalysisGraph, action: MutationAction): MutationDiffResult {
    const brokenReferences: BrokenReference[] = [];
    let removedEdgesCount = 0;

    const incoming = graph.getIncomingEdges(action.targetSymbolId);

    if (action.type === 'delete_symbol') {
      for (const edge of incoming) {
        removedEdgesCount++;
        const callerNode = graph.getNode(edge.source);
        brokenReferences.push({
          callerId: edge.source,
          callerFile: callerNode?.metadata?.path || 'unknown',
          targetId: action.targetSymbolId,
          relation: edge.relation,
        });
      }
    } else if (action.type === 'rename_symbol') {
      for (const edge of incoming) {
        if (edge.relation === 'calls' || edge.relation === 'references') {
          const callerNode = graph.getNode(edge.source);
          brokenReferences.push({
            callerId: edge.source,
            callerFile: callerNode?.metadata?.path || 'unknown',
            targetId: action.targetSymbolId,
            relation: edge.relation,
          });
        }
      }
    }

    const isSafe = brokenReferences.length === 0;

    return {
      action,
      affectedSymbolsCount: incoming.length,
      brokenReferences,
      addedEdgesCount: 0,
      removedEdgesCount,
      isSafe,
    };
  }
}
