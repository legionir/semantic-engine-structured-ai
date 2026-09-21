import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { Phase3SemanticGraphPilot, ResolutionConfidence } from '../../core/codeintel/Phase3SemanticGraph';

const fail = (error: string): AiToolOutput => ({ success: false, error, items: [] });
const confidenceRank: Record<ResolutionConfidence, number> = { exact: 4, heuristic: 3, ambiguous: 2, unresolved: 1 };

export class SymbolReferencesTool implements AiTool {
  readonly name = 'symbol_references';
  readonly description = 'Experimental TypeScript semantic references with explicit resolution confidence and provenance.';
  readonly inputSchema = { type: 'object', properties: { symbolId: { type: 'string' }, symbolKey: { type: 'string' }, name: { type: 'string' }, minConfidence: { enum: ['exact', 'heuristic', 'ambiguous', 'unresolved'] }, limit: { type: 'integer', minimum: 1, maximum: 10000 } }, anyOf: [{ required: ['symbolId'] }, { required: ['symbolKey'] }, { required: ['name'] }] };
  constructor(private readonly reader: ProjectIndexReader, private readonly workspaceRoot?: string) {}
  async execute(input: AiToolInput): Promise<AiToolOutput> {
    if (!this.workspaceRoot) return fail('DISABLED: Phase 3 workspaceRoot is not configured');
    const target = typeof input.symbolId === 'string' ? this.reader.getSymbolById(input.symbolId) : typeof input.symbolKey === 'string' ? input.symbolKey : typeof input.name === 'string' ? input.name : undefined;
    if (!target) return fail('NOT_FOUND: target symbol');
    try {
      const result = await new Phase3SemanticGraphPilot(this.reader, this.workspaceRoot).referencesFor(target);
      const min = typeof input.minConfidence === 'string' && input.minConfidence in confidenceRank ? input.minConfidence as ResolutionConfidence : 'unresolved';
      const limit = typeof input.limit === 'number' ? input.limit : 1000;
      const selected = result.references.filter(r => confidenceRank[r.provenance.confidence] >= confidenceRank[min]).slice(0, limit);
      return { success: true, items: selected.map(r => ({ id: r.id, name: r.targetSymbolKey, kind: 'symbol_reference', path: r.sourcePath, line: r.line, source: 'phase3-semantic-graph', excerpt: r.text, metadata: { start: r.start, end: r.end, targetSymbolId: r.targetSymbolId, targetSymbolKey: r.targetSymbolKey, confidence: r.provenance.confidence, via: r.provenance.via, candidates: r.provenance.candidates, snapshotId: result.graph.snapshotId } })), metadata: { experimental: true, language: 'typescript', snapshotId: result.graph.snapshotId, referenceCount: selected.length, truncated: result.references.length > selected.length, unresolvedCount: result.graph.unresolved.length, fileDependencyCount: result.graph.fileDeps.length, trust: 'untrusted-source-content' } };
    } catch (error) { return fail(`IO_ERROR: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

export class SemanticGraphInspectTool implements AiTool {
  readonly name = 'semantic_graph_inspect';
  readonly description = 'Experimental bounded semantic graph diagnostics for the TypeScript pilot.';
  readonly inputSchema = { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10000 } } };
  constructor(private readonly reader: ProjectIndexReader, private readonly workspaceRoot?: string) {}
  async execute(input: AiToolInput): Promise<AiToolOutput> {
    if (!this.workspaceRoot) return fail('DISABLED: Phase 3 workspaceRoot is not configured');
    try { const graph = await new Phase3SemanticGraphPilot(this.reader, this.workspaceRoot).build(); const limit = typeof input.limit === 'number' ? input.limit : 1000; const items = graph.fileDeps.slice(0, limit).map((d, i) => ({ id: `${d.fromFileId}:${d.specifier}`, name: d.specifier, kind: d.resolved ? 'file_dependency' : 'unresolved_dependency', source: 'phase3-semantic-graph', metadata: { fromFileId: d.fromFileId, toFileId: d.toFileId, resolved: d.resolved, snapshotId: graph.snapshotId, ordinal: i } })); return { success: true, items, metadata: { experimental: true, snapshotId: graph.snapshotId, unresolvedCount: graph.unresolved.length, referenceCount: graph.references.length, fileDependencyCount: graph.fileDeps.length, trust: 'untrusted-source-content' } }; } catch (error) { return fail(`IO_ERROR: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
