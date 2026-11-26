/*
| Events panel: one row per runtime event (newest last, at most
| LIMITS.logRows), a text filter that matches any part of a word in the
| type or the text, and a type filter built from the types present.
|
| Rows that do not match are hidden, not removed, so the count reads
| "N of M" and clearing a filter is instant.
*/

import { html } from "./dom.js";
import { clock, shorten } from "./formatters.js";


/* the text of one row; a malformed event falls back instead of throwing */
export function describeEvent(event) {

    try {
        return describeEventText(event);
    } catch {
        return shorten(event.task || event.message || event.status || event.reason || "", 70);
    }
}


export function rowClass(event) {

    const type = String(event.type || "");

    if (
        type.includes("error") ||
        event.success === false ||
        (type === "hook:end" && event.status === "failed") ||
        event.decision === "deny"
    ) {
        return "bad";
    }

    if (
        type === "report:mismatch" ||
        type === "run:delegation_hint" ||
        type === "run:loop" ||
        type === "run:wrapup" ||
        type === "run:deadline" ||
        type === "run:malformed" ||
        type === "response:repaired" ||
        type.startsWith("approval") ||
        event.decision === "require_approval"
    ) {
        return "warn";
    }

    return "";
}


/* a row as drawn: the time, type and text, and what the filters match on */
export function logRowView(row) {

    const type = String(row.event.type || "");
    const time = clock(row.at);
    const text = describeEvent(row.event);

    return {
        id: row.id,
        event: row.event,
        type,
        time,
        text,
        className: rowClass(row.event),
        haystack: `${type} ${time}${type}${text}`.toLowerCase()
    };
}


export function matchesLogFilter(view, filter, type) {

    if (type && view.type !== type) {
        return false;
    }

    return filter === "" || view.haystack.includes(filter);
}


/* the types offered: the ones present, plus the selected one if it is gone */
export function logTypesPresent(views, selected) {

    const types = new Set(views.map(view => view.type).filter(Boolean));

    if (selected) {
        types.add(selected);
    }

    return [...types].sort();
}


export function logCountText(views, filter, type) {

    const total = views.length;

    if (filter === "" && !type) {
        return `${total} event${total === 1 ? "" : "s"}`;
    }

    const shown = views.filter(view => matchesLogFilter(view, filter, type)).length;

    return `${shown} of ${total}`;
}


/*
| Row views are cached by row id: an event's text and time never change,
| so a long list is described once, not on every render.
*/
const viewCache = new Map();

export function logViews(rows) {

    const views = rows.map(row => {
        let view = viewCache.get(row.id);
        if (!view || view.event !== row.event) {
            view = logRowView(row);
            viewCache.set(row.id, view);
        }
        return view;
    });

    if (viewCache.size > rows.length * 2 + 100) {
        const keep = new Set(rows.map(row => row.id));
        for (const id of viewCache.keys()) if (!keep.has(id)) viewCache.delete(id);
    }

    return views;
}


export function LogRows({ state, onOpenCallKey }) {

    return logViews(state.logRows).map(view => {

        const clickable = Boolean(view.event.call_key);
        const className = [view.className, clickable ? "clickable" : ""].filter(Boolean).join(" ");

        return html`<li
            key=${view.id}
            class=${className || undefined}
            data-text=${view.haystack}
            data-type=${view.type}
            hidden=${!matchesLogFilter(view, state.logFilter, state.logType)}
            onClick=${clickable ? () => onOpenCallKey(view.event.call_key) : undefined}
        >
            <span class="t">${view.time}</span>
            <span class="k">${view.type}</span>
            <span class="v">${view.text}</span>
        </li>`;
    });
}


export function LogTypeOptions({ state }) {

    const types = logTypesPresent(logViews(state.logRows), state.logType);

    return html`
        <option value="" selected=${!state.logType}>all types</option>
        ${types.map(type => html`<option key=${type} value=${type} selected=${type === state.logType}>${type}</option>`)}
    `;
}


/*
| The Events modal: its own controls and list, drawn from the same rows
| and the same filter as the hidden panel, so the two always agree and
| nothing has to be moved between them. The text box is uncontrolled
| (defaultValue) so typing — including an IME composition — is never
| interrupted by a redraw.
*/
export function EventsPanel({ state, onOpenCallKey, onFilter, onType, onClear }) {

    const views = logViews(state.logRows);

    return html`<div class="events-modal-body">
        <div class="log-controls">
            <input
                type="search"
                class="filter log-filter"
                placeholder="filter by any part of a word"
                defaultValue=${state.logFilterText ?? state.logFilter}
                onInput=${event => onFilter(event.currentTarget.value)}
            />
            <select
                class="filter log-type"
                title="show only one kind of event"
                value=${state.logType}
                onChange=${event => onType(event.currentTarget.value)}
            >
                <${LogTypeOptions} state=${state} />
            </select>
            <span class="muted log-count" hidden=${views.length === 0}>${logCountText(views, state.logFilter, state.logType)}</span>
            <button type="button" class="link log-clear" onClick=${onClear}>clear</button>
        </div>
        <ul class="log"><${LogRows} state=${state} onOpenCallKey=${onOpenCallKey} /></ul>
    </div>`;
}


function describeEventText(event) {

    switch (event.type) {

        case "process:output":
            return `${event.process_id || "process"} ${event.stream || "stdout"}: ${shorten(event.text || "", 120)}`;

        case "hook:start":
            return `${event.phase} ${event.id} (${event.hook_type})`;

        case "hook:end":
            return `${event.phase} ${event.id} ${event.status}: ${shorten(event.summary || "", 70)}`;

        case "hook:phase:start":
            return `${event.phase}: ${event.hooks.join(", ")}`;

        case "hook:phase:end":
            return `${event.phase} ${event.stopped ? "stopped" : event.ok ? "ok" : "reported failures"}`;

        case "plan:autoroute:start":
            return `${event.step} → ${event.agent}`;

        case "plan:autoroute:end":
            return `${event.step} ${event.ok ? "done" : "failed"} by ${event.agent}`;

        case "tool:start":
            return `${event.agent} ${event.name} ${shorten(
                event.arguments_preview ?? event.arguments,
                60
            )}`;

        case "tool:end":
            return `${event.name} ${
                event.success
                    ? event.exit_code
                        ? `exit ${event.exit_code}`
                        : event.warning
                            ? "ok, with a warning"
                            : "ok"
                    : "failed"
            } ${event.duration_ms} ms`;

        case "tool:graph":
            return `${event.agent} ${event.shape}, ${
                event.calls.length
            } call(s), ${event.waves.length} wave(s)`;

        case "policy:decision":
            return `${event.tool} ${event.decision}`;

        case "agent:iteration":
            return `${event.agent} iteration ${event.iteration}`;

        case "agent:action":
            return `${event.agent} ${event.action}`;

        case "agent:start":
            return `${event.scope || event.agent}${
                event.parent_scope
                    ? ` from ${event.parent_scope}`
                    : ""
            }`;

        case "delegation:start":
            return `${event.parent} → ${
                event.delegations.map(item => item.agent).join(", ")
            }`;

        case "delegation:graph":
            return `${event.parent} ${event.shape}, ${
                event.delegations.length
            } sub-agent(s)`;

        case "delegation:end":
            return `${event.agent} ${
                event.success
                    ? `ok ${event.duration_ms} ms`
                    : `failed: ${shorten(event.error, 60)}`
            }`;

        case "tool:arguments_ignored":
            return `${event.name} ignored ${event.dropped.join(", ")}`;

        case "skill:loaded":
            return `loaded ${event.skills.join(", ")} (${event.chars} chars)`;

        case "skill:read":
            return `${event.skill}/${event.resource} (${event.chars} chars)`;

        case "run:delegation_hint":
            return `${event.agents_remaining} agents unused, ${
                event.open_steps
            } open steps`;

        case "report:mismatch":
            return `claimed work the runtime did not do: ${
                shorten(event.problems.join("; "), 70)
            }`;

        case "request:start":
            return `${event.agent} → ${event.model}`;

        case "request:end":
            return `${event.agent} ${event.outcome} in ${
                event.duration_ms
            } ms`;

        case "run:loop":
            return `${event.scope || event.agent} ${
                event.outcome
            } ${shorten(event.signature || event.reason || "", 60)}`;

        case "run:malformed":
            return `${event.scope || event.agent} ${event.code} ${
                event.attempt
            }/${event.max_attempts || event.limit} ${shorten(event.reason || "", 60)}`;

        case "response:repaired":
            if (event.repair === "action_envelope") {

                const changes = [
                    (event.moved_fields || []).length
                        ? `moved ${event.moved_fields.join(", ")}`
                        : null,
                    (event.defaulted_fields || []).length
                        ? `defaulted ${event.defaulted_fields.join(", ")}`
                        : null,
                    (event.removed_items || []).length
                        ? `removed ${event.removed_items.join(", ")}`
                        : null,
                    (event.argument_repairs || []).length
                        ? "cleaned linked path arguments"
                        : null
                ].filter(Boolean);

                return `action envelope repaired: ${changes.join("; ")}`;
            }

            if (event.repair === "markdown_path") {
                return `${event.tool} cleaned Markdown links in ${
                    (event.repaired_fields || []).join(", ")
                }`;
            }

            return `${event.tool} arguments repaired${
                (event.dropped || []).length
                    ? `, dropped ${event.dropped.join(", ")}`
                    : ""
            }`;

        case "context:compacted":
            return `${event.before} → ${event.after} chars`;

        case "context:memory":
            return `${event.folded_exchanges} exchanges folded with ${
                event.summary_calls ?? event.chunks ?? 0
            }/${event.chunks || 0} summary calls${
                event.skipped_chunks
                    ? `, ${event.skipped_chunks} archive-only`
                    : ""
            }, ${event.archived || 0} newly archived`;

        case "agent:thinking":
            return `${event.scope || event.agent} ${
                event.chars
            } chars of reasoning`;

        case "agent:response":
            return `${event.scope || event.agent} response${
                event.truncated ? " (preview truncated)" : ""
            }`;

        case "session:message":
            return `${event.message.role} ${event.message.kind}`;

        case "session:switched":
            return `${event.session.title || event.session.id}`;

        case "endpoint:degraded":
            return `${event.role} ${event.model} dropped ${event.dropped}`;

        case "discussion:start":
            return `start · ${event.personas?.length || 0} personas, max ${event.max_rounds} rounds`;

        case "discussion:message":
            return `${event.persona} (round ${event.round})`;

        case "discussion:observer":
            return `observer → ${event.decision} (round ${event.round})`;

        case "discussion:finish":
            return `done in ${event.total_rounds} round(s)`;

        case "discussion:error":
            return event.error;

        case "run:wrapup":
            return `${
                Math.round(event.remaining_ms / 1000)
            }s left of ${
                Math.round(event.max_run_ms / 1000)
            }s, asking for a final answer`;

        case "run:deadline":
            return `budget spent: ${
                event.elapsed_ms
            } ms of ${event.max_run_ms} ms`;

        default:
            return shorten(
                event.task ||
                event.message ||
                event.status ||
                event.reason ||
                "",
                70
            );
    }
}
