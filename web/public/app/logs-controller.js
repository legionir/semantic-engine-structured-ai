/*
|--------------------------------------------------------------------------
| Logs
|--------------------------------------------------------------------------
|
| Opens the application log in a modal and keeps it live over
| /api/logs/stream while it is open. The header's Logs button carries a
| badge with the errors recorded since the operator last looked (checked
| every 20 s while the page is visible). Errors of the console itself
| (uncaught exceptions, rejected promises) are reported to the same log.
*/

import { state, touch } from "./store.js";
import { bind, mountInModal } from "./dom.js";
import { el } from "./console-core.js";
import { createLogsState, LogsBody, logsSubtitle } from "./logs-view.js";
import { apiRequest, query } from "./operator-api.js";


let stream = null;
let badgeTimer = null;
let badgeDisabled = false;


function logs() {

    if (!state.logs) state.logs = createLogsState();

    return state.logs;
}


function maxId(entries) {
    return entries.length ? entries[entries.length - 1].id : 0;
}


function addEntries(incoming) {

    const target = logs();
    const known = maxId(target.entries);
    const fresh = incoming.filter(entry => entry.id > known);

    if (fresh.length === 0) return;

    /* the server's ring size bounds the list here too */
    target.entries = target.entries.concat(fresh).slice(-(target.summary?.capacity || 2000));

    if (target.summary) {
        for (const entry of fresh) {
            target.summary.counts[entry.level] = (target.summary.counts[entry.level] || 0) + 1;
            target.summary.total++;
            target.summary.last_id = Math.max(target.summary.last_id || 0, entry.id);
            if (!target.summary.sources.includes(entry.source)) {
                target.summary.sources = [...target.summary.sources, entry.source].sort();
            }
        }
    }
}


export async function refreshLogs(incremental = false) {

    const target = logs();
    target.loading = !incremental;
    touch("logs");

    const after = incremental ? maxId(target.entries) : 0;
    const result = await apiRequest(`/api/logs${query({ after: after || undefined })}`);

    target.loading = false;

    if (!result.ok) {
        target.error = result.error;
        touch("logs");
        return false;
    }

    target.error = null;
    if (!incremental) target.entries = [];
    addEntries(result.payload.entries || []);
    target.summary = result.payload.summary || target.summary;
    markSeen();
    state.logsModal?.setSubtitle(logsSubtitle(target));
    touch("logs");

    return true;
}


function markSeen() {

    const target = logs();

    if (!state.logsModal) return;

    target.seenId = Math.max(target.seenId, target.summary?.last_id || maxId(target.entries));
    target.unseenErrors = 0;
}


function openStream() {

    closeStream();

    if (typeof EventSource === "undefined") return;

    const target = logs();
    let first = true;

    stream = new EventSource("/api/logs/stream");

    stream.onmessage = message => {

        let data;
        try {
            data = JSON.parse(message.data);
        } catch {
            return;
        }

        if (data.type === "snapshot") {
            target.live = true;
            /* a reconnect: fetch what arrived while the stream was down */
            if (!first) refreshLogs(true);
            first = false;
        } else if (data.type === "entry" && data.entry) {
            addEntries([data.entry]);
            markSeen();
        } else if (data.type === "cleared") {
            target.entries = [];
            target.expanded.clear();
            target.summary = data.summary || target.summary;
        }

        state.logsModal?.setSubtitle(logsSubtitle(target));
        touch("logs");
    };

    stream.onerror = () => {
        target.live = false;
        touch("logs");
    };
}


function closeStream() {

    if (stream) {
        stream.close();
        stream = null;
    }

    if (state.logs) state.logs.live = false;
}


const actions = {

    level(value) {
        logs().level = value;
        touch("logs");
    },

    source(value) {
        logs().source = value;
        touch("logs");
    },

    text(value) {
        logs().text = String(value ?? "");
        touch("logs");
    },

    toggle(id) {
        const expanded = logs().expanded;
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        touch("logs");
    },

    refresh() {
        return refreshLogs(false);
    },

    async clear() {
        if (typeof window !== "undefined" && typeof window.confirm === "function" &&
            !window.confirm("Clear the application log? The current log file is rotated, not deleted.")) {
            return;
        }
        const result = await apiRequest("/api/logs", { method: "DELETE" });
        const target = logs();
        if (!result.ok) {
            target.error = result.error;
        } else {
            target.entries = [];
            target.expanded.clear();
            target.summary = result.payload.summary || target.summary;
            target.error = null;
        }
        touch("logs");
    },

    copy(entry) {
        const text = JSON.stringify(entry, null, 2);
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
        }
    }
};


export async function openLogs() {

    if (state.logsModal && state.logsModal.isOpen()) return state.logsModal;

    state.logsModal = null;

    const target = logs();
    let dispose = () => {};

    const handle = Modal.open({
        title: "Logs",
        subtitle: logsSubtitle(target),
        size: "large",
        className: "logs-modal",
        onClose: () => {
            dispose();
            closeStream();
            state.logsModal = null;
        }
    });

    state.logsModal = handle;
    dispose = mountInModal(handle, () => LogsBody({ logs: state.logs, actions }), ["logs"]);

    await refreshLogs(false);
    if (state.logsModal === handle) openStream();

    return handle;
}


async function pollBadge() {

    if (badgeDisabled || state.logsModal) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const target = logs();
    const result = await apiRequest(`/api/logs${query({ level: "error", after: target.seenId || undefined, limit: 100 })}`);

    if (!result.ok) {
        /* a scoped token cannot read the log: no badge for it */
        if (result.status === 401 || result.status === 403) stopLogBadge(true);
        return;
    }

    const lastId = result.payload.summary?.last_id || 0;

    if (!target.badgePrimed) {
        /* the first check only learns where "now" is */
        target.badgePrimed = true;
        target.seenId = Math.max(target.seenId, lastId);
        target.unseenErrors = 0;
    } else if (lastId < target.seenId) {
        /* the server restarted and numbers its entries from 1 again */
        target.seenId = 0;
    } else {
        target.unseenErrors = (result.payload.entries || []).length;
    }

    touch("logs");
}


export function startLogBadge() {

    bind(["logs"], () => {
        const badge = el("logsBadge");
        const count = state.logs?.unseenErrors || 0;
        if (!badge) return;
        badge.hidden = count === 0;
        badge.textContent = count > 99 ? "99+" : String(count);
    });

    pollBadge();
    badgeTimer = setInterval(pollBadge, state.logBadgePollMs);
}


export function stopLogBadge(disable = false) {

    if (badgeTimer) clearInterval(badgeTimer);
    badgeTimer = null;
    if (disable) badgeDisabled = true;
}


/* Console errors go to the same log, at most ten a minute, without repeats. */
export function installPanelErrorReporting(target = typeof window !== "undefined" ? window : null) {

    if (!target || typeof target.addEventListener !== "function") return () => {};

    const recent = new Map();

    const report = (message, details) => {
        const text = String(message || "Unknown console error").slice(0, 2000);
        const now = Date.now();
        for (const [key, at] of recent) if (now - at > 60_000) recent.delete(key);
        if (recent.has(text) || recent.size >= 10) return;
        recent.set(text, now);
        apiRequest("/api/logs", { json: { level: "error", message: `Console: ${text}`, details } });
    };

    /* "Script error." is all a browser reveals about a cross-origin
       script (usually an extension) — nothing the log could act on */
    const onError = event => !event.filename && !event.error && /^Script error\.?$/.test(event.message || "") ? undefined : report(event.message, {
        file: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack ? String(event.error.stack).slice(0, 4000) : undefined
    });

    const onRejection = event => {
        const reason = event.reason;
        report(reason?.message || String(reason), {
            stack: reason?.stack ? String(reason.stack).slice(0, 4000) : undefined
        });
    };

    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);

    return () => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
    };
}


/* tests drive the badge without waiting for its timer */
export const logsInternals = { pollBadge };
