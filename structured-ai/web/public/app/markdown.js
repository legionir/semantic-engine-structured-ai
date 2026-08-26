/* Safe markdown boundary — EXECUTION_PLAN Phase 24. */

export function safeHref(value) {
  try {
    const url = new URL(String(value || ""), globalThis.location?.href || "https://structured-ai.invalid/");
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.href;
  } catch {
    /* fall through */
  }
  return "#";
}

export function renderMarkdown(element, value) {
  if (!element) return element;
  /* textContent is the safe baseline; the full compatibility renderer still
     owns the richer markdown presentation in app.js. */
  element.textContent = String(value ?? "");
  return element;
}
