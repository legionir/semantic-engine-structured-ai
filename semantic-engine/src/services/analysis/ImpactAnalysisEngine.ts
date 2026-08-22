/**
 * ImpactAnalysisEngine — Multi-tiered Blast Radius & Change Risk Estimator for Platform V2.
 */

import { AnalysisGraph } from './AnalysisGraph';

export interface AffectedEntity {
  readonly id: string;
  readonly name: string;
  readonly type: 'file' | 'symbol' | 'api' | 'test';
  readonly path: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly propagationPath: readonly string[];
}

export interface ImpactAnalysisResult {
  readonly rootSymbolId: string;
  readonly riskScore: number; // 0 - 100
  readonly blastRadius: {
    readonly directDependentsCount: number;
    readonly transitiveDependentsCount: number;
    readonly affectedFilesCount: number;
    readonly affectedApisCount: number;
    readonly affectedTestsCount: number;
  };
  readonly affectedEntities: readonly AffectedEntity[];
}

export class ImpactAnalysisEngine {
  analyzeImpact(
    graph: AnalysisGraph,
    targetSymbolId: string,
    maxDepth: number = 3
  ): ImpactAnalysisResult {
    const directDependents = new Set<string>();
    const transitiveDependents = new Set<string>();
    const affectedFiles = new Set<string>();
    const affectedApis = new Set<string>();
    const affectedTests = new Set<string>();
    const affectedEntities: AffectedEntity[] = [];

    const queue: Array<{ id: string; depth: number; path: string[] }> = [
      { id: targetSymbolId, depth: 0, path: [targetSymbolId] },
    ];
    const visited = new Set<string>([targetSymbolId]);

    // Backward traversal: Find callers and dependents of the target symbol
    while (queue.length > 0) {
      const { id, depth, path: currentPath } = queue.shift()!;

      if (depth >= maxDepth) continue;

      const incoming = graph.getIncomingEdges(id);
      for (const edge of incoming) {
        if (!['calls', 'references', 'imports', 'depends_on', 'uses'].includes(edge.relation)) continue;

        const callerId = edge.source;
        const nextDepth = depth + 1;
        const nextPath = [...currentPath, callerId];

        if (!visited.has(callerId)) {
          visited.add(callerId);

          if (nextDepth === 1) {
            directDependents.add(callerId);
          } else {
            transitiveDependents.add(callerId);
          }

          const node = graph.getNode(callerId);
          const type = node ? (node.type as 'file' | 'symbol' | 'api' | 'test') : 'symbol';
          const filePath = node?.metadata?.path || '';

          if (filePath) affectedFiles.add(filePath);
          if (type === 'api' || callerId.includes('Controller') || callerId.includes('api')) {
            affectedApis.add(callerId);
          }
          if (type === 'test' || filePath.includes('.test.') || filePath.includes('.spec.')) {
            affectedTests.add(callerId);
          }

          let severity: 'critical' | 'high' | 'medium' | 'low' = 'low';
          if (type === 'api' || nextDepth === 1) severity = 'high';
          if (type === 'api' && nextDepth === 1) severity = 'critical';
          else if (nextDepth === 2) severity = 'medium';

          affectedEntities.push({
            id: callerId,
            name: node?.label || callerId,
            type,
            path: filePath,
            severity,
            propagationPath: nextPath,
          });

          queue.push({ id: callerId, depth: nextDepth, path: nextPath });
        }
      }
    }

    // Risk Score Calculation
    const directCount = directDependents.size;
    const transitiveCount = transitiveDependents.size;
    const apiCount = affectedApis.size;
    const testCount = affectedTests.size;

    let rawScore = directCount * 12 + transitiveCount * 4 + apiCount * 20 - testCount * 3;
    if (rawScore < 0) rawScore = 0;
    const riskScore = Math.min(100, Math.max(5, Math.round(rawScore)));

    return {
      rootSymbolId: targetSymbolId,
      riskScore,
      blastRadius: {
        directDependentsCount: directCount,
        transitiveDependentsCount: transitiveCount,
        affectedFilesCount: affectedFiles.size,
        affectedApisCount: apiCount,
        affectedTestsCount: testCount,
      },
      affectedEntities,
    };
  }
}
