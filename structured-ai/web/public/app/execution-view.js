/*
|--------------------------------------------------------------------------
| Console execution-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The delegation tree: one card per agent, the graph inside it split into waves,
| the tool rows, and the full detail of one call.
|
| The heaviest view in the console, and the one the stream drives hardest: the
| live tree is why the runtime emits what it emits. `archiveCurrentExecution` is
| here too, because a new task must not erase the execution it follows.
|--------------------------------------------------------------------------
*/

import { Modal, definition, el, node } from "./dom.js";
import { SHAPE_LABEL, shorten, singleLine, statusIcon } from "./formatters.js";
import { executionState, runtimeState } from "./store.js";

export function agentNode(scope, depth, extra = {}) {

    if (!executionState.agents.has(scope)) {

        executionState.agents.set(scope, {
            scope,
            name: extra.name || scope,
            depth: depth || 0,
            parent: null,
            parentScope: null,
            persona: null,
            delegationId: null,
            task: null,
            status: "running",
            iterations: 0,
            graphs: [],
            skills: [],
            loops: []
        });

        executionState.order.push(scope);
    }

    const item =
        executionState.agents.get(scope);

    if (depth !== undefined && depth !== null) {
        item.depth = depth;
    }

    for (const [key, value] of Object.entries(extra)) {

        if (value !== undefined && value !== null) {
            item[key] = value;
        }
    }

    return item;
}

export function graphNode(event) {

    const id =
        event.graph_id || `${event.agent}:loose`;

    if (!executionState.graphs.has(id)) {

        executionState.graphs.set(id, {
            id,
            agent: event.agent || "main_agent",
            kind: "tools",
            shape: event.shape || "single",
            waves: event.waves || [],
            maxParallel: event.max_parallel || null,
            iteration: event.iteration ?? null,
            order: [],
            calls: new Map()
        });

        const owner =
            agentNode(event.agent || "main_agent");

        owner.graphs.push(id);
    }

    const graph =
        executionState.graphs.get(id);

    if (event.shape) {
        graph.shape = event.shape;
    }

    if (event.waves) {
        graph.waves = event.waves;
    }

    if (event.iteration !== undefined && event.iteration !== null) {
        graph.iteration = event.iteration;
    }

    return graph;
}

export function archiveCurrentExecution() {

    if (
        executionState.order.length === 0 &&
        executionState.hookOrder.length === 0
    ) {
        return false;
    }

    const tree = el("tree");
    const archive = el("executionArchive");

    if (!tree || !archive) {
        return false;
    }

    const execSummary = el("execSummary");

    const details = node("details", "execution-run");
    const summary = node("summary");

    summary.append(
        node("span", "archived-title", singleLine(runtimeState.currentTask, 100)),
        node(
            "span",
            "archived-summary",
            execSummary ? execSummary.textContent : ""
        )
    );

    const body = node("div", "archived-tree");

    while (tree.firstChild) {
        body.appendChild(tree.removeChild(tree.firstChild));
    }

    details.append(summary, body);
    archive.appendChild(details);

    while (archive.children.length > 50) {
        archive.removeChild(archive.firstChild);
    }

    return true;
}

export function renderTree() {

    const container = el("tree");

    /*
    | renderTree runs from the event stream. A missing container must
    | not throw, because the exception would take down the handler for
    | every event after it, not just this one.
    */

    if (!container) {
        return;
    }

    const summary = el("execSummary");

    if (executionState.order.length === 0) {

        container.innerHTML =
            '<p class="empty">No run yet. Send a task to see the agent tree.</p>';

        if (summary) {
            summary.textContent = "";
        }

        return;
    }

    container.innerHTML = "";

    let calls = 0;
    let failures = 0;

    if (executionState.hookOrder.length > 0) {

        const routine = node("div", "routine");
        routine.appendChild(node("div", "routine-title", "Runtime routine"));

        for (const id of executionState.hookOrder) {

            const hook = executionState.hooks.get(id);

            if (!hook) {
                continue;
            }

            routine.appendChild(
                node(
                    "div",
                    `hook ${hook.status}`,
                    `${statusIcon(hook.status)} ${hook.phase} · ${hook.id} · ${hook.hook_type}${
                        hook.summary ? ` — ${shorten(hook.summary, 100)}` : ""
                    }`
                )
            );
        }

        container.appendChild(routine);
    }

    for (const scope of executionState.order) {

        const agent =
            executionState.agents.get(scope);

        const box = node("div", `node depth-${agent.depth}`);

        box.style.marginLeft = `${agent.depth * 16}px`;

        const head = node("div", "node-head");

        head.append(
            node("span", "node-name", agent.name),
            node("span", `badge ${agent.status}`, agent.status)
        );

        if (agent.depth > 0) {
            head.appendChild(
                node("span", "badge depth", `depth ${agent.depth}`)
            );
        }

        if (agent.iterations) {
            head.appendChild(
                node("span", "badge", `iteration ${agent.iterations}`)
            );
        }

        if (agent.parentScope || agent.parent) {
            head.appendChild(
                node(
                    "span",
                    "badge parent",
                    `↳ from ${agent.parentScope || agent.parent}`
                )
            );
        }

        if (agent.persona) {
            head.appendChild(
                node("span", "badge muted", agent.persona)
            );
        }

        if (agent.task) {
            head.appendChild(
                node("span", "node-task", shorten(agent.task, 80))
            );
        }

        box.appendChild(head);

        for (const name of agent.skills || []) {

            box.appendChild(
                node("div", "skill", `Loaded skill ${name}`)
            );
        }

        for (const loop of agent.loops) {

            box.appendChild(
                node(
                    "div",
                    `loop ${loop.outcome}`,
                    `${
                        loop.outcome === "malformed" ||
                        loop.outcome === "malformed_stopped"
                            ? `⚠ unreadable answer ×${loop.repeats}`
                            : loop.outcome === "stalled"
                                ? "↻ no progress"
                                : `↻ repeated failure ×${loop.repeats}`
                    } — ${shorten(loop.signature || loop.reason || "", 90)}${
                        loop.outcome === "malformed_stopped"
                            ? " (retry budget exhausted; run stopped)"
                            : loop.outcome === "stopped"
                                ? " (run stopped)"
                                : ""
                    }`
                )
            );
        }

        for (const graphId of agent.graphs) {

            const graph =
                executionState.graphs.get(graphId);

            if (!graph) {
                continue;
            }

            const group = node("div", "graph");

            const groupHead = node("div", "graph-head");

            groupHead.append(
                node(
                    "span",
                    `badge shape ${graph.shape}`,
                    SHAPE_LABEL[graph.shape] || graph.shape
                ),
                node(
                    "span",
                    "muted",
                    `${graph.calls.size} call${
                        graph.calls.size === 1 ? "" : "s"
                    } · ${graph.waves.length || 1} wave${
                        (graph.waves.length || 1) === 1 ? "" : "s"
                    }${
                        graph.iteration
                            ? ` · iteration ${graph.iteration}`
                            : ""
                    }`
                )
            );

            group.appendChild(groupHead);

            let lastWave = null;

            for (const id of graph.order) {

                const call = graph.calls.get(id);

                calls++;

                if (call.status === "failed") {
                    failures++;
                }

                if (
                    graph.shape !== "single" &&
                    call.wave !== null &&
                    call.wave !== lastWave
                ) {

                    lastWave = call.wave;

                    const inWave =
                        graph.waves[call.wave] || [];

                    group.appendChild(
                        node(
                            "div",
                            "wave-label",
                            `wave ${call.wave + 1}${
                                inWave.length > 1
                                    ? ` · ${inWave.length} in parallel`
                                    : ""
                            }`
                        )
                    );
                }

                group.appendChild(callRow(call, graph));
            }

            box.appendChild(group);
        }

        container.appendChild(box);
    }

    if (summary) {

        summary.textContent =
            `${executionState.order.length} agent${
                executionState.order.length === 1 ? "" : "s"
            } · ${calls} call${calls === 1 ? "" : "s"}${
                failures ? ` · ${failures} failed` : ""
            }${
                executionState.hookOrder.length ? ` · ${executionState.hookOrder.length} hook` : ""
            }${
                executionState.loops.length ? ` · ${executionState.loops.length} loop` : ""
            }`;
    }
}

export function callRow(call, graph) {

    const row =
        node("button", `tool ${call.status}`);

    row.type = "button";
    row.title = "click for the full call";

    row.append(
        node("span", "icon", statusIcon(call.status)),
        node("span", "name", call.name),
        node("span", "args", shorten(call.argumentsPreview, 70))
    );

    if ((call.depends_on || []).length > 0) {

        row.appendChild(
            node(
                "span",
                "badge dep",
                `after ${call.depends_on.join(", ")}`
            )
        );
    }

    if (call.exitCode) {
        row.appendChild(node("span", "badge dep", `exit ${call.exitCode}`));
    }

    if (call.warning) {
        row.appendChild(node("span", "badge dep", "warning"));
    }

    if (call.duration !== undefined && call.duration !== null) {
        row.appendChild(node("span", "ms", `${call.duration} ms`));
    }

    row.addEventListener(
        "click",
        () => openCallDetail(call, graph)
    );

    return row;
}

export async function openCallDetail(call, graph) {

    const body = node("div", "detail");

    const list = node("dl", "detail-grid");

    definition(list, "tool", call.name);
    definition(list, "status", call.status);
    definition(list, "exit code", call.exitCode);
    definition(list, "warning", call.warning);
    definition(list, "executed by", call.agent);

    const owner =
        executionState.agents.get(call.agent);

    if (owner && (owner.parentScope || owner.parent)) {
        definition(
            list,
            "agent parent",
            `${owner.parentScope || owner.parent} (depth ${owner.depth})`
        );
    }

    definition(list, "iteration", call.iteration);
    definition(list, "call id", call.id);

    if (graph) {

        definition(
            list,
            "execution",
            `${SHAPE_LABEL[graph.shape] || graph.shape}, wave ${
                (call.wave ?? 0) + 1
            } of ${graph.waves.length || 1}`
        );

        definition(list, "graph", graph.id);

        if (graph.maxParallel) {
            definition(list, "max parallel", graph.maxParallel);
        }

        const siblings =
            (graph.waves[call.wave] || []).filter(
                id => id !== call.id
            );

        if (siblings.length > 0) {
            definition(list, "ran alongside", siblings.join(", "));
        }
    }

    if ((call.depends_on || []).length > 0) {
        definition(list, "depends on", call.depends_on.join(", "));
    }

    definition(
        list,
        "duration",
        call.duration === undefined || call.duration === null
            ? null
            : `${call.duration} ms`
    );

    body.appendChild(list);

    const argumentsBlock = node("div", "detail-block");

    argumentsBlock.append(
        node("h3", null, "Arguments"),
        node("pre", null, call.argumentsPreview || "{}")
    );

    body.appendChild(argumentsBlock);

    const resultBlock = node("div", "detail-block");

    resultBlock.append(
        node("h3", null, call.status === "failed" ? "Error" : "Result"),
        node(
            "pre",
            call.status === "failed" ? "bad" : null,
            call.error || call.resultPreview || "(pending)"
        )
    );

    body.appendChild(resultBlock);

    const handle =
        Modal.open({
            title: `${call.name}`,

            subtitle:
                `${call.agent} · ${call.status}${
                    call.duration !== undefined && call.duration !== null
                        ? ` · ${call.duration} ms`
                        : ""
                }`,

            size: "large",

            body,

            footer:
                Modal.row(
                    Modal.button(
                        "Copy as JSON",
                        "ghost",
                        () => copyCall(call)
                    ),
                    Modal.button(
                        "Close",
                        "",
                        () => handle.close("footer")
                    )
                )
        });

    /*
    | The stream carries a preview so a 40K result does not travel with
    | every event. The full record is fetched only when it is opened.
    */

    if (call.key) {

        try {

            const response =
                await fetch(`/api/calls/${encodeURIComponent(call.key)}`);

            if (response.ok) {

                const payload = await response.json();

                const full = payload.call;

                call.full = full;

                argumentsBlock.querySelector("pre").textContent =
                    JSON.stringify(full.arguments ?? {}, null, 2);

                resultBlock.querySelector("pre").textContent =
                    full.error ||
                    JSON.stringify(full.result ?? null, null, 2);
            }

        } catch {

            /* the preview stays on screen */
        }
    }
}

export function copyCall(call) {

    const text =
        JSON.stringify(call.full || call, null, 2);

    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
    }
}
