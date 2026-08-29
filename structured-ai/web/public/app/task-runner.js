/* Task submission boundary — EXECUTION_PLAN Phase 24. */

import * as api from "./api.js";

export class TaskRunner {
  constructor({ store, onError } = {}) {
    this.store = store;
    this.onError = onError || (() => {});
    this.queue = [];
    this.running = false;
  }

  async submit(task, { projectId = null } = {}) {
    try {
      const result = await api.postTask(task, projectId);
      return result;
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  enqueue(task, projectIds) {
    this.queue.push(...projectIds.map(projectId => ({ task, projectId })));
    return this.drain();
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift();
        await this.submit(item.task, { projectId: item.projectId });
      }
    } finally {
      this.running = false;
    }
  }
}
