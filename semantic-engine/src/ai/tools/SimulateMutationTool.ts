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
        description: 'The symbol ID or fully qualified path::symbol name to mutate',
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
    const requestedTarget = input.targetSymbolId as string;
    const targetSymbolId = resolveSymbolId(this.reader, requestedTarget);

    if (!targetSymbolId) {
      return {
        success: false,
        error: `No symbol found for id or fully-qualified name: ${requestedTarget}`,
        items: [],
      };
    }

    /*
    | گراف از یک سازندهٔ مشترک می‌آید تا سر/انتهای غیرسمبل (فایل، نام خارجی)
    | هم node داشته باشند — پیش از این `callerFile` برای فراخوانِ سطح ماژول
    | 'unknown' می‌شد.
    */
    /*
    | سازندهٔ مشترک، هم node فایل‌ها و هم هر دو دسته یال (dependency و call) را
    | می‌گذارد. یال‌های call برای این ابزار حیاتی‌اند: یک rename/delete حتی وقتی
    | هیچ یال import عوض نمی‌شود می‌تواند فراخوان‌ها را بشکند.
    */
    const graph = buildIndexGraph(this.reader, { callEdges: true });

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
        /*
        | نامِ آیتم شناسهٔ هش نبود؛ یک فهرست از `a4f9…` برای هیچ مصرف‌کننده‌ای
        | قابل استفاده نیست. مسیر/نام گرهنشانه جای آن را می‌گیرد.
        */
        name: nodePath(graph, b.callerId) ?? describeNode(graph, b.callerId),
        kind: 'broken_reference',
        path: b.callerFile,
        source: 'mutation-simulator',
        excerpt:
          `${b.callerFile}${b.callerLine ? `:${b.callerLine}` : ''} — relation '${b.relation}' to ` +
          `'${b.targetId}' would be broken`,
      })),
      context: diff.isSafe
        ? `Simulation complete: Mutation is safe with 0 broken references.`
        : `Mutation creates ${diff.brokenReferences.length} broken references across ${
            new Set(diff.brokenReferences.map(b => b.callerFile)).size
          } file(s).`,
    };
  }
}
