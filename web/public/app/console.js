"use strict";

/*
| Compatibility renderer. The no-build ESM entry point at app/main.js imports
| this file while domain modules in app/ own the migration seams; the file is
| kept as a classic-compatible asset for existing embeds and UI tests.
|
| The console keeps no state of its own beyond what the runtime reports:
| every box on screen is rebuilt from the event stream, so a reload
| reproduces the same picture from the snapshot.
|
| Three things are deliberately modal rather than inline, because they
| interrupt: settings, an approval request, and the full detail of one
| executed call. They share the Modal service in modal.js.
*/

const el = id => document.getElementById(id);

const escape = Modal.escape;

const state = {
    agents: new Map(),
    order: [],
    graphs: new Map(),
    calls: new Map(),
    approvals: new Map(),
    loops: [],
    hooks: new Map(),
    hookOrder: [],
    currentTask: null,
    plan: null,
    messages: [],
    events: [],
    waiting: null,
    waitingElapsed: null,
    waitingTimer: null,
    session: null,
    sessions: [],
    historyModal: null,
    executionModal: null,
    eventsModal: null,
    status: "idle",
    startedAt: null,
    timer: null,
    approvalModal: null,
    settingsModal: null,
    llmSettingsModal: null,
    planModal: null,
    mcpModal: null,
    discussionModal: null,
    discussion: null,
    discussionEl: null,
    discussionMode: false,
    discussionPersonas: [],
    historyOpening: false,
    mcpOpening: false,
    settings: [],
    logFilter: "",
    logType: "",
    openExecutionKeys: new Set(),
    projects: [],
    currentProjectId: null,
    dashboard: { open: false, projectId: null, tab: "overview" },
    eventSource: null,
    multiQueue: [],
    gatewayHealth: null
};

const PROJECT_STORAGE_KEY = "structured-ai.currentProjectId";

const DASHBOARD_TABS = [
    ["overview", "Overview"],
    ["runs", "Agent Runs"],
    ["sessions", "Sessions"],
    ["memory", "Memory"],
    ["plan", "Plan"],
    ["events", "Events"],
    ["approvals", "Approvals"],
    ["mcp", "MCP"],
    ["logs", "Logs"],
    ["settings", "Settings"]
];


/* ---------------------------------------------------------------- helpers */

function shorten(value, max = 90) {

    const text =
        typeof value === "string"
            ? value
            : JSON.stringify(value ?? "");

    return text.length > max
        ? `${text.slice(0, max)}…`
        : text;
}


function singleLine(value, max = 90) {

    const text =
        String(value || "")
            .replace(/\s+/g, " ")
            .trim();

    return text.length > max
        ? `${text.slice(0, max)}…`
        : text || "Untitled task";
}


function node(tag, className, text) {

    const element =
        document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined && text !== null) {
        element.textContent = text;
    }

    return element;
}


function agentNode(scope, depth, extra = {}) {

    if (!state.agents.has(scope)) {

        state.agents.set(scope, {
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

        state.order.push(scope);
    }

    const item =
        state.agents.get(scope);

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


function graphNode(event) {

    const id =
        event.graph_id || `${event.agent}:loose`;

    if (!state.graphs.has(id)) {

        state.graphs.set(id, {
            id,
            agent: event.agent || "main_agent",
            kind: "tools",
            shape: event.shape || "single",
            waves: event.waves || [],
            waveBasis: event.wave_basis || "planned",
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
        state.graphs.get(id);

    if (event.shape) {
        graph.shape = event.shape;
    }

    if (event.waves) {
        graph.waves = event.waves;
    }

    if (event.wave_basis) {
        graph.waveBasis = event.wave_basis;
    }

    if (event.iteration !== undefined && event.iteration !== null) {
        graph.iteration = event.iteration;
    }

    return graph;
}


/*
| A wave index is what the scheduler planned, not what it did: items dispatch
| continuously, so two calls sharing a wave need not overlap and two calls in
| different waves may run together. The honest record of concurrency is the
| interval every call carries, so "in parallel" and "ran alongside" are read
| from those, and the planned grouping is only a fallback for a call that has
| no timestamps (a replayed run from before they were recorded).
*/
function intervalOf(call) {

    if (!call) {
        return null;
    }

    const start =
        call.startedAt ??
        (
            call.finishedAt && call.duration
                ? call.finishedAt - call.duration
                : null
        );

    if (start === null || start === undefined) {
        return null;
    }

    /* a call still running has no end yet, so it overlaps everything open */
    return {
        start,
        end: call.finishedAt ?? Number.MAX_SAFE_INTEGER
    };
}


function ranAlongside(graph, call) {

    const own = intervalOf(call);

    if (!own) {
        return (graph.waves[call.wave] || []).filter(id => id !== call.id);
    }

    const alongside = [];

    for (const id of graph.order) {

        if (id === call.id) {
            continue;
        }

        const other = intervalOf(graph.calls.get(id));

        if (other && other.start < own.end && own.start < other.end) {
            alongside.push(id);
        }
    }

    return alongside;
}


/* ------------------------------------------------------------------ tree */

const SHAPE_LABEL = {
    single: "single call",
    parallel: "parallel",
    sequential: "sequential",
    graph: "dependency graph"
};


function statusIcon(status) {

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


function archiveCurrentExecution() {

    if (
        state.order.length === 0 &&
        state.hookOrder.length === 0
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
        node("span", "archived-title", singleLine(state.currentTask, 100)),
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


function renderTree() {

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

    if (state.order.length === 0) {

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

    if (state.hookOrder.length > 0) {

        const routine = node("div", "routine");
        routine.appendChild(node("div", "routine-title", "Runtime routine"));

        for (const id of state.hookOrder) {

            const hook = state.hooks.get(id);

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

    for (const scope of state.order) {

        const agent =
            state.agents.get(scope);

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
                state.graphs.get(graphId);

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

                    /* counted from the intervals, not from the planned
                       grouping: this is who really ran with this call */
                    const alongside = ranAlongside(graph, call);

                    group.appendChild(
                        node(
                            "div",
                            "wave-label",
                            `wave ${call.wave + 1}${
                                alongside.length > 0
                                    ? ` · ${alongside.length + 1} in parallel`
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
            `${state.order.length} agent${
                state.order.length === 1 ? "" : "s"
            } · ${calls} call${calls === 1 ? "" : "s"}${
                failures ? ` · ${failures} failed` : ""
            }${
                state.hookOrder.length ? ` · ${state.hookOrder.length} hook` : ""
            }${
                state.loops.length ? ` · ${state.loops.length} loop` : ""
            }`;
    }
}


function renderPlan() {

    const container = el("plan");
    const plan = state.plan;

    container.innerHTML = "";

    if (!plan || !plan.exists) {

        container.appendChild(
            node(
                "p",
                "empty",
                plan?.error
                    ? `Plan unavailable: ${plan.error}`
                    : "No plan yet."
            )
        );

        el("planSummary").textContent = "";
        return;
    }

    el("planSummary").textContent =
        `${plan.done || 0}/${plan.steps || 0} done${
            plan.blocked ? ` · ${plan.blocked} blocked` : ""
        }`;

    if (plan.objective) {
        container.appendChild(
            node("p", "plan-objective", plan.objective)
        );
    }

    for (const [index, phase] of (plan.phases || []).entries()) {

        const details = node("details", "plan-phase");

        details.open =
            phase.status === "in_progress" ||
            (
                index === 0 &&
                !(plan.phases || []).some(item => item.status === "in_progress")
            );

        const summary = node("summary");

        summary.append(
            node("span", null, `${phase.id || `phase ${index + 1}`} · ${phase.title || "Untitled phase"}`),
            node("span", `badge ${phase.status || "pending"}`, phase.status || "pending")
        );

        details.appendChild(summary);

        if (phase.goal) {
            details.appendChild(node("div", "plan-goal", phase.goal));
        }

        const steps = node("ol", "plan-steps");

        for (const step of phase.steps || []) {

            const item = node("li", `plan-step ${step.status || "pending"}`);
            const head = node("div", "plan-step-head");

            head.append(
                node("span", "plan-step-id", step.id),
                node("span", "plan-step-title", step.title),
                node("span", `badge ${step.status || "pending"}`, step.status || "pending")
            );

            if (step.agent) {
                head.appendChild(
                    node("span", "plan-step-agent", `@${step.agent}`)
                );
            }

            item.appendChild(head);

            if (step.evidence) {
                item.appendChild(
                    node("div", "plan-evidence", step.evidence)
                );
            }

            steps.appendChild(item);
        }

        if ((phase.steps || []).length === 0) {
            steps.appendChild(node("li", "empty", "No steps defined."));
        }

        details.appendChild(steps);
        container.appendChild(details);
    }

    if (plan.routine?.enabled) {

        container.appendChild(
            node(
                "div",
                "plan-routine",
                `Runtime routine · before: ${
                    (plan.routine.before_task || []).join(", ") || "none"
                } · after: ${
                    (plan.routine.after_task || []).join(", ") || "none"
                }`
            )
        );
    }
}


function callRow(call, graph) {

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


/* ----------------------------------------------------------- call detail */

function definition(list, label, value) {

    if (value === undefined || value === null || value === "") {
        return;
    }

    list.append(
        node("dt", null, label),
        node("dd", null, String(value))
    );
}


async function openCallDetail(call, graph) {

    const body = node("div", "detail");

    const list = node("dl", "detail-grid");

    definition(list, "tool", call.name);
    definition(list, "status", call.status);
    definition(list, "exit code", call.exitCode);
    definition(list, "warning", call.warning);
    definition(list, "executed by", call.agent);

    const owner =
        state.agents.get(call.agent);

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

        const siblings = ranAlongside(graph, call);

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


function copyCall(call) {

    const text =
        JSON.stringify(call.full || call, null, 2);

    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
    }
}


/* ------------------------------------------------------------------ chat */

const WHO = {
    user: "you",
    assistant: "agent"
};


function updateWaitingElapsed() {

    if (!state.waitingElapsed || !state.waiting) {
        return;
    }

    state.waitingElapsed.textContent =
        `${((Date.now() - state.waiting.since) / 1000).toFixed(1)} s`;
}


/*
| Older session files did not store turn_id on reasoning messages. Recovering
| it from the nearest preceding user message lets those sessions use the new
| per-iteration renderer too, instead of falling back to one aggregate box.
*/
function normalizeConversationMessage(message, previous = state.messages) {

    if (!message || typeof message !== "object") {
        return message;
    }

    const normalized = { ...message };

    if (
        normalized.role !== "assistant" ||
        !["model", "thinking"].includes(normalized.kind)
    ) {
        return normalized;
    }

    if (!normalized.turn_id && normalized.execution_key) {
        normalized.turn_id = String(normalized.execution_key).split("|")[0];
    }

    if (!normalized.turn_id) {

        for (let index = previous.length - 1; index >= 0; index--) {

            const candidate = previous[index];

            if (candidate.role === "user" && candidate.turn_id) {
                normalized.turn_id = candidate.turn_id;
                break;
            }
        }
    }

    if (normalized.turn_id && !normalized.execution_key) {
        normalized.execution_key = messageExecutionKey(normalized);
    }

    return normalized;
}


function normalizeConversationMessages(messages) {

    const normalized = [];

    for (const message of Array.isArray(messages) ? messages : []) {
        normalized.push(normalizeConversationMessage(message, normalized));
    }

    return normalized;
}


function renderChat() {

    const container = el("chat");

    if (!container) {
        return;
    }

    state.waitingElapsed = null;

    /* Preserve blocks the operator explicitly expanded when a newly arrived
       reasoning message causes the chat to be rebuilt. */
    for (const existing of container.querySelectorAll("details.turn-execution")) {
        const key = existing.getAttribute("data-execution-key");
        if (!key) continue;
        if (existing.open) state.openExecutionKeys.add(key);
        else state.openExecutionKeys.delete(key);
    }

    container.innerHTML = "";

    if (state.messages.length === 0) {

        container.innerHTML =
            '<p class="empty">No messages yet. Describe a task to start.</p>';

    } else {

        /*
        | A single user turn can contain many model messages. Build one
        | execution block per assistant response (agent + iteration), and
        | place it immediately before the reasoning/action message that
        | produced it. The previous implementation keyed only by turn_id,
        | so every iteration was merged into one large block.
        */
        const assistantTurns = new Set(
            state.messages
                .filter(message =>
                    message.role === "assistant" &&
                    ["model", "thinking"].includes(message.kind) &&
                    message.turn_id
                )
                .map(message => message.turn_id)
        );

        const renderedExecutions = new Set();

        for (const message of state.messages) {

            const isExecutionMessage =
                message.role === "assistant" &&
                ["model", "thinking"].includes(message.kind);

            const key =
                isExecutionMessage
                    ? messageExecutionKey(message)
                    : null;

            if (key && !renderedExecutions.has(key)) {

                const block = turnExecutionBlock(key);

                if (block) {
                    /* The raw structured model envelope is retained in the
                       session for diagnostics, but is not a user-facing
                       bubble. The execution block belongs before reasoning
                       so each AI step reads as one unit. */
                    container.appendChild(block);
                    renderedExecutions.add(key);
                }
            }

            /* The provider's raw content is the action protocol JSON, not a
               useful chat message. Final response and thinking bubbles are
               rendered normally; model envelopes stay available in Events
               and session storage without polluting the conversation. */
            if (message.kind !== "model") {
                container.appendChild(bubble(message));
            }

            if (
                message.role === "user" &&
                message.turn_id &&
                !assistantTurns.has(message.turn_id)
            ) {

                /* Backwards compatibility for sessions written before model
                   response messages were stored: keep their tool events
                   visible under the user message until a new response arrives. */
                const fallbackKey = `${message.turn_id}|all`;

                if (!renderedExecutions.has(fallbackKey)) {
                    const block = turnExecutionBlock(fallbackKey);

                    if (block) {
                        container.appendChild(block);
                        renderedExecutions.add(fallbackKey);
                    }
                }
            }
        }
    }

    /*
    | While a request is in flight there is nothing to show yet, and a
    | two minute silence looks like a hang. The bubble is the wait
    | itself, and it disappears when the answer arrives.
    */

    if (state.waiting) {

        const pending =
            node("div", "bubble assistant pending");

        const elapsed = node("span", "text");
        state.waitingElapsed = elapsed;

        pending.append(
            node(
                "span",
                "who",
                `${state.waiting.agent} · thinking`
            ),
            elapsed
        );

        container.appendChild(pending);
        updateWaitingElapsed();
    }

    container.scrollTop = container.scrollHeight;
}


/*
| A model response is identified by the turn, the agent scope, and the
| iteration that produced it. Every tool event emitted during that action
| carries the same three correlation fields. `execution_key` is accepted
| when present so newer servers can provide an explicit stable key.
*/
function messageExecutionKey(value) {

    if (value.execution_key || value.ai_message_id) {
        return value.execution_key || value.ai_message_id;
    }

    if (!value.turn_id) {
        return null;
    }

    return [
        value.turn_id,
        value.scope || value.agent || "main_agent",
        value.iteration ?? "all"
    ].join("|");
}


function turnEventsOf(executionKey) {

    if (!executionKey) {
        return [];
    }

    const relevant = new Set([
        "agent:iteration",
        "agent:action",
        "tool:graph",
        "tool:start",
        "tool:end",
        "run:malformed"
    ]);

    const parts = executionKey.split("|");
    const isTurnFallback = parts.length === 2 && parts[1] === "all";

    return state.events.filter(event => {

        if (!relevant.has(event.type)) {
            return false;
        }

        if (isTurnFallback) {
            return event.turn_id === parts[0];
        }

        return messageExecutionKey(event) === executionKey;
    });
}


function turnSummaryText(events) {

    /* Count calls by id, not lifecycle events. A tool has a start and an end,
       but it is still one call. This also remains correct for a result event
       that arrives without a start after reconnect/replay. */
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

    const success =
        [...calls.values()].filter(call => call.success === true).length;

    const fail =
        [...calls.values()].filter(call => call.success === false).length;

    const retried =
        events.filter(event => event.type === "run:malformed").length;

    return (
        `execution · ${calls.size} tool call(s) · ${success} success · ` +
        `${fail} fail · ${retried} retried`
    );
}


function turnExecutionLine(event) {

    const kind =
        event.type === "tool:end"
            ? (event.success === false ? "tool-fail" : "tool-ok")
            : event.type === "tool:start"
                ? "tool-ok"
                : event.type === "agent:action"
                    ? "action"
                    : event.type === "run:malformed"
                        ? "malformed"
                        : "";

    const line = node(
        "div",
        `turn-execution-line${kind ? ` ${kind}` : ""}`
    );

    if (event.type === "tool:start" || event.type === "tool:end") {
        line.appendChild(node("span", "tool-chip", event.name || ""));
    }

    line.appendChild(node("span", "turn-line-text", eventLabel(event)));

    return line;
}


function turnExecutionBody(events) {

    const body = node("div", "turn-execution-body");

    for (const event of events) {
        body.appendChild(turnExecutionLine(event));
    }

    return body;
}


function turnExecutionBlock(executionKey) {

    const events = turnEventsOf(executionKey);

    if (events.length === 0) {
        return null;
    }

    const details = node("details", "turn-execution");

    details.setAttribute("data-execution-key", executionKey);

    /* Keep the old attribute for stored sessions and integrations that used
       it to locate a turn, while the new key distinguishes iterations. */
    const turnId = executionKey.split("|")[0];
    if (turnId) {
        details.setAttribute("data-turn-id", turnId);
    }

    /* Keep the block collapsible and closed by default. CSS must not impose
       a fixed height: when the user clicks the summary, the full body can
       expand normally. */
    details.open = state.openExecutionKeys.has(executionKey);
    details.addEventListener("toggle", () => {
        if (details.open) state.openExecutionKeys.add(executionKey);
        else state.openExecutionKeys.delete(executionKey);
    });

    details.appendChild(
        node("summary", null, turnSummaryText(events))
    );

    details.appendChild(turnExecutionBody(events));

    return details;
}


/*
| Updates only the execution block for one model response in place, instead
| of re-rendering the whole conversation. An already-open block stays open.
*/
function refreshTurnExecution(executionKey) {

    if (!executionKey) {
        return;
    }

    const chat = el("chat");

    if (!chat) {
        return;
    }

    let existing = null;

    for (const candidate of chat.querySelectorAll("details.turn-execution")) {

        if (candidate.getAttribute("data-execution-key") === executionKey) {
            existing = candidate;
            break;
        }
    }

    if (!existing) {
        renderChat();
        return;
    }

    const events = turnEventsOf(executionKey);
    const summary = existing.querySelector("summary");
    const body = existing.querySelector(".turn-execution-body");

    if (!summary || !body) {
        renderChat();
        return;
    }

    summary.textContent = turnSummaryText(events);

    const wasOpen = existing.open;

    existing.replaceChild(turnExecutionBody(events), body);
    existing.open = wasOpen;
}

function eventLabel(event) {

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
| Reasoning is rendered as a dedicated expandable entry so provider
| reasoning never disappears from the conversation.
*/

/* ----------------------------------------------------------- markdown */

const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;


function containsRtlText(value) {
    return RTL_TEXT.test(String(value ?? ""));
}


function safeMarkdownHref(value) {

    const href = String(value ?? "").trim();

    if (href.startsWith("//")) {
        return null;
    }

    if (
        href === "" ||
        href.startsWith("#") ||
        (href.startsWith("/") && !href.startsWith("//")) ||
        href.startsWith("./") ||
        href.startsWith("../")
    ) {
        return href;
    }

    try {
        const baseUrl =
            typeof window !== "undefined" && window.location
                ? window.location.href
                : "http://localhost/";
        const parsed = new URL(href, baseUrl);

        return ["http:", "https:", "mailto:"].includes(parsed.protocol)
            ? parsed.href
            : null;
    } catch {
        return null;
    }
}


function appendInlineMarkdown(parent, value, depth = 0) {

    const text = String(value ?? "");

    /* A depth limit prevents malformed nested delimiters from recursing
       forever while still supporting normal emphasis inside links/bold. */
    if (depth > 8 || text === "") {
        if (text !== "") parent.appendChild(node("span", null, text));
        return;
    }

    let index = 0;
    let plainStart = 0;

    const flushPlain = end => {
        if (end > plainStart) {
            parent.appendChild(node("span", null, text.slice(plainStart, end)));
        }
    };

    const findClosing = (delimiter, from) => {
        const closing = text.indexOf(delimiter, from);
        return closing > from ? closing : -1;
    };

    while (index < text.length) {

        let delimiter = null;
        let closing = -1;
        let tag = null;

        if (text[index] === "`") {
            delimiter = "`";
            closing = findClosing(delimiter, index + 1);
            tag = "code";
        } else if (text.startsWith("**", index)) {
            delimiter = "**";
            closing = findClosing(delimiter, index + 2);
            tag = "strong";
        } else if (text.startsWith("__", index)) {
            delimiter = "__";
            closing = findClosing(delimiter, index + 2);
            tag = "strong";
        } else if (text.startsWith("~~", index)) {
            delimiter = "~~";
            closing = findClosing(delimiter, index + 2);
            tag = "del";
        } else if (
            (text[index] === "*" || text[index] === "_") &&
            (index === 0 || /\s/.test(text[index - 1] || ""))
        ) {
            delimiter = text[index];
            closing = findClosing(delimiter, index + 1);
            tag = "em";
        }

        /* Markdown links are parsed before ordinary text. Unsafe schemes are
           emitted as their literal markdown instead of becoming a link. */
        if (text[index] === "[") {
            const labelEnd = text.indexOf("](", index + 1);
            const urlEnd = labelEnd === -1 ? -1 : text.indexOf(")", labelEnd + 2);

            if (labelEnd > index && urlEnd > labelEnd) {
                const href = safeMarkdownHref(text.slice(labelEnd + 2, urlEnd));

                if (href !== null) {
                    flushPlain(index);
                    const link = node("a");
                    link.href = href;
                    appendInlineMarkdown(
                        link,
                        text.slice(index + 1, labelEnd),
                        depth + 1
                    );
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    parent.appendChild(link);
                    index = urlEnd + 1;
                    plainStart = index;
                    continue;
                }
            }
        }

        if (tag && closing !== -1) {
            flushPlain(index);
            const element = node(tag, tag === "code" ? "inline-code" : null);
            const inner = text.slice(index + delimiter.length, closing);

            if (tag === "code") {
                element.textContent = inner;
            } else {
                appendInlineMarkdown(element, inner, depth + 1);
            }

            parent.appendChild(element);
            index = closing + delimiter.length;
            plainStart = index;
            continue;
        }

        index++;
    }

    flushPlain(text.length);
}


function isMarkdownBlockStart(line) {
    return (
        /^\s{0,3}#{1,6}\s+/.test(line) ||
        /^\s{0,3}(```|~~~)/.test(line) ||
        /^\s{0,3}>/.test(line) ||
        /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
        /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
    );
}


function appendMarkdownParagraph(parent, lines) {

    const paragraph = node("p", "md-paragraph");

    lines.forEach((line, index) => {
        if (index > 0) paragraph.appendChild(node("br"));
        appendInlineMarkdown(paragraph, line);
    });

    parent.appendChild(paragraph);
}


function markdownTableCells(line) {

    const normalized = String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "");
    return normalized.split("|").map(cell => cell.trim());
}


function isMarkdownTableSeparator(line) {

    const cells = markdownTableCells(line);

    return (
        cells.length > 0 &&
        cells.every(cell => /^:?-{1,}:?$/.test(cell))
    );
}


function appendMarkdownTable(parent, headerLine, rows) {

    const table = node("table", "md-table");
    const head = node("thead");
    const headRow = node("tr");

    for (const cell of markdownTableCells(headerLine)) {
        const th = node("th");
        appendInlineMarkdown(th, cell);
        headRow.appendChild(th);
    }

    head.appendChild(headRow);
    table.appendChild(head);

    const body = node("tbody");
    const headerCount = markdownTableCells(headerLine).length;

    for (const row of rows) {
        const tr = node("tr");
        const cells = markdownTableCells(row);

        for (let index = 0; index < headerCount; index++) {
            const td = node("td");
            appendInlineMarkdown(td, cells[index] || "");
            tr.appendChild(td);
        }

        body.appendChild(tr);
    }

    table.appendChild(body);
    parent.appendChild(table);
}


function renderMarkdown(parent, value) {

    const markdown = String(value ?? "").replace(/\r\n?/g, "\n");
    parent.innerHTML = "";

    if (markdown.trim() === "") {
        return;
    }

    const lines = markdown.split("\n");
    let index = 0;

    while (index < lines.length) {

        const line = lines[index];

        if (line.trim() === "") {
            index++;
            continue;
        }

        if (
            line.includes("|") &&
            index + 1 < lines.length &&
            isMarkdownTableSeparator(lines[index + 1])
        ) {
            const tableRows = [];
            index += 2;

            while (
                index < lines.length &&
                lines[index].trim() !== "" &&
                lines[index].includes("|")
            ) {
                tableRows.push(lines[index]);
                index++;
            }

            appendMarkdownTable(parent, line, tableRows);
            continue;
        }

        const fence = /^\s{0,3}(```|~~~)\s*([^\s]*)\s*$/.exec(line);

        if (fence) {
            const marker = fence[1];
            const language = fence[2] || "";
            const codeLines = [];
            index++;

            while (index < lines.length && !new RegExp(`^\\s{0,3}${marker}`).test(lines[index])) {
                codeLines.push(lines[index]);
                index++;
            }

            if (index < lines.length) index++;

            const pre = node("pre", "md-code-block");
            const code = node("code");
            if (language) code.className = `language-${language}`;
            code.textContent = codeLines.join("\n");
            pre.appendChild(code);
            parent.appendChild(pre);
            continue;
        }

        const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading) {
            const headingNode = node(`h${heading[1].length}`, "md-heading");
            appendInlineMarkdown(headingNode, heading[2]);
            parent.appendChild(headingNode);
            index++;
            continue;
        }

        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
            parent.appendChild(node("hr"));
            index++;
            continue;
        }

        if (/^\s{0,3}>/.test(line)) {
            const quoteLines = [];
            while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
                index++;
            }
            const quote = node("blockquote", "md-quote");
            renderMarkdown(quote, quoteLines.join("\n"));
            parent.appendChild(quote);
            continue;
        }

        const listItem = /^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/.exec(line);
        if (listItem) {
            const ordered = /^\d/.test(listItem[1]);
            const list = node(ordered ? "ol" : "ul", "md-list");

            while (index < lines.length) {
                const item = /^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/.exec(lines[index]);
                if (!item || /^\d/.test(item[1]) !== ordered) break;

                const listEntry = node("li");
                appendInlineMarkdown(listEntry, item[2]);
                list.appendChild(listEntry);
                index++;
            }

            parent.appendChild(list);
            continue;
        }

        const paragraphLines = [line.trim()];
        index++;

        while (
            index < lines.length &&
            lines[index].trim() !== "" &&
            !isMarkdownBlockStart(lines[index])
        ) {
            paragraphLines.push(lines[index].trim());
            index++;
        }

        appendMarkdownParagraph(parent, paragraphLines);
    }
}


function applyBubbleDirection(box, content) {

    const rtl = containsRtlText(content);
    const direction = rtl ? "rtl" : "ltr";
    box.dir = direction;
    box.setAttribute("dir", direction);
    box.classList.add(direction);
}


function appendMessageContent(box, content, className = "message-content") {

    const body = node("div", className);
    renderMarkdown(body, content);
    box.appendChild(body);
    return body;
}


function bubble(message) {

    const kind =
        message.kind || "message";

    const content = String(message.content || "");

    const box =
        node(
            "div",
            `bubble ${message.role} ${kind === "message" ? "" : kind}`.trim()
        );

    applyBubbleDirection(box, content);

    if (kind === "thinking") {

        const details = node("details");

        /* Open reasoning by default so the agent's visible text is not
           hidden behind a collapsed summary — the user reported that no AI
           text was showing, only a "thinking" label. */
        details.open = true;

        details.appendChild(
            node(
                "summary",
                null,
                `thinking${
                    message.agent
                        ? ` · ${message.agent}`
                        : ""
                }${
                    message.iteration
                        ? ` · iteration ${message.iteration}`
                        : ""
                }`
            )
        );

        appendMessageContent(box, content, "thinking-content message-content");

        /* Keep the reasoning details wrapper as the first child for the
           existing console contract; the rendered markdown sits inside it. */
        const thinkingBody = box.children[box.children.length - 1];
        details.appendChild(thinkingBody);
        box.appendChild(details);

        return box;
    }

    if (kind === "model") {

        box.appendChild(
            node(
                "span",
                "who",
                `${message.agent || "agent"} · response${
                    message.iteration
                        ? ` · iteration ${message.iteration}`
                        : ""
                }`
            )
        );

        appendMessageContent(box, content);

        if (message.truncated) {
            box.appendChild(
                node("span", "truncated", "response preview truncated")
            );
        }

        if (message.at) {
            box.appendChild(
                node(
                    "span",
                    "stamp",
                    new Date(message.at).toLocaleTimeString(
                        "en-GB",
                        { hour12: false }
                    )
                )
            );
        }

        return box;
    }

    if (kind === "git-report") {

        box.appendChild(
            node(
                "span",
                "who",
                `git${message.branch ? ` · ${message.branch}` : ""}`
            )
        );

        appendMessageContent(box, content);

        if (message.at) {

            box.appendChild(
                node(
                    "span",
                    "stamp",
                    new Date(message.at).toLocaleTimeString(
                        "en-GB",
                        { hour12: false }
                    )
                )
            );
        }

        return box;
    }

    box.appendChild(
        node(
            "span",
            "who",
            `${WHO[message.role] || message.role}${
                kind === "error"
                    ? " · failed"
                    : ""
            }`
        )
    );
    appendMessageContent(box, content);

    if (message.at) {

        box.appendChild(
            node(
                "span",
                "stamp",
                new Date(message.at).toLocaleTimeString(
                    "en-GB",
                    { hour12: false }
                )
            )
        );
    }

    return box;
}


/* -------------------------------------------------------------- sessions */

function describeSession(session) {

    return `${session.turns || 0} turn${
        (session.turns || 0) === 1 ? "" : "s"
    } · ${session.events || 0} events · ${
        new Date(session.updated_at).toLocaleString("en-GB", {
            hour12: false
        })
    }`;
}


async function openHistory() {

    if (state.historyModal && state.historyModal.isOpen()) {
        return state.historyModal;
    }

    /* Fetching the list is asynchronous. Ignore double clicks while it is
       in flight; otherwise two orphaned dialogs are pushed onto the modal
       stack and the visible one no longer matches state.historyModal. */
    if (state.historyOpening) {
        return null;
    }

    state.historyOpening = true;

    let response;

    try {
        response = await fetch("/api/sessions");
    } catch {
        state.historyOpening = false;
        return null;
    }

    if (!response.ok) {
        state.historyOpening = false;
        return null;
    }

    let payload;

    try {
        payload = await response.json();
    } catch {
        state.historyOpening = false;
        return null;
    }

    if (!payload || !Array.isArray(payload.sessions)) {
        state.historyOpening = false;
        return null;
    }

    state.sessions = payload.sessions;

    const body = node("div", "sessions");

    if (payload.sessions.length === 0) {

        body.appendChild(
            node("p", "empty", "No conversations have been saved yet.")
        );
    }

    for (const session of payload.sessions) {

        const row =
            node(
                "button",
                `session${
                    session.id === payload.current
                        ? " current"
                        : ""
                }`
            );

        row.type = "button";

        row.append(
            node("span", "name", session.title || session.id),
            node("span", "facts", describeSession(session))
        );

        row.addEventListener(
            "click",
            () => loadSession(session.id)
        );

        body.appendChild(row);
    }

    const handle =
        Modal.open({
            title: "Conversations",

            subtitle:
                `${payload.sessions.length} saved in this workspace`,

            size: "medium",

            body,

            footer:
                Modal.row(
                    Modal.button(
                        "New conversation",
                        "ghost",
                        async () => {

                            await fetch("/api/sessions", { method: "POST" });

                            handle.close("new");
                        }
                    ),
                    Modal.button(
                        "Close",
                        "",
                        () => handle.close("footer")
                    )
                ),

            onClose: () => {

                state.historyModal = null;
            }
        });

    state.historyModal = handle;
    state.historyOpening = false;

    return handle;
}


/* ------------------------------------------------------------------ mcp */

/*
| The servers this runtime can reach, and the tools they offer. A server
| is either connected, refused, or switched off, and the panel says
| which without making the operator read a log to find out.
*/

function mcpStateLabel(server) {

    if (!server.enabled) {
        return "off";
    }

    return {
        ready: "connected",
        idle: "not contacted yet",
        connecting: "connecting",
        failed: "unreachable",
        closed: "closed"
    }[server.state] || server.state;
}


function mcpServerRow(server, refresh) {

    const row = node("div", `mcp-server ${server.enabled ? server.state : "off"}`);

    const head = node("div", "mcp-head");

    head.append(
        node("span", "name", server.name),
        node("span", "chip", server.transport),
        node("span", `state ${server.enabled ? server.state : "off"}`, mcpStateLabel(server))
    );

    if (server.builtin) {
        head.appendChild(node("span", "chip", "built-in"));
    }

    row.appendChild(head);

    const facts = [];

    if (server.server && server.server.name) {
        facts.push(`${server.server.name} ${server.server.version || ""}`.trim());
    }

    if (server.connection && server.connection.url) {
        facts.push(server.connection.url);
    }

    if (server.connection && server.connection.command) {
        facts.push(
            [server.connection.command, ...(server.connection.args || [])].join(" ")
        );
    }

    facts.push(`${server.tool_count} tool${server.tool_count === 1 ? "" : "s"}`);

    if (server.stats && server.stats.calls) {
        facts.push(`${server.stats.calls} call${server.stats.calls === 1 ? "" : "s"}`);
    }

    row.appendChild(node("div", "facts", facts.join(" · ")));

    if (server.error) {
        row.appendChild(node("div", "mcp-error", server.error));
    }

    const actions = node("div", "mcp-actions");

    actions.append(
        Modal.button(
            server.enabled ? "Disable" : "Enable",
            "ghost",
            async () => {

                await fetch(
                    `/api/mcp/${encodeURIComponent(server.name)}/enabled`,
                    {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ enabled: !server.enabled })
                    }
                );

                refresh();
            }
        ),
        Modal.button(
            "Remove",
            "ghost danger",
            async () => {

                await fetch(
                    `/api/mcp/${encodeURIComponent(server.name)}`,
                    { method: "DELETE" }
                );

                refresh();
            }
        )
    );

    row.appendChild(actions);

    return row;
}


function mcpAddForm(refresh) {

    const form = node("div", "mcp-add");

    form.appendChild(node("h3", null, "Connect a server"));

    const fields = {};

    const field = (key, label, placeholder) => {

        const wrapper = node("label", "mcp-field");

        wrapper.appendChild(node("span", "label", label));

        const input = node("input");

        input.type = "text";
        input.placeholder = placeholder || "";

        wrapper.appendChild(input);

        fields[key] = input;

        form.appendChild(wrapper);

        return input;
    };

    const transportWrapper = node("label", "mcp-field");

    transportWrapper.appendChild(node("span", "label", "transport"));

    const transport = node("select");

    for (const value of ["stdio", "http", "sse", "websocket"]) {

        const option = node("option", null, value);

        option.value = value;

        transport.appendChild(option);
    }

    transportWrapper.appendChild(transport);

    form.appendChild(transportWrapper);

    field("name", "name", "github");
    field("command", "command", "npx (stdio only)");
    field("command_args", "arguments", "-y @modelcontextprotocol/server-github");
    field("url", "url", "https://host/mcp (http, sse, websocket)");
    field("token", "token", "bearer token, optional");

    // env field for stdio transport
    const envWrapper = node("label", "mcp-field");
    envWrapper.appendChild(node("span", "label", "env (JSON or KEY=VALUE lines)"));
    const envInput = node("textarea");
    envInput.placeholder = '{"GITHUB_TOKEN":"${env:GITHUB_TOKEN}"} or\\nGITHUB_TOKEN=ghp_xxx\\nNODE_ENV=production';
    envInput.rows = 3;
    envInput.style.width = "100%";
    envInput.style.resize = "vertical";
    envInput.style.fontFamily = "monospace";
    envWrapper.appendChild(envInput);
    fields.env = envInput;
    form.appendChild(envWrapper);

    const message = node("p", "mcp-message");

    form.appendChild(message);

    /*
    | A stdio server wants a command, a remote one wants a url, and
    | showing both at once is how an operator fills in the wrong one.
    */

    const applyTransport = () => {

        const local = transport.value === "stdio";

        fields.command.parentElement.hidden = !local;
        fields.command_args.parentElement.hidden = !local;
        fields.env.parentElement.hidden = !local;
        fields.url.parentElement.hidden = local;
        fields.token.parentElement.hidden = local;
    };

    transport.addEventListener("change", applyTransport);

    applyTransport();

    function parseEnvInput(raw) {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;
        // Try JSON first
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch {
            // fall through to KEY=VALUE parser
        }
        // Parse KEY=VALUE lines
        const env = {};
        const lines = trimmed.split(/\n/);
        for (const line of lines) {
            const l = line.trim();
            if (!l || l.startsWith("#")) continue;
            const eq = l.indexOf("=");
            if (eq === -1) continue;
            const k = l.slice(0, eq).trim();
            const v = l.slice(eq + 1).trim();
            if (k) env[k] = v;
        }
        return Object.keys(env).length ? env : undefined;
    }

    form.appendChild(
        Modal.row(
            Modal.button("Connect", "", async () => {

                message.textContent = "connecting…";

                const body = {
                    name: fields.name.value.trim(),
                    transport: transport.value,
                    command: fields.command.value.trim() || undefined,
                    args:
                        fields.command_args.value.trim()
                            ? fields.command_args.value.trim().split(/\s+/)
                            : undefined,
                    command_args:
                        fields.command_args.value.trim()
                            ? fields.command_args.value.trim().split(/\s+/)
                            : undefined,
                    url: fields.url.value.trim() || undefined,
                    token: fields.token.value.trim() || undefined,
                    env: parseEnvInput(fields.env.value)
                };

                const response =
                    await fetch("/api/mcp", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(body)
                    });

                const payload =
                    await response.json();

                if (!response.ok) {

                    message.textContent = payload.error;

                    return;
                }

                message.textContent = "";

                for (const input of Object.values(fields)) {
                    input.value = "";
                }

                refresh();
            })
        )
    );

    return form;
}


function mcpBody(payload, refresh) {

    const container = node("div", "mcp");

    if (!payload.enabled) {

        container.appendChild(
            node(
                "p",
                "empty",
                "MCP is switched off. Turn MCP_ENABLED on in Settings to reach external servers."
            )
        );

        return container;
    }

    if (payload.servers.length === 0) {

        container.appendChild(
            node(
                "p",
                "empty",
                "No MCP servers are configured. Add one below, or declare it in .mcp.json in the workspace."
            )
        );
    }

    for (const server of payload.servers) {

        container.appendChild(mcpServerRow(server, refresh));
    }

    for (const problem of payload.problems || []) {

        container.appendChild(node("div", "mcp-error", problem));
    }

    if (payload.tools && payload.tools.length > 0) {

        const list = node("div", "mcp-tools");

        list.appendChild(
            node("h3", null, `${payload.tools.length} tool${payload.tools.length === 1 ? "" : "s"} available`)
        );

        for (const tool of payload.tools) {

            const item = node("div", "mcp-tool");

            item.append(
                node("span", "name", tool.name),
                node("span", "facts", tool.description || "")
            );

            list.appendChild(item);
        }

        container.appendChild(list);
    }

    container.appendChild(mcpAddForm(refresh));

    return container;
}


async function openMcp() {

    if (state.mcpModal && state.mcpModal.isOpen()) {
        return state.mcpModal;
    }

    if (state.mcpOpening) {
        return null;
    }

    state.mcpOpening = true;

    const load = async (refresh) => {

        const response =
            await fetch(`/api/mcp${refresh ? "?refresh=1" : ""}`);

        return response.json();
    };

    let payload;

    try {
        payload = await load(false);
    } catch {
        state.mcpOpening = false;
        return null;
    }

    const refresh = async (force) => {

        let next;

        try {
            next = await load(force);
        } catch {
            return null;
        }

        if (state.mcpModal && state.mcpModal.isOpen()) {

            state.mcpModal.setBody(mcpBody(next, () => refresh(false)));
        }
    };

    const handle =
        Modal.open({
            title: "MCP servers",

            subtitle:
                `${payload.tool_count} tool(s) from ${
                    payload.servers.filter(server => server.state === "ready").length
                } connected server(s)`,

            size: "medium",

            body: mcpBody(payload, () => refresh(false)),

            footer:
                Modal.row(
                    Modal.button("Reconnect all", "ghost", () => refresh(true)),
                    Modal.button("Close", "", () => handle.close("footer"))
                ),

            onClose: () => {

                state.mcpModal = null;
            }
        });

    state.mcpModal = handle;
    state.mcpOpening = false;

    return handle;
}


/*
| Discussion
| ----------
| The form starts a discussion; while it runs, the same event stream
| the delegation tree uses paints the rounds into the modal as they
| happen. The final report is the only part the observer guarantees,
| so it gets its own section once discussion:finish lands.
*/

function discussionStatusLine() {

    const discussion = state.discussion;

    if (!discussion) {
        return "no discussion yet";
    }

    if (discussion.status === "running") {
        const round =
            discussion.rounds && discussion.rounds.length
                ? `round ${discussion.rounds.length} of ${discussion.max_rounds}`
                : "starting";

        return `${round} · ${discussion.personas.length} personas`;
    }

    if (discussion.status === "done") {
        return `done · ${discussion.total_rounds} round(s)${discussion.hit_max_rounds ? " · max rounds reached" : ""}`;
    }

    return `failed · ${discussion.error || "unknown error"}`;
}


function discussionReportView(report) {

    const section = node("div", "discussion-report");

    section.appendChild(node("h3", null, "Final report"));

    if (report.summary) {
        const summary = node("p", "discussion-summary");
        appendMarkdownParagraph(summary, [report.summary]);
        section.appendChild(summary);
    }

    if (report.agreed_points?.length) {
        section.appendChild(node("h4", null, "Agreed"));

        const list = node("ul", "discussion-points");

        for (const point of report.agreed_points) {
            list.appendChild(node("li", null, point));
        }

        section.appendChild(list);
    }

    if (report.unresolved?.length) {
        section.appendChild(node("h4", null, "Unresolved"));

        for (const item of report.unresolved) {
            const entry = node("div", "discussion-unresolved");

            entry.appendChild(node("strong", null, item.topic || "(topic)"));

            for (const side of item.sides || []) {
                entry.appendChild(
                    node(
                        "p",
                        null,
                        `${side.persona}: ${side.reasoning}`
                    )
                );
            }

            section.appendChild(entry);
        }
    }

    if (report.next_steps?.length) {
        section.appendChild(node("h4", null, "Next steps"));

        const ordered =
            [...report.next_steps].sort((a, b) => a.order - b.order);

        for (const step of ordered) {
            section.appendChild(
                node(
                    "p",
                    "discussion-step",
                    `${step.order}. [${step.layer}] ${step.action}`
                )
            );
        }
    }

    return section;
}


function discussionMessageView(message) {

    const details = node("details", "discussion-message");

    details.appendChild(
        node("summary", null, `${message.persona_name || message.persona} · round ${message.round}`)
    );

    const body = node("div", "discussion-message-body");
    appendMarkdownParagraph(body, [message.content || "(empty)"]);
    details.appendChild(body);

    return details;
}


function discussionObserverView(decision) {

    const box =
        node("div", `discussion-observer ${decision.decision === "FINISH" ? "finish" : "continue"}`);

    box.appendChild(
        node(
            "strong",
            null,
            `observer · round ${decision.round} → ${decision.decision}`
        )
    );

    for (const point of decision.open_points || []) {
        box.appendChild(
            node(
                "p",
                null,
                `${point.topic}${point.disagreeing?.length ? ` — ${point.disagreeing.join("; ")}` : ""}`
            )
        );
    }

    for (const instruction of Object.values(decision.instructions || {})) {
        box.appendChild(node("p", "muted", instruction));
    }

    return box;
}


function discussionHistoryView(container) {

    /* Rebuilds the modal body from state, used when the modal opens
       and when a snapshot arrives: the live stream only appends. */

    container.innerHTML = "";

    const discussion = state.discussion;

    const status = node("div", "discussion-status", discussionStatusLine());
    status.id = "discussionStatus";
    container.appendChild(status);

    if (!discussion) {
        return null;
    }

    container.appendChild(
        node("p", "discussion-task", discussion.task)
    );

    for (const round of discussion.rounds || []) {

        container.appendChild(
            node("h4", "discussion-round-head", `Round ${round.round}`)
        );

        for (const message of round.messages || []) {
            container.appendChild(discussionMessageView(message));
        }
    }

    for (const decision of discussion.observer_decisions || []) {
        container.appendChild(discussionObserverView(decision));
    }

    if (discussion.status === "failed" && discussion.error) {
        container.appendChild(node("p", "bad", discussion.error));
    }

    if (discussion.final_report) {
        container.appendChild(discussionReportView(discussion.final_report));
    }

    return container;
}


/*
| The composer's discussion options: persona checkboxes, the round
| limit and a live status line. The row sits under the task textarea
| and only exists while Discussion mode is on, so the default task
| flow stays untouched.
*/

function discussionOptionsRow() {

    const container =
        el("discussionOptions");

    if (!container || container.dataset.built === "1") {
        return container;
    }

    container.dataset.built = "1";

    const grid = node("div", "discussion-personas");

    const setAll = checked => {

        for (const box of grid.querySelectorAll("input[type=checkbox]")) {
            box.checked = checked;
        }
    };

    /* the spec's example panel, so a first run already shows a
       disagreement instead of a monologue */
    const preselect =
        new Set(["security", "backend", "frontend", "architect", "performance"]);

    for (const persona of state.discussionPersonas) {

        const label = node("label", "discussion-persona");
        label.title = persona.description;

        const checkbox = node("input", "persona-box");
        checkbox.type = "checkbox";
        checkbox.value = persona.id;
        checkbox.checked = preselect.has(persona.id);

        label.append(checkbox, node("span", null, persona.id));

        grid.appendChild(label);
    }

    const head = node("div", "discussion-persona-head");
    head.appendChild(node("span", null, "personas"));

    head.append(
        Modal.button("all", "link", () => setAll(true)),
        Modal.button("none", "link", () => setAll(false))
    );

    const bottom = node("div", "discussion-meta");

    const rounds = node("input", "filter");
    rounds.id = "discussionRounds";
    rounds.type = "number";
    rounds.min = "1";
    rounds.max = "10";
    rounds.value = "5";
    rounds.title = "maximum rounds (1-10)";

    const status = node("span", "muted discussion-status-line");
    status.id = "discussionStatusLine";

    bottom.append(
        node("span", null, "max rounds"),
        rounds,
        status
    );

    container.append(head, grid, bottom);

    return container;
}


function selectedDiscussionPersonas() {

    const boxes =
        el("discussionOptions")?.querySelectorAll(
            ".persona-box"
        );

    return [
        ...(boxes || [])
    ].filter(box => box.checked).map(box => box.value);
}


function refreshDiscussionComposerStatus() {

    const button = el("discussionButton");
    const run = el("runButton");
    const line = el("discussionStatusLine");

    const discussion = state.discussion;

    if (button) {
        button.classList.toggle("active", state.discussionMode);
    }

    if (!run) {
        return;
    }

    if (discussion?.status === "running") {

        run.disabled = true;
        run.dataset.discussionBusy = "1";
        run.textContent = "Discussion running…";

    } else if (run.dataset.discussionBusy) {

        /* a task and a discussion never run at once (the server
           refuses one while the other is going), so finishing a
           discussion always gives the button straight back */

        delete run.dataset.discussionBusy;
        run.disabled = false;

        run.textContent =
            state.discussionMode
                ? "Start discussion"
                : "Run task";
    }

    if (!line) {
        return;
    }

    line.innerHTML = "";

    if (!discussion) {
        return;
    }

    let text;

    if (discussion.status === "running") {
        const round =
            discussion.rounds?.length
                ? `${discussion.rounds.length} of ${discussion.max_rounds}`
                : "starting";

        text = `round ${round} ·`;
    } else if (discussion.status === "done") {
        text = `done in ${discussion.total_rounds} round(s) ·`;
    } else {
        text = `failed · ${discussion.error || "unknown error"}`;
    }

    line.appendChild(node("span", null, text));

    if (discussion.status !== "failed") {
        line.appendChild(
            Modal.button("view", "link", () => openDiscussion())
        );
    }
}


async function toggleDiscussionMode() {

    /* while a discussion is going, the button opens the live view
       instead of flipping the form */

    if (state.discussion?.status === "running") {
        openDiscussion();
        return;
    }

    state.discussionMode =
        !state.discussionMode;

    if (
        state.discussionMode &&
        state.discussionPersonas.length === 0
    ) {

        try {
            const response =
                await fetch("/api/discussion/personas");

            const payload =
                await response.json();

            state.discussionPersonas =
                payload.personas || [];
        } catch {
            state.discussionPersonas = [];
        }
    }

    const options =
        el("discussionOptions");

    if (options) {
        options.hidden = !state.discussionMode;
    }

    if (state.discussionMode) {
        discussionOptionsRow();
    }

    const run =
        el("runButton");

    /* the label mirrors the mode in both directions, and only while
       no discussion owns the button */

    if (run && !run.dataset.discussionBusy) {
        run.textContent =
            state.discussionMode
                ? "Start discussion"
                : "Run task";
    }

    refreshDiscussionComposerStatus();
}


async function openDiscussion() {

    if (state.discussionModal && state.discussionModal.isOpen()) {
        return state.discussionModal;
    }

    const container = node("div", "discussion");

    if (state.discussion) {
        discussionHistoryView(container);
    } else {
        container.appendChild(
            node(
                "p",
                "muted",
                "No discussion yet. Enable Discussion under the task box, pick your personas, and send the task."
            )
        );
    }

    state.discussionEl = container;

    const handle =
        Modal.open({
            title: "Discussion",
            subtitle: "specialist personas deliberate in rounds; an observer decides when to finish",
            size: "large",
            body: container,
            footer: Modal.row(Modal.button("Close", "", () => handle.close("footer"))),
            onClose: () => {
                state.discussionModal = null;
                state.discussionEl = null;
            }
        });

    state.discussionModal = handle;

    return handle;
}


function pushDiscussionEvent(event) {

    const discussion = state.discussion;

    /* A discussion may also be started from the CLI; the first start
       event adopts it, a second one is dropped. */

    if (event.type === "discussion:start") {

        if (
            !discussion ||
            discussion.status !== "running"
        ) {
            state.discussion = {
                id: event.id,
                status: "running",
                task: event.task,
                personas: event.personas,
                max_rounds: event.max_rounds,
                rounds: [],
                observer_decisions: [],
                final_report: null
            };
        } else if (discussion.id && event.id && discussion.id !== event.id) {
            return;
        }

    } else if (!discussion) {
        return;
    }

    const target = state.discussion;

    switch (event.type) {

        case "discussion:start": {
            const status = el("discussionStatus");
            if (status) {
                status.textContent = discussionStatusLine();
            }

            if (state.discussionEl) {
                /* swap the placeholder for the live view */
                discussionHistoryView(state.discussionEl);
            }

            refreshDiscussionComposerStatus();

            break;
        }

        case "discussion:message": {
            let round =
                target.rounds.find(item => item.round === event.round);

            if (!round) {
                round = { round: event.round, messages: [] };
                target.rounds.push(round);
                target.rounds.sort((a, b) => a.round - b.round);
            }

            round.messages.push({
                persona: event.persona,
                persona_name: event.persona_name,
                content: event.content,
                round: event.round
            });

            if (state.discussionEl) {
                state.discussionEl.appendChild(discussionMessageView({ ...event, round: event.round }));
            }

            break;
        }

        case "discussion:observer": {
            target.observer_decisions.push(event);

            if (state.discussionEl) {
                state.discussionEl.appendChild(discussionObserverView(event));
            }
            break;
        }

        case "discussion:round": {
            /* keeps the composer's "round N of M" label current */
            refreshDiscussionComposerStatus();
            break;
        }

        case "discussion:finish": {
            target.status = "done";
            target.total_rounds = event.total_rounds;
            target.hit_max_rounds = event.hit_max_rounds;
            target.stopped_reason = event.stopped_reason || null;
            target.final_report = event.final_report;

            const status = el("discussionStatus");
            if (status) {
                status.textContent = discussionStatusLine();
            }

            if (state.discussionEl && event.final_report) {
                state.discussionEl.appendChild(
                    discussionReportView(event.final_report)
                );
            }

            refreshDiscussionComposerStatus();

            break;
        }

        case "discussion:error": {
            target.status = "failed";
            target.error = event.error;

            const status = el("discussionStatus");
            if (status) {
                status.textContent = discussionStatusLine();
            }

            if (state.discussionEl) {
                state.discussionEl.appendChild(
                    node("p", "bad", event.error)
                );
            }

            refreshDiscussionComposerStatus();

            break;
        }
    }
}


/*
| Execution and Events live in a hidden row and are shown as header modals.
| Moving the actual node into the modal body (not a clone) keeps the live
| renderers working: el("tree")/el("log") still find the node wherever it
| is, and on close the node is returned to its hidden home.
*/

const hiddenSection = () => el("rowTwo");


/*
| Borrowing has to be reversible exactly, so where each node came from
| is recorded before it moves, and the modal is only ever given nodes it
| may own: a wrapper this function builds, never a container other nodes
| also live in.
|
| An earlier version passed the shared .execution-scroll as the modal
| body. Modal.close() detaches the backdrop before it calls onClose, so
| the scroller left with it, the restore could no longer find it, and
| the next open adopted #rowTwo itself. Closing that took the whole
| section out of the document, and el("tree") and el("log") returned
| null for the rest of the session.
*/

function borrow(nodes) {

    const homes =
        nodes
            .filter(Boolean)
            .map(element => ({
                element,
                parent: element.parentNode,
                next: element.nextSibling
            }));

    return () => {

        for (const home of homes) {

            if (!home.parent) {
                continue;
            }

            /*
            | The anchor is only usable if it is still a child of the
            | same parent; otherwise the node goes back on the end,
            | which is where it was if it had no sibling to begin with.
            */

            const anchor =
                home.next && home.next.parentNode === home.parent
                    ? home.next
                    : null;

            home.parent.insertBefore(home.element, anchor);
        }
    };
}


function openExecutionModal() {

    if (state.executionModal && state.executionModal.isOpen()) {
        return state.executionModal;
    }

    /* A modal can be removed by browser/navigation cleanup without the
       component callback running. Do not let that stale handle block every
       future Execution click. */
    state.executionModal = null;

    const tree = el("tree");
    const archive = el("executionArchive");

    if (!tree && !archive) {
        return null;
    }

    const restore =
        borrow([archive, tree]);

    /*
    | A wrapper the modal owns, wearing the class the stylesheet already
    | targets, so the cards are shown without the page's own scroller
    | being taken away from it.
    */

    const body = node("div", "execution-scroll");

    if (archive) {
        body.appendChild(archive);
    }

    if (tree) {
        body.appendChild(tree);
    }

    const handle =
        Modal.open({
            title: "Execution",

            subtitle:
                () => {

                    const summary = el("execSummary");

                    return summary ? summary.textContent || null : null;
                },

            size: "large",

            body,

            className: "execution-modal",

            onClose: () => {

                try {
                    restore();
                } finally {
                    state.executionModal = null;
                }
            }
        });

    state.executionModal = handle;

    return handle;
}


function openEventsModal() {

    if (state.eventsModal && state.eventsModal.isOpen()) {
        return state.eventsModal;
    }

    state.eventsModal = null;

    const log = el("log");
    const filter = el("logFilter");
    const type = el("logType");
    const clear = el("clearLog");
    const count = el("logCount");

    if (!log) {
        return null;
    }

    const restore =
        borrow([filter, type, clear, count, log]);

    const controls = node("div", "log-controls");

    for (const control of [filter, type, count, clear]) {

        if (control) {
            controls.appendChild(control);
        }
    }

    const body = node("div", "events-modal-body");

    body.appendChild(controls);
    body.appendChild(log);

    const handle =
        Modal.open({
            title: "Events",

            size: "large",

            body,

            className: "events-modal",

            onClose: () => {

                try {
                    restore();
                } finally {
                    state.eventsModal = null;
                }
            }
        });

    state.eventsModal = handle;

    /* the filter only makes sense next to the count of what it kept */

    applyLogFilter();

    return handle;
}


/*
| Opening a conversation replays the events it stored, so the Execution
| and Events cards are rebuilt by the same code that draws them live.
| Nothing is summarised for storage, which is why this works at all.
*/

async function refreshSession(id) {

    const response =
        await fetch(`/api/sessions/${encodeURIComponent(id)}`);

    if (!response.ok) {
        return;
    }

    const payload =
        await response.json();

    applySession(payload.session);
}


async function loadSession(id) {

    const response =
        await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
            method: "POST"
        });

    if (!response.ok) {
        return;
    }

    const payload =
        await response.json();

    applySession(payload.session);

    if (state.historyModal) {
        state.historyModal.close("loaded");
    }
}


function applySession(session) {

    resetRun(true);

    state.messages = normalizeConversationMessages(session.messages);

    state.session = {
        id: session.id,
        title: session.title,
        turns: session.turns
    };

    el("sessionTitle").textContent =
        session.title || "new conversation";

    state.events = [];
    el("log").innerHTML = "";

    for (const event of session.events || []) {
        apply(event);
    }

    for (const call of session.calls || []) {

        if (call.key && !state.calls.has(call.key)) {

            state.calls.set(call.key, {
                ...call,
                argumentsPreview:
                    JSON.stringify(call.arguments ?? {}, null, 2),
                duration: call.duration_ms
            });
        }
    }

    renderChat();
    renderTree();
}


/* ------------------------------------------------------------- approvals */

function renderApprovals() {

    const pending =
        [...state.approvals.values()];

    const button = el("approvalsButton");

    button.hidden = pending.length === 0;

    el("approvalsCount").textContent = String(pending.length);

    if (pending.length === 0) {

        if (state.approvalModal) {

            const handle = state.approvalModal;

            state.approvalModal = null;

            handle.close("resolved");
        }

        return;
    }

    if (!state.approvalModal) {
        openApprovalModal();

        return;
    }

    fillApprovalModal();
}


function openApprovalModal() {

    state.approvalModal =
        Modal.open({
            title: "Approval required",
            size: "medium",
            dismissible: true,

            onClose: () => {

                state.approvalModal = null;
            }
        });

    fillApprovalModal();
}


function fillApprovalModal() {

    const handle = state.approvalModal;

    if (!handle) {
        return;
    }

    const pending =
        [...state.approvals.values()];

    const current = pending[0];

    handle.setTitle(`Approval required — ${current.tool}`);

    handle.setSubtitle(
        `1/${pending.length} pending · requested by ${current.agent}`
    );

    const body = node("div", "detail");

    const list = node("dl", "detail-grid");

    definition(list, "tool", current.tool);
    definition(list, "agent", current.agent);
    definition(list, "reason", current.reason);

    definition(
        list,
        "groups",
        (current.groups || []).join(", ")
    );

    body.appendChild(list);

    const block = node("div", "detail-block");

    block.append(
        node("h3", null, "Arguments"),
        node(
            "pre",
            null,
            JSON.stringify(current.arguments ?? {}, null, 2)
        )
    );

    body.appendChild(block);

    if (pending.length > 1) {

        const queue = node("div", "detail-block");

        queue.appendChild(node("h3", null, "Also waiting"));

        const rest = node("ul", "queue");

        for (const item of pending.slice(1)) {

            rest.appendChild(
                node(
                    "li",
                    null,
                    `${item.tool} · ${item.agent} · ${shorten(
                        JSON.stringify(item.arguments ?? {}),
                        60
                    )}`
                )
            );
        }

        queue.appendChild(rest);

        body.appendChild(queue);
    }

    handle.setBody(body);

    handle.setFooter(
        Modal.row(
            Modal.button(
                "Deny",
                "refuse",
                () => answerApproval(current.id, false)
            ),
            Modal.button(
                "Approve",
                "allow",
                () => answerApproval(current.id, true)
            ),
            pending.length > 1
                ? Modal.button(
                    `Approve all (${pending.length})`,
                    "ghost",
                    () => approveAll()
                )
                : null
        )
    );
}


async function answerApproval(id, approved) {

    state.approvals.delete(id);

    renderApprovals();

    await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved })
    });
}


async function approveAll() {

    const ids =
        [...state.approvals.keys()];

    state.approvals.clear();

    renderApprovals();

    for (const id of ids) {

        await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ approved: true })
        });
    }
}


/* -------------------------------------------------------------- log line */

function describeEvent(event) {

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


function log(event) {

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
                state.calls.get(event.call_key);

            if (call) {
                openCallDetail(call, state.graphs.get(call.graph_id));
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


function updateLogCount() {

    const count = el("logCount");

    const list = el("log");

    if (!count || !list) {
        return;
    }

    const total = list.children.length;

    if (state.logFilter === "" && !state.logType) {

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

function logTypesPresent() {

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

    if (state.logType) {
        types.add(state.logType);
    }

    return [...types].sort();
}


function refreshLogTypes() {

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

    select.value = state.logType || "";
}


function matchesLogFilter(item) {

    if (
        state.logType &&
        item.dataset.type !== state.logType
    ) {
        return false;
    }

    if (state.logFilter === "") {
        return true;
    }

    return (item.dataset.text || "").includes(state.logFilter);
}


function applyLogFilter() {

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
            state.logFilter === "" && !state.logType
                ? `${total} event${total === 1 ? "" : "s"}`
                : `${shown} of ${total}`;

        count.hidden = total === 0;
    }

    return shown;
}


/* ---------------------------------------------------------------- status */

function setStatus(status) {

    state.status = status;

    el("statusDot").className = `dot ${status}`;
    el("statusText").textContent = status;

    el("runButton").disabled = status === "running";
    el("cancelButton").disabled = status !== "running";

    if (status === "running") {

        state.startedAt = state.startedAt || Date.now();

        if (!state.timer) {

            state.timer =
                setInterval(
                    () => {

                        el("runTimer").textContent =
                            `${(
                                (Date.now() - state.startedAt) / 1000
                            ).toFixed(1)} s`;
                    },
                    100
                );
        }

    } else {

        clearInterval(state.timer);

        state.timer = null;
        state.startedAt = null;
    }
}


/* ---------------------------------------------------------------- events */

function resetRun(clearArchive = false) {

    state.agents.clear();
    state.order = [];
    state.graphs.clear();
    state.calls.clear();
    state.approvals.clear();
    state.loops = [];
    state.hooks.clear();
    state.hookOrder = [];
    state.currentTask = null;
    state.openExecutionKeys.clear();

    if (clearArchive) {
        el("executionArchive").innerHTML = "";
    }
}


function pushMessage(message) {

    state.messages.push(
        normalizeConversationMessage(message)
    );

    renderChat();
}


function eventVisibleForCurrentProject(event) {

    if (!state.currentProjectId) {
        return true;
    }

    if (!event || !event.project_id) {
        return true;
    }

    return event.project_id === state.currentProjectId;
}


function apply(event) {

    if (!eventVisibleForCurrentProject(event)) {
        return;
    }

    if (event.plan) {
        state.plan = event.plan;
        renderPlan();
    }

    /* Keep every event so a user message's execution can be re-rendered
       as a stage-by-stage block under that message (keyed by turn_id).
       Bounded so a long session does not grow without limit in the page. */
    state.events.push(event);

    if (state.events.length > 5000) {
        state.events = state.events.slice(-5000);
    }

    /* Execution steps that appear under a user message refresh that turn's
       block in place rather than re-rendering the whole conversation, so
       the UI stays stable and open blocks do not close on every event. */
    if (
        ["agent:iteration", "agent:action", "tool:start", "tool:end", "run:malformed"].includes(event.type)
    ) {
        refreshTurnExecution(messageExecutionKey(event));
    }

    switch (event.type) {

        case "run:start":
            archiveCurrentExecution();
            resetRun();

            state.currentTask = event.task;

            agentNode("main_agent", 0, { task: event.task });

            setStatus("running");

            renderTree();
            renderApprovals();
            break;

        case "agent:start":
            agentNode(
                event.scope || event.agent,
                event.depth,
                {
                    name: event.agent,
                    task: event.task,
                    parent: event.parent,
                    parentScope: event.parent_scope,
                    persona: event.persona,
                    delegationId: event.delegation_id
                }
            );

            renderTree();
            break;

        case "agent:iteration": {

            const agent =
                agentNode(event.scope || event.agent, event.depth);

            agent.iterations = event.iteration;

            renderTree();
            break;
        }

        case "agent:end": {

            const agent =
                agentNode(event.scope || event.agent, event.depth);

            agent.status =
                event.success
                    ? "done"
                    : "failed";

            renderTree();
            break;
        }

        case "delegation:start":
            for (const item of event.delegations) {

                agentNode(
                    `${item.agent}#${(event.depth || 0) + 1}`,
                    (event.depth || 0) + 1,
                    {
                        name: item.agent,
                        task: item.task,
                        parent: event.parent,
                        parentScope: event.parent_scope,
                        delegationId: item.id
                    }
                );
            }

            renderTree();
            break;

        case "delegation:graph": {

            const parent =
                agentNode(
                    event.parent_scope || event.parent,
                    Math.max(0, (event.depth || 1) - 1)
                );

            parent.delegationShape = event.shape;

            renderTree();
            break;
        }

        case "hook:start": {

            const key = `${event.phase}:${event.id}`;

            state.hooks.set(key, {
                ...event,
                status: "running",
                summary: null
            });

            if (!state.hookOrder.includes(key)) {
                state.hookOrder.push(key);
            }

            renderTree();
            break;
        }

        case "hook:end": {

            const key = `${event.phase}:${event.id}`;
            const before = state.hooks.get(key) || {};

            state.hooks.set(key, {
                ...before,
                ...event,
                hook_type: event.hook_type || before.hook_type,
                status: event.status || (event.ok ? "done" : "failed")
            });

            if (!state.hookOrder.includes(key)) {
                state.hookOrder.push(key);
            }

            renderTree();
            break;
        }

        case "tool:graph": {

            const graph = graphNode(event);

            graph.maxParallel = event.max_parallel;

            renderTree();
            break;
        }

        case "tool:start": {

            const graph = graphNode(event);

            const call = {
                key: event.call_key,
                id: event.id,
                agent: event.agent,
                name: event.name,
                graph_id: graph.id,
                wave: event.wave ?? null,
                iteration: event.iteration ?? null,
                depends_on: event.depends_on || [],
                argumentsPreview:
                    event.arguments_preview ??
                    JSON.stringify(event.arguments ?? {}, null, 2),
                startedAt: event.at ?? null,
                status: "running"
            };

            graph.calls.set(call.id, call);

            if (!graph.order.includes(call.id)) {
                graph.order.push(call.id);
            }

            if (call.key) {
                state.calls.set(call.key, call);
            }

            renderTree();
            break;
        }

        case "tool:end": {

            const graph = graphNode(event);

            const call =
                graph.calls.get(event.id) || {
                    id: event.id,
                    agent: event.agent,
                    name: event.name,
                    graph_id: graph.id,
                    depends_on: [],
                    argumentsPreview: "{}"
                };

            call.key = event.call_key || call.key;

            /*
            | A non-zero exit code, or a tool that warned about what it
            | did, is not a clean success and must not be drawn as one.
            */

            call.status =
                !event.success
                    ? "failed"
                    : event.exit_code
                        ? "exit"
                        : event.warning
                            ? "warned"
                            : "done";

            call.exitCode = event.exit_code ?? null;
            call.warning = event.warning || null;
            call.duration = event.duration_ms;

            /* the interval is what "ran alongside" is measured on: prefer the
               executor's own start, fall back to the envelope */
            call.startedAt =
                event.started_at ?? call.startedAt ?? event.at ?? null;
            call.finishedAt = event.at ?? call.finishedAt ?? null;

            call.wave = event.wave ?? call.wave ?? null;
            call.iteration = event.iteration ?? call.iteration ?? null;
            call.resultPreview = event.result_preview ?? null;
            call.resultChars = event.result_chars ?? null;
            call.error = event.error || null;

            graph.calls.set(call.id, call);

            if (!graph.order.includes(call.id)) {
                graph.order.push(call.id);
            }

            if (call.key) {
                state.calls.set(call.key, call);
            }

            renderTree();
            break;
        }

        case "delegation:end": {

            /*
            | A delegation that failed before its agent existed has no
            | node of its own, so the parent carries the failure.
            */

            if (!event.success) {

                const parent =
                    agentNode(
                        event.parent_scope || event.parent || "main_agent"
                    );

                parent.loops.push({
                    outcome: "stopped",
                    repeats: 1,
                    signature:
                        `delegation ${event.id} to ${event.agent}: ${event.error}`
                });

                renderTree();
            }

            break;
        }

        case "run:loop": {

            state.loops.push(event);

            const agent =
                agentNode(event.scope || event.agent || "main_agent");

            agent.loops.push(event);

            renderTree();
            break;
        }

        case "skill:read": {

            const agent =
                agentNode(event.agent || "main_agent");

            agent.skills = agent.skills || [];

            const label =
                `${event.skill} · ${event.resource}`;

            if (!agent.skills.includes(label)) {
                agent.skills.push(label);
            }

            renderTree();
            break;
        }

        case "skill:loaded": {

            const agent =
                agentNode(
                    event.scope || event.agent || "main_agent"
                );

            agent.skills = agent.skills || [];

            for (const name of event.skills) {

                if (!agent.skills.includes(name)) {
                    agent.skills.push(name);
                }
            }

            renderTree();
            break;
        }

        case "report:mismatch": {

            const agent =
                agentNode(event.agent || "main_agent");

            agent.loops.push({
                outcome: "stopped",
                repeats: event.problems.length,
                signature:
                    `answer claimed work that never ran: ${
                        event.problems.join("; ")
                    }`
            });

            renderTree();
            break;
        }

        case "run:malformed": {

            /*
            | An answer the runtime could not read is a debugging fact,
            | so it sits on the agent that produced it rather than only
            | scrolling past in the log.
            */

            const agent =
                agentNode(event.scope || event.agent || "main_agent");

            agent.loops.push({
                outcome:
                    event.outcome === "stopped"
                        ? "malformed_stopped"
                        : "malformed",

                repeats: event.attempt,

                signature: event.reason,

                reason: event.reason
            });

            renderTree();
            break;
        }

        case "approval:request":
            state.approvals.set(event.id, event);
            renderApprovals();
            break;

        case "approval:resolved":
            state.approvals.delete(event.id);
            renderApprovals();
            break;

        case "run:end":
            for (const agent of state.agents.values()) {

                if (agent.status === "running") {
                    agent.status = "done";
                }
            }

            renderTree();
            break;

        case "run:auto_continue":
            el("turns").textContent = `cycle ${event.cycle}`;
            break;

        case "run:status":
            setStatus(event.status);

            state.waiting = null;

            clearInterval(state.waitingTimer);

            state.waitingTimer = null;

            renderChat();

            /* Phase 11: a multi-project composer run is a sequence of
               labelled single-project tasks, not a parallel fan-out. */
            if (event.status !== "running") {
                drainProjectTaskQueue();
            }

            break;

        case "request:start":
            state.waiting = {
                agent: event.agent,
                role: event.role,
                since: Date.now()
            };

            if (!state.waitingTimer) {

                /* Only the elapsed text changes while the endpoint works.
                   Rebuilding the conversation here used to destroy text
                   selection, scroll position and open reasoning details five
                   times a second. */
                state.waitingTimer =
                    setInterval(updateWaitingElapsed, 200);
            }

            renderChat();
            break;

        case "request:end":
            state.waiting = null;

            clearInterval(state.waitingTimer);

            state.waitingTimer = null;

            renderChat();
            break;

        case "session:message":
            /*
            | The server owns the conversation, so the browser draws what
            | it is told rather than guessing from the run.
            */
            pushMessage(event.message);
            break;

        case "session:switched": {

            const same =
                state.session &&
                state.session.id === event.session.id;

            state.session = event.session;

            el("sessionTitle").textContent =
                event.session.title || "new conversation";

            /*
            | Another console, or the history dialog, moved to a
            | different conversation. Load it rather than showing the
            | previous one under a new name.
            */

            if (!same) {
                refreshSession(event.session.id);
            }

            break;
        }

        case "settings:changed":
            loadSettings();
            break;

        case "session:cleared":
            resetRun(true);

            state.messages = [];

            el("log").innerHTML = "";

            setStatus("idle");

            renderChat();
            renderTree();
            renderApprovals();
            break;

        case "discussion:start":
        case "discussion:message":
        case "discussion:observer":
        case "discussion:round":
        case "discussion:finish":
        case "discussion:error":
            pushDiscussionEvent(event);
            break;

        default:
            break;
    }

    log(event);
}


function applySnapshot(snapshot) {

    resetRun(true);
    state.events = [];
    el("log").innerHTML = "";
    renderTree();

    state.plan = snapshot.plan || null;
    renderPlan();

    el("workspace").textContent = snapshot.workspace;
    el("model").textContent = snapshot.model;

    /* the policy controls live here while Settings is closed and inside the
       modal while it is open; either way they are in the document, but a
       render must never break because one of them is momentarily not */
    const approvalMode = el("approvalMode");

    if (approvalMode) {
        approvalMode.value = snapshot.approval_mode;
    }

    if (snapshot.settings) {
        state.settings = snapshot.settings;
    }

    el("turns").textContent =
        `${snapshot.turns} turns${
            snapshot.cycles
                ? `, cycle ${snapshot.cycles}`
                : ""
        }`;

    const autoContinue = el("autoContinue");

    if (autoContinue) {
        autoContinue.checked = Boolean(snapshot.auto_continue);
    }
    el("autoSwitchStatus").textContent = `auto-switch · ${snapshot.auto_continue ? "on" : "off"}`;

    state.messages = normalizeConversationMessages(snapshot.messages);

    state.session = snapshot.session || null;

    /* A running or finished discussion redraws from the snapshot, so a
       reload mid-discussion resumes the transcript at the right round. */
    state.discussion = snapshot.discussion || null;

    if (state.discussionModal && state.discussionModal.isOpen()) {
        discussionHistoryView(state.discussionEl);
    }

    refreshDiscussionComposerStatus();

    state.sessions = snapshot.sessions || [];

    el("sessionTitle").textContent =
        snapshot.session
            ? snapshot.session.title || "new conversation"
            : "";

    renderChat();

    for (const event of snapshot.events || []) {
        /* Messages are already authoritative in snapshot.messages. Replaying
           their transport events would duplicate every bubble after reload. */
        if (event.type !== "session:message") {
            apply(event);
        }
    }

    for (const approval of snapshot.pending_approvals || []) {

        state.approvals.set(approval.id, approval);
    }

    renderApprovals();

    setStatus(snapshot.status);
}


/* -------------------------------------------------------------- settings */

const GROUP_ORDER = [
    "endpoint",
    "endpoint.main", "endpoint.l1", "endpoint.l2", "endpoint.l3", "endpoint.summary",
    "memory", "archive", "journal", "context", "budget", "delegation", "planning", "hooks",
    "persistence", "policy", "tools", "mcp", "output", "workspace"
];


/*
| The runtime policy controls (approval mode, auto continue) live in the
| Settings modal rather than the header, but their ids must stay on the
| page for the change handlers to find them. While the modal is closed
| they rest in a hidden home; opening Settings borrows the labels the
| same way the execution and events cards are borrowed, and closing it
| returns them.
|
| Modal.close() detaches the backdrop before onClose runs, so an id
| lookup at return time would find nothing — the borrowed nodes are
| captured by reference here, exactly like the card homes do.
*/

const policyBorrow = { home: null, chips: [] };


function borrowPolicyControls(container) {

    const home = el("policyHome");

    if (!home || !container) {
        return;
    }

    const chips = [];

    for (const id of ["approvalMode", "autoContinue"]) {

        const control = el(id);
        const chip = control && control.parentElement;

        if (chip && chip.tagName === "LABEL") {
            chips.push(chip);
        }
    }

    /*
    | Nothing moved, nothing to return: the borrow state stays as it was
    | rather than recording a home with no chips, which would make the next
    | open believe a borrow is already in flight.
    */
    if (chips.length === 0) {
        return;
    }

    const row = node("div", "policy-row");

    row.appendChild(node("span", "policy-title", "runtime policy"));

    for (const chip of chips) {
        row.appendChild(chip);
    }

    policyBorrow.home = home;
    policyBorrow.chips = chips;

    const policySection = container.querySelector(".runtime-policy-settings");

    if (policySection) {
        policySection.appendChild(row);
    } else {
        container.appendChild(row);
    }
}


function returnPolicyControls() {

    const home = policyBorrow.home;

    if (!home) {
        return;
    }

    for (const chip of policyBorrow.chips) {

        if (chip.parentNode !== home) {
            home.appendChild(chip);
        }
    }

    policyBorrow.home = null;
    policyBorrow.chips = [];
}


function isLlmSetting(setting) {

    return setting.group.startsWith("endpoint") ||
        ["AGENT_PROVIDER", "AGENT_PROVIDER_REGION", "AGENT_MODEL", "AGENT_BASE_URL", "AGENT_API_KEY", "AGENT_PROXY_URL", "AZURE_OPENAI_API_VERSION", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY", "BEDROCK_SESSION_TOKEN"].includes(setting.key);
}


function settingsBody(list) {

    const container = node("div", "settings");

    const search = node("input", "filter");

    search.type = "search";
    search.placeholder = "filter settings and policy";

    container.appendChild(search);

    const groups = new Map();

    for (const setting of list) {

        if (!groups.has(setting.group)) {
            groups.set(setting.group, []);
        }

        groups.get(setting.group).push(setting);
    }

    const ordered =
        [...groups.keys()].sort(
            (a, b) =>
                GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)
        );

    const policySection = node("section", "runtime-policy-settings");
    policySection.appendChild(node("h3", null, "runtime policy"));
    container.appendChild(policySection);

    search.placeholder = "filter settings and policy";

    for (const name of ordered) {

        const section = node("div", "group");

        section.appendChild(node("h3", null, name));

        for (const setting of groups.get(name)) {

            section.appendChild(settingRow(setting));
        }

        container.appendChild(section);
    }

    search.addEventListener("input", () => {

        const term =
            search.value.trim().toLowerCase();

        const policySection = container.querySelector(".runtime-policy-settings");
        const policyRow = policySection && policySection.querySelector(".policy-row");
        if (policyRow) {
            policyRow.hidden = term !== "" && !policyRow.textContent.toLowerCase().includes(term);
            policySection.hidden = policyRow.hidden;
        }

        for (const section of container.querySelectorAll(".group")) {

            let visible = 0;

            for (const row of section.querySelectorAll(".setting")) {

                const match =
                    term === "" ||
                    row.dataset.key.toLowerCase().includes(term) ||
                    (row.dataset.hint || "").includes(term);

                row.hidden = !match;

                visible += match ? 1 : 0;
            }

            section.hidden = visible === 0;
        }
    });

    /*
    | The caller decides when to borrow: settingsBody() is a pure builder, so
    | a failed Modal.open() cannot strand the policy controls in a body that
    | never reached the page.
    */
    return container;
}


function settingRow(setting) {

    const row = node("div", "setting");

    row.dataset.key = setting.key;
    row.dataset.hint = (setting.description || "").toLowerCase();

    const label = node("div");

    label.append(
        node("div", "label", setting.key),
        node(
            "div",
            "hint",
            `${setting.description}${
                setting.fixed
                    ? " (fixed at startup)"
                    : ""
            }`
        )
    );

    let input;

    if (setting.type === "boolean" || setting.type === "enum" || /(?:^|_)MODEL$/.test(setting.key)) {

        input = node("select");

        const isModel = /(?:^|_)MODEL$/.test(setting.key);
        const values =
            isModel
                ? [setting.value || ""]
                : setting.type === "boolean"
                    ? ["true", "false"]
                    : setting.values;

        for (const option of values) {
            const element = node("option", null, option || "Choose a model");
            element.value = option;
            input.appendChild(element);
        }

        input.value = String(setting.value || "");

        if (isModel) {
            const role = setting.key.match(/^ENDPOINT_(MAIN|L1|L2|L3|SUMMARY)_MODEL$/)?.[1] || "MAIN";
            fetch(`/api/models?role=${encodeURIComponent(role)}`)
                .then(response => response.json())
                .then(payload => {
                    if (!Array.isArray(payload.models)) throw new Error(payload.error || "Model list unavailable");
                    for (const modelName of payload.models) {
                        if ([...input.children].some(option => option.value === modelName)) continue;
                        const option = node("option", null, modelName);
                        option.value = modelName;
                        input.appendChild(option);
                    }
                    input.value = String(setting.value || "");
                })
                .catch(error => {
                    input.title = error.message;
                });
        }

    } else {

        input = node("input");

        input.type =
            setting.secret
                ? "password"
                : setting.type === "number"
                    ? "number"
                    : "text";

        if (setting.secret && setting.value) {
            input.placeholder = "Configured — enter a replacement";
        }

        if (setting.min !== undefined) {
            input.min = setting.min;
        }

        if (setting.max !== undefined) {
            input.max = setting.max;
        }

        input.value =
            setting.secret || setting.value === null
                ? ""
                : setting.value;
    }

    input.disabled = setting.fixed;

    input.addEventListener("change", async () => {

        const response =
            await fetch("/api/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    key: setting.key,
                    value: input.value
                })
            });

        const payload =
            await response.json();

        if (!response.ok) {

            input.value = setting.secret ? "" : setting.value;

            row.classList.add("rejected");

            row.querySelector(".hint").textContent = payload.error;

            return;
        }

        row.classList.add("saved");

        setTimeout(
            () => row.classList.remove("saved"),
            800
        );

        loadSettings();
    });

    const source = node("span", `src ${setting.source}`, setting.source);

    source.title =
        setting.source === "override"
            ? "changed here, click to restore"
            : setting.source;

    if (setting.source === "override" && !setting.fixed) {

        source.style.cursor = "pointer";

        source.onclick = async () => {

            await fetch("/api/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    key: setting.key,
                    reset: true
                })
            });

            loadSettings();
        };
    }

    row.append(label, input, source);

    return row;
}


async function loadSettings() {

    const response =
        await fetch("/api/settings");

    const payload =
        await response.json();

    state.settings = payload.settings;

    if (state.settingsModal && state.settingsModal.isOpen()) {

        const body = settingsBody(state.settings.filter(setting => !isLlmSetting(setting)));

        /* borrow before the swap: setBody() empties the content slot, and the
           chips resting in the old body would leave the document with it */
        borrowPolicyControls(body);
        state.settingsModal.setBody(body);
    }

    if (state.llmSettingsModal && state.llmSettingsModal.isOpen()) {
        state.llmSettingsModal.setBody(settingsBody(state.settings.filter(isLlmSetting)));
    }
}


function openSettings() {

    if (state.settingsModal && state.settingsModal.isOpen()) {
        return;
    }

    const body = settingsBody(state.settings.filter(setting => !isLlmSetting(setting)));

    state.settingsModal =
        Modal.open({
            title: "Settings",
            subtitle: "applied on next use, no restart",
            size: "large",
            body,

            footer:
                Modal.row(
                    Modal.button(
                        "Reload",
                        "ghost",
                        () => loadSettings()
                    ),
                    Modal.button(
                        "Close",
                        "",
                        () => state.settingsModal.close("footer")
                    )
                ),

            onClose: () => {

                returnPolicyControls();
                state.settingsModal = null;
            }
        });

    /* the modal is on the page now, so the borrowed labels have a live home
       and an onClose that will always put them back */
    borrowPolicyControls(body);

    loadSettings();
}


function openLlmSettings() {

    if (state.llmSettingsModal && state.llmSettingsModal.isOpen()) return;

    const body = settingsBody(state.settings.filter(isLlmSetting));
    state.llmSettingsModal = Modal.open({
        title: "LLM settings",
        subtitle: "Providers, model layers, and proxy",
        size: "large",
        body,
        onClose: () => { state.llmSettingsModal = null; }
    });
    loadSettings();
}


function openPlanModal() {

    if (state.planModal && state.planModal.isOpen()) return;
    const panel = el("planPanel");
    if (!panel) return;
    panel.hidden = false;
    state.planModal = Modal.open({
        title: "Plan",
        size: "large",
        body: panel,
        onClose: () => {
            panel.hidden = true;
            const home = el("consoleMain");
            if (home && panel.parentNode !== home) home.appendChild(panel);
            state.planModal = null;
        }
    });
}


/* ----------------------------------------------------------- projects UI */

function browserLocation() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.location) {
            return globalThis.location;
        }

    } catch {
        /* tests / workers */
    }

    return { pathname: "/", search: "" };
}


function browserHistory() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.history) {
            return globalThis.history;
        }

    } catch {
        /* tests */
    }

    return null;
}


function browserStorage() {

    try {

        if (typeof globalThis !== "undefined" && globalThis.localStorage) {
            return globalThis.localStorage;
        }

    } catch {
        /* private mode */
    }

    return null;
}


function readStoredProjectId() {

    const storage = browserStorage();

    if (!storage) {
        return null;
    }

    try {
        return storage.getItem(PROJECT_STORAGE_KEY);
    } catch {
        return null;
    }
}


function writeStoredProjectId(projectId) {

    const storage = browserStorage();

    if (!storage) {
        return;
    }

    try {

        if (projectId) {
            storage.setItem(PROJECT_STORAGE_KEY, projectId);
        } else {
            storage.removeItem(PROJECT_STORAGE_KEY);
        }

    } catch {
        /* private mode */
    }
}


function parseProjectRoute() {

    const location = browserLocation();
    const pathname = location.pathname || "/";
    const search = location.search || "";
    const params = new URLSearchParams(search);
    const match = /^\/projects\/([^/]+)\/?$/.exec(pathname);
    const tab = params.get("tab") || "overview";

    return {
        projectId: match ? decodeURIComponent(match[1]) : params.get("project"),
        dashboard: Boolean(match),
        tab
    };
}


function navigateConsole(projectId, tab, replace) {

    const dashboard = Boolean(tab);
    const path =
        projectId && dashboard
            ? `/projects/${encodeURIComponent(projectId)}${
                tab && tab !== "overview"
                    ? `?tab=${encodeURIComponent(tab)}`
                    : ""
            }`
            : projectId
                ? `/?project=${encodeURIComponent(projectId)}`
                : "/";

    try {

        const history = browserHistory();
        const method = replace ? "replaceState" : "pushState";

        if (history && typeof history[method] === "function") {
            history[method]({ projectId, tab }, "", path);
        }

        const location = browserLocation();
        const url = new URL(path, "http://localhost");
        location.pathname = url.pathname;
        location.search = url.search;

    } catch {
        /* tests */
    }
}


function projectById(id) {

    return state.projects.find(item => item.id === id) || null;
}


function fillProjectSelect(select, selectedId) {

    if (!select) {
        return;
    }

    select.innerHTML = "";

    const empty = node("option", null, "workspace default");
    empty.value = "";
    select.appendChild(empty);

    for (const project of state.projects) {

        const option = node("option", null, project.name || project.id);
        option.value = project.id;
        select.appendChild(option);
    }

    select.value = selectedId || "";
}


function renderProjectSwitcher() {

    fillProjectSelect(el("projectSwitcher"), state.currentProjectId);
    fillProjectSelect(el("taskScopeProject"), el("taskScopeProject")?.value);

    const list = el("taskScopeList");

    if (list) {

        list.innerHTML = "";

        for (const project of state.projects) {

            const label = node("label");
            const box = node("input", "scope-box");
            box.type = "checkbox";
            box.value = project.id;
            label.append(box, node("span", null, project.name || project.id));
            list.appendChild(label);
        }
    }


}


function selectedTaskScope() {

    const radios =
        typeof document !== "undefined" &&
        typeof document.getElementsByName === "function"
            ? document.getElementsByName("taskScope")
            : [];

    for (const radio of radios) {

        if (radio.checked) {
            return radio.value;
        }
    }

    return "current";
}


function selectedTaskProjectIds() {

    const scope = selectedTaskScope();

    if (scope === "specific") {

        const value = el("taskScopeProject")?.value;
        return value ? [value] : [];
    }

    if (scope === "multiple") {

        const boxes = el("taskScopeList")?.querySelectorAll(".scope-box") || [];
        return [...boxes].filter(box => box.checked).map(box => box.value);
    }

    return state.currentProjectId ? [state.currentProjectId] : [];
}


function labelChatForProject(projectId) {

    const project = projectById(projectId);
    const name = project ? project.name : projectId;

    pushMessage({
        role: "system",
        kind: "message",
        content: `Project · ${name}`,
        at: Date.now()
    });
}


function startLabeledProjectQueue(task, projectIds) {

    state.multiQueue = projectIds.map(id => ({
        projectId: id,
        task: `[${(projectById(id) || { name: id }).name}] ${task}`
    }));

    drainProjectTaskQueue();
}


async function drainProjectTaskQueue() {

    if (state.status === "running" || state.multiQueue.length === 0) {
        return;
    }

    const next = state.multiQueue.shift();

    setStatus("running");
    labelChatForProject(next.projectId);

    const response =
        await fetch(
            `/api/projects/${encodeURIComponent(next.projectId)}/tasks`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ task: next.task })
            }
        );

    if (!response.ok) {
        setStatus("idle");
        pushMessage({
            role: "assistant",
            kind: "error",
            content: `Could not start ${next.projectId}`
        });
        drainProjectTaskQueue();
    }
}


async function loadProjects() {

    try {

        const response = await fetch("/api/projects");

        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        state.projects = payload.projects || [];
        renderProjectSwitcher();

    } catch {
        state.projects = [];
    }
}


function setCurrentProject(projectId, options = {}) {

    const next = projectId || null;

    if (state.currentProjectId === next && !options.force) {

        if (options.dashboard) {
            openProjectDashboard(next, options.tab || "overview");
        }

        return;
    }

    state.currentProjectId = next;
    writeStoredProjectId(next);
    renderProjectSwitcher();

    const switcher = el("projectSwitcher");

    if (switcher) {
        switcher.value = next || "";
    }

    if (!options.skipNavigate) {
        navigateConsole(next, options.dashboard ? (options.tab || "overview") : null, options.replace);
    }

    /* Drop the previous project's live cards so B cannot linger in A
       while the new stream snapshot is in flight. */
    resetRun(true);
    state.messages = [];
    state.events = [];
    state.approvals.clear();

    const log = el("log");

    if (log) {
        log.innerHTML = "";
    }

    renderChat();
    renderTree();
    renderApprovals();

    connect();

    if (options.dashboard && next) {
        openProjectDashboard(next, options.tab || "overview");
    } else if (!options.keepDashboard) {
        closeProjectDashboard();
    }
}


function refreshGatewayHealthChip(health) {

    const chip = el("gatewayHealth");

    if (!chip) {
        return;
    }

    const status = health?.status || health?.gateway?.status || "unknown";
    chip.textContent = `health · ${status}`;
    chip.classList.remove("health-ok", "health-degraded", "health-down");

    if (status === "ok") {
        chip.classList.add("health-ok");
    } else if (status === "down") {
        chip.classList.add("health-down");
    } else {
        chip.classList.add("health-degraded");
    }

    chip.href = state.currentProjectId
        ? `/projects/${encodeURIComponent(state.currentProjectId)}?tab=overview`
        : "/api/health";
}


async function loadGatewayHealth() {

    try {

        const response = await fetch("/api/health");

        if (!response.ok) {
            return;
        }

        state.gatewayHealth = await response.json();
        refreshGatewayHealthChip(state.gatewayHealth);

    } catch {
        /* health is optional */
    }
}


function closeProjectDashboard() {

    state.dashboard.open = false;

    const dash = el("projectDashboard");
    const main = el("consoleMain");

    if (dash) {
        dash.hidden = true;
    }

    if (main) {
        main.hidden = false;
    }
}


function renderDashboardTabs(active) {

    const nav = el("dashboardTabs");

    if (!nav) {
        return;
    }

    nav.innerHTML = "";

    for (const [id, label] of DASHBOARD_TABS) {

        const button = node("button", id === active ? "active" : "", label);
        button.type = "button";
        button.dataset.tab = id;
        button.addEventListener("click", () => openProjectDashboard(state.dashboard.projectId, id));
        nav.appendChild(button);
    }
}


function dashboardCard(title, value) {

    const card = node("div", "dashboard-card");
    card.append(node("h3", null, title), node("div", null, String(value ?? "—")));
    return card;
}


async function renderDashboardBody(projectId, tab) {

    const body = el("dashboardBody");

    if (!body) {
        return;
    }

    body.innerHTML = "";
    body.appendChild(node("p", "empty", "Loading…"));

    let record = projectById(projectId);
    let projectState = null;
    let metrics = null;
    let health = null;
    let sessions = [];

    try {

        const [projectRes, stateRes, metricsRes, healthRes, sessionsRes] =
            await Promise.all([
                fetch(`/api/projects/${encodeURIComponent(projectId)}`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/state`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/metrics`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/health`),
                fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`)
            ]);

        if (projectRes.ok) {
            record = (await projectRes.json()).project || record;
        }

        if (stateRes.ok) {
            projectState = await stateRes.json();
        }

        if (metricsRes.ok) {
            metrics = await metricsRes.json();
        }

        if (healthRes.ok) {
            health = await healthRes.json();
        }

        if (sessionsRes.ok) {
            sessions = (await sessionsRes.json()).sessions || [];
        }

    } catch {
        /* render what we have */
    }

    body.innerHTML = "";

    const title = el("dashboardTitle");
    const subtitle = el("dashboardSubtitle");

    if (title) {
        title.textContent = record?.name || projectId;
    }

    if (subtitle) {
        subtitle.textContent = `${record?.rootPath || ""} · ${health?.status || "unknown"}`;
    }

    if (tab === "overview") {

        const grid = node("div", "dashboard-grid");
        grid.append(
            dashboardCard("status", health?.status || projectState?.status),
            dashboardCard("runs", metrics?.metrics?.project_runs_total ?? 0),
            dashboardCard("active", metrics?.metrics?.project_active_runs ?? 0),
            dashboardCard("root", record?.rootPath)
        );
        body.appendChild(grid);
        return;
    }

    if (tab === "runs") {

        const runs = projectState?.active_runs || [];

        if (runs.length === 0) {
            body.appendChild(node("p", "empty", "No active runs for this project."));
            return;
        }

        for (const run of runs) {
            body.appendChild(
                node("div", "labeled-run", `${run.status} · ${run.run_id} · ${run.task || ""}`)
            );
        }

        return;
    }

    if (tab === "sessions") {

        if (sessions.length === 0) {
            body.appendChild(node("p", "empty", "No saved sessions for this project."));
            return;
        }

        for (const session of sessions) {
            body.appendChild(
                node("div", "labeled-run", session.title || session.id)
            );
        }

        return;
    }

    if (tab === "memory") {

        body.appendChild(
            node(
                "p",
                "empty",
                "Memory is stored in this project's data root. Inspect it with memory_get during a scoped run."
            )
        );
        body.appendChild(
            dashboardCard("last activity", metrics?.metrics?.project_last_activity || "none")
        );
        return;
    }

    if (tab === "plan") {

        if (state.plan && state.currentProjectId === projectId) {
            const holder = node("div", "plan-view");
            holder.id = "dashboardPlan";
            body.appendChild(holder);
            const previous = el("plan");
            /* reuse live plan card text when this is the active project */
            if (previous) {
                holder.appendChild(node("div", null, previous.textContent));
            }
            return;
        }

        body.appendChild(
            node("p", "empty", "Plan appears here while this project is the active console run.")
        );
        return;
    }

    if (tab === "events" || tab === "logs") {

        const events = (projectState?.events || []).slice(-80);

        if (events.length === 0) {
            body.appendChild(node("p", "empty", "No events recorded for this project."));
            return;
        }

        const list = node("ul", "log");

        for (const event of events) {

            if (tab === "logs" && !/error|failed|deadline/i.test(event.type || "")) {
                continue;
            }

            list.appendChild(
                node("li", null, `${event.type} · ${describeEvent(event)}`)
            );
        }

        body.appendChild(list);
        return;
    }

    if (tab === "approvals") {

        const pending = projectState?.pending_approvals || [];

        if (pending.length === 0) {
            body.appendChild(node("p", "empty", "No pending approvals for this project."));
            return;
        }

        for (const item of pending) {
            body.appendChild(
                node("div", "labeled-run", `${item.tool} · ${item.agent}`)
            );
        }

        return;
    }

    if (tab === "mcp") {

        body.appendChild(
            dashboardCard("mcp calls", metrics?.metrics?.project_mcp_calls_total ?? 0)
        );
        return;
    }

    if (tab === "settings") {

        const form = node("div", "mcp-add");
        const name = node("input");
        name.value = record?.name || "";
        const enabled = node("input");
        enabled.type = "checkbox";
        enabled.checked = record?.enabled !== false;

        form.append(
            node("label", "mcp-field"),
        );

        const nameField = node("label", "mcp-field");
        nameField.append(node("span", "label", "name"), name);
        const enabledField = node("label", "mcp-field");
        enabledField.append(node("span", "label", "enabled"), enabled);
        form.append(nameField, enabledField);

        form.appendChild(
            Modal.button("Save", "", async () => {

                await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        name: name.value,
                        enabled: enabled.checked
                    })
                });

                await loadProjects();
                renderDashboardBody(projectId, "settings");
            })
        );

        body.appendChild(form);
    }
}


function openProjectDashboard(projectId, tab) {

    if (!projectId) {
        return;
    }

    state.dashboard = { open: true, projectId, tab: tab || "overview" };
    setCurrentProject(projectId, { skipNavigate: true, keepDashboard: true });
    navigateConsole(projectId, state.dashboard.tab, false);

    const dash = el("projectDashboard");
    const main = el("consoleMain");

    if (dash) {
        dash.hidden = false;
    }

    if (main) {
        main.hidden = true;
    }

    renderDashboardTabs(state.dashboard.tab);
    renderDashboardBody(projectId, state.dashboard.tab);
}


function openNewProjectModal() {

    const name = node("input");
    name.placeholder = "Display name";
    const root = node("input");
    root.placeholder = "/absolute/path/to/workspace";
    const message = node("p", "mcp-message");

    const form = node("div", "mcp-add");
    const nameField = node("label", "mcp-field");
    nameField.append(node("span", "label", "name"), name);
    const rootField = node("label", "mcp-field");
    rootField.append(node("span", "label", "rootPath"), root);
    form.append(nameField, rootField, message);

    const handle = Modal.open({
        title: "New Project",
        subtitle: "Registers a workspace. Root comes from you, never from the model.",
        body: form,
        footer: Modal.row(
            Modal.button("Create", "", async () => {

                const response = await fetch("/api/projects", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        name: name.value.trim() || undefined,
                        rootPath: root.value.trim()
                    })
                });

                const payload = await response.json().catch(() => ({}));

                if (!response.ok) {
                    message.textContent = payload.error || "could not register";
                    return;
                }

                await loadProjects();
                setCurrentProject(payload.project.id);
                handle.close("created");
            }),
            Modal.button("Cancel", "ghost", () => handle.close("cancel"))
        )
    });
}


async function openProjectsManager() {

    await loadProjects();

    const body = node("div", "sessions");

    if (state.projects.length === 0) {
        body.appendChild(node("p", "empty", "No registered projects yet."));
    }

    for (const project of state.projects) {

        const row = node("div", "project-row");
        row.appendChild(node("span", "name", project.name || project.id));
        row.appendChild(node("span", "muted", project.rootPath || ""));

        row.appendChild(
            Modal.button("Open", "ghost", () => {

                handle.close("open");
                openProjectDashboard(project.id, "overview");
            })
        );

        row.appendChild(
            Modal.button("Use", "ghost", () => {

                handle.close("use");
                setCurrentProject(project.id);
            })
        );

        row.appendChild(
            Modal.button("Delete", "ghost danger", async () => {

                await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
                    method: "DELETE"
                });

                await loadProjects();

                if (state.currentProjectId === project.id) {
                    setCurrentProject(null);
                }

                handle.close("deleted");
                openProjectsManager();
            })
        );

        body.appendChild(row);
    }

    const handle = Modal.open({
        title: "Projects",
        subtitle: `${state.projects.length} registered`,
        size: "medium",
        body,
        footer: Modal.row(
            Modal.button("New Project", "ghost", () => {

                handle.close("new");
                openNewProjectModal();
            }),
            Modal.button("Close", "", () => handle.close("footer"))
        )
    });
}


function bindProjectControls() {

    const switcher = el("projectSwitcher");

    if (switcher) {

        switcher.addEventListener("change", event => {
            setCurrentProject(event.target.value || null);
        });
    }

    el("newProjectButton")?.addEventListener("click", openNewProjectModal);
    el("projectsButton")?.addEventListener("click", openProjectsManager);
    el("dashboardBack")?.addEventListener("click", () => {

        closeProjectDashboard();
        navigateConsole(state.currentProjectId, null, false);
    });

    const scope = el("taskScope");

    if (scope) {

        scope.addEventListener("change", () => {

            const mode = selectedTaskScope();
            const specific = el("taskScopeProject");
            const list = el("taskScopeList");

            if (specific) {
                specific.hidden = mode !== "specific";
            }

            if (list) {
                list.hidden = mode !== "multiple";
            }
        });
    }

    try {

        const win =
            typeof globalThis !== "undefined"
                ? globalThis.window
                : undefined;

        if (win && typeof win.addEventListener === "function") {

            win.addEventListener("popstate", () => {
                applyProjectRoute(true);
            });
        }

    } catch {
        /* tests */
    }
}


function applyProjectRoute(fromPop) {

    const route = parseProjectRoute();
    const stored = readStoredProjectId();
    const projectId = route.projectId || stored || null;

    if (route.dashboard && projectId) {

        setCurrentProject(projectId, {
            force: true,
            dashboard: true,
            tab: route.tab,
            skipNavigate: true,
            replace: !fromPop
        });
        return;
    }

    if (projectId) {
        setCurrentProject(projectId, { force: true, skipNavigate: true, replace: true });
    }
}


async function initProjects() {

    if (!el("projectSwitcher") && !el("projectDashboard")) {
        return;
    }

    bindProjectControls();
    await loadProjects();
    applyProjectRoute(false);
    loadGatewayHealth();
}


/* ------------------------------------------------------------------ wire */

function eventsUrl() {

    if (state.currentProjectId) {

        return `/api/events?projectId=${encodeURIComponent(state.currentProjectId)}`;
    }

    return "/api/events";
}


function connect() {

    if (state.eventSource && typeof state.eventSource.close === "function") {

        try {
            state.eventSource.close();
        } catch {
            /* the shim EventSource has no close */
        }
    }

    const source =
        new EventSource(eventsUrl());

    state.eventSource = source;

    source.onmessage = message => {

        const payload =
            JSON.parse(message.data);

        if (payload.type === "snapshot") {

            applySnapshot(payload.snapshot);

            return;
        }

        apply(payload);
    };

    source.onerror = () => {

        const status = el("statusText");

        if (status) {
            status.textContent = "reconnecting";
        }
    };
}


el("taskForm").addEventListener("submit", async submitEvent => {

    submitEvent.preventDefault();

    const task =
        el("task").value.trim();

    if (task === "") {
        return;
    }

    /*
    | Discussion mode sends the same task box to the panel instead of
    | the delegation tree: the personas and the round limit come from
    | the options row, and the live view opens as it runs.
    */

    if (state.discussionMode) {

        const personas =
            selectedDiscussionPersonas();

        const line =
            el("discussionStatusLine");

        if (personas.length === 0) {

            if (line) {
                line.className = "bad";
                line.textContent =
                    "select at least one persona";
            }

            return;
        }

        const maxRounds =
            Math.max(
                1,
                Math.min(10, Number(el("discussionRounds")?.value) || 5)
            );

        el("runButton").disabled = true;

        const discussionUrl =
            state.currentProjectId
                ? `/api/projects/${encodeURIComponent(state.currentProjectId)}/discussions`
                : "/api/discussion";

        const response =
            await fetch(discussionUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ task, personas, max_rounds: maxRounds })
            });

        if (response.ok) {

            el("task").value = "";

            /* the stream confirms with discussion:start; this keeps
               the composer honest in the meantime */
            state.discussion = {
                id:
                    (await response.json().catch(() => ({}))).id ||
                    null,
                status: "running",
                task,
                personas,
                max_rounds: maxRounds,
                rounds: [],
                observer_decisions: [],
                final_report: null
            };

            refreshDiscussionComposerStatus();

            openDiscussion();

        } else {

            const payload =
                await response.json().catch(() => ({}));

            el("runButton").disabled = false;

            if (line) {
                line.className = "bad";
                line.textContent =
                    payload.error ||
                    `request failed (${response.status})`;
            }
        }

        return;
    }

    const targets = selectedTaskProjectIds();

    if (targets.length > 1) {

        startLabeledProjectQueue(task, targets);
        el("task").value = "";
        return;
    }

    setStatus("running");

    const projectId = targets[0] || null;
    const url =
        projectId
            ? `/api/projects/${encodeURIComponent(projectId)}/tasks`
            : "/api/tasks";

    const response =
        await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task })
        });

    if (response.ok) {

        el("task").value = "";

        if (projectId) {
            labelChatForProject(projectId);
        }

        const snapshot =
            await (await fetch("/api/state")).json();

        el("turns").textContent = `${snapshot.turns} turns`;

    } else {

        setStatus("idle");
    }
});


el("cancelButton").addEventListener("click", () => {

    state.multiQueue = [];

    if (state.currentProjectId) {

        fetch(
            `/api/projects/${encodeURIComponent(state.currentProjectId)}/cancel`,
            { method: "POST" }
        );
    }

    fetch("/api/cancel", { method: "POST" });
});


el("clearButton").addEventListener("click", async () => {

    await fetch("/api/clear", { method: "POST" });

    el("turns").textContent = "0 turns";
});


el("autoContinue").addEventListener("change", event => {

    el("autoSwitchStatus").textContent = `auto-switch · ${event.target.checked ? "on" : "off"}`;

    fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            key: "AUTO_CONTINUE",
            value: event.target.checked
        })
    });
});


el("clearLog").addEventListener("click", () => {

    el("log").innerHTML = "";

    /*
    | The type list is built from the rows that exist, so emptying the
    | list has to rebuild it or it would keep offering types that are
    | no longer there.
    */

    applyLogFilter();
});


el("logFilter").addEventListener("input", event => {

    state.logFilter =
        event.target.value.trim().toLowerCase();

    applyLogFilter();
});


el("logType").addEventListener("change", event => {

    state.logType = event.target.value;

    applyLogFilter();
});


el("approvalMode").addEventListener("change", event => {

    fetch("/api/approval-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: event.target.value })
    });
});


el("settingsButton").addEventListener("click", openSettings);
el("llmSettingsButton").addEventListener("click", openLlmSettings);
el("planButton").addEventListener("click", openPlanModal);

el("mobileMenuToggle").addEventListener("click", () => {
    const header = el("consoleHeader");
    const open = header.classList.toggle("menu-open");
    el("mobileMenuToggle").setAttribute("aria-expanded", String(open));
});

el("consoleMenu").addEventListener("click", event => {
    if (event.target.closest("button")) {
        el("consoleHeader").classList.remove("menu-open");
        el("mobileMenuToggle").setAttribute("aria-expanded", "false");
    }
});

el("mcpButton").addEventListener("click", openMcp);


el("historyButton").addEventListener("click", openHistory);

el("executionButton").addEventListener("click", openExecutionModal);

el("eventsButton").addEventListener("click", openEventsModal);

el("discussionButton").addEventListener("click", toggleDiscussionMode);


el("approvalsButton").addEventListener("click", () => {

    if (!state.approvalModal) {
        openApprovalModal();
    }
});


el("task").addEventListener("keydown", event => {

    if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter"
    ) {

        el("taskForm").requestSubmit();
    }
});


connect();

loadSettings();

initProjects();
