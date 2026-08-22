/**
 * GraphViewModelMapper — Maps internal models to standardized GraphNode and GraphEdge format.
 */

import { NodeType, EdgeRelation, GraphNode, GraphEdge } from '../../server/types';
import { SymbolEntry, FileEntry } from '../../core/types/project-index.types';

export class GraphViewModelMapper {
  static createNode(
    id: string,
    type: NodeType,
    label: string,
    metadata: GraphNode['metadata'] = {},
    parentId?: string
  ): GraphNode {
    return {
      id,
      type,
      label,
      parentId,
      metadata,
    };
  }

  static createEdge(
    id: string,
    source: string,
    target: string,
    relation: EdgeRelation,
    metadata: GraphEdge['metadata'] = {
      confidence: 100,
      basis: 'resolved',
      sourceKind: 'compiler',
    }
  ): GraphEdge {
    return {
      id,
      source,
      target,
      relation,
      metadata,
    };
  }

  static fromSymbolEntry(symbol: SymbolEntry, filePath?: string): GraphNode {
    let nodeType: NodeType = 'function';
    if (symbol.kind === 'class') nodeType = 'class';
    else if (symbol.kind === 'method') nodeType = 'method';
    else if (symbol.kind === 'interface') nodeType = 'interface';
    else if (symbol.kind === 'struct') nodeType = 'struct';
    else if (symbol.kind === 'trait') nodeType = 'trait';

    return {
      id: symbol.id,
      type: nodeType,
      label: symbol.name,
      parentId: symbol.parentId || symbol.fileId,
      metadata: {
        path: filePath,
        line: symbol.line,
        endLine: symbol.endLine,
        complexity: symbol.complexity ?? undefined,
        referencesCount: symbol.referenceCount ?? undefined,
        isEntryPoint: symbol.exported,
      },
    };
  }

  static fromFileEntry(file: FileEntry): GraphNode {
    return {
      id: file.id,
      type: 'file',
      label: file.path.split('/').pop() || file.path,
      metadata: {
        path: file.path,
        language: file.language ?? undefined,
        role: file.role,
        isEntryPoint: file.entryPoint,
      },
    };
  }
}
