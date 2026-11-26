/*
| Presentation formatters shared by the views. Pure functions of their
| arguments: no DOM, no state.
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
                : status === "exit" || status === "warned"
                    ? "!"
                    : "✓";
}


export const SHAPE_LABEL = Object.freeze({
    single: "single call",
    parallel: "parallel",
    sequential: "sequential",
    graph: "dependency graph"
});


export const WHO = Object.freeze({
    user: "you",
    assistant: "agent"
});


/* wall-clock time of an event, the way every panel has always shown it */
export function clock(at) {

    return new Date(at).toLocaleTimeString("en-GB", { hour12: false });
}


export function plural(count, word) {

    return `${count} ${word}${count === 1 ? "" : "s"}`;
}


export function describeSession(session) {

    return `${session.turns || 0} turn${
        (session.turns || 0) === 1 ? "" : "s"
    } · ${session.events || 0} events · ${
        new Date(session.updated_at).toLocaleString("en-GB", {
            hour12: false
        })
    }`;
}


/* one line of a turn's execution block */
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


/*
| Counts calls by id, not lifecycle events: a tool has a start and an end
| but is still one call, and a result that arrives without its start after
| a reconnect still counts once.
*/
export function turnSummaryText(events) {

    const calls = new Map();

    for (const event of events) {

        if (event.type !== "tool:start" && event.type !== "tool:end") {
            continue;
        }

        const id =
            event.id || `${event.name || "tool"}-${calls.size + 1}`;

        const call = calls.get(id) || { success: null };

        if (event.type === "tool:end") {
            call.success = event.success === true;
        }

        calls.set(id, call);
    }

    const values = [...calls.values()];
    const success = values.filter(call => call.success === true).length;
    const fail = values.filter(call => call.success === false).length;
    const retried = events.filter(event => event.type === "run:malformed").length;

    return (
        `execution · ${calls.size} tool call(s) · ${success} success · ` +
        `${fail} fail · ${retried} retried`
    );
}
