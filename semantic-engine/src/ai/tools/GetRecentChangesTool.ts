/**
 * GetRecentChangesTool — تاریخچه‌ی git اخیر برای فایل‌ها یا کل پروژه.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import * as path from 'path';
import { GitClient } from '../../core/git/GitClient';

export interface GetRecentChangesInput extends AiToolInput {
  /** اختیاری: پیش‌فرض ریشهٔ خودِ پروژهٔ ایندکس‌شده است. */
  readonly workspaceRoot?: string;
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
      /*
      | این فیلد قبلاً `required` بود، درحالی‌که خودِ ابزار ریشهٔ پروژه را
      | از رجیستری می‌دانست. نتیجه برای agent: پرس‌وجوی «تغییرات اخیر این
      | پروژه» با خطای اعتبارسنجی رد می‌شد مگر مسیرِ مطلقِ مخزن را از قبل
      | بداند — یعنی یک پارامترِ تنظیماتی به‌جای پرس‌وجو.
      */
      workspaceRoot: { type: 'string', description: 'Git repository root; defaults to the indexed project root' },
      path: { type: 'string', description: 'Optional relative file path' },
      limit: { type: 'integer', default: 10 },
      since: { type: 'string', description: 'ISO date to filter commits from' },
    },
  };

  constructor(private readonly defaultWorkspaceRoot?: string) {}

  async execute(input: GetRecentChangesInput): Promise<AiToolOutput> {
    try {
      /* MCP models commonly answer `workspaceRoot: "."`. Resolve that
         relative to the project selected by the server, not the process
         directory used to launch semantic-engine. */
      const requested = input.workspaceRoot ?? '.';
      const base = this.defaultWorkspaceRoot ?? process.cwd();
      const workspaceRoot = path.isAbsolute(requested)
        ? requested
        : path.resolve(base, requested);
      const git = new GitClient(workspaceRoot);
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
        // کدام ریشه واقعاً خوانده شد، برای agent پنهان نمی‌ماند
        metadata: { count: items.length, workspaceRoot, path: input.path, since: input.since },
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
