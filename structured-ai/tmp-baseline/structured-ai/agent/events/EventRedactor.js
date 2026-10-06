"use strict";

/*
| Event redaction — EXECUTION_PLAN Phase 27.
| Raw business events remain available to the event store; these helpers are
| used when an event is rendered into an operator log or external surface.
*/

const SECRET_KEY = /token|authorization|api[_-]?key|secret|password|credential/i;
const SOURCE_KEY = /^(content|source|raw|arguments|result)$/i;


function redact(value, { sourceContent = false, maxSourceChars = 240 } = {}) {

    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
        return sourceContent && value.length > maxSourceChars
            ? `${value.slice(0, maxSourceChars)}…`
            : value;
    }

    if (Array.isArray(value)) {
        return value.map(item => redact(item, { sourceContent, maxSourceChars }));
    }

    if (typeof value !== "object") return value;

    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (SECRET_KEY.test(key)) {
            output[key] = "****";
        } else {
            output[key] = redact(item, {
                sourceContent: sourceContent || SOURCE_KEY.test(key),
                maxSourceChars
            });
        }
    }
    return output;
}


function redactEvent(event, options) {
    return redact(event, options);
}


function redactForLog(event) {
    return redactEvent(event, { sourceContent: true });
}


module.exports = {
    SECRET_KEY,
    SOURCE_KEY,
    redact,
    redactEvent,
    redactForLog
};
