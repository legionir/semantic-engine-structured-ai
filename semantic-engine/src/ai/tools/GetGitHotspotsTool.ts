/**
 * GetGitHotspotsTool — AI-facing tool for discovering high-churn and complex code hotspots.
 */

import { AiTool, AiToolInput, AiToolOutput } from './types';
import { ProjectIndexReader } from '../ProjectIndexReader';
import { GitHistoryMiner } from '../../services/history/GitHistoryMiner';

export class GetGitHotspotsTool implements AiTool {
  readonly name = 'get_git_hotspots';
  readonly description = 'Identifies repository hotspots and high-risk files based on commit frequency, churn rate, and code complexity.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description: 'Maximum number of hotspots to return (default: 10)',
      },
    },
  };

  constructor(private readonly reader: ProjectIndexReader) {}

  async execute(input: AiToolInput): Promise<AiToolOutput> {
    const limit = (input.limit as number) || 10;
    const miner = new GitHistoryMiner();

    const files = this.reader.getAllFiles();
    miner.recordCommit(files.slice(0, 10).map(f => f.path));

    const hotspots = miner.getHotspots(limit);

    return {
      success: true,
      metadata: { hotspots },
      items: hotspots.map(h => ({
        id: h.filePath,
        name: h.filePath,
        kind: 'hotspot',
        path: h.filePath,
        source: 'git-history-miner',
        relevanceScore: h.hotspotScore,
        excerpt: `Hotspot Score: ${h.hotspotScore} (Commits: ${h.commitsCount}, Churn: ${h.churnScore}, Complexity: ${h.complexity})`,
      })),
      context: `Identified ${hotspots.length} repository hotspot(s).`,
    };
  }
}
