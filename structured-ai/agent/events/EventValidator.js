"use strict";

const {
    ENVELOPE_REQUIRED_FIELDS,
    KEY_PAYLOADS,
    isKnownType
} = require("./EventTypes");

/*
|--------------------------------------------------------------------------
| Event Validator — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Validates that emitted events conform to the correlation envelope and key
| payload contracts.
|--------------------------------------------------------------------------
*/

class EventValidator {

    static validateEnvelope(event) {

        const errors = [];

        if (!event || typeof event !== "object" || Array.isArray(event)) {

            return ["event must be a non-null object"];
        }

        for (const field of ENVELOPE_REQUIRED_FIELDS) {

            if (!Object.prototype.hasOwnProperty.call(event, field)) {

                errors.push(`missing required envelope field: ${field}`);
            }
        }

        if (typeof event.seq !== "number" || !Number.isInteger(event.seq) || event.seq < 0) {

            errors.push(`invalid seq: expected non-negative integer, got ${event.seq}`);
        }

        if (typeof event.type !== "string" || event.type.trim() === "") {

            errors.push(`invalid type: expected non-empty string, got ${event.type}`);
        }

        if (typeof event.at !== "number" || !Number.isFinite(event.at) || event.at <= 0) {

            errors.push(`invalid at: expected positive epoch timestamp, got ${event.at}`);
        }

        if (event.run_id !== null && typeof event.run_id !== "string") {

            errors.push(`invalid run_id: expected string or null, got ${typeof event.run_id}`);
        }

        if (event.turn_id !== null && typeof event.turn_id !== "string") {

            errors.push(`invalid turn_id: expected string or null, got ${typeof event.turn_id}`);
        }

        if (event.scope !== null && typeof event.scope !== "string") {

            errors.push(`invalid scope: expected string or null, got ${typeof event.scope}`);
        }

        if (
            event.iteration !== null &&
            (typeof event.iteration !== "number" || !Number.isFinite(event.iteration))
        ) {

            errors.push(`invalid iteration: expected number or null, got ${event.iteration}`);
        }

        if (
            Object.prototype.hasOwnProperty.call(event, "project_id") &&
            event.project_id !== null &&
            typeof event.project_id !== "string"
        ) {

            errors.push(`invalid project_id: expected string or null, got ${typeof event.project_id}`);
        }

        return errors;
    }

    static validateKeyPayload(event) {

        const errors = [];

        if (!event || typeof event !== "object") {

            return errors;
        }

        const requiredFields = KEY_PAYLOADS[event.type];

        if (Array.isArray(requiredFields)) {

            for (const field of requiredFields) {

                if (
                    !Object.prototype.hasOwnProperty.call(event, field) ||
                    event[field] === null ||
                    event[field] === undefined
                ) {

                    errors.push(
                        `event ${event.type} is missing documented key payload field: ${field}`
                    );
                }
            }
        }

        return errors;
    }

    static validate(event) {

        const envelopeErrors = EventValidator.validateEnvelope(event);
        const payloadErrors = EventValidator.validateKeyPayload(event);

        const errors = [...envelopeErrors, ...payloadErrors];

        return {
            valid: errors.length === 0,
            errors
        };
    }

    static assertValid(event) {

        const { valid, errors } = EventValidator.validate(event);

        if (!valid) {

            throw new Error(`Event contract violation: ${errors.join("; ")}`);
        }

        return true;
    }
}

module.exports = {
    EventValidator
};
