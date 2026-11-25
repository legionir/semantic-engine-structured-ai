"use strict";

/*
| Event projection — EXECUTION_PLAN Phase 27.
| Project streams receive their own events in full and unscoped events as
| aggregate metadata; another project's event is never projected.
*/

class EventProjector {

    aggregateMetadata(event) {
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


    visibleOnProjectStream(event, projectId) {
        if (event.project_id === projectId) return event;
        if (event.project_id) return null;
        return this.aggregateMetadata(event);
    }


    project(event, { projectId = null, claims, auth } = {}) {

        if (projectId) {
            return this.visibleOnProjectStream(event, projectId);
        }

        if (
            claims &&
            auth &&
            !auth.allowsAllProjects(claims)
        ) {
            if (
                event.project_id &&
                !auth.allowsProject(claims, event.project_id)
            ) return null;
            if (!event.project_id) return this.aggregateMetadata(event);
        }

        return event;
    }


    replay(events, options) {
        return (events || [])
            .map(event => this.project(event, options))
            .filter(Boolean);
    }
}


module.exports = {
    EventProjector
};
