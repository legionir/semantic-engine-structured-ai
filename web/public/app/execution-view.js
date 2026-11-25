/*
| Execution card: the agent tree of the current run, the accordion of
| archived runs, and the full detail of one call.
*/

import { html, mountInModal } from "./dom.js";
import { shorten, singleLine, statusIcon, SHAPE_LABEL } from "./formatters.js";
import { ranAlongside } from "./execution-model.js";


function loopText(loop) {

    const head =
        loop.outcome === "malformed" || loop.outcome === "malformed_stopped"
            ? `⚠ unreadable answer ×${loop.repeats}`
            : loop.outcome === "stalled"
                ? "↻ no progress"
                : `↻ repeated failure ×${loop.repeats}`;

    const tail =
        loop.outcome === "malformed_stopped"
            ? " (retry budget exhausted; run stopped)"
            : loop.outcome === "stopped" ? " (run stopped)" : "";

    return `${head} — ${shorten(loop.signature || loop.reason || "", 90)}${tail}`;
}


function CallRow({ call, graph, run, onOpenCall }) {

    return html`<button
        type="button"
        class=${`tool ${call.status}`}
        title="click for the full call"
        onClick=${() => onOpenCall(call, graph, run)}
    >
        <span class="icon">${statusIcon(call.status)}</span>
        <span class="name">${call.name}</span>
        <span class="args">${shorten(call.argumentsPreview, 70)}</span>
        ${(call.depends_on || []).length > 0 &&
            html`<span class="badge dep">${`after ${call.depends_on.join(", ")}`}</span>`}
        ${call.exitCode ? html`<span class="badge dep">${`exit ${call.exitCode}`}</span>` : null}
        ${call.warning ? html`<span class="badge dep">warning</span>` : null}
        ${call.duration !== undefined && call.duration !== null
            ? html`<span class="ms">${`${call.duration} ms`}</span>`
            : null}
    </button>`;
}


function Graph({ graph, run, onOpenCall }) {

    const waves = graph.waves.length || 1;
    const rows = [];
    let lastWave = null;

    for (const id of graph.order) {

        const call = graph.calls.get(id);

        if (graph.shape !== "single" && call.wave !== null && call.wave !== undefined && call.wave !== lastWave) {

            lastWave = call.wave;

            /* counted from the intervals: who really ran with this call */
            const alongside = ranAlongside(graph, call);

            rows.push(html`<div class="wave-label" key=${`w${call.wave}-${id}`}>${
                `wave ${call.wave + 1}${alongside.length > 0 ? ` · ${alongside.length + 1} in parallel` : ""}`
            }</div>`);
        }

        rows.push(html`<${CallRow} key=${`c${id}`} call=${call} graph=${graph} run=${run} onOpenCall=${onOpenCall} />`);
    }

    return html`<div class="graph">
        <div class="graph-head">
            <span class=${`badge shape ${graph.shape}`}>${SHAPE_LABEL[graph.shape] || graph.shape}</span>
            <span class="muted">${
                `${graph.calls.size} call${graph.calls.size === 1 ? "" : "s"} · ${waves} wave${waves === 1 ? "" : "s"}${
                    graph.iteration ? ` · iteration ${graph.iteration}` : ""}`
            }</span>
        </div>
        ${rows}
    </div>`;
}


function AgentNode({ agent, run, onOpenCall }) {

    return html`<div class=${`node depth-${agent.depth}`} style=${{ marginLeft: `${agent.depth * 16}px` }}>
        <div class="node-head">
            <span class="node-name">${agent.name}</span>
            <span class=${`badge ${agent.status}`}>${agent.status}</span>
            ${agent.depth > 0 ? html`<span class="badge depth">${`depth ${agent.depth}`}</span>` : null}
            ${agent.iterations ? html`<span class="badge">${`iteration ${agent.iterations}`}</span>` : null}
            ${agent.parentScope || agent.parent
                ? html`<span class="badge parent">${`↳ from ${agent.parentScope || agent.parent}`}</span>`
                : null}
            ${agent.persona ? html`<span class="badge muted">${agent.persona}</span>` : null}
            ${agent.task ? html`<span class="node-task">${shorten(agent.task, 80)}</span>` : null}
        </div>
        ${(agent.skills || []).map(name => html`<div class="skill" key=${`s${name}`}>${`Loaded skill ${name}`}</div>`)}
        ${agent.loops.map((loop, index) => html`<div class=${`loop ${loop.outcome}`} key=${`l${index}`}>${loopText(loop)}</div>`)}
        ${agent.graphs.map(id => run.graphs.get(id)).filter(Boolean)
            .map(graph => html`<${Graph} key=${`g${graph.id}`} graph=${graph} run=${run} onOpenCall=${onOpenCall} />`)}
    </div>`;
}


/* the routine and the agents of one run; shared by the live card and the archive */
export function TreeBody({ run, onOpenCall }) {

    const hooks = run.hookOrder.map(id => run.hooks.get(id)).filter(Boolean);

    return html`
        ${hooks.length > 0 && html`<div class="routine">
            <div class="routine-title">Runtime routine</div>
            ${hooks.map(hook => html`<div class=${`hook ${hook.status}`} key=${`${hook.phase}:${hook.id}`}>${
                `${statusIcon(hook.status)} ${hook.phase} · ${hook.id} · ${hook.hook_type}${
                    hook.summary ? ` — ${shorten(hook.summary, 100)}` : ""}`
            }</div>`)}
        </div>`}
        ${run.order.map(scope => html`<${AgentNode}
            key=${scope}
            agent=${run.agents.get(scope)}
            run=${run}
            onOpenCall=${onOpenCall}
        />`)}
    `;
}


export function Tree({ run, onOpenCall }) {

    if (run.order.length === 0) {
        return html`<p class="empty">No run yet. Send a task to see the agent tree.</p>`;
    }

    return html`<${TreeBody} run=${run} onOpenCall=${onOpenCall} />`;
}


/*
| Previous runs, closed by default. Which ones the operator opened is kept
| in the store (openIds), so the accordion is the same in the Execution
| modal each time it opens.
*/
export function Archive({ archive, onOpenCall, openIds = null, onToggle = null }) {

    return archive.map(entry => html`<details
        class="execution-run"
        key=${entry.id}
        open=${openIds ? openIds.has(entry.id) : undefined}
        onToggle=${onToggle ? event => onToggle(entry.id, event.currentTarget.open) : undefined}
    >
        <summary>
            <span class="archived-title">${singleLine(entry.task, 100)}</span>
            <span class="archived-summary">${entry.summary}</span>
        </summary>
        <div class="archived-tree"><${TreeBody} run=${entry.run} onOpenCall=${onOpenCall} /></div>
    </details>`);
}


/* the Execution modal: the archive and the current tree, drawn afresh */
export function ExecutionPanel({ run, archive, openIds, onToggle, onOpenCall }) {

    return html`<div class="execution-scroll">
        <div class="execution-archive">
            <${Archive} archive=${archive} openIds=${openIds} onToggle=${onToggle} onOpenCall=${onOpenCall} />
        </div>
        <div class="tree"><${Tree} run=${run} onOpenCall=${onOpenCall} /></div>
    </div>`;
}


function Definition({ label, value }) {

    if (value === undefined || value === null || value === "") {
        return null;
    }

    return html`<dt>${label}</dt><dd>${String(value)}</dd>`;
}


function CallDetail({ call, graph, run }) {

    const owner = run && run.agents ? run.agents.get(call.agent) : null;
    const siblings = graph ? ranAlongside(graph, call) : [];
    const full = call.full;

    const argumentsText = full
        ? JSON.stringify(full.arguments ?? {}, null, 2)
        : call.argumentsPreview || "{}";

    const resultText = full
        ? full.error || JSON.stringify(full.result ?? null, null, 2)
        : call.error || call.resultPreview || "(pending)";

    return html`
        <dl class="detail-grid">
            <${Definition} label="tool" value=${call.name} />
            <${Definition} label="status" value=${call.status} />
            <${Definition} label="exit code" value=${call.exitCode} />
            <${Definition} label="warning" value=${call.warning} />
            <${Definition} label="executed by" value=${call.agent} />
            ${owner && (owner.parentScope || owner.parent) &&
                html`<${Definition} label="agent parent" value=${`${owner.parentScope || owner.parent} (depth ${owner.depth})`} />`}
            <${Definition} label="iteration" value=${call.iteration} />
            <${Definition} label="call id" value=${call.id} />
            ${graph && html`
                <${Definition}
                    label="execution"
                    value=${`${SHAPE_LABEL[graph.shape] || graph.shape}, wave ${(call.wave ?? 0) + 1} of ${graph.waves.length || 1}`}
                />
                <${Definition} label="graph" value=${graph.id} />
                ${graph.maxParallel ? html`<${Definition} label="max parallel" value=${graph.maxParallel} />` : null}
                ${siblings.length > 0 ? html`<${Definition} label="ran alongside" value=${siblings.join(", ")} />` : null}
            `}
            ${(call.depends_on || []).length > 0 &&
                html`<${Definition} label="depends on" value=${call.depends_on.join(", ")} />`}
            <${Definition}
                label="duration"
                value=${call.duration === undefined || call.duration === null ? null : `${call.duration} ms`}
            />
        </dl>
        <div class="detail-block">
            <h3>Arguments</h3>
            <pre>${argumentsText}</pre>
        </div>
        <div class="detail-block">
            <h3>${call.status === "failed" ? "Error" : "Result"}</h3>
            <pre class=${call.status === "failed" ? "bad" : undefined}>${resultText}</pre>
        </div>
    `;
}


/*
| Opens one call in a large modal. The stream carries a preview so a 40K
| result does not travel with every event; the full record is fetched
| when the detail is opened, and the view redraws when it arrives.
| `touchTree` re-renders the open detail (it is mounted on "tree", so a
| call still running updates in place too).
*/
export async function openCallDetail({ Modal, call, graph, run, touchTree }) {

    let dispose = () => {};

    const handle = Modal.open({
        title: `${call.name}`,
        subtitle: `${call.agent} · ${call.status}${
            call.duration !== undefined && call.duration !== null ? ` · ${call.duration} ms` : ""}`,
        size: "large",
        footer: Modal.row(
            Modal.button("Copy as JSON", "ghost", () => copyCall(call)),
            Modal.button("Close", "", () => handle.close("footer"))
        ),
        onClose: () => dispose()
    });

    dispose = mountInModal(handle, CallDetail, ["tree"], { call, graph, run }, "detail");

    if (!call.key) {
        return handle;
    }

    try {

        const response = await fetch(`/api/calls/${encodeURIComponent(call.key)}`);

        if (response.ok) {

            const payload = await response.json();

            if (payload && payload.call) {
                call.full = payload.call;
                touchTree();
            }
        }

    } catch {
        /* the preview stays on screen */
    }

    return handle;
}


function copyCall(call) {

    const text = JSON.stringify(call.full || call, null, 2);

    if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
    }
}
