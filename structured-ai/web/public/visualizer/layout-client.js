/* Worker-backed graph layout with deterministic fallback — Phase 25. */

import { applyPositions, layoutGrid } from "./graph-model.js";

export class LayoutClient {
  constructor({ WorkerClass = globalThis.Worker, workerUrl = "/workers/layout.worker.js" } = {}) {
    this.WorkerClass = WorkerClass;
    this.workerUrl = workerUrl;
    this.worker = null;
    this.sequence = 0;
  }

  fallback(nodes, options) {
    return applyPositions(nodes, layoutGrid(nodes, options));
  }

  layout(nodes, edges, options = {}) {
    if (typeof this.WorkerClass !== "function") {
      return Promise.resolve(this.fallback(nodes, options));
    }

    const requestId = ++this.sequence;
    return new Promise(resolve => {
      let worker;
      try {
        worker = new this.WorkerClass(this.workerUrl);
      } catch {
        resolve(this.fallback(nodes, options));
        return;
      }
      this.worker = worker;
      const finish = positions => {
        if (this.worker === worker) this.worker = null;
        worker.terminate?.();
        resolve(applyPositions(nodes, positions));
      };
      worker.onmessage = event => {
        if (event.data?.requestId && event.data.requestId !== requestId) return;
        finish(event.data?.positions || {});
      };
      worker.onerror = () => finish(layoutGrid(nodes, options));
      worker.postMessage({ nodes, edges, options, requestId });
    });
  }

  dispose() {
    this.worker?.terminate?.();
    this.worker = null;
  }
}
