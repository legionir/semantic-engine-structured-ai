/** Git history mining keyed by project identity. */

export interface FileChurnStats {
  readonly filePath: string;
  readonly commitsCount: number;
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly churnScore: number;
  readonly complexity: number;
  readonly hotspotScore: number;
}

export interface CoChurnItem {
  readonly targetFile: string;
  readonly coOccurrenceCount: number;
  readonly confidence: number;
}

interface ProjectHistory {
  readonly fileStats: Map<string, FileChurnStats>;
  readonly coChurn: Map<string, Map<string, number>>;
}

const DEFAULT_PROJECT = '__default__';

export class GitHistoryMiner {
  private readonly histories = new Map<string, ProjectHistory>();

  private history(projectId: string): ProjectHistory {
    const existing = this.histories.get(projectId);
    if (existing) return existing;
    const created: ProjectHistory = { fileStats: new Map(), coChurn: new Map() };
    this.histories.set(projectId, created);
    return created;
  }

  /** Backward-compatible overload keeps old non-project callers isolated in a default bucket. */
  recordCommit(filesChanged: readonly string[], linesDiff?: Record<string, { added: number; deleted: number }>): void;
  recordCommit(projectId: string, filesChanged: readonly string[], linesDiff?: Record<string, { added: number; deleted: number }>): void;
  recordCommit(
    projectOrFiles: string | readonly string[],
    filesOrDiff?: readonly string[] | Record<string, { added: number; deleted: number }>,
    maybeDiff?: Record<string, { added: number; deleted: number }>
  ): void {
    const projectId = typeof projectOrFiles === 'string' ? projectOrFiles : DEFAULT_PROJECT;
    const filesChanged = (typeof projectOrFiles === 'string' ? filesOrDiff : projectOrFiles) as readonly string[];
    const linesDiff = (typeof projectOrFiles === 'string' ? maybeDiff : filesOrDiff) as Record<string, { added: number; deleted: number }> | undefined;
    if (!Array.isArray(filesChanged)) throw new Error('filesChanged must be an array');

    const state = this.history(projectId);
    for (const filePath of filesChanged) {
      const existing = state.fileStats.get(filePath) || {
        filePath,
        commitsCount: 0,
        linesAdded: 0,
        linesDeleted: 0,
        churnScore: 0,
        complexity: Math.max(1, filePath.split('/').length * 2),
        hotspotScore: 0,
      };
      const diff = linesDiff?.[filePath] || { added: 10, deleted: 5 };
      const commitsCount = existing.commitsCount + 1;
      const linesAdded = existing.linesAdded + diff.added;
      const linesDeleted = existing.linesDeleted + diff.deleted;
      const churnScore = commitsCount * 5 + (linesAdded + linesDeleted);
      state.fileStats.set(filePath, {
        ...existing,
        commitsCount,
        linesAdded,
        linesDeleted,
        churnScore,
        hotspotScore: Math.round(churnScore * existing.complexity),
      });
    }

    for (let i = 0; i < filesChanged.length; i++) {
      for (let j = i + 1; j < filesChanged.length; j++) {
        this.addCoChurnPair(state, filesChanged[i]!, filesChanged[j]!);
        this.addCoChurnPair(state, filesChanged[j]!, filesChanged[i]!);
      }
    }
  }

  private addCoChurnPair(state: ProjectHistory, first: string, second: string): void {
    const map = state.coChurn.get(first) ?? new Map<string, number>();
    map.set(second, (map.get(second) ?? 0) + 1);
    state.coChurn.set(first, map);
  }

  getHotspots(limit?: number): FileChurnStats[];
  getHotspots(projectId: string, limit?: number): FileChurnStats[];
  getHotspots(projectOrLimit: string | number = DEFAULT_PROJECT, maybeLimit = 10): FileChurnStats[] {
    const projectId = typeof projectOrLimit === 'string' ? projectOrLimit : DEFAULT_PROJECT;
    const limit = typeof projectOrLimit === 'number' ? projectOrLimit : maybeLimit;
    const state = this.histories.get(projectId);
    if (!state) return [];
    return Array.from(state.fileStats.values())
      .sort((a, b) => b.hotspotScore - a.hotspotScore)
      .slice(0, limit);
  }

  getCoChurn(filePath: string, limit?: number): CoChurnItem[];
  getCoChurn(projectId: string, filePath: string, limit?: number): CoChurnItem[];
  getCoChurn(projectOrFile: string, fileOrLimit?: string | number, maybeLimit = 5): CoChurnItem[] {
    const projectId = typeof fileOrLimit === 'string' ? projectOrFile : DEFAULT_PROJECT;
    const filePath = typeof fileOrLimit === 'string' ? fileOrLimit : projectOrFile;
    const limit = typeof fileOrLimit === 'number' ? fileOrLimit : maybeLimit;
    const state = this.histories.get(projectId);
    const map = state?.coChurn.get(filePath);
    if (!map) return [];

    const totalCommits = state?.fileStats.get(filePath)?.commitsCount ?? 1;
    return Array.from(map.entries())
      .map(([targetFile, count]) => ({
        targetFile,
        coOccurrenceCount: count,
        confidence: Math.min(1, Math.round((count / totalCommits) * 100) / 100),
      }))
      .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount)
      .slice(0, limit);
  }

  clearProject(projectId: string): void {
    this.histories.delete(projectId);
  }
}
