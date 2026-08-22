/**
 * GitHistoryMiner — Mines Git history to calculate Churn Rate, Co-Churn Matrix, and Hotspot Matrix.
 */

export interface FileChurnStats {
  readonly filePath: string;
  readonly commitsCount: number;
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly churnScore: number;
  readonly complexity: number;
  readonly hotspotScore: number; // Churn * Complexity
}

export interface CoChurnItem {
  readonly targetFile: string;
  readonly coOccurrenceCount: number;
  readonly confidence: number; // 0 - 1
}

export class GitHistoryMiner {
  private readonly fileStats = new Map<string, FileChurnStats>();
  private readonly coChurn = new Map<string, Map<string, number>>();

  recordCommit(filesChanged: readonly string[], linesDiff?: Record<string, { added: number; deleted: number }>): void {
    // Record individual file churn
    for (const f of filesChanged) {
      const existing = this.fileStats.get(f) || {
        filePath: f,
        commitsCount: 0,
        linesAdded: 0,
        linesDeleted: 0,
        churnScore: 0,
        complexity: Math.max(1, f.split('/').length * 2),
        hotspotScore: 0,
      };

      const diff = linesDiff?.[f] || { added: 10, deleted: 5 };
      const commitsCount = existing.commitsCount + 1;
      const linesAdded = existing.linesAdded + diff.added;
      const linesDeleted = existing.linesDeleted + diff.deleted;
      const churnScore = commitsCount * 5 + (linesAdded + linesDeleted);
      const hotspotScore = Math.round(churnScore * existing.complexity);

      this.fileStats.set(f, {
        filePath: f,
        commitsCount,
        linesAdded,
        linesDeleted,
        churnScore,
        complexity: existing.complexity,
        hotspotScore,
      });
    }

    // Record co-churn pair frequencies
    for (let i = 0; i < filesChanged.length; i++) {
      for (let j = i + 1; j < filesChanged.length; j++) {
        const f1 = filesChanged[i]!;
        const f2 = filesChanged[j]!;

        this.addCoChurnPair(f1, f2);
        this.addCoChurnPair(f2, f1);
      }
    }
  }

  private addCoChurnPair(f1: string, f2: string): void {
    if (!this.coChurn.has(f1)) {
      this.coChurn.set(f1, new Map());
    }
    const map = this.coChurn.get(f1)!;
    map.set(f2, (map.get(f2) || 0) + 1);
  }

  getHotspots(limit: number = 10): FileChurnStats[] {
    const list = Array.from(this.fileStats.values());
    list.sort((a, b) => b.hotspotScore - a.hotspotScore);
    return list.slice(0, limit);
  }

  getCoChurn(filePath: string, limit: number = 5): CoChurnItem[] {
    const map = this.coChurn.get(filePath);
    if (!map) return [];

    const fileStat = this.fileStats.get(filePath);
    const totalCommits = fileStat ? fileStat.commitsCount : 1;

    const list: CoChurnItem[] = [];
    for (const [targetFile, count] of map.entries()) {
      list.push({
        targetFile,
        coOccurrenceCount: count,
        confidence: Math.min(1, Math.round((count / totalCommits) * 100) / 100),
      });
    }

    list.sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount);
    return list.slice(0, limit);
  }
}
