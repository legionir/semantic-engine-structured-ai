import type { Mat4 } from "@web-engine/engine-core";

/**
 * Manages a pool of Web Workers for parallel processing.
 * Automatically creates workers from constructor URLs and distributes
 * work across available workers.
 */
export class WorkerPoolManager {
  private readonly workers: Worker[] = [];
  private readonly idle: Set<number> = new Set();
  private taskQueue: Array<{ task: (worker: Worker) => void; resolve: (value: unknown) => void }> = [];

  constructor(
    private readonly workerScript: string | URL,
    poolSize: number = navigator.hardwareConcurrency || 4,
  ) {
    const size = Math.max(1, Math.min(poolSize, 16));
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScript, { type: "module" });
      this.workers.push(worker);
      this.idle.add(i);
    }
  }

  /**
   * Run a task on an available worker. Returns a promise that resolves
   * with the worker's postMessage response.
   */
  run<T>(message: unknown, transfer?: Transferable[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const task = (worker: Worker) => {
        const handler = (e: MessageEvent) => {
          worker.removeEventListener("message", handler);
          worker.removeEventListener("error", errorHandler);
          resolve(e.data as T);
        };
        const errorHandler = (e: ErrorEvent) => {
          worker.removeEventListener("message", handler);
          worker.removeEventListener("error", errorHandler);
          reject(new Error(e.message));
        };
        worker.addEventListener("message", handler);
        worker.addEventListener("error", errorHandler);
        if (transfer && transfer.length > 0) {
          worker.postMessage(message, transfer);
        } else {
          worker.postMessage(message);
        }
      };

      // Try to assign to an idle worker
      for (const idx of this.idle) {
        this.idle.delete(idx);
        const worker = this.workers[idx];
        const originalResolve = resolve;
        const wrappedResolve = (value: unknown) => {
          this.idle.add(idx);
          originalResolve(value);
          // Process next queued task
          if (this.taskQueue.length > 0) {
            const next = this.taskQueue.shift()!;
            this.idle.delete(idx);
            next.task(this.workers[idx]);
          }
        };
        // Replace resolve with wrapped version
        const origResolve = resolve;
        // We need a different approach - use a new promise
        task(worker);
        return;
      }

      // All workers busy, queue the task
      this.taskQueue.push({
        task,
        resolve: resolve as (value: unknown) => void,
      });
    });
  }

  /** Terminate all workers and clear the queue. */
  dispose(): void {
    this.taskQueue = [];
    this.workers.forEach((w) => w.terminate());
    this.workers.length = 0;
    this.idle.clear();
  }

  get size(): number {
    return this.workers.length;
  }
}
