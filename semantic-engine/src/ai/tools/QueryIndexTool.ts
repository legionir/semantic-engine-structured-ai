/**
 * QueryIndexTool — SQL-like structured query روی SQLite project-index.
 *
 * فقط SELECT روی جداول allowed است. جداول allowed:
 * files, symbols, call_graph, type_graph, dependency_graph, reverse_dependency_graph
 */

import * as path from 'path';
import { AiTool, AiToolInput, AiToolOutput } from './types';
import { applyQueryPolicy, validateDatabasePath } from './queryPolicy';

export interface QueryIndexInput extends AiToolInput {
  readonly sqlitePath?: string;
  readonly sql: string;
  readonly params?: readonly unknown[];
  readonly limit?: number;
}

export interface QueryIndexOptions {
  /** دایرکتوری‌ای که فایل دیتابیس باید داخلش باشد. بدون آن هیچ فایلی باز نمی‌شود. */
  readonly allowedRoot?: string;
  readonly maxRows?: number;
}

const DEFAULT_MAX_ROWS = 100;

interface SqliteDatabase {
  close(callback?: (err: Error | null) => void): void;
  all(sql: string, params: unknown[], callback: (err: Error | null, rows: unknown[]) => void): void;
}

interface SqliteModule {
  OPEN_READONLY: number;
  Database: new (path: string, mode: number, callback?: (err: Error | null) => void) => SqliteDatabase;
}

/*
| sqlite3 یک ماژول native است و ممکن است build نشود. با import ایستا،
| شکست آن کل رجیستری ابزارها را از کار می‌انداخت (SE-BUILD-09). این
| بارگذاری تنبل، خرابی را به همین یک ابزار محدود می‌کند.
*/
function loadSqlite(): SqliteModule | null {
  try {

    return require('sqlite3') as SqliteModule;
  } catch {
    return null;
  }
}

export class QueryIndexTool implements AiTool<QueryIndexInput> {
  readonly name = 'query_index';
  readonly description = 'Run a read-only SQL query against the project-index.sqlite database.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      sqlitePath: { type: 'string', description: 'Path to project-index.sqlite' },
      sql: { type: 'string', description: 'Read-only SELECT. symbols uses file_id; join files on files.id = symbols.file_id when you need a path.' },
      params: { type: 'array', default: [], description: 'Query parameters' },
      limit: { type: 'integer', default: 100 },
    },
    required: ['sqlitePath', 'sql'],
  };

  constructor(private readonly options: QueryIndexOptions = {}) {}

  async execute(input: QueryIndexInput): Promise<AiToolOutput> {
    const policy = {
      allowedRoot: this.options.allowedRoot,
      maxRows: Math.min(
        input.limit ?? DEFAULT_MAX_ROWS,
        this.options.maxRows ?? DEFAULT_MAX_ROWS
      ),
    };

    /* Paths coming from an MCP client are commonly relative to the
       artifact directory (for example `project-index.sqlite`). Resolving
       them before policy validation both makes that contract useful and
       keeps the security check on the final path, not on process.cwd(). */
    const requestedPath = input.sqlitePath?.trim() || 'project-index.sqlite';
    const databasePath = path.isAbsolute(requestedPath)
      ? requestedPath
      : policy.allowedRoot
        ? path.resolve(policy.allowedRoot, requestedPath)
        : requestedPath;

    const pathCheck = validateDatabasePath(databasePath, policy);
    if (!pathCheck.ok) {
      return { success: false, error: pathCheck.error, items: [] };
    }

    const queryCheck = applyQueryPolicy(input.sql, policy);
    if (!queryCheck.ok) {
      return { success: false, error: queryCheck.error, items: [] };
    }

    const sqlite = loadSqlite();
    if (!sqlite) {
      return {
        success: false,
        error:
          'The sqlite3 native module is not available. ' +
          'Reinstall dependencies, or use the JSON index instead.',
        items: [],
      };
    }

    try {
      const db = await this.openDatabase(sqlite, databasePath);
      try {
        const rows = await this.query(db, queryCheck.sql, input.params ?? []);
        const items = rows.map((row, index) => ({
          id: `row-${index}`,
          name: Object.values(row ?? {}).slice(0, 2).join(' | ') || `row-${index}`,
          kind: 'query-result',
          source: 'sqlite',
          excerpt: JSON.stringify(row),
        }));
        return {
          success: true,
          items,
          metadata: { returned: items.length, capped: policy.maxRows },
        };
      } finally {
        await this.closeDatabase(db);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
      };
    }
  }

  private openDatabase(
    sqlite: SqliteModule,
    path: string
  ): Promise<SqliteDatabase> {
    return new Promise((resolve, reject) => {
      const db = new sqlite.Database(path, sqlite.OPEN_READONLY, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  private closeDatabase(db: SqliteDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private query(db: SqliteDatabase, sql: string, params: readonly unknown[]): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      db.all(
        sql,
        [...params],
        (err: Error | null, rows: unknown[]) => {
          if (err) reject(err);
          else resolve(rows ?? []);
        }
      );
    });
  }
}
