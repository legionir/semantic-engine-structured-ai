/**
 * GetDependenciesTool — forward/backward dependencies برای file یا symbol.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { resolveFileOrSymbolId } from './resolveIndexEntity';

export interface GetDependenciesInput extends AiToolInput {
  readonly id: string;
  readonly direction: 'forward' | 'backward';
  readonly level?: 'file' | 'symbol';
  readonly depth?: number;
  readonly kind?: 'import' | 'package' | 'dynamic-import' | 'called-by' | 'all';
  readonly limit?: number;
}

const MAX_DEPTH = 3;

export class GetDependenciesTool implements AiTool<GetDependenciesInput> {
  readonly name = 'get_dependencies';
  readonly description = 'Get forward or backward dependencies for a file or symbol.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'fileId, symbolId, or indexed relative file path' },
      direction: { enum: ['forward', 'backward'], description: 'forward = this depends on others; backward = others depend on this' },
      level: { enum: ['file', 'symbol'], default: 'file', description: 'Resolution level' },
      depth: { type: 'integer', default: 1, minimum: 1, maximum: 3, description: 'How many hops to traverse' },
      kind: { enum: ['import', 'package', 'dynamic-import', 'called-by', 'all'], default: 'all' },
      limit: { type: 'integer', default: 50 },
    },
    required: ['id', 'direction'],
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(input: GetDependenciesInput): Promise<AiToolOutput> {
    try {
      const depth = input.depth ?? 1;
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
        return { success: false, error: `depth must be an integer between 1 and ${MAX_DEPTH}`, items: [] };
      }
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1) {
        return { success: false, error: 'limit must be a positive integer', items: [] };
      }
      const direction = input.direction;
      const kind = input.kind ?? 'all';
      const level = input.level ?? 'file';
      const resolvedId = resolveFileOrSymbolId(this.reader, input.id);
      if (!resolvedId) return { success: false, error: `No file or symbol found for id or path: ${input.id}`, items: [] };

      const visited = new Set<string>();
      const results: import('./types').AiToolResultItem[] = [];
      const traverse = (currentId: string, currentDepth: number): void => {
        if (currentDepth > depth || results.length >= limit || visited.has(currentId)) return;
        visited.add(currentId);
        const edges = direction === 'forward'
          ? this.reader.getDependencies(currentId)
          : this.reader.getReverseDependencies(currentId);
        for (const edge of edges) {
          if (kind !== 'all' && !this.matchesKind(edge.kind, kind)) continue;
          const targetId = edge.to;
          const targetFile = this.reader.getFileById(targetId);
          const targetSymbol = this.reader.getSymbolById(targetId);
          const externalPackage = targetId.startsWith('pkg:');
          if (level === 'file' && !targetFile && !externalPackage) continue;
          if (level === 'symbol' && !targetSymbol) continue;
          results.push({ id: targetId, name: targetSymbol?.name ?? targetFile?.path ?? targetId.replace(/^pkg:/, ''), kind: edge.kind, path: targetFile?.path, line: targetSymbol?.line, source: 'index' });
          traverse(targetId, currentDepth + 1);
          if (results.length >= limit) return;
        }
      };
      traverse(resolvedId, 1);
      return { success: true, items: results.slice(0, limit) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error), items: [] };
    }
  }

  private matchesKind(edgeKind: string, filterKind: string): boolean {
    return filterKind === 'all' || edgeKind === filterKind;
  }
}
