/**
 * Benchmark: SQLite export performance.
 *
 * اجرا:
 *   node dist/export/SQLiteExporter.benchmark.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { SQLiteExporter } from './SQLiteExporter';
import { ProjectIndex, FileEntry, SymbolEntry, VectorChunk } from '../core/types/project-index.types';

function createFile(id: number): FileEntry {
  return {
    id: `f${id}`,
    path: `src/file${id}.ts`,
    language: 'typescript',
    encoding: 'utf8',
    size: 1000,
    lines: 50,
    hash: `hash-${id}`,
    modified: new Date().toISOString(),
    binary: false,
    testFile: false,
    generated: false,
    symbolIds: [],
    imports: [],
    exports: [],
    diagnostics: [],
    outline: [],
  };
}

function createSymbol(id: number): SymbolEntry {
  return {
    id: `s${id}`,
    fileId: `f${id}`,
    parentId: null,
    kind: 'function',
    name: `fn${id}`,
    line: 1,
    endLine: 2,
    source: 'lsp',
    confidence: 85,
  } as SymbolEntry;
}

function createChunk(id: number): VectorChunk {
  return {
    id: `vec-${id}`,
    fileId: `f${id}`,
    symbolId: null,
    unit: 'module',
    content: `content ${id}`,
    startLine: 1,
    endLine: 10,
    tokenEstimate: 5,
  };
}

function buildProjectIndex(fileCount: number): ProjectIndex {
  return {
    schemaVersion: '2.0.0',
    root: 'benchmark',
    generatedAt: new Date().toISOString(),
    languages: ['typescript'],
    files: Array.from({ length: fileCount }, (_, i) => createFile(i)),
    symbols: Array.from({ length: fileCount }, (_, i) => createSymbol(i)),
    graphs: {
      callGraph: [],
      typeGraph: [],
      dependencyGraph: [],
      reverseDependencyGraph: [],
    },
    diagnostics: [],
    metrics: {
      totalFiles: fileCount,
      totalLoc: fileCount * 50,
      totalSymbols: fileCount,
      avgCyclomaticComplexity: 0,
      languageBreakdown: { typescript: fileCount },
    },
    vectorChunks: Array.from({ length: fileCount }, (_, i) => createChunk(i)),
  };
}

async function main(): Promise<void> {
  const outDir = path.join(__dirname, '..', '..', 'tmp-sqlite-benchmark');
  fs.mkdirSync(outDir, { recursive: true });

  const counts = [100, 500, 1000];

  console.log('SQLiteExporter Benchmark');
  console.log('========================');

  for (const count of counts) {
    const projectIndex = buildProjectIndex(count);
    const outputPath = path.join(outDir, `bench-${count}.sqlite`);

    const start = process.hrtime.bigint();
    const exporter = new SQLiteExporter();
    await exporter.export(projectIndex, { outputPath });
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;

    const stats = fs.statSync(outputPath);
    console.log(`Files: ${count}, Time: ${ms.toFixed(2)}ms, DB size: ${(stats.size / 1024).toFixed(1)}KB`);

    fs.rmSync(outputPath);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
}

main().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
