/**
 * DetectArchitectureViolationsTool — AI-facing tool for detecting circular dependencies and layer bypassing.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { AnalysisGraph } from '../../services/analysis/AnalysisGraph';
import { ArchitectureRuleEngine } from '../../services/analysis/ArchitectureRuleEngine';

export class DetectArchitectureViolationsTool implements AiTool {
  readonly name = 'detect_architecture_violations';
  readonly description = 'Analyzes project dependencies to discover architectural rule violations, circular dependencies, and technical debt.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      checkCyclesOnly: {
        type: 'boolean',
        description: 'Whether to restrict analysis to circular dependency detection only',
      },
    },
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(_input: AiToolInput): Promise<AiToolOutput> {
    const graph = new AnalysisGraph();

    for (const s of this.reader.getAllSymbols()) {
      const f = this.reader.getFileById(s.fileId);
      graph.addNode({
        id: s.id,
        type: s.kind || 'symbol',
        label: s.name,
        metadata: { path: f?.path, line: s.line },
      });
    }

    const depEdges = this.reader.projectIndex.graphs?.dependencyGraph ?? [];
    for (const [idx, dep] of depEdges.entries()) {
      graph.addEdge({
        id: `e_${idx}`,
        source: dep.from,
        target: dep.to,
        relation: 'depends_on',
      });
    }

    const engine = new ArchitectureRuleEngine();
    const report = engine.analyzeArchitectureDebt(graph);

    return {
      success: true,
      metadata: { report },
      items: [
        ...report.circularDependencies.map(c => ({
          id: `cycle_${c.nodes.join('_')}`,
          name: 'Circular Dependency Cycle',
          kind: 'architecture_cycle',
          source: 'architecture-rules',
          excerpt: c.nodes.join(' -> '),
        })),
        ...report.layerViolations.map(v => ({
          id: v.ruleId,
          name: v.ruleName,
          kind: 'layer_violation',
          source: 'architecture-rules',
          excerpt: `${v.description} (${v.severity})`,
        })),
      ],
      context: `Found ${report.totalViolations} architectural violation(s) (${report.circularDependencies.length} cycles, ${report.layerViolations.length} layer violations).`,
    };
  }
}
