/**
 * SimulateMutationTool — AI-facing tool for virtual refactoring and impact simulation before disk mutation.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { AnalysisGraph } from '../../services/analysis/AnalysisGraph';
import { MutationSimulator, MutationAction } from '../../services/analysis/MutationSimulator';

export class SimulateMutationTool implements AiTool {
  readonly name = 'simulate_mutation';
  readonly description = 'Simulates a virtual code refactoring action (e.g. deleting or renaming a symbol) and identifies all broken references and callers before changes are written to disk.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      actionType: {
        type: 'string',
        enum: ['rename_symbol', 'delete_symbol', 'move_symbol'],
        description: 'The type of mutation to simulate',
      },
      targetSymbolId: {
        type: 'string',
        description: 'The symbol ID or fully qualified name to mutate',
      },
      newName: {
        type: 'string',
        description: 'New symbol name if actionType is rename_symbol',
      },
    },
    required: ['actionType', 'targetSymbolId'],
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(input: AiToolInput): Promise<AiToolOutput> {
    const actionType = input.actionType as MutationAction['type'];
    const targetSymbolId = input.targetSymbolId as string;

    const graph = new AnalysisGraph();

    // Populate graph from reader
    const allSymbols = this.reader.getAllSymbols();
    for (const s of allSymbols) {
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

    const simulator = new MutationSimulator();
    const diff = simulator.simulate(graph, {
      type: actionType,
      targetSymbolId,
      newName: input.newName as string | undefined,
    });

    return {
      success: true,
      metadata: { diff },
      items: diff.brokenReferences.map(b => ({
        id: b.callerId,
        name: b.callerId,
        kind: 'broken_reference',
        path: b.callerFile,
        source: 'mutation-simulator',
        excerpt: `Relation '${b.relation}' to '${b.targetId}' would be broken`,
      })),
      context: diff.isSafe
        ? `Simulation complete: Mutation is safe with 0 broken references.`
        : `Simulation complete: Mutation creates ${diff.brokenReferences.length} broken references.`,
    };
  }
}
