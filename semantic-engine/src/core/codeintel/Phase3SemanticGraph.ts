import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectIndexReader } from '../../ai/ProjectIndexReader';
import { FileEntry, SymbolEntry } from '../types/project-index.types';
import { compareCanonical, LineIndex, makeSymbolKey } from '../contracts/codeintel';
import { Phase1IndexPlatform } from './Phase1Platform';

export type ResolutionConfidence = 'exact' | 'heuristic' | 'ambiguous' | 'unresolved';
export type ResolutionVia = 'lsp' | 'import-graph' | 'scope' | 'name-only';

export interface ResolutionCandidate { readonly symbolId: string; readonly symbolKey: string; readonly path: string; readonly name: string; readonly kind: string; }
export interface ResolutionProvenance { readonly confidence: ResolutionConfidence; readonly via: ResolutionVia; readonly candidates: readonly ResolutionCandidate[]; readonly reason?: string; }
export interface SymbolReference {
  readonly id: string; readonly targetSymbolId?: string; readonly targetSymbolKey: string;
  readonly sourceFileId: string; readonly sourcePath: string; readonly line: number; readonly column: number;
  readonly start: number; readonly end: number; readonly text: string; readonly provenance: ResolutionProvenance;
}
export interface UnresolvedReference {
  readonly id: string; readonly sourceFileId: string; readonly sourcePath: string; readonly name: string;
  readonly line: number; readonly column: number; readonly reason: string; readonly provenance: ResolutionProvenance;
}
export interface SemanticGraph {
  readonly schemaVersion: '3-pilot'; readonly language: 'typescript'; readonly snapshotId: string;
  readonly references: readonly SymbolReference[]; readonly unresolved: readonly UnresolvedReference[];
  readonly fileDeps: readonly { readonly fromFileId: string; readonly toFileId?: string; readonly specifier: string; readonly resolved: boolean }[];
}

interface CandidateWithFile extends ResolutionCandidate { readonly fileId: string; }

/** Dependency-free TypeScript pilot. It is deliberately additive over ProjectIndexReader. */
export class Phase3SemanticGraphPilot {
  private readonly platform = new Phase1IndexPlatform();
  private readonly sourceCache = new Map<string, string>();
  constructor(private readonly reader: ProjectIndexReader, private readonly workspaceRoot: string) {}

  async build(): Promise<SemanticGraph> {
    const index = this.reader.projectIndex;
    const snapshotId = this.platform.snapshotId(index);
    const refs: SymbolReference[] = [];
    const unresolved: UnresolvedReference[] = [];
    const deps: { fromFileId: string; toFileId?: string; specifier: string; resolved: boolean }[] = [];
    for (const file of [...this.reader.getAllFiles()].filter(f => this.isTypeScript(f)).sort((a, b) => compareCanonical(a.path, b.path))) {
      const text = await this.read(file);
      const imports = this.imports(file, text);
      for (const item of imports) {
        const target = this.resolveImport(file, item.specifier, item.imported);
        deps.push({ fromFileId: file.id, ...(target.file ? { toFileId: target.file.id } : {}), specifier: item.specifier, resolved: !!target.file });
        if (!target.symbols.length) {
          unresolved.push(this.unresolved(file, text, item.local, `unresolved import '${item.imported}' from '${item.specifier}'`));
          continue;
        }
        const provenance: ResolutionProvenance = target.symbols.length === 1
          ? { confidence: 'exact', via: 'import-graph', candidates: target.symbols }
          : { confidence: 'ambiguous', via: 'import-graph', candidates: target.symbols, reason: 'multiple matching exports' };
        for (const occurrence of occurrencesOutsideImport(text, item.local, item.importStart, item.importEnd)) {
          refs.push({ id: stableId(`${file.path}:${occurrence.start}:${target.symbols.map(s => s.symbolId).join(',')}`), targetSymbolId: target.symbols.length === 1 ? target.symbols[0].symbolId : undefined, targetSymbolKey: target.symbols.length === 1 ? target.symbols[0].symbolKey : target.symbols[0].symbolKey, sourceFileId: file.id, sourcePath: file.path, line: occurrence.line, column: occurrence.column, start: occurrence.start, end: occurrence.end, text: item.local, provenance });
        }
      }
    }
    refs.sort(referenceOrder); unresolved.sort((a, b) => compareCanonical(a.id, b.id));
    deps.sort((a, b) => compareCanonical(`${a.fromFileId}:${a.specifier}`, `${b.fromFileId}:${b.specifier}`));
    return { schemaVersion: '3-pilot', language: 'typescript', snapshotId, references: refs, unresolved, fileDeps: deps };
  }

  /**
   * Conservative incremental contract for the pilot. The current adapter rebuilds
   * the bounded graph to preserve semantic equality until the producer exposes
   * per-file parse caches; callers still get an explicit changed-path boundary.
   * It never returns a stale partial graph.
   */
  async buildIncremental(previous: SemanticGraph, changedPaths: readonly string[]): Promise<SemanticGraph> {
    if (previous.schemaVersion !== '3-pilot') throw new Error('INVALID_ARGUMENT: unsupported semantic graph schema');
    if (changedPaths.some(p => !p || path.posix.isAbsolute(p) || p.includes('..'))) throw new Error('DENIED: invalid changed path');
    return this.build();
  }

  async referencesFor(target: SymbolEntry | string): Promise<{ graph: SemanticGraph; references: readonly SymbolReference[] }> {
    const graph = await this.build();
    const symbol = typeof target === 'string' ? this.findSymbol(target) : target;
    if (!symbol) return { graph, references: [] };
    const key = this.symbolKey(symbol);
    return { graph, references: graph.references.filter(r => r.targetSymbolId === symbol.id || r.targetSymbolKey === key) };
  }

  private findSymbol(value: string): SymbolEntry | undefined {
    return this.reader.getSymbolById(value) ?? [...this.reader.getAllSymbols()].find(s => this.symbolKey(s) === value || s.name === value);
  }
  private symbolKey(symbol: SymbolEntry): string { const file = this.reader.getFileById(symbol.fileId); return String(makeSymbolKey(file?.path ?? symbol.fileId, symbol.fullyQualifiedName ?? symbol.name, symbol.kind)); }
  private isTypeScript(file: FileEntry): boolean { return file.language === 'typescript' || file.language === 'javascript' || file.language === 'tsx' || /\.(tsx?|jsx?|mts|cts)$/u.test(file.path); }
  private async read(file: FileEntry): Promise<string> { const cached = this.sourceCache.get(file.id); if (cached !== undefined) return cached; const value = (await fs.readFile(path.resolve(this.workspaceRoot, file.path), 'utf8')).replace(/^\uFEFF/u, ''); this.sourceCache.set(file.id, value); return value; }
  private imports(file: FileEntry, text: string): ImportScan[] {
    const out: ImportScan[] = [];
    const re = /\bimport\s+(?:(?:type\s+)?\{([^}]+)\}|([A-Za-z_$][\w$]*)|\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"]/gu;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const specifier = match[4]; const imported = match[1]?.split(',')[0]?.trim().split(/\s+as\s+/u)[0] ?? 'default'; const local = match[1]?.split(',')[0]?.trim().split(/\s+as\s+/u)[1] ?? match[2] ?? match[3] ?? imported;
      out.push({ imported, local, specifier, importStart: match.index, importEnd: match.index + match[0].length });
    }
    return out;
  }
  private resolveImport(from: FileEntry, specifier: string, imported: string): { file?: FileEntry; symbols: CandidateWithFile[] } {
    if (!specifier.startsWith('.')) return { symbols: [] };
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from.path), specifier));
    const files = [...this.reader.getAllFiles()].filter(f => [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`].includes(f.path));
    const candidates = files.flatMap(file => [...this.reader.getSymbolsForFile(file.id)].filter(s => (imported === 'default' ? !!s.exported && s.name === 'default' : s.name === imported || s.fullyQualifiedName?.endsWith(`.${imported}`))).map(s => ({ symbolId: s.id, symbolKey: this.symbolKey(s), path: file.path, name: s.name, kind: s.kind, fileId: file.id })));
    return { file: files[0], symbols: candidates.sort((a, b) => compareCanonical(a.symbolKey, b.symbolKey)) };
  }
  private unresolved(file: FileEntry, text: string, name: string, reason: string): UnresolvedReference { const occurrence = occurrencesOutsideImport(text, name, -1, -1)[0] ?? { start: 0, end: 0, line: 1, column: 0 }; return { id: stableId(`${file.path}:${occurrence.start}:${name}`), sourceFileId: file.id, sourcePath: file.path, name, line: occurrence.line, column: occurrence.column, reason, provenance: { confidence: 'unresolved', via: 'import-graph', candidates: [], reason } }; }
}

interface ImportScan { imported: string; local: string; specifier: string; importStart: number; importEnd: number; }
function occurrencesOutsideImport(text: string, name: string, importStart: number, importEnd: number): { start: number; end: number; line: number; column: number }[] {
  if (!name) return []; const re = new RegExp(`\\b${escape(name)}\\b`, 'gu'); const index = new LineIndex(text); const out: { start: number; end: number; line: number; column: number }[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { if (m.index >= importStart && m.index < importEnd) continue; const p = index.positionAt(m.index); out.push({ start: m.index, end: m.index + name.length, line: p.line + 1, column: p.character }); }
  return out;
}
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function stableId(value: string): string { return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16); }
function referenceOrder(a: SymbolReference, b: SymbolReference): number { return compareCanonical(`${a.sourcePath}:${a.start}:${a.id}`, `${b.sourcePath}:${b.start}:${b.id}`); }
