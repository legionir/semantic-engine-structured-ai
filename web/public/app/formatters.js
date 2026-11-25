/* Shared presentation formatters — EXECUTION_PLAN Phase 24. */

export function shorten(value, max = 90) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function singleLine(value, max = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text || "Untitled task";
}

export function formatDuration(ms) {
  const value = Number(ms) || 0;
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

export function statusIcon(status) {
  return status === "running"
    ? "◌"
    : status === "failed"
      ? "✕"
      : status === "skipped"
        ? "–"
        : "✓";
}
