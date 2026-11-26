"use strict";

/*
|--------------------------------------------------------------------------
| Headless output for CI (roadmap P3-07)
|--------------------------------------------------------------------------
|
| agent --json-schema result.schema.json "task"
|
|   The task gets one more paragraph: the final answer must be a JSON
|   value matching the schema. The answer is parsed (a ```json fence is
|   accepted), validated, and printed on stdout as JSON on its own:
|
|     valid     the value, exit 0
|     invalid   {"error": ..., "violations": [...], "raw": ...}, exit 3
|               (SCHEMA): the run finished but its output is unusable
|
| Exit codes of a headless run (agent --help lists them):
|
|   0 success   1 failed   2 usage   3 output does not match --json-schema
|   4 budget reached (time, MAX_RUN_COST_USD / --max-cost)   130 cancelled
|
| The validator covers the JSON Schema keywords structured outputs use:
| type (with arrays of types), properties, required, additionalProperties
| (false or a schema), items, enum, const, minimum/maximum,
| exclusiveMinimum/Maximum, minLength/maxLength, pattern, minItems/
| maxItems, anyOf, oneOf, allOf, nullable. $ref is not followed.
|--------------------------------------------------------------------------
*/

const fs = require("fs");


function typeOf(value) {

    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (Number.isInteger(value)) return "integer";

    return typeof value;
}


function typeMatches(value, type) {

    const actual = typeOf(value);

    if (type === "number") return actual === "number" || actual === "integer";

    return actual === type;
}


function validate(value, schema, at = "$", errors = []) {

    if (schema === true || schema === undefined || schema === null) return errors;

    if (schema === false) {
        errors.push(`${at}: no value is allowed here`);
        return errors;
    }

    if (schema.nullable === true && value === null) return errors;

    if (schema.type !== undefined) {

        const types = Array.isArray(schema.type) ? schema.type : [schema.type];

        if (!types.some(type => typeMatches(value, type))) {
            errors.push(`${at}: expected ${types.join(" or ")}, got ${typeOf(value)}`);
            return errors;
        }
    }

    if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
        errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
    }

    if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) {
        errors.push(`${at}: must be one of ${schema.enum.map(item => JSON.stringify(item)).join(", ")}`);
    }

    if (typeof value === "number") {
        if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${at}: must be >= ${schema.minimum}`);
        if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${at}: must be <= ${schema.maximum}`);
        if (Number.isFinite(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) errors.push(`${at}: must be > ${schema.exclusiveMinimum}`);
        if (Number.isFinite(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) errors.push(`${at}: must be < ${schema.exclusiveMaximum}`);
    }

    if (typeof value === "string") {
        if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
        if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
        if (typeof schema.pattern === "string") {
            try {
                if (!new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
            } catch {
                errors.push(`${at}: the schema pattern ${schema.pattern} is not a valid expression`);
            }
        }
    }

    if (Array.isArray(value)) {
        if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
        if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
        if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
            value.forEach((item, index) => validate(item, schema.items, `${at}[${index}]`, errors));
        }
    }

    if (typeOf(value) === "object") {

        const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};

        for (const name of Array.isArray(schema.required) ? schema.required : []) {
            if (!Object.prototype.hasOwnProperty.call(value, name)) errors.push(`${at}: missing required property ${name}`);
        }

        for (const [name, item] of Object.entries(value)) {

            if (Object.prototype.hasOwnProperty.call(properties, name)) {
                validate(item, properties[name], `${at}.${name}`, errors);
            } else if (schema.additionalProperties === false) {
                errors.push(`${at}: property ${name} is not allowed`);
            } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
                validate(item, schema.additionalProperties, `${at}.${name}`, errors);
            }
        }
    }

    if (Array.isArray(schema.allOf)) {
        schema.allOf.forEach(part => validate(value, part, at, errors));
    }

    if (Array.isArray(schema.anyOf) && !schema.anyOf.some(part => validate(value, part, at, []).length === 0)) {
        errors.push(`${at}: matches none of anyOf`);
    }

    if (Array.isArray(schema.oneOf)) {
        const matching = schema.oneOf.filter(part => validate(value, part, at, []).length === 0).length;
        if (matching !== 1) errors.push(`${at}: matches ${matching} of oneOf, expected exactly 1`);
    }

    return errors;
}


function loadSchema(file) {

    let text;

    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        throw new Error(`--json-schema: cannot read ${file}: ${error.message}`);
    }

    try {
        const schema = JSON.parse(text);
        if (!schema || typeof schema !== "object") throw new Error("not an object");
        return schema;
    } catch (error) {
        throw new Error(`--json-schema: ${file} is not a JSON schema object: ${error.message}`);
    }
}


function taskWithSchema(task, schema) {

    return [
        task,
        "",
        "Output contract: when you finish, the content of your final response must be ONLY a JSON value that matches this JSON Schema - no prose, no Markdown fence:",
        JSON.stringify(schema)
    ].join("\n");
}


/* the JSON value of a final answer's text, or throws */
function extractJson(text) {

    const raw = String(text ?? "").trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
    const body = fenced ? fenced[1] : raw;

    try {
        return JSON.parse(body);
    } catch {
        const start = body.search(/[[{]/);
        const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
        if (start !== -1 && end > start) return JSON.parse(body.slice(start, end + 1));
        throw new Error("the final answer is not JSON");
    }
}


/* { ok, value?, violations?, error?, raw } for a finished run's action */
function checkOutput(action, schema) {

    const raw = action && action.response ? action.response.content : null;

    if (action && action.error) {
        return { ok: false, error: `the run failed: ${typeof action.error === "string" ? action.error : JSON.stringify(action.error)}`, raw };
    }

    let value;

    try {
        value = extractJson(raw);
    } catch (error) {
        return { ok: false, error: error.message, raw };
    }

    const violations = validate(value, schema);

    return violations.length === 0
        ? { ok: true, value, raw }
        : { ok: false, error: "the final answer does not match the schema", violations, value, raw };
}


/* a stopped run's limit, from the error or the action: "budget" or null */
function budgetStop(errorOrAction) {

    const reason = errorOrAction && (errorOrAction.cancelledReason || errorOrAction.stop_reason);

    if (reason === "deadline" || reason === "cost_cap") return "budget";

    const text = String(
        (errorOrAction && (errorOrAction.message || (typeof errorOrAction.error === "string" ? errorOrAction.error : errorOrAction.error?.message))) || ""
    );

    return /\((?:deadline|cost_cap)\)|run budget of|cost cap of/.test(text) ? "budget" : null;
}


module.exports = { validate, loadSchema, taskWithSchema, extractJson, checkOutput, budgetStop };
