"use strict";

/*
|--------------------------------------------------------------------------
| Web console stream hub (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| Who is watching, and what each of them is allowed to see.
|
| `broadcast` is the single funnel every runtime event passes on its way to
| the browser: it stamps the plan onto the events that carry one, records
| the event for replay, keeps the ring buffer capped, and writes each
| visible client. `eventForClient` is the boundary the multi-project console
| depends on: a project stream gets only its project's payload, a scoped
| token gets aggregate metadata for an event without a project, and a
| client that may not see an event gets `null` rather than a redacted copy.
|
| A write that throws drops the client instead of failing the run — the
| original does that and a broadcast must not be able to break a task.
|--------------------------------------------------------------------------
*/

const consoleAuth = require("../../agent/lib/consoleAuth");

function createSseHub(ctx) {

    const { runtime, state, clients } = ctx;

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
            ctx.forStream(
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
            ctx.settings.sessionsEnabled() &&
            event.type !== "session:message" &&
            event.type !== "session:switched"
        ) {

            state.session.events.push(event);
        }

        while (state.events.length > ctx.settings.maxConsoleEvents()) {
            state.events.shift();
        }

        for (const client of [...clients]) {

            const visible =
                eventForClient(event, client);

            if (!visible) {
                continue;
            }

            const payload =
                `data: ${JSON.stringify(visible)}\n\n`;

            try {

                client.res.write(payload);

            } catch {

                clients.delete(client);
            }
        }
    }

    function eventForClient(event, client) {

        if (!client) {
            return event;
        }

        const visibleOnProjectStream =
            runtime.events.visibleOnProjectStream;

        const aggregateMetadata =
            runtime.events.aggregateMetadata;

        if (client.projectId) {

            return typeof visibleOnProjectStream === "function"
                ? visibleOnProjectStream(event, client.projectId)
                : (event.project_id === client.projectId ? event : null);
        }

        if (
            client.claims &&
            !consoleAuth.allowsAllProjects(client.claims)
        ) {

            if (
                event.project_id &&
                !consoleAuth.allowsProject(client.claims, event.project_id)
            ) {
                return null;
            }

            if (!event.project_id && typeof aggregateMetadata === "function") {
                return aggregateMetadata(event);
            }
        }

        return event;
    }

    return {
        broadcast,
        eventForClient
    };
}

module.exports = {
    createSseHub
};
