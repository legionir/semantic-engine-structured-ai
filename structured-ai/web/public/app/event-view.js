/*
|--------------------------------------------------------------------------
| Console event-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The event log: one row per event, the type list built from the rows that exist,
| and the two filters that combine.
|
| `logTypesPresent` is derived, never configured, which is why clearing the log
| rebuilds it — a filter offering a type with no rows left looks broken even when
| nothing is.
|--------------------------------------------------------------------------
*/

import { el, node } from "./dom.js";
import { shorten } from "./formatters.js";
import { openCallDetail } from "./execution-view.js";
import { eventState, executionState } from "./store.js";

export function describeEvent(event) {

    switch (event.type) {

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

export function log(event) {

    const list = el("log");

    /*
    | log() runs for every message on the stream. If the list is missing
    | the event is dropped rather than thrown away with an exception,
    | because throwing here would break the handler for every event that
    | follows, not just this one.
    */

    if (!list) {
        return;
    }

    const item = node("li");

    if (
        event.type.includes("error") ||
        event.success === false ||
        (event.type === "hook:end" && event.status === "failed") ||
        event.decision === "deny"
    ) {
        item.className = "bad";
    } else if (
        event.type === "report:mismatch" ||
        event.type === "run:delegation_hint" ||
        event.type === "run:loop" ||
        event.type === "run:wrapup" ||
        event.type === "run:deadline" ||
        event.type === "run:malformed" ||
        event.type === "response:repaired" ||
        event.type.startsWith("approval") ||
        event.decision === "require_approval"
    ) {
        item.className = "warn";
    }

    const time =
        new Date(event.at || Date.now())
            .toLocaleTimeString("en-GB", { hour12: false });

    item.append(
        node("span", "t", time),
        node("span", "k", event.type),
        node("span", "v", describeEvent(event))
    );

    if (event.call_key) {

        item.classList.add("clickable");

        item.addEventListener("click", () => {

            const call =
                executionState.calls.get(event.call_key);

            if (call) {
                openCallDetail(call, executionState.graphs.get(call.graph_id));
            }
        });
    }

    item.dataset.text =
        `${event.type} ${item.textContent}`.toLowerCase();

    item.dataset.type = event.type;

    /*
    | Judged by the same predicate the filter uses, so a row arriving
    | while a filter is on cannot disagree with the rows already there.
    */

    item.hidden = !matchesLogFilter(item);

    list.appendChild(item);

    while (list.children.length > 400) {
        list.removeChild(list.firstChild);
    }

    list.scrollTop = list.scrollHeight;

    /*
    | Only the type list and the count need refreshing here; every other
    | row was judged when it arrived.
    */

    refreshLogTypes();

    updateLogCount();
}

export function updateLogCount() {

    const count = el("logCount");

    const list = el("log");

    if (!count || !list) {
        return;
    }

    const total = list.children.length;

    if (eventState.logFilter === "" && !eventState.logType) {

        count.textContent = `${total} event${total === 1 ? "" : "s"}`;
        count.hidden = total === 0;

        return;
    }

    let shown = 0;

    for (const item of list.children) {
        shown += item.hidden ? 0 : 1;
    }

    count.textContent = `${shown} of ${total}`;
    count.hidden = total === 0;
}

/*
| Two filters over the same list, and a row survives only if it passes
| both: the text box matches any part of a word anywhere in the row, and
| the dropdown narrows to one kind of event.
|
| The types offered are the ones actually present, so the list never
| offers a choice that would empty the panel, and it is rebuilt as new
| kinds arrive. A type that is selected and then disappears is kept in
| the list rather than silently switching the operator back to "all".
*/

export function logTypesPresent() {

    const list = el("log");

    if (!list) {
        return [];
    }

    const types = new Set();

    for (const item of list.children) {

        if (item.dataset.type) {
            types.add(item.dataset.type);
        }
    }

    if (eventState.logType) {
        types.add(eventState.logType);
    }

    return [...types].sort();
}

export function refreshLogTypes() {

    const select = el("logType");

    if (!select) {
        return;
    }

    const types = logTypesPresent();

    const signature = types.join("|");

    if (select.dataset.signature === signature) {
        return;
    }

    select.dataset.signature = signature;

    select.innerHTML = "";

    const all = node("option", null, "all types");

    all.value = "";

    select.appendChild(all);

    for (const type of types) {

        const option = node("option", null, type);

        option.value = type;

        select.appendChild(option);
    }

    select.value = eventState.logType || "";
}

export function matchesLogFilter(item) {

    if (
        eventState.logType &&
        item.dataset.type !== eventState.logType
    ) {
        return false;
    }

    if (eventState.logFilter === "") {
        return true;
    }

    return (item.dataset.text || "").includes(eventState.logFilter);
}

export function applyLogFilter() {

    const list = el("log");

    if (!list) {
        return;
    }

    refreshLogTypes();

    let shown = 0;

    for (const item of list.children) {

        const matched = matchesLogFilter(item);

        item.hidden = !matched;

        shown += matched ? 1 : 0;
    }

    const count = el("logCount");

    if (count) {

        const total = list.children.length;

        count.textContent =
            eventState.logFilter === "" && !eventState.logType
                ? `${total} event${total === 1 ? "" : "s"}`
                : `${shown} of ${total}`;

        count.hidden = total === 0;
    }

    return shown;
}
