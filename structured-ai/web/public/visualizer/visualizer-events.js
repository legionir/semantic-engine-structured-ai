/* Visualizer DOM event binding — EXECUTION_PLAN Phase 25. */

export function bindVisualizerEvents({ document, window, elements, callbacks } = {}) {
  const doc = document || globalThis.document;
  const win = window || globalThis.window;
  if (!doc) return () => {};
  const cleanups = [];
  const listen = (element, event, handler, options) => {
    if (!element) return;
    element.addEventListener(event, handler, options);
    cleanups.push(() => element.removeEventListener(event, handler, options));
  };

  doc.querySelectorAll?.(".view-tab").forEach(tab => listen(tab, "click", () => callbacks.onView?.(tab.dataset.view)));
  listen(elements.focusDepth, "change", event => callbacks.onDepth?.(event.target.value));
  listen(elements.resolvedOnly, "change", event => callbacks.onResolvedOnly?.(event.target.checked));
  listen(elements.fit, "click", () => callbacks.onFit?.());
  listen(elements.reset, "click", () => callbacks.onReset?.());
  listen(elements.close, "click", () => callbacks.onReset?.());
  listen(elements.search, "input", event => callbacks.onSearch?.(event.target.value));
  listen(elements.explore, "click", () => callbacks.onExplore?.());
  listen(elements.impact, "click", () => callbacks.onImpact?.());
  listen(elements.container, "mousedown", callbacks.onMouseDown);
  listen(win, "mousemove", callbacks.onMouseMove);
  listen(win, "mouseup", callbacks.onMouseUp);
  listen(elements.container, "wheel", callbacks.onWheel, { passive: false });

  return () => cleanups.splice(0).forEach(cleanup => cleanup());
}
