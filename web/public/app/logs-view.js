/*
|--------------------------------------------------------------------------
| Logs view
|--------------------------------------------------------------------------
|
| The application log: failed AI requests (status, endpoint, model and the
| response body), retries, run / tool / hook / MCP failures, server errors
| and crashes. Filters are a minimum level, a source and free text; each
| row expands to its details. Drawn from state.logs only.
|--------------------------------------------------------------------------
*/

import { html } from "./dom.js";
import { formatStamp } from "./operator-api.js";
import { SkeletonRows } from "./skeleton-view.js";


export const LOG_LEVELS = Object.freeze(["debug", "info", "warn", "error"]);

const RANK = { debug: 0, info: 1, warn: 2, error: 3 };


export function createLogsState() {

    return {
        entries: [],
        summary: null,
        level: "info",
        source: "",
        text: "",
        expanded: new Set(),
        live: false,
        loading: false,
        error: null,
        unseenErrors: 0,
        seenId: 0,
        badgePrimed: false,
        follow: true
    };
}


/* the entries the current filters show, newest first */
export function visibleEntries(logs) {

    const minimum = RANK[logs.level] ?? 0;
    const text = logs.text.trim().toLowerCase();

    return logs.entries
        .filter(entry =>
            (RANK[entry.level] ?? 0) >= minimum &&
            (!logs.source || entry.source === logs.source) &&
            (!text || JSON.stringify(entry).toLowerCase().includes(text)))
        .slice()
        .reverse();
}


export function logsSubtitle(logs) {

    const counts = logs.summary?.counts;

    if (!counts) return logs.live ? "live" : "";

    return `${counts.error} error(s) · ${counts.warn} warning(s) · ${logs.summary.total} entr${logs.summary.total === 1 ? "y" : "ies"}${logs.live ? " · live" : ""}`;
}


function detailText(details) {

    try {
        return JSON.stringify(details, null, 2);
    } catch {
        return String(details);
    }
}


function aiFacts(entry) {

    const details = entry.details || {};
    const facts = [];

    if (details.status) facts.push(`HTTP ${details.status}`);
    if (details.model) facts.push(details.model);
    if (details.provider) facts.push(details.provider);
    if (details.attempt) facts.push(`attempt ${details.attempt}`);
    if (details.duration_ms !== undefined) facts.push(`${details.duration_ms} ms`);

    return facts.join(" · ");
}


function LogRow({ entry, open, actions }) {

    const facts = aiFacts(entry);
    const hasDetails = entry.details && Object.keys(entry.details).length > 0;

    return html`<li class=${`log-entry level-${entry.level}${open ? " open" : ""}`}>
        <button type="button" class="log-entry-head" aria-expanded=${open} onClick=${() => actions.toggle(entry.id)}>
            <span class="log-time">${formatStamp(entry.at)}</span>
            <span class=${`log-level level-${entry.level}`}>${entry.level}</span>
            <span class="log-source">${entry.source}</span>
            <span class="log-message">${entry.message}</span>
            ${facts ? html`<span class="log-facts">${facts}</span>` : null}
        </button>
        ${open ? html`<div class="log-entry-body">
            ${entry.details?.response ? html`<div class="log-response">
                <div class="log-label">Response body</div>
                <pre>${entry.details.response}</pre>
            </div>` : null}
            ${hasDetails ? html`<pre class="log-details">${detailText(entry.details)}</pre>` : html`<p class="muted">No details.</p>`}
            ${entry.run_id ? html`<p class="muted">run ${entry.run_id}</p>` : null}
            <button type="button" class="ghost" onClick=${() => actions.copy(entry)}>Copy entry</button>
        </div>` : null}
    </li>`;
}


export function LogsBody({ logs, actions }) {

    const sources = logs.summary?.sources || [];
    const entries = visibleEntries(logs);

    return html`<div class="logs-workspace">
        <div class="logs-toolbar">
            <label class="logs-filter">
                <span class="label">Level</span>
                <select aria-label="Minimum level" onChange=${event => actions.level(event.currentTarget.value)}>
                    ${LOG_LEVELS.map(level => html`<option value=${level} selected=${logs.level === level}>${level}+</option>`)}
                </select>
            </label>
            <label class="logs-filter">
                <span class="label">Source</span>
                <select aria-label="Source" onChange=${event => actions.source(event.currentTarget.value)}>
                    <option value="" selected=${!logs.source}>all</option>
                    ${sources.map(source => html`<option value=${source} selected=${logs.source === source}>${source}</option>`)}
                </select>
            </label>
            <input
                type="search"
                class="logs-search"
                placeholder="Search messages and details"
                aria-label="Search the log"
                value=${logs.text}
                onInput=${event => actions.text(event.currentTarget.value)}
            />
        </div>
        ${logs.error ? html`<p class="logs-error" role="alert">${logs.error}</p>` : null}
        ${logs.loading && entries.length === 0
            ? html`<${SkeletonRows} count=${6} label="Loading…" />`
            : entries.length === 0
                ? html`<p class="empty">No log entries match these filters.</p>`
                : html`<ul class="log-list">
                    ${entries.map(entry => html`<${LogRow} key=${entry.id} entry=${entry} open=${logs.expanded.has(entry.id)} actions=${actions} />`)}
                </ul>`}
        ${logs.summary?.file ? html`<p class="muted logs-file">Log file: ${logs.summary.file}</p>` : null}
    </div>`;
}
