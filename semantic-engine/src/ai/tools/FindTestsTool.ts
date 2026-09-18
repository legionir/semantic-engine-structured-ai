/**
 * FindTestsTool — پیدا کردن تست‌های مرتبط با یک فایل یا symbol.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';

export interface FindTestsInput extends AiToolInput {
  readonly path?: string;
  readonly fileId?: string;
  readonly symbolId?: string;
  readonly limit?: number;
}

export class FindTestsTool implements AiTool<FindTestsInput> {
  readonly name = 'find_tests';
  readonly description = 'Find test files related to a given file or symbol.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path' },
      fileId: { type: 'string', description: 'File id (alternative to path)' },
      symbolId: { type: 'string', description: 'Symbol id' },
      limit: { type: 'integer', default: 20 },
    },
    anyOf: [{ required: ['path'] }, { required: ['fileId'] }, { required: ['symbolId'] }],
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(input: FindTestsInput): Promise<AiToolOutput> {
    try {
      const selectors = [input.path, input.fileId, input.symbolId];
      if (selectors.every(value => value === undefined)) return { success: false, error: 'One of path, fileId, or symbolId is required', items: [] };
      if (selectors.some(value => value !== undefined && (typeof value !== 'string' || value.trim().length === 0))) {
        return { success: false, error: 'path, fileId, and symbolId must be non-empty strings', items: [] };
      }
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
        return { success: false, error: 'limit must be a positive integer', items: [] };
      }
      const file = input.fileId ? this.reader.getFileById(input.fileId) : input.path ? this.reader.getFileByPath(input.path) : undefined;
      const symbol = input.symbolId ? this.reader.getSymbolById(input.symbolId) : undefined;
      const symbolFile = symbol ? this.reader.getFileById(symbol.fileId) : undefined;
      const targetFile = file ?? symbolFile;
      if (!targetFile && !symbol) return { success: false, error: 'No file or symbol found', items: [] };
      const limit = input.limit ?? 20;
      const matched = new Map<string, { file: import('../../core/types/project-index.types').FileEntry; reason: string; score: number }>();
      if (symbol) for (const test of this.reader.getTestsForSymbol(symbol.id)) matched.set(test.id, { file: test, reason: `Mapped test for symbol ${symbol.name}`, score: 3 });
      if (targetFile) for (const test of this.reader.getTestsForFile(targetFile.id)) if (!matched.has(test.id)) matched.set(test.id, { file: test, reason: `Mapped test for file ${targetFile.path}`, score: 2.5 });
      const targetPaths: string[] = [];
      if (file) targetPaths.push(file.path);
      if (symbolFile && (!file || symbolFile.id !== file.id)) targetPaths.push(symbolFile.path);
      if (targetPaths.length > 0) {
        for (const test of this.reader.getAllFiles().filter(f => f.testFile)) {
          if (matched.has(test.id)) continue;
          let bestScore = 0;
          let reason = '';
          for (const path of targetPaths) {
            const base = path.replace(/\.[^.]+$/, '').replace(/[/\\]/g, '_');
            const testName = test.path.toLowerCase();
            if (testName.includes(base.toLowerCase()) || testName.includes(path.replace(/\.[^.]+$/, '').toLowerCase())) { bestScore = Math.max(bestScore, 1); reason = `Filename matches ${path}`; }
            if (test.imports?.some(imp => this.reader.getFileById(imp.resolvedFileId ?? '')?.path === path)) { bestScore = Math.max(bestScore, 2); reason = `Imports ${path}`; }
          }
          if (bestScore > 0) matched.set(test.id, { file: test, reason, score: bestScore });
        }
      }
      const items = Array.from(matched.values()).sort((a, b) => b.score - a.score).slice(0, limit).map(m => ({ id: m.file.id, name: m.file.path, kind: 'test', path: m.file.path, source: m.reason, relevanceScore: m.score }));
      return { success: true, items };
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), items: [] }; }
  }
}
