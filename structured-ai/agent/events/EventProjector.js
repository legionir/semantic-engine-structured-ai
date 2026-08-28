"use strict";

/*
|--------------------------------------------------------------------------
| Event Projector — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Handles event projections for project streams, aggregate metadata, UI
| views, session storage, and deduplication for replay.
|--------------------------------------------------------------------------
*/

class EventProjector {

    static aggregateMetadata(event) {

        return {
            seq: event.seq,
            type: event.type,
            at: event.at,
            run_id: event.run_id,
            turn_id: event.turn_id,
            scope: event.scope,
            iteration: event.iteration,
            project_id: event.project_id ?? null,
            aggregate: true
        };
    }

    static visibleOnProjectStream(event, projectId) {

        if (event.project_id === projectId) {
            return event;
        }

        if (event.project_id) {
            return null;
        }

        return EventProjector.aggregateMetadata(event);
    }

    static toUI(event) {

        /* UI consumes the full correlation envelope and payload,
           with volatile numbers intact and additive fields available. */
        return {
            ...event,
            project_id: event.project_id ?? null
        };
    }

    static toSession(event) {

        /* Session projection for persistent replay */
        return {
            ...event,
            turn_id: event.turn_id || null,
            run_id: event.run_id || null,
            scope: event.scope || null,
            iteration: event.iteration ?? null
        };
    }

    static deduplicate(events) {

        if (!Array.isArray(events)) {
            return [];
        }

        const seen = new Set();
        const result = [];

        for (const event of events) {

            if (!event || typeof event !== "object") {
                continue;
            }

            const key = `${event.run_id || ""}|${event.seq}`;

            if (!seen.has(key)) {

                seen.add(key);
                result.push(event);
            }
        }

        return result;
    }
}

module.exports = {
    EventProjector,
    aggregateMetadata: EventProjector.aggregateMetadata,
    visibleOnProjectStream: EventProjector.visibleOnProjectStream
};
