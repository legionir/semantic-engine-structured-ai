"use strict";

const { AsyncLocalStorage } = require("async_hooks");

/*
| Correlation context — EXECUTION_PLAN Phase 27.
| Global context is retained for legacy callers; modular runs use an async
| scope so concurrent run/turn/project attribution cannot overwrite it.
*/

const CONTEXT_FIELDS = Object.freeze([
    "run_id",
    "turn_id",
    "scope",
    "iteration"
]);


class EventContext {

    constructor() {
        this.global = {
            run_id: null,
            turn_id: null,
            scope: null,
            iteration: null
        };
        this.storage = new AsyncLocalStorage();
    }


    current() {
        return this.storage.getStore() || null;
    }


    runWithScope(initial = {}, fn) {

        const scope = {
            run_id: null,
            turn_id: null,
            scope: null,
            iteration: null,
            project_id:
                Object.prototype.hasOwnProperty.call(initial, "project_id")
                    ? initial.project_id
                    : null
        };

        for (const key of CONTEXT_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(initial, key)) {
                scope[key] = initial[key];
            }
        }

        return this.storage.run(scope, fn);
    }


    withProjectId(projectId, fn) {

        const scoped = this.current();

        if (!scoped) {
            return fn();
        }

        return this.runWithScope({
            run_id: scoped.run_id,
            turn_id: scoped.turn_id,
            scope: scoped.scope,
            iteration: scoped.iteration,
            project_id:
                projectId === undefined
                    ? scoped.project_id
                    : projectId
        }, fn);
    }


    set(patch = {}) {

        const scoped = this.current();
        const target = scoped || this.global;

        for (const key of CONTEXT_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                target[key] = patch[key];
            }
        }

        if (
            scoped &&
            Object.prototype.hasOwnProperty.call(patch, "project_id")
        ) {
            scoped.project_id = patch.project_id;
        }
    }


    resolve(payload, key) {

        return Object.prototype.hasOwnProperty.call(payload, key)
            ? payload[key]
            : (this.current() ? this.current()[key] : this.global[key]);
    }
}


module.exports = {
    CONTEXT_FIELDS,
    EventContext
};
