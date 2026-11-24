"use strict";

const { EVENT_TYPE_SET } = require("./EventTypes");

const REQUIRED_FIELDS = Object.freeze([
    "seq",
    "type",
    "at",
    "run_id",
    "turn_id",
    "scope",
    "iteration"
]);


/*
| Validation is additive. Unknown event names are allowed so introducing a
| new business event does not make old consumers crash; known names and the
| correlation envelope are still checked.
*/
class EventValidator {

    constructor({ requiredFields = REQUIRED_FIELDS, knownTypes = EVENT_TYPE_SET } = {}) {
        this.requiredFields = [...requiredFields];
        this.knownTypes = knownTypes;
    }


    problems(event) {

        const problems = [];

        if (!event || typeof event !== "object" || Array.isArray(event)) {
            return ["event must be an object"];
        }

        for (const field of this.requiredFields) {
            if (!Object.prototype.hasOwnProperty.call(event, field)) {
                problems.push(`event is missing envelope field ${field}`);
            }
        }

        if (typeof event.seq !== "number" || !Number.isFinite(event.seq)) {
            problems.push("event.seq must be a finite number");
        }

        if (typeof event.type !== "string" || event.type.trim() === "") {
            problems.push("event.type must be a non-empty string");
        }

        if (typeof event.at !== "number" || !Number.isFinite(event.at)) {
            problems.push("event.at must be a finite number");
        }

        if (
            Object.prototype.hasOwnProperty.call(event, "project_id") &&
            event.project_id !== null &&
            typeof event.project_id !== "string"
        ) {
            problems.push("event.project_id must be a string or null");
        }

        return problems;
    }


    validate(event) {

        const problems = this.problems(event);

        if (problems.length > 0) {
            throw new Error(`Event validation failed:\n- ${problems.join("\n- ")}`);
        }

        return true;
    }


    isKnownType(type) {
        return this.knownTypes.has(type);
    }
}


module.exports = {
    REQUIRED_FIELDS,
    EventValidator
};
