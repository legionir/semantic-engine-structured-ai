"use strict";

/* Event stream service — EXECUTION_PLAN Phase 23. */

class EventStreamService {

    constructor({ events, auth } = {}) {
        this.events = events;
        this.auth = auth;
    }


    visible(event, client) {

        if (!client) {
            return event;
        }

        if (client.projectId) {

            return typeof this.events.visibleOnProjectStream === "function"
                ? this.events.visibleOnProjectStream(event, client.projectId)
                : event.project_id === client.projectId
                    ? event
                    : null;
        }

        if (
            client.claims &&
            !this.auth.allowsAllProjects(client.claims)
        ) {

            if (
                event.project_id &&
                !this.auth.allowsProject(client.claims, event.project_id)
            ) {
                return null;
            }

            if (
                !event.project_id &&
                typeof this.events.aggregateMetadata === "function"
            ) {
                return this.events.aggregateMetadata(event);
            }
        }

        return event;
    }


    filter(events, client) {
        return events
            .map(event => this.visible(event, client))
            .filter(Boolean);
    }
}


module.exports = {
    EventStreamService
};
