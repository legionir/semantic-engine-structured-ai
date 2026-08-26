"use strict";

const { EventEmitter } = require("events");

const { EventContext } = require("./EventContext");
const { EventValidator } = require("./EventValidator");
const { EventProjector } = require("./EventProjector");
const EventRedactor = require("./EventRedactor");


/*
|--------------------------------------------------------------------------
| Event bus — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| One bus owns production and correlation. Storage/replay/UI consumers use
| the same event object; redaction is an explicit projection, never a silent
| mutation of the durable business event.
|--------------------------------------------------------------------------
*/

class EventBus {

    constructor({ bus, context, validator, projector, clock = Date } = {}) {
        this.bus = bus || new EventEmitter();
        this.bus.setMaxListeners(64);
        this.context = context || new EventContext();
        this.validator = validator || new EventValidator();
        this.projector = projector || new EventProjector();
        this.redactor = EventRedactor;
        this.clock = clock;
        this.sequence = 0;
    }


    currentScope() {
        return this.context.current();
    }


    runWithScope(initial, fn) {
        return this.context.runWithScope(initial, fn);
    }


    withProjectId(projectId, fn) {
        return this.context.withProjectId(projectId, fn);
    }


    setContext(patch) {
        return this.context.set(patch);
    }


    emit(type, payload = {}) {

        this.sequence++;

        const scoped = this.currentScope();
        const event = {
            seq: this.sequence,
            type,
            at: this.clock.now(),
            run_id: this.context.resolve(payload, "run_id"),
            turn_id: this.context.resolve(payload, "turn_id"),
            scope: this.context.resolve(payload, "scope"),
            iteration: this.context.resolve(payload, "iteration"),
            ...payload
        };

        /* Only a scoped event carries project_id, preserving legacy shape. */
        if (scoped) {
            event.project_id =
                Object.prototype.hasOwnProperty.call(payload, "project_id")
                    ? payload.project_id
                    : scoped.project_id;
        }

        this.validator.validate(event);
        this.bus.emit("event", event);
        this.bus.emit(type, event);
        return event;
    }


    resetSequence() {
        this.sequence = 0;
    }


    aggregateMetadata(event) {
        return this.projector.aggregateMetadata(event);
    }


    visibleOnProjectStream(event, projectId) {
        return this.projector.visibleOnProjectStream(event, projectId);
    }


    project(event, options) {
        return this.projector.project(event, options);
    }


    redact(event, options) {
        return this.redactor.redactEvent(event, options);
    }


    redactForLog(event) {
        return this.redactor.redactForLog(event);
    }
}


module.exports = {
    EventBus
};
