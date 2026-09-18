/**
 * SimulateMutationTool — AI-facing tool for virtual refactoring and impact simulation before disk mutation.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { buildIndexGraph, describeNode, nodePath } from '../../services/analysis/buildIndexGraph';
import { MutationSimulator, MutationAction } from '../../services/analysis/MutationSimulator';
import { resolveSymbolId } from './resolveIndexEntity';

export class SimulateMutationTool implements AiTool {
  readonly name = 'simulate_mutation';
  readonly description = 'Simulates a virtual code refactoring action and identifies broken references before changes are written to disk.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      actionType: { type: 'string', enum: ['rename_symbol', 'delete_symbol', 'move_symbol'], description: 'The type of mutation to simulate' },
      targetSymbolId: { type: 'string', description: 'The symbol ID or fully qualified path::symbol name to mutate' },
      newName: { type: 'string', description: 'New symbol name if actionType is rename_symbol' },
      newPath: { type: 'string', description: 'New file path if actionType is move_symbol' },
    },
    required: ['actionType', 'targetSymbolId'],
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(input: AiToolInput): Promise<AiToolOutput> {
    const actionType = input.actionType as MutationAction['type'];
    const requestedTarget = input.targetSymbolId as string;
    if (!['rename_symbol', 'delete_symbol', 'move_symbol'].includes(actionType)) return { success: false, error: `Unsupported mutation action: ${String(input.actionType)}`, items: [] };
    if (typeof input.targetSymbolId !== 'string' || input.targetSymbolId.trim().length === 0) return { success: false, error: 'targetSymbolId is required and must be a non-empty string', items: [] };
    if (actionType === 'rename_symbol' && (typeof input.newName !== 'string' || input.newName.trim().length === 0)) return { success: false, error: 'newName is required and must be a non-empty string for rename_symbol', items: [] };
    if (actionType === 'move_symbol' && (typeof input.newPath !== 'string' || input.newPath.trim().length === 0)) return { success: false, error: 'newPath is required and must be a non-empty string for move_symbol', items: [] };
    const targetSymbolId = resolveSymbolId(this.reader, requestedTarget);
    if (!targetSymbolId) return { success: false, error: `No symbol found for id or fully-qualified name: ${requestedTarget}`, items: [] };
    const graph = buildIndexGraph(this.reader, { callEdges: true });
    const diff = new MutationSimulator().simulate(graph, { type: actionType, targetSymbolId, newName: input.newName as string | undefined, newPath: input.newPath as string | undefined });
    return {
      success: true,
      metadata: { diff },
      items: diff.brokenReferences.map(b => ({ id: b.callerId, name: nodePath(graph, b.callerId) ?? describeNode(graph, b.callerId), kind: 'broken_reference', path: b.callerFile, source: 'mutation-simulator', excerpt: `${b.callerFile}${b.callerLine ? `:${b.callerLine}` : ''} — relation '${b.relation}' to '${b.targetId}' would be broken` })),
      context: diff.isSafe ? 'Simulation complete: Mutation is safe with 0 broken references.' : `Mutation creates ${diff.brokenReferences.length} broken references across ${new Set(diff.brokenReferences.map(b => b.callerFile)).size} file(s).`,
    };
  }
}
