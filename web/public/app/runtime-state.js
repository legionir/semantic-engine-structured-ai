/*
|--------------------------------------------------------------------------
| Event reducer
|--------------------------------------------------------------------------
|
| reduce(state, event) applies one runtime event to the store's state and
| reports which screen regions changed and which side effects the event
| asks for. It never touches the DOM and never performs I/O, so the
| console's whole event semantics can be tested in Node.
|
| Effects are returned, not run. The caller runs them only for live
| events: a snapshot replay must redraw the past, not re-trigger it (a
| replayed settings:changed used to reload settings, a replayed
| session:switched used to refetch the session).
|--------------------------------------------------------------------------
*/

import { LIMITS } from "./store.js";
import { agentNode, graphNode, archiveCurrentExecution, resetRun } from "./execution-model.js";
import { normalizeConversationMessage, normalizeConversationMessages, TURN_REFRESH_TYPES } from "./conversation-model.js";
import { reduceDiscussion } from "./discussion-model.js";


export function eventVisibleForProject(state, event) {

    if (!state.currentProjectId || !event || !event.project_id) {
        return true;
    }

    return event.project_id === state.currentProjectId;
}


function setRunStatus(state, status) {

    state.status = status;

    if (status !== "running") {
        state.stopPending = false;
        state.activeProjectId = null;
        state.startedAt = null;
    } else {
        state.startedAt = state.startedAt || Date.now();
    }
}


export { setRunStatus };


function appendLogRow(state, event) {

    state.logSeq += 1;

    state.logRows.push({
        id: state.logSeq,
        event,
        at: event.at || Date.now()
    });

    if (state.logRows.length > LIMITS.logRows) {
        state.logRows = state.logRows.slice(-LIMITS.logRows);
    }
}


export function reduce(state, event) {

    const regions = new Set(["log"]);
    const effects = [];

    if (!eventVisibleForProject(state, event)) {
        return { regions: new Set(), effects };
    }

    /* a project's background turn belongs to that project's tab, not to
       the default conversation on screen; the default view follows only
       the project it sent a task to (a labelled multi-project run) */
    if (
        !state.currentProjectId && event.background === true &&
        event.project_id && event.project_id !== state.activeProjectId
    ) {
        if (event.type === "run:status" && event.status !== "running") {
            effects.push({ type: "runSettled", projectId: event.project_id });
        }
        appendLogRow(state, event);
        return { regions, effects };
    }

    /* the metadata shadow of another conversation's event (a project
       stream sees unscoped events this way): logged, never applied */
    if (event.aggregate === true) {
        appendLogRow(state, event);
        return { regions, effects };
    }

    if (event.plan) {
        state.plan = event.plan;
        regions.add("plan");
    }

    /* every event is kept so a turn's execution block can be redrawn */
    state.events.push(event);

    if (state.events.length > LIMITS.events) {
        state.events = state.events.slice(-LIMITS.events);
    }

    if (TURN_REFRESH_TYPES.has(event.type)) {
        regions.add("chat");
    }

    const tree = () => regions.add("tree");

    switch (event.type) {

        case "run:start":
            archiveCurrentExecution(state);
            resetRun(state);
            state.currentTask = event.task;
            agentNode(state, "main_agent", 0, { task: event.task });
            setRunStatus(state, "running");
            regions.add("tree").add("run").add("approvals");
            break;

        case "agent:start":
            agentNode(state, event.scope || event.agent, event.depth, {
                name: event.agent,
                task: event.task,
                parent: event.parent,
                parentScope: event.parent_scope,
                persona: event.persona,
                delegationId: event.delegation_id
            });
            tree();
            break;

        case "agent:iteration":
            agentNode(state, event.scope || event.agent, event.depth).iterations = event.iteration;
            tree();
            break;

        case "agent:end":
            agentNode(state, event.scope || event.agent, event.depth).status =
                event.success ? "done" : "failed";
            tree();
            break;

        case "delegation:start":
            for (const item of event.delegations || []) {
                agentNode(state, `${item.agent}#${(event.depth || 0) + 1}`, (event.depth || 0) + 1, {
                    name: item.agent,
                    task: item.task,
                    parent: event.parent,
                    parentScope: event.parent_scope,
                    delegationId: item.id
                });
            }
            tree();
            break;

        case "delegation:graph":
            agentNode(
                state,
                event.parent_scope || event.parent,
                Math.max(0, (event.depth || 1) - 1)
            ).delegationShape = event.shape;
            tree();
            break;

        case "hook:start": {
            const key = `${event.phase}:${event.id}`;
            state.hooks.set(key, { ...event, status: "running", summary: null });
            if (!state.hookOrder.includes(key)) state.hookOrder.push(key);
            tree();
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
            if (!state.hookOrder.includes(key)) state.hookOrder.push(key);
            tree();
            break;
        }

        case "tool:graph":
            graphNode(state, event).maxParallel = event.max_parallel;
            tree();
            break;

        case "tool:start": {
            const graph = graphNode(state, event);
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
                    event.arguments_preview ?? JSON.stringify(event.arguments ?? {}, null, 2),
                startedAt: event.at ?? null,
                status: "running"
            };
            graph.calls.set(call.id, call);
            if (!graph.order.includes(call.id)) graph.order.push(call.id);
            if (call.key) state.calls.set(call.key, call);
            tree();
            break;
        }

        case "tool:end": {
            const graph = graphNode(state, event);
            const call = graph.calls.get(event.id) || {
                id: event.id,
                agent: event.agent,
                name: event.name,
                graph_id: graph.id,
                depends_on: [],
                argumentsPreview: "{}"
            };

            call.key = event.call_key || call.key;

            /* a non-zero exit code or a warning is not a clean success */
            call.status = !event.success
                ? "failed"
                : event.exit_code ? "exit" : event.warning ? "warned" : "done";

            call.exitCode = event.exit_code ?? null;
            call.warning = event.warning || null;
            call.duration = event.duration_ms;
            /* "ran alongside" is measured on the executor's own start when known */
            call.startedAt = event.started_at ?? call.startedAt ?? event.at ?? null;
            call.finishedAt = event.at ?? call.finishedAt ?? null;
            call.wave = event.wave ?? call.wave ?? null;
            call.iteration = event.iteration ?? call.iteration ?? null;
            call.resultPreview = event.result_preview ?? null;
            call.resultChars = event.result_chars ?? null;
            call.error = event.error || null;

            graph.calls.set(call.id, call);
            if (!graph.order.includes(call.id)) graph.order.push(call.id);
            if (call.key) state.calls.set(call.key, call);
            tree();
            break;
        }

        case "delegation:end":
            /* a delegation that failed before its agent existed: the parent carries it */
            if (!event.success) {
                agentNode(state, event.parent_scope || event.parent || "main_agent").loops.push({
                    outcome: "stopped",
                    repeats: 1,
                    signature: `delegation ${event.id} to ${event.agent}: ${event.error}`
                });
                tree();
            }
            break;

        case "run:loop":
            state.loops.push(event);
            agentNode(state, event.scope || event.agent || "main_agent").loops.push(event);
            tree();
            break;

        case "skill:read": {
            const agent = agentNode(state, event.agent || "main_agent");
            const label = `${event.skill} · ${event.resource}`;
            agent.skills = agent.skills || [];
            if (!agent.skills.includes(label)) agent.skills.push(label);
            tree();
            break;
        }

        case "skill:loaded": {
            const agent = agentNode(state, event.scope || event.agent || "main_agent");
            agent.skills = agent.skills || [];
            for (const name of event.skills || []) {
                if (!agent.skills.includes(name)) agent.skills.push(name);
            }
            tree();
            break;
        }

        case "report:mismatch": {
            const problems = event.problems || [];
            agentNode(state, event.agent || "main_agent").loops.push({
                outcome: "stopped",
                repeats: problems.length,
                signature: `answer claimed work that never ran: ${problems.join("; ")}`
            });
            tree();
            break;
        }

        case "run:malformed":
            /* an unreadable answer is a debugging fact on the agent that produced it */
            agentNode(state, event.scope || event.agent || "main_agent").loops.push({
                outcome: event.outcome === "stopped" ? "malformed_stopped" : "malformed",
                repeats: event.attempt,
                signature: event.reason,
                reason: event.reason
            });
            tree();
            break;

        case "approval:request":
            state.approvals.set(event.id, event);
            regions.add("approvals");
            break;

        case "approval:resolved":
            state.approvals.delete(event.id);
            regions.add("approvals");
            break;

        case "run:end":
            for (const agent of state.agents.values()) {
                if (agent.status === "running") agent.status = "done";
            }
            tree();
            break;

        case "run:auto_continue":
            state.turnsText = `cycle ${event.cycle}`;
            regions.add("header");
            break;

        case "run:status":
            setRunStatus(state, event.status);
            state.waiting = null;
            regions.add("run").add("chat");
            /* a multi-project composer run is a sequence of labelled tasks */
            if (event.status !== "running") effects.push({ type: "runSettled", projectId: event.project_id || null });
            break;

        case "request:start":
            state.waiting = { agent: event.agent, role: event.role, since: Date.now() };
            regions.add("chat");
            break;

        case "request:end":
            state.waiting = null;
            regions.add("chat");
            break;

        case "session:message":
            /* the server owns the conversation; the browser draws what it is told */
            state.messages.push(normalizeConversationMessage(event.message, state.messages));
            regions.add("chat");
            break;

        case "session:switched": {
            const same = state.session && event.session && state.session.id === event.session.id;
            state.session = event.session;
            regions.add("header");
            /* another console moved to a different conversation: load it */
            if (!same && event.session) effects.push({ type: "refreshSession", id: event.session.id });
            break;
        }

        case "settings:changed":
            effects.push({ type: "loadSettings" });
            break;

        case "queue:changed":
            if (event.project_id && event.project_id === state.currentProjectId) {
                state.queue = { project_id: event.project_id, paused: Boolean(event.paused), items: event.items || [] };
                regions.add("queue").add("run");
            }
            break;

        case "session:cleared":
            resetRun(state, true);
            state.messages = [];
            state.logRows = [];
            setRunStatus(state, "idle");
            regions.add("chat").add("tree").add("approvals").add("run");
            break;

        case "discussion:start":
        case "discussion:message":
        case "discussion:observer":
        case "discussion:round":
        case "discussion:finish":
        case "discussion:error":
            if (reduceDiscussion(state, event)) {
                regions.add("discussion").add("composer");
            }
            break;

        default:
            break;
    }

    /* session:cleared emptied the log; its own row is the first of the new list */
    appendLogRow(state, event);

    return { regions, effects };
}


/*
| A snapshot replaces the picture: the conversation and the settings come
| from the snapshot itself, the run is redrawn by replaying its events
| (without their side effects), and the pending approvals and the status
| are authoritative last.
*/
export function applySnapshot(state, snapshot) {

    resetRun(state, true);
    state.events = [];
    state.logRows = [];

    state.plan = snapshot.plan || null;
    state.workspace = snapshot.workspace;
    state.model = snapshot.model;
    state.approvalMode = snapshot.approval_mode ?? null;
    state.autoContinue = Boolean(snapshot.auto_continue);

    if (snapshot.settings) {
        state.settings = snapshot.settings;
    }

    state.turnsText = `${snapshot.turns} turns${snapshot.cycles ? `, cycle ${snapshot.cycles}` : ""}`;
    state.messages = normalizeConversationMessages(snapshot.messages);
    state.session = snapshot.session || null;
    /* a reload mid-discussion resumes the transcript at the right round */
    state.discussion = snapshot.discussion || null;
    state.sessions = snapshot.sessions || [];
    state.queue = snapshot.queue || null;
    state.conversationMode = snapshot.conversation || null;

    if (Array.isArray(snapshot.conversations)) {
        state.conversations = snapshot.conversations;
    }
    state.waiting = null;

    for (const event of snapshot.events || []) {
        /* messages are authoritative in snapshot.messages; replaying their
           transport events would duplicate every bubble */
        if (event.type !== "session:message") {
            reduce(state, event);
        }
    }

    for (const approval of snapshot.pending_approvals || []) {
        state.approvals.set(approval.id, approval);
    }

    setRunStatus(state, snapshot.status);
    state.reconnecting = false;
}
