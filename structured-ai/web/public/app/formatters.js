/*
|--------------------------------------------------------------------------
| Console formatters (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| Text the console prints: shortening with an ellipsis, the icons, and the
| labels that turn a runtime object into one line.
|
| No DOM and no state in here, which is what lets a render test call them directly
| instead of booting a page.
|--------------------------------------------------------------------------
*/

export function shorten(value, max = 90) {

    const text =
        typeof value === "string"
            ? value
            : JSON.stringify(value ?? "");

    return text.length > max
        ? `${text.slice(0, max)}…`
        : text;
}

export function singleLine(value, max = 90) {

    const text =
        String(value || "")
            .replace(/\s+/g, " ")
            .trim();

    return text.length > max
        ? `${text.slice(0, max)}…`
        : text || "Untitled task";
}

export const SHAPE_LABEL = {
    single: "single call",
    parallel: "parallel",
    sequential: "sequential",
    graph: "dependency graph"
};

export function statusIcon(status) {

    return status === "running"
        ? "◌"
        : status === "failed"
            ? "✕"
            : status === "skipped"
                ? "–"
                : status === "exit" || status === "warned"
                ? "!"
                : "✓";
}

export const WHO = {
    user: "you",
    assistant: "agent"
};

export function eventLabel(event) {

    switch (event.type) {

        case "agent:iteration":
            return `iter ${event.iteration} · ${event.agent || event.scope}`;

        case "agent:action":
            return `action: ${event.action}`;

        case "tool:start":
            return event.id ? `start (${event.id})` : "start";

        case "tool:end":
            return event.success === false
                ? (event.error ? String(event.error).slice(0, 60) : "failed")
                : "done";

        case "run:malformed":
            return `retry: ${String(event.reason || "").slice(0, 60)}`;

        default:
            return event.type;
    }
}
