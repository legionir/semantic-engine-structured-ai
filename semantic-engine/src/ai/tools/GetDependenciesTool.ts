/**
 * GetDependenciesTool — forward/backward dependencies برای file یا symbol.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';

export interface GetDependenciesInput extends AiToolInput {
  readonly id: string;
  readonly direction: 'forward' | 'backward';
  readonly level?: 'file' | 'symbol';
  readonly depth?: number;
  readonly kind?: 'import' | 'package' | 'dynamic-import' | 'called-by' | 'all';
  readonly limit?: number;
}

/** سقفِ عمق. در schema هم اعلام شده تا درخواستِ بزرگ‌تر رد شود، نه بریده. */
const MAX_DEPTH = 3;

export class GetDependenciesTool implements AiTool<GetDependenciesInput> {
  readonly name = 'get_dependencies';
  readonly description = 'Get forward or backward dependencies for a file or symbol.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'fileId or symbolId' },
      direction: { enum: ['forward', 'backward'], description: 'forward = this depends on others; backward = others depend on this' },
      level: { enum: ['file', 'symbol'], default: 'file', description: 'Resolution level' },
      depth: { type: 'integer', default: 1, minimum: 1, maximum: 3, description: 'How many hops to traverse. Capped at 3; asking for more is rejected rather than silently reduced.' },
      kind: { enum: ['import', 'package', 'dynamic-import', 'called-by', 'all'], default: 'all' },
      limit: { type: 'integer', default: 50 },
    },
    required: ['id', 'direction'],
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(input: GetDependenciesInput): Promise<AiToolOutput> {
    try {
      const direction = input.direction;
      /*
      | SE-AI-06 — `depth` بی‌صدا روی ۳ سقف می‌خورد. کسی که ۱۰
      | بخواهد، ۳ می‌گیرد و خبردار نمی‌شود. حالا سقف در schema هم
      | اعلام شده، پس درخواستِ بزرگ‌تر *رد* می‌شود به‌جای اینکه
      | بی‌صدا کوچک شود.
      */
      const depth = Math.min(input.depth ?? 1, MAX_DEPTH);
      const limit = input.limit ?? 50;
      const kind = input.kind ?? 'all';
      /*
      | SE-AI-06 — `level` در schema و در interface اعلام شده بود و
      | **هرگز خوانده نمی‌شد**. یک گزینهٔ اعلام‌شده که کاری نمی‌کند،
      | بدتر از نبودنش است: مصرف‌کننده فکر می‌کند فیلتر کرده.
      */
      const level = input.level ?? 'file';

      const visited = new Set<string>();
      const results: import('./types').AiToolResultItem[] = [];

      const traverse = (currentId: string, currentDepth: number) => {
        if (currentDepth > depth) return;
        if (visited.has(currentId)) return;
        visited.add(currentId);

        const edges = direction === 'forward'
          ? this.reader.getDependencies(currentId)
          : this.reader.getReverseDependencies(currentId);

        for (const edge of edges) {
          const targetId = edge.to;
          if (kind !== 'all' && !this.matchesKind(edge.kind, kind)) continue;

          const targetFile = this.reader.getFileById(targetId);
          const targetSymbol = this.reader.getSymbolById(targetId);

          if (level === 'file' && !targetFile) continue;
          if (level === 'symbol' && !targetSymbol) continue;

          results.push({
            id: targetId,
            name: targetSymbol?.name ?? targetFile?.path ?? targetId,
            kind: edge.kind,
            path: targetFile?.path,
            line: targetSymbol?.line,
            source: 'index',
          });

          if (results.length >= limit) return;

          traverse(targetId, currentDepth + 1);
          if (results.length >= limit) return;
        }
      };

      traverse(input.id, 1);

      return { success: true, items: results.slice(0, limit) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
      };
    }
  }

  private matchesKind(edgeKind: string, filterKind: string): boolean {
    if (filterKind === 'all') return true;
    return edgeKind === filterKind;
  }
}
