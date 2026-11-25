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
        eventForClient,
        executionMessageKey,
        forStream,
        runtime,
        sessionsEnabled,
        sseHub,
        state
    } = shared;

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
                        plan: runtime.currentPlanView()
                    }
                    : rawEvent
            );

        state.events.push(event);

        /*
        | Stored in the same shape the browser received, so replaying a
        | session redraws exactly what the live run drew.
        */

        if (
            sessionsEnabled() &&
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
    }


    /*
    | The browser must receive model output even when session persistence is
    | disabled. Persistence is an optional storage feature; it must never
    | turn the live conversation into a single final-answer bubble.
    */
    runtime.events.bus.on("agent:response", event => {

        addMessage({
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

        addMessage({
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
                request.ownerTurnId = state.currentTurnId || null;

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
