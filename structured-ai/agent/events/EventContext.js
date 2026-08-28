"use strict";

const { AsyncLocalStorage } = require("async_hooks");

/*
|--------------------------------------------------------------------------
| Event Correlation Context — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Manages async-local and ambient correlation contexts (run_id, turn_id,
| scope, iteration, project_id). Ensures that concurrent runs cannot
| overwrite each other's attribution and Sub-Agents maintain proper scoping.
|--------------------------------------------------------------------------
*/

class EventContext {

    constructor() {

        this.globalContext = {
            run_id: null,
            turn_id: null,
            scope: null,
            iteration: null
        };

        this.scopeStorage = new AsyncLocalStorage();
    }

    currentScope() {

        return this.scopeStorage.getStore() || null;
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

        for (const key of ["run_id", "turn_id", "scope", "iteration"]) {

            if (Object.prototype.hasOwnProperty.call(initial, key)) {
                scope[key] = initial[key];
            }
        }

        return this.scopeStorage.run(scope, fn);
    }

    withProjectId(projectId, fn) {

        const scoped = this.currentScope();

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

    setContext(patch = {}) {

        const scoped = this.currentScope();
        const target = scoped || this.globalContext;

        for (const key of Object.keys(this.globalContext)) {

            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                target[key] = patch[key];
            }
        }

        /* project_id lives only on a scoped (modular) envelope; a nested
           Sub-Agent may retarget it for its own async chain without
           touching the process-global context. */
        if (
            scoped &&
            Object.prototype.hasOwnProperty.call(patch, "project_id")
        ) {
            scoped.project_id = patch.project_id;
        }
    }

    resolveCorrelation(payload = {}) {

        const scoped = this.currentScope();

        const resolve = key =>
            Object.prototype.hasOwnProperty.call(payload, key)
                ? payload[key]
                : (scoped ? scoped[key] : this.globalContext[key]);

        const correlation = {
            run_id: resolve("run_id"),
            turn_id: resolve("turn_id"),
            scope: resolve("scope"),
            iteration: resolve("iteration")
        };

        if (scoped) {

            correlation.project_id =
                Object.prototype.hasOwnProperty.call(payload, "project_id")
                    ? payload.project_id
                    : scoped.project_id;
        }

        return correlation;
    }

    getSnapshot() {

        const scoped = this.currentScope();

        return {
            ...(scoped || this.globalContext),
            isScoped: scoped !== null
        };
    }
}

const defaultContext = new EventContext();

module.exports = {
    EventContext,
    defaultContext
};
