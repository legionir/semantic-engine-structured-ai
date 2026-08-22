/**
 * IJobQueue — Unified Interface for Job Queuing in Platform V2.
 */

export interface QueueJobOptions {
  readonly priority?: 'urgent' | 'high' | 'normal' | 'low';
  readonly delayMs?: number;
  readonly maxRetries?: number;
}

export interface QueuedJob<TData = unknown> {
  readonly id: string;
  readonly type: string;
  readonly projectId: string;
  readonly data: TData;
  readonly priority: 'urgent' | 'high' | 'normal' | 'low';
  readonly createdAt: number;
  readonly status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';
  readonly progress: number;
}

export interface IJobQueue {
  enqueue<TData>(
    projectId: string,
    type: string,
    data: TData,
    options?: QueueJobOptions
  ): Promise<QueuedJob<TData>>;

  getJob(id: string): Promise<QueuedJob | null>;
  cancelJob(id: string): Promise<boolean>;
  getPendingCount(): Promise<number>;
  clear(): Promise<void>;
}
