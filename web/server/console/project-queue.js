"use strict";

/*
|--------------------------------------------------------------------------
| Project message queue and mid-run corrections (roadmap P1-04)
|--------------------------------------------------------------------------
|
| A message sent to a project whose run is busy waits in that project's
| queue instead of being refused; when the run ends, the first waiting
| message starts the next turn. The queue can be read, edited, reordered by
| deleting, and cleared; every change is a `queue:changed` event so every
| open console shows the same list.
|
| A cancelled run pauses the queue rather than emptying it: the operator
| decides whether the waiting messages still make sense (resume) or not
| (clear).
|
| A course correction is different: it does not wait for the run to end.
| It is handed to the running AgentRunContext and read at the start of the
| run's next iteration (agent/runtime/RunCorrections). One the run never
| reached (it ended first) is not lost: it moves to the front of the queue.
|
| Part of the console server's closure (ServerImplementation).
*/

const RunCorrections = require("../../../agent/runtime/RunCorrections");
const { runFlagOptions } = require("./run-flags");


module.exports = function createProjectQueue(shared) {

    const {
        conversations,
        runtime
    } = shared;


    function limit() {

        return runtime.settings.get("PROJECT_QUEUE_MAX");
    }


    function enabled() {

        return limit() > 0;
    }


    function itemView(item) {

        return {
            id: item.id,
            text: item.text,
            reasoning_effort: item.reasoningEffort || null,
            ...(item.runFlags ? { run_flags: runFlagOptions(item.runFlags) } : {}),
            kind: item.kind,
            created_at: item.createdAt,
            updated_at: item.updatedAt
        };
    }


    function view(projectId) {

        const conv = conversations.get(projectId);

        return {
            project_id: projectId,
            paused: conv ? conv.queuePaused : false,
            limit: limit(),
            items: conv ? conv.queue.map(itemView) : []
        };
    }


    function changed(conv) {

        const current = view(conv.projectId);

        runtime.events.emit("queue:changed", {
            project_id: conv.projectId,
            paused: current.paused,
            items: current.items
        });
    }


    function fail(status, message) {

        return Object.assign(new Error(message), { status });
    }


    function add(projectId, text, options = {}) {

        if (!enabled()) {
            throw fail(409, `project ${projectId} already has a run in progress`);
        }

        const conv = conversations.ensure(projectId);

        if (conv.queue.length >= limit()) {
            throw fail(429, `the queue of project ${projectId} is full (${limit()} messages)`);
        }

        const now = Date.now();

        const item = {
            id: `q${++conv.queueSeq}-${now.toString(36)}`,
            text,
            reasoningEffort: options.reasoningEffort || null,
            runFlags: options.runFlags && Object.keys(options.runFlags).length > 0 ? { ...options.runFlags } : null,
            kind: options.kind || "message",
            createdAt: now,
            updatedAt: now
        };

        if (options.front) {
            conv.queue.unshift(item);
        } else {
            conv.queue.push(item);
        }

        changed(conv);

        return itemView(item);
    }


    function edit(projectId, id, text) {

        const conv = conversations.get(projectId);
        const item = conv ? conv.queue.find(entry => entry.id === id) : null;

        if (!item) {
            return null;
        }

        item.text = text;
        item.updatedAt = Date.now();

        changed(conv);

        return itemView(item);
    }


    function remove(projectId, id) {

        const conv = conversations.get(projectId);
        const index = conv ? conv.queue.findIndex(entry => entry.id === id) : -1;

        if (index === -1) {
            return false;
        }

        conv.queue.splice(index, 1);
        changed(conv);

        return true;
    }


    function clear(projectId) {

        const conv = conversations.get(projectId);

        if (!conv || (conv.queue.length === 0 && !conv.queuePaused)) {
            return 0;
        }

        const dropped = conv.queue.length;

        conv.queue = [];
        conv.queuePaused = false;
        changed(conv);

        return dropped;
    }


    function setPaused(projectId, paused) {

        const conv = conversations.ensure(projectId);

        if (conv.queuePaused !== Boolean(paused)) {
            conv.queuePaused = Boolean(paused);
            changed(conv);
        }

        return view(projectId);
    }


    /*
    | Called when a project's turn has ended (or the operator resumed an
    | idle queue): the message that starts the next turn, or null. A turn
    | that ended cancelled pauses a non-empty queue.
    */
    function takeNext(conv, { turnEnded = true } = {}) {

        if (!conv) {
            return null;
        }

        reclaimCorrections(conv);

        if (conv.queue.length === 0) {
            return null;
        }

        if (turnEnded && conv.status === "cancelled" && !conv.queuePaused) {
            conv.queuePaused = true;
            changed(conv);
        }

        if (conv.queuePaused) {
            return null;
        }

        const item = conv.queue.shift();

        changed(conv);

        return item;
    }


    /* the console run of this project the correction belongs to */
    function runContextFor(conv) {

        const manager = runtime.runManager;

        if (!manager || typeof manager.activeRuns !== "function") {
            return null;
        }

        const candidates =
            [
                ...manager.activeRuns(),
                ...(typeof manager.queuedRuns === "function" ? manager.queuedRuns() : [])
            ].filter(run =>
                run.projectId === conv.projectId &&
                !run.parentRunId
            );

        return (
            candidates.find(run => run.turnId && run.turnId === conv.currentTurnId) ||
            candidates[candidates.length - 1] ||
            null
        );
    }


    /* hands a correction to the running turn; null when nothing is running */
    function offerCorrection(projectId, text) {

        const conv = conversations.get(projectId);

        if (!conv || conv.status !== "running") {
            return null;
        }

        const context = runContextFor(conv);

        if (!context) {
            return null;
        }

        const id = `c${++conv.queueSeq}-${Date.now().toString(36)}`;

        RunCorrections.offer(context, text, { id });

        if (!conv.correctionTargets) {
            conv.correctionTargets = new Set();
        }

        conv.correctionTargets.add(context);

        return { id, run_id: context.runId || null };
    }


    /* corrections the run ended before reading become the next message */
    function reclaimCorrections(conv) {

        if (!conv.correctionTargets) {
            return 0;
        }

        let moved = 0;

        for (const context of conv.correctionTargets) {

            const left =
                Array.isArray(context.pendingCorrections)
                    ? context.pendingCorrections.splice(0)
                    : [];

            for (const correction of left.reverse()) {

                const now = Date.now();

                conv.queue.unshift({
                    id: correction.id || `c${++conv.queueSeq}-${now.toString(36)}`,
                    text: correction.text,
                    reasoningEffort: null,
                    kind: "correction",
                    createdAt: correction.at || now,
                    updatedAt: now
                });

                moved++;
            }
        }

        conv.correctionTargets = null;

        if (moved > 0) {
            changed(conv);
        }

        return moved;
    }


    return {
        projectQueue: {
            add,
            clear,
            edit,
            enabled,
            offerCorrection,
            remove,
            setPaused,
            takeNext,
            view
        }
    };
};
