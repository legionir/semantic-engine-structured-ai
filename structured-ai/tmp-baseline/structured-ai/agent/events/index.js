"use strict";

const { EventBus } = require("./EventBus");
const { EventContext } = require("./EventContext");
const { EventValidator, REQUIRED_FIELDS } = require("./EventValidator");
const { EventProjector } = require("./EventProjector");
const EventRedactor = require("./EventRedactor");
const EventTypes = require("./EventTypes");


const eventBus = new EventBus();


module.exports = {
    EventBus,
    EventContext,
    EventValidator,
    EventProjector,
    EventRedactor,
    ...EventTypes,
    REQUIRED_FIELDS,
    eventBus,
    bus: eventBus.bus,
    emit: eventBus.emit.bind(eventBus),
    setContext: eventBus.setContext.bind(eventBus),
    runWithScope: eventBus.runWithScope.bind(eventBus),
    withProjectId: eventBus.withProjectId.bind(eventBus),
    resetSequence: eventBus.resetSequence.bind(eventBus),
    aggregateMetadata: eventBus.aggregateMetadata.bind(eventBus),
    visibleOnProjectStream: eventBus.visibleOnProjectStream.bind(eventBus),
    project: eventBus.project.bind(eventBus),
    redact: eventBus.redact.bind(eventBus),
    redactForLog: eventBus.redactForLog.bind(eventBus)
};
