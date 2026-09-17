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
  readonly callerLabel: string;
  readonly callerLine?: number | null;
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
    const recordBrokenReference = (edge: ReturnType<AnalysisGraph['getIncomingEdges']>[number]) => {
      const callerNode = graph.getNode(edge.source);
      brokenReferences.push({
        callerId: edge.source,
        callerFile: callerNode?.metadata?.path || 'unknown',
        callerLabel: callerNode ? (callerNode.metadata?.path ?? callerNode.label) : edge.source,
        callerLine: typeof edge.metadata?.line === 'number' ? edge.metadata.line : null,
        targetId: action.targetSymbolId,
        relation: edge.relation,
      });
    };

    if (action.type === 'delete_symbol') {
      for (const edge of incoming) { removedEdgesCount++; recordBrokenReference(edge); }
    } else if (action.type === 'rename_symbol' || action.type === 'move_symbol') {
      // A move changes the symbol's qualified path. Every incoming reference
      // must be re-bound by the eventual refactoring; otherwise it is broken.
      for (const edge of incoming) {
        if (edge.relation === 'calls' || edge.relation === 'references' || edge.relation === 'imports' || action.type === 'move_symbol') recordBrokenReference(edge);
      }
    }

    return {
      action,
      affectedSymbolsCount: incoming.length,
      brokenReferences,
      addedEdgesCount: 0,
      removedEdgesCount,
      isSafe: brokenReferences.length === 0,
    };
  }
}
