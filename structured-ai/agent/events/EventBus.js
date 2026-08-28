"use strict";

const { EventEmitter } = require("events");
const { defaultContext } = require("./EventContext");
const { EventValidator } = require("./EventValidator");

/*
|--------------------------------------------------------------------------
| Event Bus — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Publishes structured events with monotonic sequences and execution
| correlation envelopes. Dispatches both to type-specific channels and to
| the unified "event" stream for observation, journal and event store.
|--------------------------------------------------------------------------
*/

class EventBus {

    constructor({
        context = defaultContext,
        validator = EventValidator,
        maxListeners = 64
    } = {}) {

        this.rawBus = new EventEmitter();
        this.rawBus.setMaxListeners(maxListeners);

        this.sequence = 0;
        this.context = context;
        this.validator = validator;
    }

    get bus() {

        return this.rawBus;
    }

    setMaxListeners(n) {

        this.rawBus.setMaxListeners(n);
    }

    resetSequence() {

        this.sequence = 0;
    }

    getSequence() {

        return this.sequence;
    }

    emit(type, payload = {}) {

        this.sequence++;

        const scoped = this.context.currentScope();

        const correlation =
            this.context.resolveCorrelation(payload);

        const event = {
            seq: this.sequence,
            type,
            at: Date.now(),
            ...correlation,
            ...payload
        };

        /* Additive: only a scoped (modular) event carries project_id, or if
           the payload explicitly supplies project_id, so legacy envelopes
           keep their historical fields bit for bit. */
        if (scoped || Object.prototype.hasOwnProperty.call(payload, "project_id")) {

            event.project_id =
                Object.prototype.hasOwnProperty.call(payload, "project_id")
                    ? payload.project_id
                    : (scoped ? scoped.project_id : null);
        }

        this.rawBus.emit("event", event);
        this.rawBus.emit(type, event);

        return event;
    }

    on(type, listener) {

        return this.rawBus.on(type, listener);
    }

    once(type, listener) {

        return this.rawBus.once(type, listener);
    }

    off(type, listener) {

        return this.rawBus.off(type, listener);
    }

    removeListener(type, listener) {

        return this.rawBus.removeListener(type, listener);
    }

    listeners(type) {

        return this.rawBus.listeners(type);
    }
}

const defaultEventBus = new EventBus();

module.exports = {
    EventBus,
    defaultEventBus
};
