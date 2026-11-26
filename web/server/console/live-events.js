"use strict";

/*
|--------------------------------------------------------------------------
| Live events
|--------------------------------------------------------------------------
|
| Connects the runtime's event bus, process output and approval handler
| to the browser's event stream. Registering the listeners is a side
| effect of calling the factory, so it is called exactly once.
|
| Part of the console server's closure (ServerImplementation): it reads what
| it needs from `shared`, which the earlier factories have filled in, and
| returns what the later ones and the request handler use.
|
*/

const ProcessOutputBus = require("../../../agent/tools/process/ProcessOutputBus");


module.exports = function createLiveEvents(shared) {

    const {
        addMessage,
        approvalStore,
        conversations,
        conversationsFor,
        eventForClient,
        executionMessageKey,
        forStream,
        runtime,
        sessionsEnabled,
        sseHub,
        state
    } = shared;

    /* the plan an event carries is its own project's, even when the
       event is emitted outside the run (run:status of a project turn) */
    function planViewFor(projectId) {

        if (
            !projectId ||
            typeof runtime.runWithProject !== "function" ||
            typeof runtime.resolveRunProjectContext !== "function"
        ) {
            return runtime.currentPlanView();
        }

        try {

            return runtime.runWithProject(
                runtime.resolveRunProjectContext({ projectId }),
                () => runtime.currentPlanView()
            );

        } catch {

            return runtime.currentPlanView();
        }
    }


    /*
    | Every console learns how every conversation it may see is doing (the
    | tabs' badges, notifications), whichever project its stream shows. The
    | summary is not a runtime event: it is pushed beside the stream, at
    | most once per tick, when a conversation may have changed state.
    */
    const SUMMARY_TRIGGERS = new Set([
        "run:start",
        "run:status",
        "approval:request",
        "approval:resolved",
        "queue:changed",
        "session:cleared"
    ]);

    let summaryPending = false;

    function scheduleSummary() {

        if (summaryPending) {
            return;
        }

        summaryPending = true;

        setImmediate(() => {

            summaryPending = false;

            const list = conversations.list();

            sseHub.broadcast(
                { type: "conversations", conversations: list },
                (value, client) => ({
                    ...value,
                    conversations: conversationsFor(client.claims, value.conversations)
                })
            );
        });
    }


    function broadcast(rawEvent) {

        const carriesPlan =
            rawEvent.type === "run:start" ||
            rawEvent.type === "run:status" ||
            rawEvent.type === "run:continue" ||
            rawEvent.type === "plan:autoroute:end" ||
            (
                rawEvent.type === "tool:end" &&
                rawEvent.success === true &&
                ["plan_set", "plan_update"].includes(rawEvent.name)
            );

        const event =
            forStream(
                carriesPlan
                    ? {
                        ...rawEvent,
                        plan: planViewFor(rawEvent.project_id)
                    }
                    : rawEvent
            );

        state.events.push(event);

        /* each project replays its own events, whatever else ran (P1-03) */
        conversations.recordEvent(event);

        /*
        | Stored in the same shape the browser received, so replaying a
        | session redraws exactly what the live run drew. A background turn
        | belongs to its project's conversation, not the foreground session.
        */

        if (
            sessionsEnabled() &&
            !conversations.backgroundOwnerOf(event) &&
            event.type !== "session:message" &&
            event.type !== "session:switched"
        ) {

            state.session.events.push(event);
        }

        while (state.events.length > runtime.settings.get("MAX_CONSOLE_EVENTS")) {
            state.events.shift();
        }

        sseHub.broadcast(
            event,
            (value, client) => eventForClient(value, client)
        );

        if (SUMMARY_TRIGGERS.has(event.type)) {
            scheduleSummary();
        }
    }


    /*
    | The browser must receive model output even when session persistence is
    | disabled. Persistence is an optional storage feature; it must never
    | turn the live conversation into a single final-answer bubble.
    */
    /* a background turn's message goes to its own conversation */
    function messageFor(event, entry) {

        const owner = conversations.backgroundOwnerOf(event);

        return owner
            ? conversations.addMessage(owner, entry)
            : addMessage(entry);
    }


    runtime.events.bus.on("agent:response", event => {

        messageFor(event, {
            role: "assistant",
            kind: "model",
            agent: event.scope || event.agent,
            iteration: event.iteration,
            turn_id: event.turn_id,
            execution_key: executionMessageKey(event),
            finish_reason: event.finish_reason,
            truncated: event.truncated,
            content: event.content
        });
    });


    /*
    | Reasoning is part of the conversation for a reader, so it is kept
    | as its own entry rather than folded into the answer. This handles both
    | the live stream and the stored conversation through addMessage.
    */
    runtime.events.bus.on("agent:thinking", event => {

        messageFor(event, {
            role: "assistant",
            kind: "thinking",
            agent: event.scope || event.agent,
            iteration: event.iteration,
            turn_id: event.turn_id,
            execution_key: executionMessageKey(event),
            content: event.content
        });
    });


    runtime.events.bus.on("event", broadcast);

    const broadcastProcessOutput = output => {
        sseHub.broadcast(
            { type: "process:output", ...output },
            (event, client) => eventForClient(event, client)
        );
    };
    ProcessOutputBus.on(ProcessOutputBus.outputEvent, broadcastProcessOutput);


    /*
    | An approval becomes a pending question the browser can answer. The
    | policy layer creates the pending record; this adapter only connects it
    | to the console's event stream and response endpoint.
    */

    runtime.setApprovalHandler(
        runtime.policyEngine.approvalManager.createPendingHandler({
            store: approvalStore,
            createId: (_evaluation, _args, store) =>
                `approval_${store.pendingSize() + 1}_${Date.now()}`,
            projectIdOf: evaluation =>
                evaluation.project_id ||
                (runtime.runManager && runtime.runManager.current
                    ? runtime.runManager.current()?.projectId
                    : null) ||
                state.projectId ||
                null,
            onRequest: (request, args) => {

                /*
                | Stamp the run that owns this pending approval. A run's
                | end-of-life cleanup may only resolve approvals it created;
                | otherwise a finishing run (whose finally is still draining
                | the git report / eventstore) silently auto-denies an
                | approval a newer run has already surfaced. `request` is the
                | same object the store holds, so this mutation is visible to
                | the sweep below.
                */
                const run =
                    runtime.runManager && typeof runtime.runManager.current === "function"
                        ? runtime.runManager.current()
                        : null;

                /* the turn of the run that asked, so a background project's
                   approval reaches (and is swept by) its own conversation */
                request.ownerTurnId =
                    (run && run.turnId) || state.currentTurnId || null;

                runtime.events.emit("approval:request", {
                    id: request.id,
                    agent: request.agent,
                    tool: request.tool,
                    reason: request.reason,
                    groups: request.groups,
                    arguments: args,
                    project_id: request.project_id,
                    turn_id: request.ownerTurnId
                });
            }
        })
    );


    function resolveApproval(id, approved) {

        const request =
            approvalStore.removePending(id);

        if (!request) {
            return false;
        }

        request.resolve(approved);

        runtime.events.emit("approval:resolved", {
            id,
            tool: request.tool,
            approved,
            project_id: request.project_id || null
        });

        return true;
    }

    return {
        broadcastProcessOutput,
        resolveApproval
    };
};
