/**
 * InMemoryQueueAdapter — Default in-memory implementation of IJobQueue with priority support.
 */

import * as crypto from 'crypto';
import { IJobQueue, QueuedJob, QueueJobOptions } from './IJobQueue';

const PRIORITY_SCORES: Record<string, number> = {
  urgent: 100,
  high: 50,
  normal: 10,
  low: 1,
};

export class InMemoryQueueAdapter implements IJobQueue {
  private readonly jobs = new Map<string, QueuedJob>();

  async enqueue<TData>(
    projectId: string,
    type: string,
    data: TData,
    options?: QueueJobOptions
  ): Promise<QueuedJob<TData>> {
    const id = `qjob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const priority = options?.priority || 'normal';

    const job: QueuedJob<TData> = {
      id,
      type,
      projectId,
      data,
      priority,
      createdAt: Date.now(),
      status: 'queued',
      progress: 0,
    };

    this.jobs.set(id, job as QueuedJob<unknown>);
    return job;
  }

  async getJob(id: string): Promise<QueuedJob | null> {
    return this.jobs.get(id) || null;
  }

  async cancelJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'failed') return false;

    this.jobs.set(id, { ...job, status: 'cancelled' });
    return true;
  }

  async getPendingCount(): Promise<number> {
    let count = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'queued') count++;
    }
    return count;
  }

  async getNextJob(): Promise<QueuedJob | null> {
    const candidates = Array.from(this.jobs.values()).filter(j => j.status === 'queued');
    if (candidates.length === 0) return null;

    // Sort by priority descending, then createdAt ascending
    candidates.sort((a, b) => {
      const scoreA = PRIORITY_SCORES[a.priority] || 10;
      const scoreB = PRIORITY_SCORES[b.priority] || 10;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.createdAt - b.createdAt;
    });

    const next = candidates[0]!;
    const active: QueuedJob = { ...next, status: 'active' };
    this.jobs.set(next.id, active);
    return active;
  }

  async updateProgress(id: string, progress: number): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      this.jobs.set(id, { ...job, progress });
    }
  }

  async markComplete(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      this.jobs.set(id, { ...job, status: 'completed', progress: 100 });
    }
  }

  async markFailed(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      this.jobs.set(id, { ...job, status: 'failed' });
    }
  }

  async clear(): Promise<void> {
    this.jobs.clear();
  }
}
