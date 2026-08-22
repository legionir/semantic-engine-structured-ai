/**
 * GetRecentChangesTool — تاریخچه‌ی git اخیر برای فایل‌ها یا کل پروژه.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { GitClient } from '../../core/git/GitClient';

export interface GetRecentChangesInput extends AiToolInput {
  readonly workspaceRoot: string;
  readonly path?: string;
  readonly limit?: number;
  readonly since?: string; // ISO date
}

export class GetRecentChangesTool implements AiTool<GetRecentChangesInput> {
  readonly name = 'get_recent_changes';
  readonly description = 'Get recent git commit history for a file or the whole project.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      workspaceRoot: { type: 'string', description: 'Workspace root path' },
      path: { type: 'string', description: 'Optional relative file path' },
      limit: { type: 'integer', default: 10 },
      since: { type: 'string', description: 'ISO date to filter commits from' },
    },
    required: ['workspaceRoot'],
  };

  async execute(input: GetRecentChangesInput): Promise<AiToolOutput> {
    try {
      const git = new GitClient(input.workspaceRoot);
      const limit = input.limit ?? 10;

      let log = input.path
        ? await git.getFileLog(input.path, limit)
        : await git.getLog(limit);

      // Filter by 'since' date if provided (ISO format, e.g. "2026-01-01")
      if (input.since) {
        const sinceDate = new Date(input.since);
        if (!isNaN(sinceDate.getTime())) {
          log = log.filter(entry => {
            const entryDate = new Date(entry.date);
            return !isNaN(entryDate.getTime()) && entryDate >= sinceDate;
          });
        }
      }

      const items = log.map(entry => ({
        id: entry.hash,
        name: entry.message.split('\n')[0] ?? entry.hash,
        kind: 'commit',
        source: entry.author,
        excerpt: `${entry.date} | ${entry.message.split('\n')[0] ?? entry.message}`,
      }));

      return {
        success: true,
        items,
        metadata: { count: items.length, path: input.path, since: input.since },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
      };
    }
  }
}
