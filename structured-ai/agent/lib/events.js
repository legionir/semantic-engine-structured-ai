const { EventEmitter } = require("events");

const { AsyncLocalStorage } = require("async_hooks");


/*
|--------------------------------------------------------------------------
| Runtime Events
|--------------------------------------------------------------------------
|
| The runtime already reports what it does through log lines, which is
| enough for a terminal but not for a UI that has to draw a delegation
| tree and offer approval buttons. The same moments are therefore also
| published as structured events.
|
| Nothing in the runtime depends on a listener being attached, so the CLI
| and the tests are unaffected.
|
| Every event carries a correlation envelope (run_id, turn_id, scope,
| iteration) so the journal, the session, the archive and the UI can all
| attribute an event to the same run, turn and step. The runtime sets the
| current context with setContext(); an emit may override any field via its
| own payload.
|
| With runWithScope() (Phase 3, RUN_CONTEXT_MODE=modular) a whole async
| chain gets its own context: setContext writes land in the scope instead
| of the process-global object, and emitted envelopes are read back from
| it. Concurrent runs therefore cannot overwrite each other's attribution.
| A scoped envelope additionally carries project_id (additive); events
| emitted without a scope keep the exact legacy shape.
|--------------------------------------------------------------------------
*/

const bus = new EventEmitter();

bus.setMaxListeners(64);

let sequence = 0;

const context = {
    run_id: null,
    turn_id: null,
    scope: null,
    iteration: null
};


const scopeStorage = new AsyncLocalStorage();


function currentScope() {

    return scopeStorage.getStore() || null;

}


/* Runs fn with its own correlation context; leaving the chain restores
   whatever the caller saw, so no cleanup pass is needed after a run. */
function runWithScope(initial = {}, fn) {

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

    return scopeStorage.run(scope, fn);

}


function setContext(patch = {}) {

    const scoped = currentScope();

    const target = scoped || context;

    for (const key of Object.keys(context)) {

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


function emit(type, payload = {}) {

    sequence++;

    const scoped = currentScope();

    const resolve = (key) =>
        Object.prototype.hasOwnProperty.call(payload, key)
            ? payload[key]
            : (scoped ? scoped[key] : context[key]);

    const event = {
        seq: sequence,

        type,

        at: Date.now(),

        run_id: resolve("run_id"),

        turn_id: resolve("turn_id"),

        scope: resolve("scope"),

        iteration: resolve("iteration"),

        ...payload
    };

    /* Additive: only a scoped (modular) event carries the project, so
       legacy envelopes keep their historical fields bit for bit. */
    if (scoped) {

        event.project_id =
            Object.prototype.hasOwnProperty.call(payload, "project_id")
                ? payload.project_id
                : scoped.project_id;

    }

    bus.emit("event", event);

    bus.emit(type, event);

    return event;
}


function resetSequence() {

    sequence = 0;
}


/* Phase 9: a project stream sees that project's events in full and
   global (unscoped) events as aggregate metadata only. Another
   project's events are omitted entirely. */
function aggregateMetadata(event) {

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


/* Phase 12: a Sub-Agent may run under a different project than the
   parent run. Nest a scope that keeps the parent's run/turn and
   replaces only project_id. Outside a scope (legacy) this is a no-op
   so envelopes stay historically shaped. */
function withProjectId(projectId, fn) {

    const scoped = currentScope();

    if (!scoped) {
        return fn();
    }

    return runWithScope({
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


function visibleOnProjectStream(event, projectId) {

    if (event.project_id === projectId) {
        return event;
    }

    if (event.project_id) {
        return null;
    }

    return aggregateMetadata(event);
}


module.exports = {
    bus,
    emit,
    setContext,
    runWithScope,
    withProjectId,
    resetSequence,
    aggregateMetadata,
    visibleOnProjectStream
};
