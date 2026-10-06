/**
 * ArchitectureRuleEngine — Detects Architecture Layer Violations & Dependency Cycles (Tarjan SCC).
 */

import { AnalysisGraph } from './AnalysisGraph';

export interface ArchitectureViolation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: 'error' | 'warning';
  readonly sourceNode: string;
  readonly targetNode: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface DependencyCycle {
  readonly cycleLength: number;
  readonly nodes: readonly string[];
}

export interface ArchitectureDebtReport {
  readonly totalViolations: number;
  readonly circularDependencies: readonly DependencyCycle[];
  readonly layerViolations: readonly ArchitectureViolation[];
}

export class ArchitectureRuleEngine {
  /**
   * Find circular dependencies using Tarjan's Strongly Connected Components (SCC) algorithm.
   */
  findCircularDependencies(graph: AnalysisGraph): DependencyCycle[] {
    let index = 0;
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    const strongConnect = (nodeId: string) => {
      indices.set(nodeId, index);
      lowlinks.set(nodeId, index);
      index++;
      stack.push(nodeId);
      onStack.add(nodeId);

      const outgoing = graph.getOutgoingEdges(nodeId);
      for (const edge of outgoing) {
        if (!['imports', 'depends_on', 'calls'].includes(edge.relation)) continue;
        const targetId = edge.target;

        if (!indices.has(targetId)) {
          strongConnect(targetId);
          lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId)!, lowlinks.get(targetId)!));
        } else if (onStack.has(targetId)) {
          lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId)!, indices.get(targetId)!));
        }
      }

      if (lowlinks.get(nodeId) === indices.get(nodeId)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== nodeId);

        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    };

    const allNodes = graph.getAllNodes();
    for (const node of allNodes) {
      if (!indices.has(node.id)) {
        strongConnect(node.id);
      }
    }

    return sccs.map(nodes => ({
      cycleLength: nodes.length,
      nodes,
    }));
  }

  /**
   * Detects layered architectural rule violations.
   */
  detectLayerViolations(graph: AnalysisGraph): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const allEdges = graph.getAllEdges();

    for (const edge of allEdges) {
      /*
      | F-0017: node ids are opaque sha256 hex in the real index (buildIndexGraph
      | stores the readable file path in metadata.path and the name in label).
      | Matching layer keywords against the id never fires — resolve the readable
      | text first. Falls back to id so hand-built graphs using readable ids (and
      | the unit tests) still match.
      */
      const describe = (id: string): string => {
        const node = graph.getNode(id);
        const path = node?.metadata?.path;
        return String(path ?? node?.label ?? id).toLowerCase();
      };
      const src = describe(edge.source);
      const tgt = describe(edge.target);

      // Rule 1: Controller bypassing Service directly to Repository/DB
      if (src.includes('controller') && (tgt.includes('repository') || tgt.includes('dao') || tgt.includes('database'))) {
        violations.push({
          ruleId: 'ARCH-001',
          ruleName: 'Layer Bypassing: Controller to Repository',
          severity: 'error',
          sourceNode: edge.source,
          targetNode: edge.target,
          description: `Controller '${edge.source}' directly invokes data repository '${edge.target}' without going through a Service.`,
          suggestion: 'Inject and route calls through an intermediary domain Service.',
        });
      }

      // Rule 2: Database / Domain layer depending on Web/UI layer
      if ((src.includes('service') || src.includes('repository') || src.includes('entity')) &&
          (tgt.includes('controller') || tgt.includes('view') || tgt.includes('ui'))) {
        violations.push({
          ruleId: 'ARCH-002',
          ruleName: 'Inverted Dependency: Domain depending on UI',
          severity: 'error',
          sourceNode: edge.source,
          targetNode: edge.target,
          description: `Core domain entity '${edge.source}' depends upwards on presentation layer '${edge.target}'.`,
          suggestion: 'Apply Inversion of Control or event-driven callbacks.',
        });
      }
    }

    return violations;
  }

  analyzeArchitectureDebt(graph: AnalysisGraph): ArchitectureDebtReport {
    const circularDependencies = this.findCircularDependencies(graph);
    const layerViolations = this.detectLayerViolations(graph);

    return {
      totalViolations: circularDependencies.length + layerViolations.length,
      circularDependencies,
      layerViolations,
    };
  }
}
