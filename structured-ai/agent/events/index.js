"use strict";

const EventTypes = require("./EventTypes");
const { KNOWN_EVENT_TYPES, TURN_ID_DEFINITION, isKnownType } = EventTypes;
const { EventContext, defaultContext } = require("./EventContext");
const { EventValidator } = require("./EventValidator");
const { EventRedactor } = require("./EventRedactor");
const { EventProjector, aggregateMetadata, visibleOnProjectStream } = require("./EventProjector");
const { EventBus, defaultEventBus } = require("./EventBus");

/*
|--------------------------------------------------------------------------
| Event Subsystem — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Central hub for the event bus, contract validation, correlation context,
| redaction, and project-aware projections.
|--------------------------------------------------------------------------
*/

module.exports = {
    /* Legacy / ambient interface (preserves exact historical exports) */
    bus: defaultEventBus.bus,
    emit: (type, payload) => defaultEventBus.emit(type, payload),
    setContext: patch => defaultContext.setContext(patch),
    runWithScope: (initial, fn) => defaultContext.runWithScope(initial, fn),
    withProjectId: (projectId, fn) => defaultContext.withProjectId(projectId, fn),
    resetSequence: () => defaultEventBus.resetSequence(),
    aggregateMetadata,
    visibleOnProjectStream,

    /* Modular classes and definitions */
    EventBus,
    EventTypes,
    EventValidator,
    EventContext,
    EventProjector,
    EventRedactor,
    KNOWN_EVENT_TYPES,
    TURN_ID_DEFINITION,
    isKnownType,
    defaultEventBus,
    defaultContext
};
