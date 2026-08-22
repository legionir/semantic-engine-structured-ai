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
    required: ['path'],
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(input: FindTestsInput): Promise<AiToolOutput> {
    try {
      const file = input.fileId
        ? this.reader.getFileById(input.fileId)
        : input.path
          ? this.reader.getFileByPath(input.path)
          : undefined;

      const symbol = input.symbolId ? this.reader.getSymbolById(input.symbolId) : undefined;
      const symbolFile = symbol ? this.reader.getFileById(symbol.fileId) : undefined;

      const targetFile = file ?? symbolFile;

      if (!targetFile && !symbol) {
        return { success: false, error: 'No file or symbol found', items: [] };
      }

      const limit = input.limit ?? 20;
      const matched = new Map<string, { file: import('../../core/types/project-index.types').FileEntry; reason: string; score: number }>();

      // ۱. استفاده از testIds یکپارچه‌شده در ProjectIndex (فاز C)
      if (symbol) {
        for (const test of this.reader.getTestsForSymbol(symbol.id)) {
          matched.set(test.id, { file: test, reason: `Mapped test for symbol ${symbol.name}`, score: 3 });
        }
      }

      if (targetFile) {
        for (const test of this.reader.getTestsForFile(targetFile.id)) {
          if (!matched.has(test.id)) {
            matched.set(test.id, { file: test, reason: `Mapped test for file ${targetFile.path}`, score: 2.5 });
          }
        }
      }

      // ۲. Fallback heuristic اگر testIds پر نشده باشد
      const targetPaths: string[] = [];
      if (file) targetPaths.push(file.path);
      if (symbolFile && (!file || symbolFile.id !== file.id)) targetPaths.push(symbolFile.path);

      if (targetPaths.length > 0) {
        const testFiles = this.reader.getAllFiles().filter(f => f.testFile);

        for (const test of testFiles) {
          if (matched.has(test.id)) continue;

          let bestScore = 0;
          let reason = '';

          for (const path of targetPaths) {
            const base = path.replace(/\.[^.]+$/, '').replace(/[/\\]/g, '_');
            const testName = test.path.toLowerCase();
            const targetName = path.toLowerCase();

            if (testName.includes(base.toLowerCase()) || testName.includes(targetName.replace(/\.[^.]+$/, '').toLowerCase())) {
              bestScore = Math.max(bestScore, 1);
              reason = `Filename matches ${path}`;
            }

            const importsTarget = test.imports?.some(imp => {
              const resolvedFile = imp.resolvedFileId ? this.reader.getFileById(imp.resolvedFileId) : undefined;
              return resolvedFile?.path === path;
            });
            if (importsTarget) {
              bestScore = Math.max(bestScore, 2);
              reason = `Imports ${path}`;
            }
          }

          if (bestScore > 0) {
            matched.set(test.id, { file: test, reason, score: bestScore });
          }
        }
      }

      const items = Array.from(matched.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(m => ({
          id: m.file.id,
          name: m.file.path,
          kind: 'test',
          path: m.file.path,
          source: m.reason,
          relevanceScore: m.score,
        }));

      return { success: true, items };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
      };
    }
  }
}
