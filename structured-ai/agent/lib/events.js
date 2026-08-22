const { EventEmitter } = require("events");


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


function setContext(patch = {}) {

    for (const key of Object.keys(context)) {

        if (Object.prototype.hasOwnProperty.call(patch, key)) {
            context[key] = patch[key];
        }
    }
}


function emit(type, payload = {}) {

    sequence++;

    const event = {
        seq: sequence,

        type,

        at: Date.now(),

        run_id:
            Object.prototype.hasOwnProperty.call(payload, "run_id")
                ? payload.run_id
                : context.run_id,

        turn_id:
            Object.prototype.hasOwnProperty.call(payload, "turn_id")
                ? payload.turn_id
                : context.turn_id,

        scope:
            Object.prototype.hasOwnProperty.call(payload, "scope")
                ? payload.scope
                : context.scope,

        iteration:
            Object.prototype.hasOwnProperty.call(payload, "iteration")
                ? payload.iteration
                : context.iteration,

        ...payload
    };

    bus.emit("event", event);

    bus.emit(type, event);

    return event;
}


function resetSequence() {

    sequence = 0;
}


module.exports = {
    bus,
    emit,
    setContext,
    resetSequence
};
