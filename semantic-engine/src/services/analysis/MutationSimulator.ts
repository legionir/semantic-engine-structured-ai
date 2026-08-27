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
  /**
   * آنچه یک انسان می‌شناسد: مسیر فایل برای فراخوانِ سطح ماژول، یا
   * «path:line → name» برای یک سمبل. `callerFile` برای نام‌های خارجی
   * هنوز 'unknown' است و این فیلد همان‌جا هم چیزی برای نشان دادن دارد.
   */
  readonly callerLabel: string;
  /** سطر محل فراخوانی، اگر گراف آن را داشته باشد. */
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

    if (action.type === 'delete_symbol') {
      for (const edge of incoming) {
        removedEdgesCount++;
        const callerNode = graph.getNode(edge.source);
        brokenReferences.push({
          callerId: edge.source,
          callerFile: callerNode?.metadata?.path || 'unknown',
          callerLabel: callerNode ? (callerNode.metadata?.path ?? callerNode.label) : edge.source,
          callerLine: typeof edge.metadata?.line === 'number' ? edge.metadata.line : null,
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
            callerLabel: callerNode ? (callerNode.metadata?.path ?? callerNode.label) : edge.source,
            callerLine: typeof edge.metadata?.line === 'number' ? edge.metadata.line : null,
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
