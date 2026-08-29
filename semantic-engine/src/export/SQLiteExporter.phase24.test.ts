/**
 * فاز ۲۴ — خروجی SQLite.
 *
 *   SE-EXP-07  سطر مرده هرگز حذف نمی‌شد — `INSERT OR REPLACE` بدون `DELETE`
 *   SE-EXP-08  نه جدول متادیتا بود، نه نسخهٔ schema، نه مسیر مهاجرت
 *   SE-EXP-09  `PRAGMA foreign_keys = ON` بدون حتی یک FK
 *
 * این سوئیت روی درایور داخلی Node اجرا می‌شود، پس برخلاف
 * `SQLiteExporter.test.ts` قدیمی به build بومی نیاز ندارد و در
 * `npm test` هم می‌آید.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SQLiteExporter } from './SQLiteExporter';
import { openSqlite, hasNativeSqlite, SqliteDriver } from './sqlite/SqliteDriver';
import { ProjectIndex, FileEntry, SymbolEntry } from '../core/types/project-index.types';

let directory: string;
let dbPath: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'se-sqlite-'));
  dbPath = path.join(directory, 'index.sqlite');
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function file(id: string, filePath: string): FileEntry {
  return {
    id,
    path: filePath,
    language: 'typescript',
    encoding: 'utf8',
    size: 1,
    lines: 1,
    hash: `h-${id}`,
    modified: '2026-08-19T00:00:00.000Z',
    binary: false,
    testFile: false,
    generated: false,
  } as FileEntry;
}

function symbol(id: string, fileId: string, name: string): SymbolEntry {
  return { id, fileId, parentId: null, kind: 'function', name, line: 1, endLine: 2 } as SymbolEntry;
}

function index(files: FileEntry[], symbols: SymbolEntry[]): ProjectIndex {
  return {
    schemaVersion: '2.0.0',
    root: 'fixture',
    rootPath: '/tmp/fixture',
    generatedAt: '2026-08-19T00:00:00.000Z',
    languages: ['typescript'],
    files,
    symbols,
    graphs: { callGraph: [], typeGraph: [], dependencyGraph: [], reverseDependencyGraph: [] },
    diagnostics: [],
    metrics: {
      totalFiles: files.length,
      totalLoc: files.length,
      totalSymbols: symbols.length,
      avgCyclomaticComplexity: 0,
      languageBreakdown: { typescript: files.length },
    },
  } as ProjectIndex;
}

async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const db: SqliteDriver = await openSqlite(dbPath);
  try {
    return await db.all<T>(sql);
  } finally {
    await db.close();
  }
}

describe('درایور SQLite', () => {
  it('SQLite داخلی Node در این محیط موجود است', () => {
    expect(hasNativeSqlite()).toBe(true);
  });

  it('درایور بازشده همان داخلی است', async () => {
    const db = await openSqlite(':memory:');
    expect(db.name).toBe('node:sqlite');
    await db.close();
  });
});

describe('SE-EXP-07 — سطر مرده حذف می‌شود', () => {
  it('فایل حذف‌شده و symbolهایش از دیتابیس می‌روند', async () => {
    const exporter = new SQLiteExporter();

    await exporter.export(
      index(
        [file('f1', 'a.ts'), file('f2', 'b.ts')],
        [symbol('s1', 'f1', 'alpha'), symbol('s2', 'f2', 'beta')]
      ),
      { outputPath: dbPath }
    );

    expect((await query('SELECT id FROM files ORDER BY id')).map(r => r['id'])).toEqual(['f1', 'f2']);
    expect((await query('SELECT id FROM symbols ORDER BY id')).map(r => r['id'])).toEqual(['s1', 's2']);

    // اسکن دوباره، بدون b.ts
    await exporter.export(index([file('f1', 'a.ts')], [symbol('s1', 'f1', 'alpha')]), {
      outputPath: dbPath,
    });

    expect((await query('SELECT id FROM files ORDER BY id')).map(r => r['id'])).toEqual(['f1']);
    expect((await query('SELECT id FROM symbols ORDER BY id')).map(r => r['id'])).toEqual(['s1']);
  });

  it('symbol حذف‌شده از فایلی که مانده هم می‌رود', async () => {
    const exporter = new SQLiteExporter();

    await exporter.export(
      index([file('f1', 'a.ts')], [symbol('s1', 'f1', 'alpha'), symbol('s2', 'f1', 'beta')]),
      { outputPath: dbPath }
    );
    expect(await query('SELECT id FROM symbols')).toHaveLength(2);

    await exporter.export(index([file('f1', 'a.ts')], [symbol('s1', 'f1', 'alpha')]), {
      outputPath: dbPath,
    });

    expect((await query('SELECT id FROM symbols')).map(r => r['id'])).toEqual(['s1']);
  });

  it('یال گراف مرده هم می‌رود', async () => {
    const exporter = new SQLiteExporter();
    const withEdge = index([file('f1', 'a.ts')], [symbol('s1', 'f1', 'alpha')]);

    await exporter.export(
      {
        ...withEdge,
        graphs: {
          ...withEdge.graphs,
          callGraph: [
            {
              id: 'e1',
              caller: 's1',
              callee: 's1',
              kind: 'direct',
              line: 1,
              provenance: { extractor: 'heuristic', confidence: 50, basis: 'name-match' },
            },
          ],
        },
      } as ProjectIndex,
      { outputPath: dbPath }
    );
    expect(await query('SELECT id FROM call_graph')).toHaveLength(1);

    await exporter.export(withEdge, { outputPath: dbPath });
    expect(await query('SELECT id FROM call_graph')).toHaveLength(0);
  });
});

describe('SE-EXP-08 — جدول meta و نسخهٔ schema', () => {
  it('meta نوشته می‌شود و چیزهایی دارد که تا امروز فقط در JSON بودند', async () => {
    await new SQLiteExporter().export(index([file('f1', 'a.ts')], []), { outputPath: dbPath });

    const rows = await query<{ key: string; value: string }>('SELECT key, value FROM meta');
    const meta = Object.fromEntries(rows.map(r => [r.key, r.value]));

    expect(meta['schema_version']).toBeDefined();
    expect(meta['index_schema_version']).toBe('2.0.0');
    expect(meta['root']).toBe('fixture');
    expect(meta['root_path']).toBe('/tmp/fixture');
    expect(meta['generated_at']).toBe('2026-08-19T00:00:00.000Z');
    expect(JSON.parse(meta['languages']!)).toEqual(['typescript']);
    expect(JSON.parse(meta['metrics']!).totalFiles).toBe(1);
  });

  it('دیتابیس با نسخهٔ ناسازگار، بازسازی می‌شود نه اینکه بی‌صدا واگرا بماند', async () => {
    const exporter = new SQLiteExporter();
    await exporter.export(index([file('f1', 'a.ts')], []), { outputPath: dbPath });

    // یک نسخهٔ قدیمی جعل می‌کنیم و یک ستون کم می‌گذاریم
    const db = await openSqlite(dbPath);
    await db.exec("UPDATE meta SET value = '0' WHERE key = 'schema_version'");
    await db.exec('DROP TABLE symbols');
    await db.close();

    await exporter.export(index([file('f2', 'b.ts')], [symbol('s9', 'f2', 'gamma')]), {
      outputPath: dbPath,
    });

    expect((await query('SELECT id FROM files')).map(r => r['id'])).toEqual(['f2']);
    expect((await query('SELECT id FROM symbols')).map(r => r['id'])).toEqual(['s9']);
  });
});

describe('SE-EXP-09 — کلید خارجی واقعی', () => {
  it('symbols به files ارجاع دارد و آبشاری حذف می‌شود', async () => {
    await new SQLiteExporter().export(
      index([file('f1', 'a.ts')], [symbol('s1', 'f1', 'alpha')]),
      { outputPath: dbPath }
    );

    const foreignKeys = await query<{ table: string; from: string; to: string }>(
      'PRAGMA foreign_key_list(symbols)'
    );
    expect(foreignKeys.length).toBeGreaterThan(0);
    expect(foreignKeys[0]!.table).toBe('files');

    const db = await openSqlite(dbPath);
    await db.exec('PRAGMA foreign_keys = ON');
    await db.exec("DELETE FROM files WHERE id = 'f1'");
    const left = await db.all('SELECT id FROM symbols');
    await db.close();

    expect(left).toEqual([]);
  });

  it('یک symbol با fileId ناموجود پذیرفته نمی‌شود', async () => {
    await new SQLiteExporter().export(index([file('f1', 'a.ts')], []), { outputPath: dbPath });

    const db = await openSqlite(dbPath);
    await db.exec('PRAGMA foreign_keys = ON');
    await expect(
      db.exec("INSERT INTO symbols (id, file_id, kind, name) VALUES ('x', 'ghost', 'function', 'x')")
    ).rejects.toThrow(/FOREIGN KEY/i);
    await db.close();
  });
});
