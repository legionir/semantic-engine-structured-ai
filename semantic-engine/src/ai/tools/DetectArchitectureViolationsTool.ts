/**
 * DetectArchitectureViolationsTool — AI-facing tool for detecting circular dependencies and layer bypassing.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { buildIndexGraph, describeNode } from '../../services/analysis/buildIndexGraph';
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
    /*
    | از سازندهٔ مشترک: چرخه‌ها روی گرافِ فایل/سمبل گزارش می‌شوند و برای
    | خوانا بودن به node های فایل نیاز دارند — پیش از این گراف فقط سمبل داشت
    | و `dependencyGraph` (که بین فایل‌هاست) به node های بی‌نام می‌رسید.
    */
    const graph = buildIndexGraph(this.reader);

    const engine = new ArchitectureRuleEngine();
    const report = engine.analyzeArchitectureDebt(graph);

    return {
      success: true,
      metadata: { report },
      items: [
        ...report.circularDependencies.map(c => {
          /*
          | سه هشِ کنار هم برای هیچ مصرف‌کننده‌ای قابل استفاده نبود؛ همان
          | چرخه با مسیر فایل‌هایش گزارش می‌شود و شناسه‌ها در metadata می‌مانند
          | (برای اینکه بشود روی‌شان دوباره کوئری زد).
          */
          const readable = c.nodes.map(node => describeNode(graph, node));
          return {
            id: `cycle_${c.nodes.join('_')}`,
            name: `Circular dependency across ${c.nodes.length} files`,
            kind: 'architecture_cycle',
            path: readable[0],
            source: 'architecture-rules',
            excerpt: [...readable, readable[0]].join(' -> '),
            metadata: { nodeIds: c.nodes, cycleLength: c.nodes.length },
          };
        }),
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
