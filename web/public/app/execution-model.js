/*
| The execution model: agents, tool-call graphs, hooks and loops of the
| current run, plus the archive of previous runs. Pure data helpers over
| the store's state object — no DOM.
*/

import { LIMITS } from "./store.js";


export function agentNode(state, scope, depth, extra = {}) {

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

    const item = state.agents.get(scope);

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


export function graphNode(state, event) {

    const id = event.graph_id || `${event.agent}:loose`;

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

        agentNode(state, event.agent || "main_agent").graphs.push(id);
    }

    const graph = state.graphs.get(id);

    if (event.shape) graph.shape = event.shape;
    if (event.waves) graph.waves = event.waves;
    if (event.wave_basis) graph.waveBasis = event.wave_basis;

    if (event.iteration !== undefined && event.iteration !== null) {
        graph.iteration = event.iteration;
    }

    return graph;
}


/*
| A wave index is what the scheduler planned, not what it did: items
| dispatch continuously, so two calls sharing a wave need not overlap and
| two calls in different waves may run together. The honest record of
| concurrency is the interval every call carries; the planned grouping is
| only a fallback for a call without timestamps (an old replayed run).
*/
export function intervalOf(call) {

    if (!call) {
        return null;
    }

    const start =
        call.startedAt ??
        (call.finishedAt && call.duration ? call.finishedAt - call.duration : null);

    if (start === null || start === undefined) {
        return null;
    }

    /* a call still running has no end yet, so it overlaps everything open */
    return { start, end: call.finishedAt ?? Number.MAX_SAFE_INTEGER };
}


export function ranAlongside(graph, call) {

    const own = intervalOf(call);

    if (!own) {
        return (graph.waves[call.wave] || []).filter(id => id !== call.id);
    }

    const alongside = [];

    for (const id of graph.order) {

        if (id === call.id) continue;

        const other = intervalOf(graph.calls.get(id));

        if (other && other.start < own.end && own.start < other.end) {
            alongside.push(id);
        }
    }

    return alongside;
}


/* the execution card's one-line summary ("2 agents · 3 calls · …") */
export function treeSummary(run) {

    if (run.order.length === 0) {
        return "";
    }

    let calls = 0;
    let failures = 0;

    for (const scope of run.order) {

        for (const graphId of run.agents.get(scope).graphs) {

            const graph = run.graphs.get(graphId);

            if (!graph) continue;

            for (const id of graph.order) {
                calls++;
                if (graph.calls.get(id).status === "failed") failures++;
            }
        }
    }

    return `${run.order.length} agent${run.order.length === 1 ? "" : "s"} · ${
        calls} call${calls === 1 ? "" : "s"}${
        failures ? ` · ${failures} failed` : ""}${
        run.hookOrder.length ? ` · ${run.hookOrder.length} hook` : ""}${
        run.loops.length ? ` · ${run.loops.length} loop` : ""}`;
}


/* the parts of state that make up one run's execution card */
export function currentRun(state) {

    return {
        agents: state.agents,
        order: state.order,
        graphs: state.graphs,
        hooks: state.hooks,
        hookOrder: state.hookOrder,
        loops: state.loops
    };
}


/*
| A new task closes the previous execution into the archive accordion.
| The archived run keeps its own data, so its rows still open the full
| call detail. Bounded like the page always was.
*/
export function archiveCurrentExecution(state) {

    if (state.order.length === 0 && state.hookOrder.length === 0) {
        return false;
    }

    const run = currentRun(state);

    state.archive.push({
        id: `${Date.now()}-${state.archive.length}-${Math.random().toString(36).slice(2, 8)}`,
        task: state.currentTask,
        summary: treeSummary(run),
        run
    });

    if (state.archive.length > LIMITS.archivedRuns) {
        state.archive = state.archive.slice(-LIMITS.archivedRuns);
    }

    return true;
}


/* fresh containers rather than clear(): the archive keeps the old ones */
export function resetRun(state, clearArchive = false) {

    state.agents = new Map();
    state.order = [];
    state.graphs = new Map();
    state.calls = new Map();
    state.approvals = new Map();
    state.loops = [];
    state.hooks = new Map();
    state.hookOrder = [];
    state.currentTask = null;
    state.openExecutionKeys = new Set();

    if (clearArchive) {
        state.archive = [];
    }
}
