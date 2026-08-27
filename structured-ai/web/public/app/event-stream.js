/*
|--------------------------------------------------------------------------
| Console event-stream (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The reducer. `apply()` is why the console keeps no state of its own: every box
| on screen is rebuilt from the stream, so a reload draws the same picture from
| the snapshot frame and a reconnect catches up instead of lying.
|
| `connect()` owns the EventSource, including the reconnect status the browser
| cannot report for us; `applySnapshot()` runs the same reducer over the captured
| past. The replay rules that keep a reopened conversation from duplicating a
| card are untouched — duplicated events are the failure this file prevents.
|--------------------------------------------------------------------------
*/

import { el } from "./dom.js";
import { agentNode, archiveCurrentExecution, graphNode, renderTree } from "./execution-view.js";
import { renderPlan } from "./plan-view.js";
import { messageExecutionKey, normalizeConversationMessages, refreshTurnExecution, renderChat } from "./chat.js";
import { discussionHistoryView, pushDiscussionEvent, refreshDiscussionComposerStatus } from "./discussion-view.js";
import { renderApprovals } from "./approvals-view.js";
import { log } from "./event-view.js";
import { eventsUrl, loadSettings, refreshSession } from "./api.js";
import { drainProjectTaskQueue } from "./task-runner.js";
import { eventVisibleForCurrentProject } from "./project-state.js";
import { approvalState, conversationState, discussionState, eventState, executionState, planState, pushMessage, resetRun, runtimeState, setStatus, settingsState, updateWaitingElapsed } from "./store.js";

export function apply(event) {

    if (!eventVisibleForCurrentProject(event)) {
        return;
    }

    if (event.plan) {
        planState.plan = event.plan;
        renderPlan();
    }

    /* Keep every event so a user message's execution can be re-rendered
       as a stage-by-stage block under that message (keyed by turn_id).
       Bounded so a long session does not grow without limit in the page. */
    eventState.events.push(event);

    if (eventState.events.length > 5000) {
        eventState.events = eventState.events.slice(-5000);
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

            runtimeState.currentTask = event.task;

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

            executionState.hooks.set(key, {
                ...event,
                status: "running",
                summary: null
            });

            if (!executionState.hookOrder.includes(key)) {
                executionState.hookOrder.push(key);
            }

            renderTree();
            break;
        }

        case "hook:end": {

            const key = `${event.phase}:${event.id}`;
            const before = executionState.hooks.get(key) || {};

            executionState.hooks.set(key, {
                ...before,
                ...event,
                hook_type: event.hook_type || before.hook_type,
                status: event.status || (event.ok ? "done" : "failed")
            });

            if (!executionState.hookOrder.includes(key)) {
                executionState.hookOrder.push(key);
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
                status: "running"
            };

            graph.calls.set(call.id, call);

            if (!graph.order.includes(call.id)) {
                graph.order.push(call.id);
            }

            if (call.key) {
                executionState.calls.set(call.key, call);
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
                executionState.calls.set(call.key, call);
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

            executionState.loops.push(event);

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
            approvalState.approvals.set(event.id, event);
            renderApprovals();
            break;

        case "approval:resolved":
            approvalState.approvals.delete(event.id);
            renderApprovals();
            break;

        case "run:end":
            for (const agent of executionState.agents.values()) {

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

            runtimeState.waiting = null;

            clearInterval(runtimeState.waitingTimer);

            runtimeState.waitingTimer = null;

            renderChat();

            /* Phase 11: a multi-project composer run is a sequence of
               labelled single-project tasks, not a parallel fan-out. */
            if (event.status !== "running") {
                drainProjectTaskQueue();
            }

            break;

        case "request:start":
            runtimeState.waiting = {
                agent: event.agent,
                role: event.role,
                since: Date.now()
            };

            if (!runtimeState.waitingTimer) {

                /* Only the elapsed text changes while the endpoint works.
                   Rebuilding the conversation here used to destroy text
                   selection, scroll position and open reasoning details five
                   times a second. */
                runtimeState.waitingTimer =
                    setInterval(updateWaitingElapsed, 200);
            }

            renderChat();
            break;

        case "request:end":
            runtimeState.waiting = null;

            clearInterval(runtimeState.waitingTimer);

            runtimeState.waitingTimer = null;

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
                conversationState.session &&
                conversationState.session.id === event.session.id;

            conversationState.session = event.session;

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

            conversationState.messages = [];

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

export function applySnapshot(snapshot) {

    resetRun(true);
    eventState.events = [];
    el("log").innerHTML = "";
    renderTree();

    planState.plan = snapshot.plan || null;
    renderPlan();

    el("workspace").textContent = snapshot.workspace;
    el("model").textContent = snapshot.model;
    el("approvalMode").value = snapshot.approval_mode;

    if (snapshot.settings) {
        settingsState.settings = snapshot.settings;
    }

    el("turns").textContent =
        `${snapshot.turns} turns${
            snapshot.cycles
                ? `, cycle ${snapshot.cycles}`
                : ""
        }`;

    el("autoContinue").checked = Boolean(snapshot.auto_continue);

    conversationState.messages = normalizeConversationMessages(snapshot.messages);

    conversationState.session = snapshot.session || null;

    /* A running or finished discussion redraws from the snapshot, so a
       reload mid-discussion resumes the transcript at the right round. */
    discussionState.discussion = snapshot.discussion || null;

    if (discussionState.discussionModal && discussionState.discussionModal.isOpen()) {
        discussionHistoryView(discussionState.discussionEl);
    }

    refreshDiscussionComposerStatus();

    conversationState.sessions = snapshot.sessions || [];

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

        approvalState.approvals.set(approval.id, approval);
    }

    renderApprovals();

    setStatus(snapshot.status);
}

export function connect() {

    if (runtimeState.eventSource && typeof runtimeState.eventSource.close === "function") {

        try {
            runtimeState.eventSource.close();
        } catch {
            /* the shim EventSource has no close */
        }
    }

    const source =
        new EventSource(eventsUrl());

    runtimeState.eventSource = source;

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
