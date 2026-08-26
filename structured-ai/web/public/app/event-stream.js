/* SSE lifecycle — EXECUTION_PLAN Phase 24. */

export function eventsUrl(projectId) {
  return projectId
    ? `/api/events?projectId=${encodeURIComponent(projectId)}`
    : "/api/events";
}


export class EventStream {
  constructor({ onEvent, onSnapshot, onError } = {}) {
    this.source = null;
    this.onEvent = onEvent || (() => {});
    this.onSnapshot = onSnapshot || (() => {});
    this.onError = onError || (() => {});
  }

  connect(projectId) {
    this.close();
    this.source = new EventSource(eventsUrl(projectId));
    this.source.onmessage = message => {
      const payload = JSON.parse(message.data);
      if (payload.type === "snapshot") this.onSnapshot(payload.snapshot || {});
      else this.onEvent(payload);
    };
    this.source.onerror = error => this.onError(error);
    return this.source;
  }

  close() {
    if (this.source && typeof this.source.close === "function") {
      this.source.close();
    }
    this.source = null;
  }
}
